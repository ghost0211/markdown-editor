import { useState, useCallback, useRef } from 'react';
import { DocumentTab, ConfirmDialogState, StartupViewMode, ViewMode } from '@/types';
import { getWelcomeDocument } from '@/lib/defaultDocument';
import { openFileDialog, saveFileDialog, writeTextFile, readTextFile, getFileMtime, isTauri } from '@/lib/native';
import {
  getFileNameFromPath,
  normalizePathKey,
  computeSavedTabState,
  createDefaultTab,
  createDiffTabState,
  moveTabState,
  openOrFocusDocumentState,
  sanitizeRestoredTabs,
  decideExternalChangeAction,
  OpenOrFocusResult,
} from '@/lib/documentUtils';
import { useI18n, getCurrentLanguage } from '@/i18n';

const STORAGE_SESSION_KEY = 'markdown_editor_tabs_v1';

export function useDocuments(
  showToast: (msg: string, type: 'info' | 'success' | 'warning' | 'error') => void,
  restoreSession = true,
  startupView: StartupViewMode = 'remember-last'
) {
  const { t } = useI18n();

  // Initialize tabs from localStorage or default welcome document
  const [tabs, setTabs] = useState<DocumentTab[]>(() => {
    if (restoreSession) {
      try {
        const saved = localStorage.getItem(STORAGE_SESSION_KEY);
        if (saved) {
          const parsed = JSON.parse(saved);
          if (Array.isArray(parsed) && parsed.length > 0) {
            return sanitizeRestoredTabs(parsed, startupView);
          }
        }
      } catch {
        // ignore JSON parse error
      }
    }

    const currentLang = getCurrentLanguage();
    const welcome = getWelcomeDocument(currentLang);

    return [
      {
        id: 'doc-welcome',
        title: welcome.title,
        filePath: null,
        content: welcome.content,
        savedContent: welcome.content,
        isDirty: false,
        cursorLine: 1,
        cursorCol: 1,
      },
    ];
  });

  const [activeTabId, setActiveTabId] = useState<string>(() => tabs[0]?.id || 'doc-welcome');

  // Ref to always access the latest tabs array inside async operations
  const tabsRef = useRef<DocumentTab[]>(tabs);
  tabsRef.current = tabs;

  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState>({
    isOpen: false,
    title: '',
    message: '',
    onConfirm: () => {},
  });

  // Ref mirror so async flows can check whether a confirm dialog is currently open
  const confirmDialogRef = useRef(confirmDialog);
  confirmDialogRef.current = confirmDialog;

  // Active tab getter
  const activeTab = tabs.find((t) => t.id === activeTabId) || tabs[0];

  // Helper to persist session
  const saveSession = useCallback((updatedTabs: DocumentTab[]) => {
    try {
      localStorage.setItem(STORAGE_SESSION_KEY, JSON.stringify(updatedTabs));
    } catch {
      // ignore storage quota errors
    }
  }, []);

  // Create a new blank tab
  const createNewTab = useCallback(
    (title?: string, content = '') => {
      const defaultTitle = title || t('common.untitledDoc');
      const newTab = createDefaultTab(defaultTitle, content);
      const next = [...tabsRef.current, newTab];
      tabsRef.current = next;
      setTabs(next);
      setActiveTabId(newTab.id);
      saveSession(next);
    },
    [saveSession, t]
  );

  // Update content of a tab
  const updateContent = useCallback(
    (tabId: string, newContent: string) => {
      const next = tabsRef.current.map((tab) => {
        if (tab.id === tabId) {
          const isDirty = newContent !== tab.savedContent;
          return {
            ...tab,
            content: newContent,
            isDirty,
          };
        }
        return tab;
      });
      tabsRef.current = next;
      setTabs(next);
      saveSession(next);
    },
    [saveSession]
  );

  // Update cursor position of a tab
  const updateCursor = useCallback((tabId: string, line: number, col: number) => {
    const next = tabsRef.current.map((tab) => {
      if (tab.id === tabId) {
        return { ...tab, cursorLine: line, cursorCol: col };
      }
      return tab;
    });
    tabsRef.current = next;
    setTabs(next);
  }, []);

  // Update the per-tab view mode (edit / split / read) and persist it with the session
  const updateViewMode = useCallback(
    (tabId: string, mode: ViewMode) => {
      const next = tabsRef.current.map((tab) => {
        if (tab.id === tabId) {
          return { ...tab, viewMode: mode };
        }
        return tab;
      });
      tabsRef.current = next;
      setTabs(next);
      saveSession(next);
    },
    [saveSession]
  );

  // Persist per-tab scroll positions (editor + preview) so each tab keeps
  // its own reading progress across tab switches and app restarts.
  const updateScrollPositions = useCallback(
    (tabId: string, editorScrollTop: number, previewScrollTop: number) => {
      const next = tabsRef.current.map((tab) => {
        if (tab.id === tabId) {
          return {
            ...tab,
            scrollPosition: Math.round(editorScrollTop),
            previewScrollPosition: Math.round(previewScrollTop),
          };
        }
        return tab;
      });
      tabsRef.current = next;
      setTabs(next);
      saveSession(next);
    },
    [saveSession]
  );

  // Shared deterministic logic to open a document or focus it if already open.
  // Uses pure helper `openOrFocusDocumentState` and maintains `tabsRef.current`
  // synchronously so batch and async opens never encounter race conditions or updater timing delays.
  const openOrFocusDocument = useCallback(
    (filePath: string, content: string, title?: string, fileMtime?: number): OpenOrFocusResult => {
      const result = openOrFocusDocumentState(tabsRef.current, filePath, content, title, fileMtime);

      tabsRef.current = result.tabs;
      setTabs(result.tabs);
      setActiveTabId(result.activeTabId);
      saveSession(result.tabs);

      if (result.action === 'focused') {
        showToast(t('toasts.switchedToOpenDoc', { title: result.tab.title }), 'info');
      } else {
        showToast(t('toasts.openedDoc', { title: result.tab.title }), 'success');
      }

      return result;
    },
    [showToast, saveSession, t]
  );

  // Open single document by file path
  const openFileByPath = useCallback(
    async (filePath: string): Promise<boolean> => {
      const trimmed = filePath ? filePath.trim() : '';
      if (!trimmed) return false;

      try {
        const content = await readTextFile(trimmed);
        const fileMtime = (await getFileMtime(trimmed)) ?? undefined;
        const fileName = getFileNameFromPath(trimmed);
        openOrFocusDocument(trimmed, content, fileName, fileMtime);
        return true;
      } catch (err: unknown) {
        const msg = (err as Error)?.message || String(err);
        const fileName = getFileNameFromPath(trimmed);
        showToast(t('toasts.openFailed', { name: fileName, error: msg }), 'error');
        return false;
      }
    },
    [openOrFocusDocument, showToast, t]
  );

  // Open multiple documents by an array of file paths
  const openFilesByPaths = useCallback(
    async (filePaths: string[]): Promise<void> => {
      if (!Array.isArray(filePaths) || filePaths.length === 0) return;

      const seen = new Set<string>();
      const uniquePaths: string[] = [];
      for (const p of filePaths) {
        if (!p || typeof p !== 'string') continue;
        const key = normalizePathKey(p);
        if (key && !seen.has(key)) {
          seen.add(key);
          uniquePaths.push(p.trim());
        }
      }

      for (const filePath of uniquePaths) {
        await openFileByPath(filePath);
      }
    },
    [openFileByPath]
  );

  // Open a file via dialog
  const openDocument = useCallback(async () => {
    try {
      const fileRes = await openFileDialog();
      if (!fileRes) {
        return; // User cancelled
      }
      const fileMtime = (await getFileMtime(fileRes.path)) ?? undefined;
      openOrFocusDocument(fileRes.path, fileRes.content, fileRes.name, fileMtime);
    } catch (err: unknown) {
      showToast((err as Error).message || t('toasts.openFailedGeneric'), 'error');
    }
  }, [openOrFocusDocument, showToast, t]);

  // Save active document (or Save As)
  const saveActiveDocument = useCallback(
    async (forceSaveAs = false): Promise<boolean> => {
      const tab = tabsRef.current.find((t) => t.id === activeTabId);
      if (!tab) return false;

      let targetPath = tab.filePath;

      // If no path or forced Save As, prompt dialog
      if (!targetPath || forceSaveAs) {
        try {
          const selected = await saveFileDialog(tab.title);
          if (!selected) {
            return false; // user cancelled
          }
          targetPath = selected;
        } catch (err: unknown) {
          showToast((err as Error).message || t('toasts.getSavePathFailed'), 'error');
          return false;
        }
      }

      // Snapshot the exact content right before writing to disk
      const freshTab = tabsRef.current.find((t) => t.id === tab.id) || tab;
      const contentSnapshot = freshTab.content;

      try {
        await writeTextFile(targetPath, contentSnapshot);
        const fileMtime = (await getFileMtime(targetPath)) ?? undefined;
        const fileName = getFileNameFromPath(targetPath);

        const next = tabsRef.current.map((t) => {
          if (t.id === tab.id) {
            return computeSavedTabState(t, targetPath, contentSnapshot, fileMtime);
          }
          return t;
        });
        tabsRef.current = next;
        setTabs(next);
        saveSession(next);

        showToast(t('toasts.savedSuccess', { name: fileName }), 'success');
        return true;
      } catch (err: unknown) {
        showToast((err as Error).message || t('toasts.saveFailed'), 'error');
        return false;
      }
    },
    [activeTabId, showToast, saveSession, t]
  );

  // Create a side-by-side compare tab for two open document tabs
  const createDiffTab = useCallback(
    (leftId: string, rightId: string) => {
      const left = tabsRef.current.find((t) => t.id === leftId);
      const right = tabsRef.current.find((t) => t.id === rightId);
      if (!left || !right || left.id === right.id) return;
      if (left.kind === 'diff' || right.kind === 'diff') return;

      const newTab = createDiffTabState(left, right);
      const next = [...tabsRef.current, newTab];
      tabsRef.current = next;
      setTabs(next);
      setActiveTabId(newTab.id);
      saveSession(next);
    },
    [saveSession]
  );

  // Reorder tabs via drag-and-drop: moves `sourceId` before/after `targetId`
  const moveTab = useCallback(
    (sourceId: string, targetId: string, position: 'before' | 'after') => {
      const next = moveTabState(tabsRef.current, sourceId, targetId, position);
      if (next === tabsRef.current) return;
      tabsRef.current = next;
      setTabs(next);
      saveSession(next);
    },
    [saveSession]
  );

  // Directly close a tab without prompt
  const forceCloseTab = useCallback(
    (tabId: string) => {
      const prev = tabsRef.current;
      if (prev.length <= 1) {
        // If closing the only tab, create a new fresh tab
        const newTab = createDefaultTab(t('common.untitledDoc'), '');
        const next = [newTab];
        tabsRef.current = next;
        setTabs(next);
        setActiveTabId(newTab.id);
        saveSession(next);
        return;
      }

      const closeIdx = prev.findIndex((t) => t.id === tabId);
      const next = prev.filter((t) => t.id !== tabId);
      tabsRef.current = next;
      setTabs(next);

      if (activeTabId === tabId) {
        // Switch to adjacent tab
        const nextIdx = Math.min(closeIdx, next.length - 1);
        setActiveTabId(next[nextIdx].id);
      }

      saveSession(next);
    },
    [activeTabId, saveSession, t]
  );

  // Safe close tab (with confirm if dirty)
  const requestCloseTab = useCallback(
    (tabId: string) => {
      const tab = tabsRef.current.find((t) => t.id === tabId);
      if (!tab) return;

      if (!tab.isDirty) {
        forceCloseTab(tabId);
        return;
      }

      setConfirmDialog({
        isOpen: true,
        title: t('confirm.unsavedChangesTitle'),
        message: t('confirm.unsavedChangesMsg', { title: tab.title }),
        confirmLabel: t('confirm.discardAndClose'),
        cancelLabel: t('common.cancel'),
        variant: 'danger',
        onConfirm: () => {
          forceCloseTab(tabId);
          setConfirmDialog((prev) => ({ ...prev, isOpen: false }));
        },
        onCancel: () => {
          setConfirmDialog((prev) => ({ ...prev, isOpen: false }));
        },
      });
    },
    [forceCloseTab, t]
  );

  // Close other tabs
  const closeOtherTabs = useCallback(
    (tabId: string) => {
      const dirtyOthers = tabsRef.current.filter((t) => t.id !== tabId && t.isDirty);
      if (dirtyOthers.length > 0) {
        setConfirmDialog({
          isOpen: true,
          title: t('confirm.closeOtherTabsTitle'),
          message: t('confirm.closeOtherTabsMsg', { count: dirtyOthers.length }),
          confirmLabel: t('confirm.closeAll'),
          cancelLabel: t('common.cancel'),
          variant: 'danger',
          onConfirm: () => {
            const current = tabsRef.current.find((t) => t.id === tabId);
            const next = current ? [current] : [];
            tabsRef.current = next;
            setTabs(next);
            saveSession(next);
            setActiveTabId(tabId);
            setConfirmDialog((prev) => ({ ...prev, isOpen: false }));
          },
          onCancel: () => {
            setConfirmDialog((prev) => ({ ...prev, isOpen: false }));
          },
        });
        return;
      }

      const current = tabsRef.current.find((t) => t.id === tabId);
      const next = current ? [current] : [];
      tabsRef.current = next;
      setTabs(next);
      saveSession(next);
      setActiveTabId(tabId);
    },
    [saveSession, t]
  );

  // Reload a tab's content from disk (external change accepted / no local edits)
  const reloadTabFromDisk = useCallback(
    (tabId: string, content: string, mtime: number) => {
      const next = tabsRef.current.map((tab) => {
        if (tab.id === tabId) {
          return {
            ...tab,
            content,
            savedContent: content,
            isDirty: false,
            fileMtime: mtime,
          };
        }
        return tab;
      });
      tabsRef.current = next;
      setTabs(next);
      saveSession(next);
    },
    [saveSession]
  );

  // Silently adopt a new mtime baseline without touching content
  const setTabMtimeBaseline = useCallback(
    (tabId: string, mtime: number) => {
      const next = tabsRef.current.map((tab) => {
        if (tab.id === tabId) {
          return { ...tab, fileMtime: mtime };
        }
        return tab;
      });
      tabsRef.current = next;
      setTabs(next);
      saveSession(next);
    },
    [saveSession]
  );

  /**
   * Checks all open file-backed tabs for external modifications.
   * - Unmodified tabs are reloaded automatically (with a toast).
   * - Dirty tabs trigger a confirm dialog (reload vs keep local edits).
   * Safe to call frequently; no-ops in web mode or when nothing changed.
   */
  const checkExternalChanges = useCallback(async () => {
    if (!isTauri()) return;

    const snapshot = tabsRef.current;
    for (const tab of snapshot) {
      if (!tab.filePath || tab.filePath.startsWith('browser://')) continue;

      let mtime: number | null;
      try {
        mtime = await getFileMtime(tab.filePath);
      } catch {
        continue; // e.g. file deleted or inaccessible; leave the tab untouched
      }

      // Re-read the freshest tab state (may have changed during awaits)
      const fresh = tabsRef.current.find((t) => t.id === tab.id);
      if (!fresh || !fresh.filePath) continue;

      const needsContent =
        fresh.fileMtime !== undefined && mtime !== null && mtime !== fresh.fileMtime;

      let content: string | null = null;
      if (needsContent) {
        try {
          content = await readTextFile(fresh.filePath);
        } catch {
          continue;
        }
      }

      const action = decideExternalChangeAction(fresh, mtime, content);

      if (action === 'baseline' && mtime !== null) {
        setTabMtimeBaseline(fresh.id, mtime);
      } else if (action === 'reload' && content !== null && mtime !== null) {
        reloadTabFromDisk(fresh.id, content, mtime);
        showToast(t('toasts.externalReloaded', { title: fresh.title }), 'info');
      } else if (action === 'prompt' && content !== null && mtime !== null) {
        // Only one confirm dialog at a time; other dirty tabs wait for the next check round
        if (confirmDialogRef.current.isOpen) continue;

        const pendingContent = content;
        const pendingMtime = mtime;
        const tabId = fresh.id;
        const tabTitle = fresh.title;
        setConfirmDialog({
          isOpen: true,
          title: t('confirm.externalChangeTitle'),
          message: t('confirm.externalChangeMsg', { title: tabTitle }),
          confirmLabel: t('confirm.reloadFromDisk'),
          cancelLabel: t('confirm.keepMyChanges'),
          variant: 'warning',
          onConfirm: () => {
            reloadTabFromDisk(tabId, pendingContent, pendingMtime);
            setConfirmDialog((prev) => ({ ...prev, isOpen: false }));
            showToast(t('toasts.externalReloaded', { title: tabTitle }), 'info');
          },
          onCancel: () => {
            // Keep local edits: adopt the new mtime so we don't prompt again
            // until the file changes on disk once more.
            setTabMtimeBaseline(tabId, pendingMtime);
            setConfirmDialog((prev) => ({ ...prev, isOpen: false }));
          },
        });
      }
    }
  }, [reloadTabFromDisk, setTabMtimeBaseline, showToast, t]);

  return {
    tabs,
    activeTabId,
    activeTab,
    setActiveTabId,
    createNewTab,
    updateContent,
    updateCursor,
    updateViewMode,
    updateScrollPositions,
    checkExternalChanges,
    moveTab,
    createDiffTab,
    openDocument,
    openFileByPath,
    openFilesByPaths,
    saveActiveDocument,
    requestCloseTab,
    forceCloseTab,
    closeOtherTabs,
    confirmDialog,
    setConfirmDialog,
  };
}
