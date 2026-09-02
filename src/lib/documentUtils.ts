import { DocumentTab, StartupViewMode, ViewMode } from '@/types';

const VALID_VIEW_MODES: readonly ViewMode[] = ['edit', 'split', 'read'];

/**
 * Generates a unique, collision-resistant document tab ID.
 * Prefers crypto.randomUUID() when available in modern browsers / WebView2,
 * with a timestamp-random fallback.
 */
export function generateDocId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `doc-${crypto.randomUUID()}`;
  }
  const timestamp = Date.now().toString(36);
  const randomPart = Math.random().toString(36).substring(2, 10);
  return `doc-${timestamp}-${randomPart}`;
}

/**
 * Extracts the file name from a Windows or POSIX file path.
 */
export function getFileNameFromPath(filePath?: string | null): string {
  if (!filePath) return '未命名.md';
  const parts = filePath.split(/[/\\]/);
  const lastPart = parts[parts.length - 1];
  return lastPart && lastPart.trim().length > 0 ? lastPart.trim() : '未命名.md';
}

/**
 * Normalizes file path keys for comparison and deduplication.
 * - Standardizes all backslashes to forward slashes.
 * - Collapses redundant consecutive slashes.
 * - Preserves UNC paths and custom protocols (e.g. browser://).
 * - Trims leading/trailing whitespace.
 * - Ignores case (essential for Windows file paths).
 */
export function normalizePathKey(filePath?: string | null): string {
  if (!filePath) return '';
  const trimmed = filePath.trim();
  if (!trimmed) return '';

  const isUNC = trimmed.startsWith('\\\\') || trimmed.startsWith('//');
  const isWindowsDrive = /^[a-zA-Z]:[/\\]/.test(trimmed);

  // Replace all backslashes with forward slashes
  let normalized = trimmed.replace(/\\/g, '/');

  // Handle custom URI schemes (e.g., browser://), excluding Windows drive letters (e.g., C:/)
  if (!isWindowsDrive && /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(normalized)) {
    const colonIdx = normalized.indexOf('://');
    const scheme = normalized.slice(0, colonIdx);
    const rest = normalized.slice(colonIdx + 3);
    normalized = `${scheme}://${rest.replace(/\/+/g, '/')}`;
  } else {
    normalized = normalized.replace(/\/+/g, '/');
    if (isUNC) {
      normalized = '/' + normalized;
    }
  }

  // Remove trailing slash unless it is root (e.g., "/" or "C:/")
  if (normalized.length > 1 && normalized.endsWith('/')) {
    if (!/^[a-zA-Z]:\/$/.test(normalized)) {
      normalized = normalized.replace(/\/+$/, '');
    }
  }

  return normalized.toLowerCase();
}

/**
 * Computes default export filename for a document given its title and target format.
 * Strips existing markdown/document extensions (.md, .markdown, .mdown, .mkd, .txt, .docx, .pdf, .html, .htm)
 * and appends the target format extension.
 */
export function getExportFilename(
  title?: string | null,
  format: 'docx' | 'pdf' | 'html' = 'docx'
): string {
  if (!title || !title.trim()) {
    return `未命名.${format}`;
  }
  const cleanTitle = title
    .trim()
    .replace(/\.(md|markdown|mdown|mkd|txt|docx|pdf|html|htm)$/i, '')
    .trim();
  return `${cleanTitle || '未命名'}.${format}`;
}

export interface OpenOrFocusResult {
  tabs: DocumentTab[];
  activeTabId: string;
  action: 'opened' | 'focused';
  tab: DocumentTab;
}

/**
 * Pure helper to compute the next DocumentTab list and active tab state
 * when opening a file or focusing an already opened tab.
 *
 * Deterministic guarantees:
 * - If the file path is already open (case-insensitive / normalized), focuses that tab without duplicating it.
 * - If the only existing tab is an untouched/pristine welcome tab, replaces it with the newly opened file.
 * - Otherwise appends the newly opened file as a new tab and activates it.
 */
export function openOrFocusDocumentState(
  currentTabs: DocumentTab[],
  filePath: string,
  content: string,
  title?: string,
  fileMtime?: number
): OpenOrFocusResult {
  const targetPathKey = normalizePathKey(filePath);
  const existing = currentTabs.find(
    (t) => t.filePath && normalizePathKey(t.filePath) === targetPathKey
  );

  if (existing) {
    return {
      tabs: currentTabs,
      activeTabId: existing.id,
      action: 'focused',
      tab: existing,
    };
  }

  const id = generateDocId();
  const newTitle = title || getFileNameFromPath(filePath);
  const newTab: DocumentTab = {
    id,
    title: newTitle,
    filePath,
    content,
    savedContent: content,
    isDirty: false,
    cursorLine: 1,
    cursorCol: 1,
    fileMtime,
  };

  const isPristineWelcome =
    currentTabs.length === 1 &&
    currentTabs[0].id === 'doc-welcome' &&
    !currentTabs[0].isDirty &&
    currentTabs[0].filePath === null;

  const nextTabs = isPristineWelcome ? [newTab] : [...currentTabs, newTab];

  return {
    tabs: nextTabs,
    activeTabId: id,
    action: 'opened',
    tab: newTab,
  };
}

/**
 * Pure function to compute the new DocumentTab state after a successful save operation.
 * Ensures the savedContent matches the snapshot written to disk, and recalculates
 * isDirty against the user's current content to prevent race condition data loss.
 */
export function computeSavedTabState(
  tab: DocumentTab,
  targetPath: string,
  savedSnapshot: string,
  fileMtime?: number
): DocumentTab {
  const fileName = getFileNameFromPath(targetPath);
  return {
    ...tab,
    filePath: targetPath,
    title: fileName,
    savedContent: savedSnapshot,
    isDirty: tab.content !== savedSnapshot,
    fileMtime: fileMtime !== undefined ? fileMtime : tab.fileMtime,
  };
}

/**
 * Creates a default clean document tab.
 */
export function createDefaultTab(
  title?: string,
  content = '',
  id?: string
): DocumentTab {
  const docId = id || generateDocId();
  const docTitle = title || '未命名文档.md';
  return {
    id: docId,
    title: docTitle,
    filePath: null,
    content,
    savedContent: content,
    isDirty: false,
    cursorLine: 1,
    cursorCol: 1,
  };
}

export type ExternalChangeAction = 'none' | 'baseline' | 'reload' | 'prompt';

/**
 * Pure decision logic for external file modification handling.
 *
 * - 'none': nothing to do (cannot stat file, or mtime unchanged, or content unreadable).
 * - 'baseline': silently adopt the new mtime as the known baseline
 *   (first time we learn the mtime, or only mtime/content reverted to saved state).
 * - 'reload': file changed on disk and the tab has no unsaved edits → safe to auto-reload.
 * - 'prompt': file changed on disk but the tab has unsaved edits → ask the user.
 */
export function decideExternalChangeAction(
  tab: Pick<DocumentTab, 'fileMtime' | 'savedContent' | 'isDirty'>,
  currentMtime: number | null,
  currentContent: string | null
): ExternalChangeAction {
  if (currentMtime === null || Number.isNaN(currentMtime)) return 'none';
  if (tab.fileMtime === undefined) return 'baseline';
  if (currentMtime === tab.fileMtime) return 'none';
  if (currentContent === null) return 'none';
  if (currentContent === tab.savedContent) return 'baseline';
  return tab.isDirty ? 'prompt' : 'reload';
}

/**
 * Pure helper for drag-and-drop tab reordering.
 * Returns a new array with `sourceId` inserted before/after `targetId`.
 * Returns the original array reference when the move is a no-op.
 */
export function moveTabState(
  tabs: DocumentTab[],
  sourceId: string,
  targetId: string,
  position: 'before' | 'after'
): DocumentTab[] {
  const from = tabs.findIndex((t) => t.id === sourceId);
  if (from === -1 || sourceId === targetId) return tabs;
  if (!tabs.some((t) => t.id === targetId)) return tabs;

  const next = [...tabs];
  const [moved] = next.splice(from, 1);
  const to = next.findIndex((t) => t.id === targetId);
  const insertAt = position === 'before' ? to : to + 1;
  next.splice(insertAt, 0, moved);
  return next;
}

/**
 * Creates a side-by-side diff/compare tab referencing two document tabs.
 * Content snapshots are captured so the diff remains viewable even if a
 * source tab is later closed (that side then becomes read-only).
 */
export function createDiffTabState(
  left: DocumentTab,
  right: DocumentTab,
  id?: string
): DocumentTab {
  return {
    id: id || generateDocId(),
    title: `${left.title} ↔ ${right.title}`,
    filePath: null,
    content: '',
    savedContent: '',
    isDirty: false,
    cursorLine: 1,
    cursorCol: 1,
    kind: 'diff',
    diffRefs: {
      left: { tabId: left.id, title: left.title, snapshot: left.content },
      right: { tabId: right.id, title: right.title, snapshot: right.content },
    },
  };
}

/**
 * Sanitizes the per-tab view mode of tabs restored from a persisted session.
 * - Drops corrupted/unknown viewMode values so tabs fall back to the default.
 * - When startupView is an explicit mode (not 'remember-last'), clears all
 *   stored per-tab modes so every restored tab starts in the configured
 *   startup view.
 */
export function sanitizeRestoredTabs(
  tabs: DocumentTab[],
  startupView: StartupViewMode
): DocumentTab[] {
  return tabs.map((tab) => {
    const stored = tab.viewMode;
    const valid = VALID_VIEW_MODES.includes(stored as ViewMode) ? stored : undefined;
    return {
      ...tab,
      viewMode: startupView === 'remember-last' ? valid : undefined,
    };
  });
}
