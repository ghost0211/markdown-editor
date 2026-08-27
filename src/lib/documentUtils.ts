import { DocumentTab } from '@/types';

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
 * Strips existing markdown/document extensions (.md, .markdown, .mdown, .txt, .docx, .pdf)
 * and appends the target format extension.
 */
export function getExportFilename(
  title?: string | null,
  format: 'docx' | 'pdf' = 'docx'
): string {
  if (!title || !title.trim()) {
    return `未命名.${format}`;
  }
  const cleanTitle = title
    .trim()
    .replace(/\.(md|markdown|mdown|txt|docx|pdf)$/i, '')
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
  title?: string
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
  savedSnapshot: string
): DocumentTab {
  const fileName = getFileNameFromPath(targetPath);
  return {
    ...tab,
    filePath: targetPath,
    title: fileName,
    savedContent: savedSnapshot,
    isDirty: tab.content !== savedSnapshot,
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
