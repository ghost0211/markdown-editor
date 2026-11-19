import type { TranslationKey, TranslationParams } from '@/i18n';
import { DocumentTab, ToastType } from '@/types';
import {
  computeSavedTabState,
  decideAutoSave,
  getExportFilename,
  getFileNameFromPath,
  isAutoSaveEligible,
  normalizePathKey,
} from '@/lib/documentUtils';
import { documentRequiresXmd } from '@/lib/xmdSaveFormat';
import { rebaseDocumentResources } from '@/lib/workspaceDocuments';

/**
 * Minimal keyed async queue.
 *
 * Tasks with the same key run strictly one after another; different keys run
 * concurrently. A rejected task never poisons the chain, so a failed save does
 * not stop the next save of the same document. Settled keys are removed from
 * the map to keep memory proportional to the number of *active* saves.
 */
export interface KeyedAsyncQueue {
  run<T>(key: string, task: () => Promise<T>): Promise<T>;
  isBusy(key: string): boolean;
  /** Resolves once the given key (or every key, when omitted) has settled. */
  whenIdle(key?: string): Promise<void>;
}

export function createKeyedAsyncQueue(): KeyedAsyncQueue {
  const tails = new Map<string, Promise<unknown>>();

  return {
    run<T>(key: string, task: () => Promise<T>): Promise<T> {
      const previous = tails.get(key) ?? Promise.resolve();
      // Swallow the previous result/error: this save has its own outcome.
      const next = previous.catch(() => undefined).then(task);
      tails.set(key, next);
      const release = () => {
        if (tails.get(key) === next) tails.delete(key);
      };
      void next.then(release, release);
      return next;
    },

    isBusy(key: string): boolean {
      return tails.has(key);
    },

    async whenIdle(key?: string): Promise<void> {
      if (key !== undefined) {
        await (tails.get(key) ?? Promise.resolve()).catch(() => undefined);
        return;
      }
      // Re-check because a finished task may enqueue its successor while the
      // previous batch is settling.
      while (tails.size > 0) {
        await Promise.allSettled([...tails.values()]);
      }
    },
  };
}

/** Everything the save controller needs from the React hook. */
export interface DocumentSaveHost {
  tabsRef: { current: DocumentTab[] };
  setTabs: (tabs: DocumentTab[]) => void;
  saveSession: (tabs: DocumentTab[]) => void;
  rememberRecentFile: (path: string) => void;
  showToast: (message: string, type: ToastType) => void;
  saveFileDialog: (defaultName: string) => Promise<string | null>;
  writeFile: (path: string, content: string, sourceFilePath: string | null) => Promise<void>;
  getFileMtime: (path: string) => Promise<number | null>;
  translate: (key: TranslationKey, params?: TranslationParams) => string;
  /**
   * Optional local version-history capture. It runs only after the file write
   * actually succeeded, receives exactly the bytes that reached the disk, and
   * never makes the save itself fail. It is awaited so ordered saves cannot
   * produce reversed snapshots; a history failure is non-fatal.
   */
  recordHistory?: (path: string, content: string, title: string) => Promise<boolean>;
}

export interface DocumentSaveController {
  writeDocumentTab: (tabId: string, forceSaveAs?: boolean, silent?: boolean) => Promise<boolean>;
  /** Drops bookkeeping for a tab that was closed; never cancels an in-flight write. */
  forget: (tabId: string) => void;
}

export interface DocumentSaveControllerOptions {
  queue?: KeyedAsyncQueue;
}

/**
 * Serializes document saves and keeps the tab state coherent while slow XMD
 * packaging overlaps with further edits and saves.
 *
 * Guarantees:
 * - Saves targeting the same normalized path queue behind each other, so an
 *   older snapshot can never be written after a newer one to that path.
 * - The content snapshot is taken only when the queued save actually starts,
 *   not when the button/dialog was clicked. A save that waited therefore stores
 *   the freshest text, while completion still marks `savedContent` with exactly
 *   the snapshot that reached the disk, so later edits remain dirty.
 * - Each attempt gets a generation. A slower, older Save-As completion cannot
 *   rewrite the tab's path/saved state after a newer attempt already applied
 *   (which would otherwise point the tab back at an old destination).
 * - A tab closed while its save is queued or running is never re-created; the
 *   successful write is still reported so callers can continue closing.
 * - Auto saves re-check the on-disk mtime *inside* the queue, immediately
 *   before reading the snapshot, so an external modification that happened
 *   while an earlier save was still running is never overwritten.
 */
export function createDocumentSaveController(
  getHost: () => DocumentSaveHost,
  options: DocumentSaveControllerOptions = {}
): DocumentSaveController {
  const queue = options.queue ?? createKeyedAsyncQueue();
  // Last generation started per tab and last generation whose result was applied.
  const startedGeneration = new Map<string, number>();
  const appliedGeneration = new Map<string, number>();
  let autoSaveErrorShown = false;

  const beginAttempt = (tabId: string): number => {
    const next = (startedGeneration.get(tabId) ?? 0) + 1;
    startedGeneration.set(tabId, next);
    return next;
  };

  const isLatestAttempt = (tabId: string, generation: number): boolean =>
    (startedGeneration.get(tabId) ?? 0) === generation;

  const showSavePathFailure = (host: DocumentSaveHost, error: unknown): void => {
    const message = error instanceof Error ? error.message : String(error);
    host.showToast(message || host.translate('toasts.getSavePathFailed'), 'error');
  };

  const writeDocumentTab = async (
    tabId: string,
    forceSaveAs = false,
    silent = false,
    redirected = false
  ): Promise<boolean> => {
    const host = getHost();
    const initial = host.tabsRef.current.find((tab) => tab.id === tabId);
    if (!initial || initial.kind === 'diff') return false;
    const initialIsXmd = initial.filePath?.toLowerCase().endsWith('.xmd') ?? false;
    const needsXmd = !initialIsXmd && documentRequiresXmd(initial.content);
    if (silent && (forceSaveAs || needsXmd || !isAutoSaveEligible(initial))) return false;
    const generation = beginAttempt(tabId);

    // Dialog first (it can take seconds); everything after it is serialized.
    const selectNewPath = forceSaveAs || needsXmd;
    let selectedPath: string | null = null;
    if (!initial.filePath || selectNewPath) {
      try {
        const defaultName = needsXmd || initialIsXmd ? getExportFilename(initial.title, 'xmd') : initial.title;
        selectedPath = await host.saveFileDialog(defaultName);
      } catch (error) {
        if (isLatestAttempt(tabId, generation)) showSavePathFailure(host, error);
        return false;
      }
      if (!selectedPath) return false;
    }

    const afterDialog = host.tabsRef.current.find((tab) => tab.id === tabId);
    if (!afterDialog) return false; // closed while the dialog was open
    const targetPath = selectNewPath ? selectedPath : afterDialog.filePath ?? selectedPath;
    if (!targetPath) return false;

    const queueKey = normalizePathKey(targetPath) || `tab:${tabId}`;
    const result = await queue.run<boolean | 'xmd-required'>(queueKey, async () => {
      // Re-resolve the host so language/toast changes made while waiting apply.
      const now = getHost();
      const tab = now.tabsRef.current.find((item) => item.id === tabId);
      if (!tab) return false; // closed while queued: never resurrect it
      // A newer Save-As may have completed before this older dialog returned.
      // Its generation owns both disk and tab state: do not write late bytes.
      if ((appliedGeneration.get(tabId) ?? 0) > generation) return false;

      const path = selectNewPath ? selectedPath : tab.filePath ?? selectedPath;
      if (!path) return false;
      // A newer Save-As moved this tab to another path while this attempt was
      // waiting. The newer attempt owns the tab; writing the old path here
      // could only resurrect an obsolete destination.
      if (!selectNewPath && normalizePathKey(path) !== normalizePathKey(targetPath)) {
        return false;
      }

      if (silent) {
        if (!isAutoSaveEligible(tab)) return false;
        const diskMtime = await now.getFileMtime(path);
        const afterCheck = now.tabsRef.current.find((item) => item.id === tabId);
        if (!afterCheck) return false;
        const checkPath = afterCheck.filePath ?? '';
        if (normalizePathKey(checkPath) !== normalizePathKey(path)) return false;
        // External change while we were queued: leave the tab dirty instead of
        // silently overwriting the file the user (or another app) just wrote.
        if (!decideAutoSave(afterCheck, diskMtime)) return false;
      }

      const fresh = now.tabsRef.current.find((item) => item.id === tabId);
      if (!fresh) return false;
      const snapshot = fresh.content;
      const targetIsXmd = path.toLowerCase().endsWith('.xmd');
      // The dialog and the queue may have been waiting while XMD content was added.
      if (!targetIsXmd && (snapshot === initial.content && !initialIsXmd ? needsXmd : documentRequiresXmd(snapshot))) {
        return 'xmd-required';
      }
      const sourceFilePath = forceSaveAs ? initial.filePath : fresh.filePath;

      try {
        const rebase = targetIsXmd && normalizePathKey(sourceFilePath) !== normalizePathKey(path);
        const savedSnapshot = rebase ? rebaseDocumentResources(snapshot, sourceFilePath, path) : snapshot;
        await now.writeFile(path, snapshot, sourceFilePath);
        const fileMtime = (await now.getFileMtime(path)) ?? undefined;
        const afterWrite = now.tabsRef.current.find((item) => item.id === tabId);
        // The path is the persisted history identity, including Save As and
        // auto-save. Superseded writes must not claim an older content snapshot
        // for a newer destination. Closing a tab does not remove its history.
        const destinationChanged = afterWrite && normalizePathKey(afterWrite.filePath) !== normalizePathKey(path);
        if (!destinationChanged && path.trim() && !path.startsWith('browser://') && fileMtime !== undefined) {
          try { await getHost().recordHistory?.(path, snapshot, getFileNameFromPath(path)); }
          catch { /* History is best-effort; the real document was saved. */ }
        }
        // Re-read after the awaited snapshot write: the tab may have closed.
        const afterHistory = now.tabsRef.current.find((item) => item.id === tabId);
        // Closed while the write was running: do not add the tab back.
        if (!afterHistory) return true;
        // A newer attempt already committed its state; never roll it back.
        if ((appliedGeneration.get(tabId) ?? 0) >= generation) return true;
        const fileName = getFileNameFromPath(path);
        let content = afterHistory.content;
        if (rebase) {
          const sameSnapshot = content === snapshot && afterHistory.filePath === sourceFilePath;
          content = sameSnapshot ? savedSnapshot : rebaseDocumentResources(content, afterHistory.filePath, path);
        }
        const savedTab = computeSavedTabState({ ...afterHistory, content }, path, savedSnapshot, fileMtime);
        appliedGeneration.set(tabId, generation);
        const next = now.tabsRef.current.map((item) => item.id === tabId ? savedTab : item);
        now.tabsRef.current = next;
        now.setTabs(next);
        now.saveSession(next);
        now.rememberRecentFile(path);

        if (silent) {
          autoSaveErrorShown = false;
        } else {
          now.showToast(now.translate('toasts.savedSuccess', { name: fileName }), 'success');
        }
        return true;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        // Keep the tab dirty (no state was applied above). Suppress noise from
        // an attempt that a newer save has already superseded.
        if (isLatestAttempt(tabId, generation)) {
          if (silent) {
            if (!autoSaveErrorShown) {
              autoSaveErrorShown = true;
              now.showToast(now.translate('toasts.autoSaveFailed', { error: message }), 'error');
            }
          } else {
            now.showToast(message || now.translate('toasts.saveFailed'), 'error');
          }
        }
        return false;
      }
    });
    if (result !== 'xmd-required') return result;
    if (silent || !isLatestAttempt(tabId, generation)) return false;
    if (!needsXmd && !redirected) return writeDocumentTab(tabId, forceSaveAs, false, true);
    const currentHost = getHost();
    currentHost.showToast(currentHost.translate('toasts.xmdSaveRequired'), 'warning');
    return false;
  };

  return {
    writeDocumentTab,
    forget(tabId: string) {
      startedGeneration.delete(tabId);
      appliedGeneration.delete(tabId);
    },
  };
}
