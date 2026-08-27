import { useState, useCallback, useRef } from 'react';
import { DocumentTab, ConfirmDialogState } from '@/types';
import { WELCOME_DOCUMENT } from '@/lib/defaultDocument';
import { openFileDialog, saveFileDialog, writeTextFile } from '@/lib/native';
import {
  generateDocId,
  getFileNameFromPath,
  normalizePathKey,
  computeSavedTabState,
  createDefaultTab,
} from '@/lib/documentUtils';

const STORAGE_SESSION_KEY = 'markdown_editor_tabs_v1';

export function useDocuments(
  showToast: (msg: string, type: 'info' | 'success' | 'warning' | 'error') => void
) {
  // Initialize tabs from localStorage or default welcome document
  const [tabs, setTabs] = useState<DocumentTab[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_SESSION_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed;
        }
      }
    } catch {
      // ignore JSON parse error
    }

    return [
      {
        id: 'doc-welcome',
        title: '欢迎使用.md',
        filePath: null,
        content: WELCOME_DOCUMENT,
        savedContent: WELCOME_DOCUMENT,
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
      const newTab = createDefaultTab(title, content);

      setTabs((prev) => {
        const next = [...prev, newTab];
        saveSession(next);
        return next;
      });
      setActiveTabId(newTab.id);
    },
    [saveSession]
  );

  // Update content of a tab
  const updateContent = useCallback(
    (tabId: string, newContent: string) => {
      setTabs((prev) => {
        const next = prev.map((tab) => {
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
        saveSession(next);
        return next;
      });
    },
    [saveSession]
  );

  // Update cursor position of a tab
  const updateCursor = useCallback((tabId: string, line: number, col: number) => {
    setTabs((prev) =>
      prev.map((tab) => {
        if (tab.id === tabId) {
          return { ...tab, cursorLine: line, cursorCol: col };
        }
        return tab;
      })
    );
  }, []);

  // Open a file
  const openDocument = useCallback(async () => {
    try {
      const fileRes = await openFileDialog();
      if (!fileRes) {
        return; // User cancelled
      }

      setTabs((prev) => {
        // Check if file is already open using path normalization
        const targetPathKey = normalizePathKey(fileRes.path);
        const existing = prev.find(
          (t) => t.filePath && normalizePathKey(t.filePath) === targetPathKey
        );
        if (existing) {
          setActiveTabId(existing.id);
          showToast(`已切换至已打开的文档: ${existing.title}`, 'info');
          return prev;
        }

        const id = generateDocId();
        const newTab: DocumentTab = {
          id,
          title: fileRes.name || getFileNameFromPath(fileRes.path),
          filePath: fileRes.path,
          content: fileRes.content,
          savedContent: fileRes.content,
          isDirty: false,
          cursorLine: 1,
          cursorCol: 1,
        };

        const next = [...prev, newTab];
        setActiveTabId(id);
        saveSession(next);
        showToast(`已打开: ${newTab.title}`, 'success');
        return next;
      });
    } catch (err: unknown) {
      showToast((err as Error).message || '打开文件失败', 'error');
    }
  }, [showToast, saveSession]);

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
          showToast((err as Error).message || '获取保存路径失败', 'error');
          return false;
        }
      }

      // Snapshot the exact content right before writing to disk
      const freshTab = tabsRef.current.find((t) => t.id === tab.id) || tab;
      const contentSnapshot = freshTab.content;

      try {
        await writeTextFile(targetPath, contentSnapshot);
        const fileName = getFileNameFromPath(targetPath);

        setTabs((prev) => {
          const next = prev.map((t) => {
            if (t.id === tab.id) {
              return computeSavedTabState(t, targetPath, contentSnapshot);
            }
            return t;
          });
          saveSession(next);
          return next;
        });

        showToast(`已成功保存: ${fileName}`, 'success');
        return true;
      } catch (err: unknown) {
        showToast((err as Error).message || '保存文件失败', 'error');
        return false;
      }
    },
    [activeTabId, showToast, saveSession]
  );

  // Directly close a tab without prompt
  const forceCloseTab = useCallback(
    (tabId: string) => {
      setTabs((prev) => {
        if (prev.length <= 1) {
          // If closing the only tab, create a new fresh tab
          const newTab = createDefaultTab('未命名文档.md', '');
          setActiveTabId(newTab.id);
          saveSession([newTab]);
          return [newTab];
        }

        const closeIdx = prev.findIndex((t) => t.id === tabId);
        const next = prev.filter((t) => t.id !== tabId);

        if (activeTabId === tabId) {
          // Switch to adjacent tab
          const nextIdx = Math.min(closeIdx, next.length - 1);
          setActiveTabId(next[nextIdx].id);
        }

        saveSession(next);
        return next;
      });
    },
    [activeTabId, saveSession]
  );

  // Safe close tab (with confirm if dirty)
  const requestCloseTab = useCallback(
    (tabId: string) => {
      const tab = tabs.find((t) => t.id === tabId);
      if (!tab) return;

      if (!tab.isDirty) {
        forceCloseTab(tabId);
        return;
      }

      setConfirmDialog({
        isOpen: true,
        title: '未保存的更改',
        message: `文档「${tab.title}」有未保存的修改，关闭将丢失这些修改。是否确认关闭？`,
        confirmLabel: '放弃更改并关闭',
        cancelLabel: '取消',
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
    [tabs, forceCloseTab]
  );

  // Close other tabs
  const closeOtherTabs = useCallback(
    (tabId: string) => {
      const dirtyOthers = tabs.filter((t) => t.id !== tabId && t.isDirty);
      if (dirtyOthers.length > 0) {
        setConfirmDialog({
          isOpen: true,
          title: '关闭其他标签页',
          message: `有 ${dirtyOthers.length} 个其他标签页包含未保存的修改，关闭将丢失它们。是否继续？`,
          confirmLabel: '全部关闭',
          cancelLabel: '取消',
          variant: 'danger',
          onConfirm: () => {
            setTabs((prev) => {
              const current = prev.find((t) => t.id === tabId);
              const next = current ? [current] : [];
              saveSession(next);
              return next;
            });
            setActiveTabId(tabId);
            setConfirmDialog((prev) => ({ ...prev, isOpen: false }));
          },
          onCancel: () => {
            setConfirmDialog((prev) => ({ ...prev, isOpen: false }));
          },
        });
        return;
      }

      setTabs((prev) => {
        const current = prev.find((t) => t.id === tabId);
        const next = current ? [current] : [];
        saveSession(next);
        return next;
      });
      setActiveTabId(tabId);
    },
    [tabs, saveSession]
  );

  return {
    tabs,
    activeTabId,
    activeTab,
    setActiveTabId,
    createNewTab,
    updateContent,
    updateCursor,
    openDocument,
    saveActiveDocument,
    requestCloseTab,
    forceCloseTab,
    closeOtherTabs,
    confirmDialog,
    setConfirmDialog,
  };
}
