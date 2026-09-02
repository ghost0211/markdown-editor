import React, { useState, useRef, useMemo, useEffect, useCallback } from 'react';
import { TitleBar } from '@/components/TitleBar';
import { TabBar } from '@/components/TabBar';
import { Toolbar } from '@/components/Toolbar';
import { Sidebar } from '@/components/Sidebar';
import { Editor, EditorHandle } from '@/components/Editor';
import { Preview, PreviewHandle } from '@/components/Preview';
import { StatusBar } from '@/components/StatusBar';
import { ConfirmModal } from '@/components/ConfirmModal';
import { CompareModal } from '@/components/CompareModal';
import { DiffView } from '@/components/DiffView';
import { ShortcutsModal } from '@/components/ShortcutsModal';
import { SettingsModal } from '@/components/SettingsModal';
import { ToastContainer } from '@/components/ToastContainer';

import { useSettings } from '@/hooks/useSettings';
import { useTheme } from '@/hooks/useTheme';
import { useToast } from '@/hooks/useToast';
import { useDocuments } from '@/hooks/useDocuments';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';
import { useExportDocument } from '@/hooks/useExportDocument';
import { I18nProvider } from '@/i18n';

import { extractOutline } from '@/lib/outline';
import { calculateStats } from '@/lib/stats';
import { ViewMode, HeadingItem, ThemeMode, EditorSettings, DiffSideRef } from '@/types';
import { MarkdownAction } from '@/lib/markdownCommands';
import { isTauri, subscribeOpenFiles, drainPendingOpenFiles } from '@/lib/native';
import { createFileCoordinator } from '@/lib/fileCoordinator';

const STORAGE_VIEW_MODE_KEY = 'markdown_editor_view_mode';
const STORAGE_SIDEBAR_KEY = 'markdown_editor_sidebar_open';

interface AppContentProps {
  settings: EditorSettings;
  updateSetting: <K extends keyof EditorSettings>(key: K, value: EditorSettings[K]) => void;
  resetSettings: () => void;
}

const AppContent: React.FC<AppContentProps> = ({
  settings,
  updateSetting,
  resetSettings,
}) => {
  // Stable callback for theme bridge to prevent unnecessary listener/effect churn
  const handleThemeChange = useCallback(
    (newTheme: ThemeMode) => {
      updateSetting('theme', newTheme);
    },
    [updateSetting]
  );

  // Theme hook
  const { theme, setTheme, isDark } = useTheme(settings.theme, handleThemeChange);

  // Toast hook
  const { toasts, showToast, removeToast } = useToast();

  // Documents manager hook
  const {
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
    openFilesByPaths,
    saveActiveDocument,
    requestCloseTab,
    confirmDialog,
    setConfirmDialog,
  } = useDocuments(showToast, settings.restoreSession, settings.startupView);

  // Document export hook
  const {
    isExporting,
    exportingType,
    exportWord,
    exportPdf,
    exportHtml,
  } = useExportDocument(activeTab, showToast);

  // Default view mode resolved once at startup from settings / last-used mode.
  // Each tab may override it with its own persisted per-tab mode.
  const [defaultViewMode] = useState<ViewMode>(() => {
    if (settings.startupView !== 'remember-last') {
      return settings.startupView;
    }
    const saved = localStorage.getItem(STORAGE_VIEW_MODE_KEY) as ViewMode | null;
    return saved === 'edit' || saved === 'split' || saved === 'read' ? saved : 'split';
  });

  // View mode is independent per tab: tabs that were never switched explicitly
  // fall back to the default view mode.
  const viewMode: ViewMode = activeTab?.viewMode ?? defaultViewMode;

  const setViewMode = useCallback(
    (mode: ViewMode) => {
      // Remember as the global last-used mode (default for new tabs on next launch)
      localStorage.setItem(STORAGE_VIEW_MODE_KEY, mode);
      // Apply to the active tab only, leaving other tabs' modes untouched
      if (activeTabId) {
        if (mode !== viewMode) {
          // Capture the current reading position as a source line so the new
          // view mode continues from exactly the same position (no jumping).
          const pos =
            viewMode === 'read'
              ? previewRef.current?.getTopSourceLine()
              : editorRef.current?.getTopVisibleLine();
          pendingLineSyncRef.current = {
            tabId: activeTabId,
            line: pos?.line ?? 1,
            fraction: pos?.fraction ?? 0,
          };
        }
        updateViewMode(activeTabId, mode);
      }
    },
    [activeTabId, viewMode, updateViewMode]
  );

  // Sidebar open/collapse state
  const [isSidebarOpen, setIsSidebarOpen] = useState<boolean>(() => {
    const saved = localStorage.getItem(STORAGE_SIDEBAR_KEY);
    return saved !== null ? saved === 'true' : true;
  });

  const toggleSidebar = useCallback(() => {
    setIsSidebarOpen((prev) => {
      const next = !prev;
      localStorage.setItem(STORAGE_SIDEBAR_KEY, String(next));
      return next;
    });
  }, []);

  const handleCloseSidebar = useCallback(() => {
    setIsSidebarOpen(false);
  }, []);

  // Modals state & stable handlers
  const [isShortcutsModalOpen, setIsShortcutsModalOpen] = useState(false);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [isCompareModalOpen, setIsCompareModalOpen] = useState(false);

  const handleOpenSettings = useCallback(() => {
    setIsSettingsModalOpen(true);
  }, []);

  const handleCloseSettings = useCallback(() => {
    setIsSettingsModalOpen(false);
  }, []);

  const handleToggleSettings = useCallback(() => {
    setIsSettingsModalOpen((prev) => !prev);
  }, []);

  const handleOpenShortcuts = useCallback(() => {
    setIsShortcutsModalOpen(true);
  }, []);

  const handleCloseShortcuts = useCallback(() => {
    setIsShortcutsModalOpen(false);
  }, []);

  const handleToggleShortcuts = useCallback(() => {
    setIsShortcutsModalOpen((prev) => !prev);
  }, []);

  // Compare (diff) modal handlers
  const handleOpenCompare = useCallback(() => {
    setIsCompareModalOpen(true);
  }, []);

  const handleCloseCompare = useCallback(() => {
    setIsCompareModalOpen(false);
  }, []);

  const handleConfirmCompare = useCallback(
    (leftId: string, rightId: string) => {
      createDiffTab(leftId, rightId);
      setIsCompareModalOpen(false);
    },
    [createDiffTab]
  );

  // Candidate documents for comparison (diff tabs cannot be compared)
  const docTabs = useMemo(() => tabs.filter((tab) => tab.kind !== 'diff'), [tabs]);
  const defaultCompareLeftId =
    activeTab && activeTab.kind !== 'diff' ? activeTab.id : undefined;

  // Resolve one side of a diff tab against its live source tab, falling back
  // to the captured snapshot (read-only) once the source tab is closed.
  const resolveDiffSide = useCallback(
    (ref: DiffSideRef) => {
      const source = tabs.find((tab) => tab.id === ref.tabId);
      return {
        title: ref.title,
        content: source ? source.content : ref.snapshot,
        readOnly: !source,
        onChange: source
          ? (value: string) => updateContent(source.id, value)
          : undefined,
      };
    },
    [tabs, updateContent]
  );

  // Stable document action handlers
  const handleNewTab = useCallback(() => {
    createNewTab();
  }, [createNewTab]);

  const handleSave = useCallback(() => {
    saveActiveDocument(false);
  }, [saveActiveDocument]);

  const handleSaveAs = useCallback(() => {
    saveActiveDocument(true);
  }, [saveActiveDocument]);

  const handleCloseActiveTab = useCallback(() => {
    if (activeTabId) {
      requestCloseTab(activeTabId);
    }
  }, [activeTabId, requestCloseTab]);

  const handleCancelConfirm = useCallback(() => {
    confirmDialog.onCancel?.();
    setConfirmDialog((prev) => ({ ...prev, isOpen: false }));
  }, [confirmDialog.onCancel, setConfirmDialog]);

  // Editor and Preview refs
  const editorRef = useRef<EditorHandle>(null);
  const previewRef = useRef<PreviewHandle>(null);

  // Sync scroll lock to prevent feedback loop
  const isSyncingScroll = useRef(false);

  // Latest tab list / active tab id in refs for effect-time lookups
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const activeTabIdRef = useRef(activeTabId);
  activeTabIdRef.current = activeTabId;

  // Per-tab scroll positions (editor + preview), recorded continuously on scroll
  // events so tab switches never lose reading progress even mid-frame.
  const scrollPositionsRef = useRef(new Map<string, { editor: number; preview: number }>());

  // Pending cross-mode scroll translation (source line based), set by setViewMode
  // right before a mode switch and consumed by the restore effect below.
  const pendingLineSyncRef = useRef<{ tabId: string; line: number; fraction: number } | null>(null);

  const recordEditorScroll = useCallback((top: number) => {
    const id = activeTabIdRef.current;
    if (!id) return;
    const entry = scrollPositionsRef.current.get(id) ?? { editor: 0, preview: 0 };
    entry.editor = top;
    scrollPositionsRef.current.set(id, entry);
  }, []);

  const recordPreviewScroll = useCallback((top: number) => {
    const id = activeTabIdRef.current;
    if (!id) return;
    const entry = scrollPositionsRef.current.get(id) ?? { editor: 0, preview: 0 };
    entry.preview = top;
    scrollPositionsRef.current.set(id, entry);
  }, []);

  // Save / restore per-tab scroll positions on tab switch or view-mode change
  const prevScrollTabIdRef = useRef<string | null>(null);

  useEffect(() => {
    const prevTabId = prevScrollTabIdRef.current;

    // Persist the previous tab's latest positions into its tab record (session)
    if (prevTabId && prevTabId !== activeTabId) {
      const prev = scrollPositionsRef.current.get(prevTabId);
      if (prev) {
        updateScrollPositions(prevTabId, prev.editor, prev.preview);
      }
      // Prune entries belonging to closed tabs
      const openIds = new Set(tabsRef.current.map((t) => t.id));
      for (const key of scrollPositionsRef.current.keys()) {
        if (!openIds.has(key)) {
          scrollPositionsRef.current.delete(key);
        }
      }
    }
    prevScrollTabIdRef.current = activeTabId;

    if (!activeTabId) return;

    // Same tab, view mode just switched: translate the reading position by
    // source line so the new mode continues from exactly the same position.
    const pending = pendingLineSyncRef.current;
    pendingLineSyncRef.current = null;
    if (pending && pending.tabId === activeTabId && prevTabId === activeTabId) {
      isSyncingScroll.current = true;
      const raf = requestAnimationFrame(() => {
        if (viewMode !== 'read') {
          editorRef.current?.scrollToLine(pending.line);
        }
        if (viewMode !== 'edit') {
          previewRef.current?.scrollToSourceLine(pending.line, pending.fraction);
        }
        setTimeout(() => {
          isSyncingScroll.current = false;
        }, 100);
      });
      return () => cancelAnimationFrame(raf);
    }

    // Resolve target positions: in-session map first, then persisted tab record
    const fromMap = scrollPositionsRef.current.get(activeTabId);
    const tabRecord = tabsRef.current.find((t) => t.id === activeTabId);
    const editorTop = fromMap?.editor ?? tabRecord?.scrollPosition ?? 0;
    const previewTop = fromMap?.preview ?? tabRecord?.previewScrollPosition ?? 0;
    scrollPositionsRef.current.set(activeTabId, { editor: editorTop, preview: previewTop });

    // Restore after the panes (re)mount; hold the sync lock so the programmatic
    // restore does not trigger the split-scroll synchronization.
    isSyncingScroll.current = true;
    const raf = requestAnimationFrame(() => {
      if (viewMode !== 'read') {
        editorRef.current?.setScrollTop(editorTop);
      }
      if (viewMode !== 'edit') {
        previewRef.current?.setScrollTop(previewTop);
      }
      setTimeout(() => {
        isSyncingScroll.current = false;
      }, 100);
    });
    return () => cancelAnimationFrame(raf);
  }, [activeTabId, viewMode, updateScrollPositions]);

  // Flush the active tab's scroll positions into the persisted session on unload
  useEffect(() => {
    const flush = () => {
      const id = activeTabIdRef.current;
      if (!id) return;
      const pos = scrollPositionsRef.current.get(id);
      if (pos) {
        updateScrollPositions(id, pos.editor, pos.preview);
      }
    };
    window.addEventListener('beforeunload', flush);
    return () => window.removeEventListener('beforeunload', flush);
  }, [updateScrollPositions]);

  // External file modification detection: poll while visible + on window focus
  const checkExternalChangesRef = useRef(checkExternalChanges);
  checkExternalChangesRef.current = checkExternalChanges;

  useEffect(() => {
    const run = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      checkExternalChangesRef.current();
    };
    const timer = setInterval(run, 3000);
    window.addEventListener('focus', run);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', run);
    };
  }, []);

  // Auto-collapse sidebar on small screens
  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth < 768 && isSidebarOpen) {
        setIsSidebarOpen(false);
      }
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [isSidebarOpen]);

  const openFilesByPathsRef = useRef(openFilesByPaths);
  openFilesByPathsRef.current = openFilesByPaths;

  // Handle cold-start, runtime file association opens, window restore, and suspension recovery
  useEffect(() => {
    const coordinator = createFileCoordinator({
      drainPendingFiles: drainPendingOpenFiles,
      onFilesReceived: (paths) => openFilesByPathsRef.current(paths),
      isTauri,
      subscribeOpenFiles,
      pollIntervalMs: 2000,
    });

    coordinator.start();

    return () => {
      coordinator.stop();
    };
  }, []);

  // Extract headings outline from active document content
  const headings = useMemo(() => {
    if (!activeTab) return [];
    return extractOutline(activeTab.content);
  }, [activeTab?.content]);

  // Calculate statistics from active document content
  const stats = useMemo(() => {
    if (!activeTab) {
      return { words: 0, chars: 0, charsNoSpaces: 0, lines: 0, readingTimeMinutes: 0 };
    }
    return calculateStats(activeTab.content);
  }, [activeTab?.content]);

  // Keyboard shortcuts integration
  useKeyboardShortcuts({
    onNew: handleNewTab,
    onOpen: openDocument,
    onSave: handleSave,
    onSaveAs: handleSaveAs,
    onCloseTab: handleCloseActiveTab,
    onSetViewMode: setViewMode,
    onToggleSidebar: toggleSidebar,
    onToggleShortcutsModal: handleToggleShortcuts,
    onToggleSettingsModal: handleToggleSettings,
  });

  // Handle heading selection from outline
  const handleSelectHeading = useCallback(
    (heading: HeadingItem) => {
      isSyncingScroll.current = true;
      if (viewMode === 'edit' || viewMode === 'split') {
        editorRef.current?.jumpToLine(heading.line);
      }
      if (viewMode === 'read' || viewMode === 'split') {
        previewRef.current?.scrollToAnchor(heading.slug, heading.line);
      }
      setTimeout(() => {
        isSyncingScroll.current = false;
      }, 300);
    },
    [viewMode]
  );

  // Handle toolbar action formatting
  const handleToolbarAction = useCallback((action: MarkdownAction) => {
    if (editorRef.current) {
      editorRef.current.applyAction(action);
    }
  }, []);

  // Synchronized scroll from Editor to Preview in split mode.
  // Anchored on source line numbers so both panes stay aligned even when the
  // rendered heights differ significantly (images, code blocks, tables...).
  const handleEditorScroll = useCallback(
    (scrollTop: number) => {
      recordEditorScroll(scrollTop);
      if (viewMode !== 'split' || isSyncingScroll.current) return;
      const pos = editorRef.current?.getTopVisibleLine();
      if (pos) {
        isSyncingScroll.current = true;
        previewRef.current?.scrollToSourceLine(pos.line, pos.fraction);
        setTimeout(() => {
          isSyncingScroll.current = false;
        }, 50);
      }
    },
    [viewMode, recordEditorScroll]
  );

  // Track preview scroll for per-tab reading position memory
  const handlePreviewScroll = useCallback(
    (scrollTop: number) => {
      recordPreviewScroll(scrollTop);
    },
    [recordPreviewScroll]
  );

  const handleCursorChange = useCallback(
    (line: number, col: number) => {
      if (activeTabId) {
        updateCursor(activeTabId, line, col);
      }
    },
    [activeTabId, updateCursor]
  );

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-white dark:bg-[#0f172a] text-slate-900 dark:text-slate-100 font-sans">
      {/* 1. TitleBar & Quick Controls */}
      <TitleBar
        activeTab={activeTab}
        viewMode={viewMode}
        onSetViewMode={setViewMode}
        theme={theme}
        onSetTheme={setTheme}
        isSidebarOpen={isSidebarOpen}
        onToggleSidebar={toggleSidebar}
        onNew={handleNewTab}
        onOpen={openDocument}
        onSave={handleSave}
        onSaveAs={handleSaveAs}
        onExportWord={exportWord}
        onExportPdf={exportPdf}
        onExportHtml={exportHtml}
        isExporting={isExporting}
        exportingType={exportingType}
        onOpenShortcuts={handleOpenShortcuts}
        onOpenSettings={handleOpenSettings}
        onCompare={handleOpenCompare}
      />

      {/* 2. TabBar (Multi-document tabs) */}
      <TabBar
        tabs={tabs}
        activeTabId={activeTabId}
        onSelectTab={setActiveTabId}
        onCloseTab={requestCloseTab}
        onNewTab={handleNewTab}
        onMoveTab={moveTab}
      />

      {/* 3. Toolbar (Markdown insertion ribbon) */}
      {viewMode !== 'read' && activeTab?.kind !== 'diff' && (
        <Toolbar onAction={handleToolbarAction} disabled={!activeTab} />
      )}

      {/* 4. Main Body: Sidebar + Editor + Preview */}
      <div className="flex-1 flex overflow-hidden relative">
        {/* Left Outline Sidebar (not applicable to diff tabs) */}
        {activeTab?.kind !== 'diff' && (
          <Sidebar
            headings={headings}
            isOpen={isSidebarOpen}
            onClose={handleCloseSidebar}
            onSelectHeading={handleSelectHeading}
            currentLine={activeTab?.cursorLine || 1}
          />
        )}

        {/* Central Workspace */}
        <main className="flex-1 flex overflow-hidden relative bg-slate-100/50 dark:bg-[#0b1120]">
          {activeTab?.kind === 'diff' && activeTab.diffRefs ? (
            (() => {
              const left = resolveDiffSide(activeTab.diffRefs!.left);
              const right = resolveDiffSide(activeTab.diffRefs!.right);
              return (
                <DiffView
                  key={activeTab.id}
                  leftTitle={left.title}
                  rightTitle={right.title}
                  leftDoc={left.content}
                  rightDoc={right.content}
                  leftReadOnly={left.readOnly}
                  rightReadOnly={right.readOnly}
                  onChangeLeft={left.onChange}
                  onChangeRight={right.onChange}
                  isDark={isDark}
                  fontSize={settings.fontSize}
                  lineHeight={settings.lineHeight}
                  tabSize={settings.tabSize}
                  wordWrap={settings.wordWrap}
                  lineNumbers={settings.lineNumbers}
                />
              );
            })()
          ) : (
            <>
              {/* Edit Mode / Split Left */}
              {(viewMode === 'edit' || viewMode === 'split') && (
            <div
              className={`h-full overflow-hidden ${
                viewMode === 'split'
                  ? 'w-1/2 border-r border-slate-200 dark:border-slate-800'
                  : 'w-full'
              }`}
            >
              <Editor
                ref={editorRef}
                value={activeTab?.content || ''}
                onChange={(val) => {
                  if (activeTabId) {
                    updateContent(activeTabId, val);
                  }
                }}
                onCursorChange={handleCursorChange}
                onScroll={handleEditorScroll}
                isDark={isDark}
                fontSize={settings.fontSize}
                lineHeight={settings.lineHeight}
                tabSize={settings.tabSize}
                wordWrap={settings.wordWrap}
                lineNumbers={settings.lineNumbers}
              />
            </div>
          )}

          {/* Read Mode / Split Right */}
          {(viewMode === 'read' || viewMode === 'split') && (
            <div
              className={`h-full overflow-hidden bg-white dark:bg-[#0f172a] ${
                viewMode === 'split' ? 'w-1/2' : 'w-full'
              }`}
            >
              <Preview
                ref={previewRef}
                content={activeTab?.content || ''}
                showLineNumbers={settings.lineNumbers}
                onScroll={handlePreviewScroll}
              />
            </div>
          )}
            </>
          )}
        </main>
      </div>

      {/* 5. Bottom StatusBar */}
      <StatusBar
        stats={stats}
        cursorLine={activeTab?.cursorLine || 1}
        cursorCol={activeTab?.cursorCol || 1}
        isDirty={activeTab?.isDirty || false}
        viewMode={viewMode}
      />

      {/* 6. Modals and Floating Elements */}
      <ConfirmModal
        isOpen={confirmDialog.isOpen}
        title={confirmDialog.title}
        message={confirmDialog.message}
        confirmLabel={confirmDialog.confirmLabel}
        cancelLabel={confirmDialog.cancelLabel}
        variant={confirmDialog.variant}
        onConfirm={confirmDialog.onConfirm}
        onCancel={handleCancelConfirm}
      />

      <ShortcutsModal
        isOpen={isShortcutsModalOpen}
        onClose={handleCloseShortcuts}
      />

      <CompareModal
        isOpen={isCompareModalOpen}
        docTabs={docTabs}
        defaultLeftId={defaultCompareLeftId}
        onConfirm={handleConfirmCompare}
        onCancel={handleCloseCompare}
      />

      <SettingsModal
        isOpen={isSettingsModalOpen}
        onClose={handleCloseSettings}
        settings={settings}
        onUpdateSetting={updateSetting}
        onResetSettings={resetSettings}
        showToast={showToast}
      />

      <ToastContainer toasts={toasts} onDismiss={removeToast} />
    </div>
  );
};

export const App: React.FC = () => {
  const { settings, updateSetting, resetSettings } = useSettings();

  return (
    <I18nProvider language={settings.language}>
      <AppContent
        settings={settings}
        updateSetting={updateSetting}
        resetSettings={resetSettings}
      />
    </I18nProvider>
  );
};

export default App;
