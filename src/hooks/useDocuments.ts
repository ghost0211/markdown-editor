import { useState, useCallback, useRef } from 'react';
import { prepareDocumentsForUpdate } from '@/lib/appUpdateDocuments';
import { DocumentTab, ConfirmDialogState, StartupViewMode, ViewMode } from '@/types';
import { getWelcomeDocument } from '@/lib/defaultDocument';
import { openFileDialog, saveFileDialog, writeTextFile, readTextFile, getFileMtime } from '@/lib/native';
import {
  getFileNameFromPath,
  normalizeLineEndings,
  normalizePathKey,
  computeSavedTabState,
  createDefaultTab,
  createDiffTabState,
  moveTabState,
  closeTabsToTheRightState,
  closeSavedTabsState,
  openOrFocusDocumentState,
  openDroppedDocumentState,
  OpenOrFocusResult,
} from '@/lib/documentUtils';
import {
  RecentFile,
  addRecentFile,
  isRecordablePath,
  loadRecentFiles,
  pushClosedFile,
  removeRecentFile,
  saveRecentFiles,
} from '@/lib/recentFiles';
import { loadLocalSessionSync, STORAGE_ACTIVE_TAB_KEY } from '@/lib/sessionStorage';
import { useSessionPersistence } from '@/hooks/useSessionPersistence';
import { useAutoSave, AUTO_SAVE_DELAY_MS } from '@/hooks/useAutoSave';
import { useExternalFileChanges } from '@/hooks/useExternalFileChanges';
import { useI18n, getCurrentLanguage } from '@/i18n';

export { AUTO_SAVE_DELAY_MS };

function createInitialWelcomeTab(): DocumentTab {
  const currentLang = getCurrentLanguage();
  const welcome = getWelcomeDocument(currentLang);
  return {
    id: 'doc-welcome',
    title: welcome.title,
    filePath: null,
    content: welcome.content,
    savedContent: welcome.content,
    isDirty: false,
    cursorLine: 1,
    cursorCol: 1,
  };
}

export function useDocuments(
  showToast: (msg: string, type: 'info' | 'success' | 'warning' | 'error') => void,
  restoreSession = true,
  startupView: StartupViewMode = 'remember-last',
  autoSave = false
) {
  const { t } = useI18n();

  const [recentFiles, setRecentFiles] = useState<RecentFile[]>(() => loadRecentFiles());
  const closedFilesRef = useRef<string[]>([]);

  const rememberRecentFile = useCallback((path?: string | null) => {
    if (!isRecordablePath(path)) return;
    setRecentFiles((prev) => {
      const next = addRecentFile(prev, path);
      saveRecentFiles(next);
      return next;
    });
  }, []);

  const forgetRecentFile = useCallback((path: string) => {
    setRecentFiles((prev) => {
      const next = removeRecentFile(prev, path);
      if (next !== prev) saveRecentFiles(next);
      return next;
    });
  }, []);

  const clearRecentFiles = useCallback(() => {
    setRecentFiles([]);
    saveRecentFiles([]);
  }, []);

  // Initialize tabs synchronously from localStorage (Web mode / pre-migration)
  // or welcome tab; Tauri's native app-data session hydrates right after mount.
  const [tabs, setTabs] = useState<DocumentTab[]>(() => {
    const localSession = loadLocalSessionSync(restoreSession, startupView);
    if (localSession && localSession.tabs.length > 0) {
      return localSession.tabs;
    }
    return [createInitialWelcomeTab()];
  });

  const [activeTabId, setActiveTabId] = useState<string>(() => {
    try {
      const savedActive = localStorage.getItem(STORAGE_ACTIVE_TAB_KEY);
      if (savedActive && tabs.some((tab) => tab.id === savedActive)) {
        return savedActive;
      }
    } catch {
      // ignore storage failures
    }
    return tabs[0]?.id || 'doc-welcome';
  });

  const tabsRef = useRef<DocumentTab[]>(tabs);
  tabsRef.current = tabs;

  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState>({
    isOpen: false,
    title: '',
    message: '',
    onConfirm: () => {},
  });

  const confirmDialogRef = useRef(confirmDialog);
  confirmDialogRef.current = confirmDialog;

  const activeTab = tabs.find((item) => item.id === activeTabId) || tabs[0];

  const { saveSession, flushSession } = useSessionPersistence({
    restoreSession,
    startupView,
    activeTabId,
    tabsRef,
    setTabs,
    setActiveTabId,
    showToast,
  });

  const scheduleAutoSaveRef = useRef<() => void>(() => {});

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

  const updateContent = useCallback(
    (tabId: string, newContent: string) => {
      const next = tabsRef.current.map((tab) => {
        if (tab.id === tabId) {
          const isDirty =
            normalizeLineEndings(newContent) !== normalizeLineEndings(tab.savedContent);
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
      scheduleAutoSaveRef.current();
    },
    [saveSession]
  );

  const updateCursor = useCallback((tabId: string, line: number, col: number) => {
    let changed = false;
    const next = tabsRef.current.map((tab) => {
      if (tab.id === tabId) {
        if (tab.cursorLine === line && tab.cursorCol === col) return tab;
        changed = true;
        return { ...tab, cursorLine: line, cursorCol: col };
      }
      return tab;
    });
    if (!changed) return;
    tabsRef.current = next;
    setTabs(next);
  }, []);

  const updateViewMode = useCallback(
    (tabId: string, mode: ViewMode) => {
      const next = tabsRef.current.map((tab) =>
        tab.id === tabId ? { ...tab, viewMode: mode } : tab
      );
      tabsRef.current = next;
      setTabs(next);
      saveSession(next);
    },
    [saveSession]
  );

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

  const openOrFocusDocument = useCallback(
    (filePath: string, content: string, title?: string, fileMtime?: number): OpenOrFocusResult => {
      const result = openOrFocusDocumentState(tabsRef.current, filePath, content, title, fileMtime);

      tabsRef.current = result.tabs;
      setTabs(result.tabs);
      setActiveTabId(result.activeTabId);
      saveSession(result.tabs);
      rememberRecentFile(filePath);

      if (result.action === 'focused') {
        showToast(t('toasts.switchedToOpenDoc', { title: result.tab.title }), 'info');
      } else {
        showToast(t('toasts.openedDoc', { title: result.tab.title }), 'success');
      }

      return result;
    },
    [showToast, saveSession, rememberRecentFile, t]
  );

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

  const openDocument = useCallback(async () => {
    try {
      const fileRes = await openFileDialog();
      if (!fileRes) return;
      const fileMtime = (await getFileMtime(fileRes.path)) ?? undefined;
      openOrFocusDocument(fileRes.path, fileRes.content, fileRes.name, fileMtime);
    } catch (err: unknown) {
      showToast((err as Error).message || t('toasts.openFailedGeneric'), 'error');
    }
  }, [openOrFocusDocument, showToast, t]);

  const openRecentFile = useCallback(
    async (filePath: string): Promise<boolean> => {
      const ok = await openFileByPath(filePath);
      if (!ok) forgetRecentFile(filePath);
      return ok;
    },
    [openFileByPath, forgetRecentFile]
  );

  const reopenClosedFile = useCallback(async (): Promise<boolean> => {
    const stack = closedFilesRef.current;
    while (stack.length > 0) {
      const path = stack.pop()!;
      const key = normalizePathKey(path);
      if (tabsRef.current.some((tab) => normalizePathKey(tab.filePath) === key)) continue;
      return openFileByPath(path);
    }
    showToast(t('toasts.noClosedFileToReopen'), 'info');
    return false;
  }, [openFileByPath, showToast, t]);

  const openDroppedDocument = useCallback(
    (name: string, content: string) => {
      const result = openDroppedDocumentState(tabsRef.current, name, content);
      tabsRef.current = result.tabs;
      setTabs(result.tabs);
      setActiveTabId(result.activeTabId);
      saveSession(result.tabs);

      if (result.action === 'focused') {
        showToast(t('toasts.switchedToOpenDoc', { title: result.tab.title }), 'info');
      } else {
        showToast(t('toasts.droppedAsUnsaved', { title: result.tab.title }), 'info');
      }
    },
    [saveSession, showToast, t]
  );

  const autoSaveErrorShownRef = useRef(false);
  const writeDocumentTab = useCallback(
    async (tabId: string, forceSaveAs = false, silent = false): Promise<boolean> => {
      const tab = tabsRef.current.find((item) => item.id === tabId);
      if (!tab) return false;

      let targetPath = tab.filePath;
      if (!targetPath || forceSaveAs) {
        try {
          const selected = await saveFileDialog(tab.title);
          if (!selected) return false;
          targetPath = selected;
        } catch (err: unknown) {
          showToast((err as Error).message || t('toasts.getSavePathFailed'), 'error');
          return false;
        }
      }

      const freshTab = tabsRef.current.find((item) => item.id === tab.id) || tab;
      const contentSnapshot = freshTab.content;

      try {
        await writeTextFile(targetPath, contentSnapshot);
        const fileMtime = (await getFileMtime(targetPath)) ?? undefined;
        const fileName = getFileNameFromPath(targetPath);

        const next = tabsRef.current.map((item) =>
          item.id === tab.id
            ? computeSavedTabState(item, targetPath, contentSnapshot, fileMtime)
            : item
        );
        tabsRef.current = next;
        setTabs(next);
        saveSession(next);
        rememberRecentFile(targetPath);

        if (silent) {
          autoSaveErrorShownRef.current = false;
        } else {
          showToast(t('toasts.savedSuccess', { name: fileName }), 'success');
        }
        return true;
      } catch (err: unknown) {
        const message = (err as Error).message || t('toasts.saveFailed');
        if (!silent) {
          showToast(message, 'error');
        } else if (!autoSaveErrorShownRef.current) {
          autoSaveErrorShownRef.current = true;
          showToast(t('toasts.autoSaveFailed', { error: message }), 'error');
        }
        return false;
      }
    },
    [showToast, saveSession, rememberRecentFile, t]
  );

  const { scheduleAutoSave } = useAutoSave({
    autoSave,
    tabsRef,
    writeDocumentTab,
  });
  scheduleAutoSaveRef.current = scheduleAutoSave;

  const saveDocumentTab = useCallback(
    async (tabId: string, forceSaveAs = false): Promise<boolean> => {
      const tab = tabsRef.current.find((item) => item.id === tabId);
      if (!tab) return false;

      if (tab.kind === 'diff') {
        if (forceSaveAs) return false;
        const refs = tab.diffRefs ? [tab.diffRefs.left, tab.diffRefs.right] : [];
        const sources = refs
          .map((ref) => tabsRef.current.find((item) => item.id === ref.tabId))
          .filter((item): item is DocumentTab => Boolean(item && item.kind !== 'diff'));
        const dirtySources = sources.filter((item) => item.isDirty);

        if (dirtySources.length === 0) {
          showToast(t('toasts.diffTabNoChanges'), 'info');
          return false;
        }

        let allSaved = true;
        for (const source of dirtySources) {
          const saved = await writeDocumentTab(source.id);
          if (!saved) {
            allSaved = false;
            break;
          }
        }
        if (allSaved) {
          showToast(t('toasts.diffTabCannotSave'), 'info');
        }
        return allSaved;
      }

      return writeDocumentTab(tabId, forceSaveAs);
    },
    [showToast, t, writeDocumentTab]
  );

  const saveDirtyTabs = useCallback(
    async (tabIds: string[]): Promise<boolean> => {
      const targets = tabIds
        .map((id) => tabsRef.current.find((item) => item.id === id))
        .filter((item): item is DocumentTab => Boolean(item && item.isDirty && item.kind !== 'diff'));

      for (const target of targets) {
        const saved = await writeDocumentTab(target.id);
        if (!saved) return false;
      }
      return true;
    },
    [writeDocumentTab]
  );

  const prepareForAppUpdate = useCallback(async (): Promise<boolean> => {
    return prepareDocumentsForUpdate(() => tabsRef.current, saveDirtyTabs, flushSession);
  }, [saveDirtyTabs, flushSession]);

  const saveActiveDocument = useCallback(
    (forceSaveAs = false) => saveDocumentTab(activeTabId, forceSaveAs),
    [saveDocumentTab, activeTabId]
  );

  const createDiffTab = useCallback(
    (leftId: string, rightId: string) => {
      const left = tabsRef.current.find((item) => item.id === leftId);
      const right = tabsRef.current.find((item) => item.id === rightId);
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

  const forceCloseTab = useCallback(
    (tabId: string) => {
      const prev = tabsRef.current;
      const closing = prev.find((tab) => tab.id === tabId);
      if (closing && closing.kind !== 'diff') {
        closedFilesRef.current = pushClosedFile(closedFilesRef.current, closing.filePath);
      }
      if (prev.length <= 1) {
        const newTab = createDefaultTab(t('common.untitledDoc'), '');
        const next = [newTab];
        tabsRef.current = next;
        setTabs(next);
        setActiveTabId(newTab.id);
        saveSession(next);
        return;
      }

      const closeIdx = prev.findIndex((item) => item.id === tabId);
      const next = prev.filter((item) => item.id !== tabId);
      tabsRef.current = next;
      setTabs(next);

      if (activeTabId === tabId) {
        const nextIdx = Math.min(closeIdx, next.length - 1);
        setActiveTabId(next[nextIdx].id);
      }

      saveSession(next);
    },
    [activeTabId, saveSession, t]
  );

  const requestCloseTab = useCallback(
    (tabId: string) => {
      const tab = tabsRef.current.find((item) => item.id === tabId);
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
        secondaryLabel: t('confirm.saveAndClose'),
        cancelLabel: t('common.cancel'),
        variant: 'danger',
        onConfirm: () => {
          forceCloseTab(tabId);
          setConfirmDialog((prev) => ({ ...prev, isOpen: false }));
        },
        onSecondary: () => {
          setConfirmDialog((prev) => ({ ...prev, isOpen: false }));
          void saveDocumentTab(tabId).then((saved) => {
            if (saved) forceCloseTab(tabId);
          });
        },
        onCancel: () => {
          setConfirmDialog((prev) => ({ ...prev, isOpen: false }));
        },
      });
    },
    [forceCloseTab, saveDocumentTab, t]
  );

  const closeOtherTabs = useCallback(
    (tabId: string) => {
      const dirtyOthers = tabsRef.current.filter((item) => item.id !== tabId && item.isDirty);
      const keepOnlyTarget = () => {
        const current = tabsRef.current.find((item) => item.id === tabId);
        const next = current ? [current] : [createDefaultTab(t('common.untitledDoc'), '')];
        tabsRef.current = next;
        setTabs(next);
        saveSession(next);
        setActiveTabId(next[0].id);
      };

      if (dirtyOthers.length > 0) {
        setConfirmDialog({
          isOpen: true,
          title: t('confirm.closeOtherTabsTitle'),
          message: t('confirm.closeOtherTabsMsg', { count: dirtyOthers.length }),
          confirmLabel: t('confirm.closeAll'),
          secondaryLabel: t('confirm.saveAllAndClose'),
          cancelLabel: t('common.cancel'),
          variant: 'danger',
          onConfirm: () => {
            keepOnlyTarget();
            setConfirmDialog((prev) => ({ ...prev, isOpen: false }));
          },
          onSecondary: () => {
            const targets = dirtyOthers.map((item) => item.id);
            setConfirmDialog((prev) => ({ ...prev, isOpen: false }));
            void saveDirtyTabs(targets).then((saved) => {
              if (saved) keepOnlyTarget();
            });
          },
          onCancel: () => {
            setConfirmDialog((prev) => ({ ...prev, isOpen: false }));
          },
        });
        return;
      }

      keepOnlyTarget();
    },
    [saveDirtyTabs, saveSession, t]
  );

  const closeTabsToTheRight = useCallback(
    (tabId: string) => {
      const allTabs = tabsRef.current;
      const targetIdx = allTabs.findIndex((item) => item.id === tabId);
      if (targetIdx === -1 || targetIdx >= allTabs.length - 1) return;

      const tabsToClose = allTabs.slice(targetIdx + 1);
      const dirtyTabs = tabsToClose.filter((item) => item.isDirty);

      const performClose = () => {
        const remainingTabs = closeTabsToTheRightState(tabsRef.current, tabId);
        tabsRef.current = remainingTabs;
        setTabs(remainingTabs);
        saveSession(remainingTabs);

        if (!remainingTabs.some((item) => item.id === activeTabId)) {
          setActiveTabId(tabId);
        }
      };

      if (dirtyTabs.length > 0) {
        setConfirmDialog({
          isOpen: true,
          title: t('confirm.closeRightTabsTitle'),
          message: t('confirm.closeRightTabsMsg', { count: dirtyTabs.length }),
          confirmLabel: t('confirm.closeAll'),
          secondaryLabel: t('confirm.saveAllAndClose'),
          cancelLabel: t('common.cancel'),
          variant: 'danger',
          onConfirm: () => {
            performClose();
            setConfirmDialog((prev) => ({ ...prev, isOpen: false }));
          },
          onSecondary: () => {
            const targets = dirtyTabs.map((tab) => tab.id);
            setConfirmDialog((prev) => ({ ...prev, isOpen: false }));
            void saveDirtyTabs(targets).then((saved) => {
              if (saved) performClose();
            });
          },
          onCancel: () => {
            setConfirmDialog((prev) => ({ ...prev, isOpen: false }));
          },
        });
        return;
      }

      performClose();
    },
    [activeTabId, saveDirtyTabs, saveSession, t]
  );

  const closeSavedTabs = useCallback(() => {
    const dirtyTabs = closeSavedTabsState(tabsRef.current);

    if (dirtyTabs.length === 0) {
      const newTab = createDefaultTab(t('common.untitledDoc'), '');
      const next = [newTab];
      tabsRef.current = next;
      setTabs(next);
      setActiveTabId(newTab.id);
      saveSession(next);
      return;
    }

    tabsRef.current = dirtyTabs;
    setTabs(dirtyTabs);
    saveSession(dirtyTabs);

    if (!dirtyTabs.some((item) => item.id === activeTabId)) {
      setActiveTabId(dirtyTabs[0].id);
    }
  }, [activeTabId, saveSession, t]);

  const closeAllTabs = useCallback(() => {
    const allTabs = tabsRef.current;
    if (allTabs.length === 0) return;

    const dirtyTabs = allTabs.filter((item) => item.isDirty);

    const performClose = () => {
      const newTab = createDefaultTab(t('common.untitledDoc'), '');
      const next = [newTab];
      tabsRef.current = next;
      setTabs(next);
      setActiveTabId(newTab.id);
      saveSession(next);
    };

    if (dirtyTabs.length > 0) {
      setConfirmDialog({
        isOpen: true,
        title: t('confirm.closeAllTabsTitle'),
        message: t('confirm.closeAllTabsMsg', { count: dirtyTabs.length }),
        confirmLabel: t('confirm.closeAll'),
        secondaryLabel: t('confirm.saveAllAndClose'),
        cancelLabel: t('common.cancel'),
        variant: 'danger',
        onConfirm: () => {
          performClose();
          setConfirmDialog((prev) => ({ ...prev, isOpen: false }));
        },
        onSecondary: () => {
          const targets = dirtyTabs.map((tab) => tab.id);
          setConfirmDialog((prev) => ({ ...prev, isOpen: false }));
          void saveDirtyTabs(targets).then((saved) => {
            if (saved) performClose();
          });
        },
        onCancel: () => {
          setConfirmDialog((prev) => ({ ...prev, isOpen: false }));
        },
      });
      return;
    }

    performClose();
  }, [saveDirtyTabs, saveSession, t]);

  const reloadTabFromDisk = useCallback(
    (tabId: string, content: string, mtime: number) => {
      const next = tabsRef.current.map((tab) =>
        tab.id === tabId
          ? {
              ...tab,
              content,
              savedContent: content,
              isDirty: false,
              fileMtime: mtime,
            }
          : tab
      );
      tabsRef.current = next;
      setTabs(next);
      saveSession(next);
    },
    [saveSession]
  );

  const reloadTab = useCallback(
    async (tabId: string) => {
      const tab = tabsRef.current.find((item) => item.id === tabId);
      if (!tab) return;
      if (!tab.filePath || tab.filePath.startsWith('browser://')) {
        showToast(t('toasts.cannotReloadUnsaved'), 'warning');
        return;
      }

      const doReload = async () => {
        try {
          const content = await readTextFile(tab.filePath!);
          const mtime = (await getFileMtime(tab.filePath!)) ?? Date.now();
          reloadTabFromDisk(tabId, content, mtime);
          showToast(t('toasts.reloadedFromDisk', { title: tab.title }), 'success');
        } catch (err: unknown) {
          const msg = (err as Error)?.message || String(err);
          showToast(t('toasts.reloadFailed', { error: msg }), 'error');
        }
      };

      if (tab.isDirty) {
        setConfirmDialog({
          isOpen: true,
          title: t('confirm.reloadFromDiskTitle'),
          message: t('confirm.reloadFromDiskMsg', { title: tab.title }),
          confirmLabel: t('confirm.reloadFromDisk'),
          cancelLabel: t('common.cancel'),
          variant: 'warning',
          onConfirm: () => {
            setConfirmDialog((prev) => ({ ...prev, isOpen: false }));
            void doReload();
          },
          onCancel: () => {
            setConfirmDialog((prev) => ({ ...prev, isOpen: false }));
          },
        });
        return;
      }

      await doReload();
    },
    [reloadTabFromDisk, showToast, t]
  );

  const setTabMtimeBaseline = useCallback(
    (tabId: string, mtime: number) => {
      const next = tabsRef.current.map((tab) =>
        tab.id === tabId ? { ...tab, fileMtime: mtime } : tab
      );
      tabsRef.current = next;
      setTabs(next);
      saveSession(next);
    },
    [saveSession]
  );

  const { checkExternalChanges } = useExternalFileChanges({
    tabsRef,
    confirmDialogRef,
    setConfirmDialog,
    reloadTabFromDisk,
    setTabMtimeBaseline,
    showToast,
  });

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
    openRecentFile,
    openDroppedDocument,
    reopenClosedFile,
    recentFiles,
    clearRecentFiles,
    saveActiveDocument,
    saveDocumentTab,
    requestCloseTab,
    forceCloseTab,
    closeOtherTabs,
    closeTabsToTheRight,
    closeSavedTabs,
    closeAllTabs,
    reloadTab,
    flushSession,
    prepareForAppUpdate,
    confirmDialog,
    setConfirmDialog,
  };
}
