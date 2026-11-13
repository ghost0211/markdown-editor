import React, {
  Suspense,
  lazy,
  useState,
  useRef,
  useMemo,
  useEffect,
  useCallback,
  useDeferredValue,
} from 'react';
import { TitleBar } from '@/components/TitleBar';
import { TabBar } from '@/components/TabBar';
import { Toolbar } from '@/components/Toolbar';
import { Sidebar } from '@/components/Sidebar';
import type { EditorHandle } from '@/components/Editor';
import type { PreviewHandle } from '@/components/Preview';
import { StatusBar } from '@/components/StatusBar';
import { SplitPane } from '@/components/SplitPane';
import { ConfirmModal } from '@/components/ConfirmModal';
import { UpdateInstallOverlay } from '@/components/AppUpdateSection';
import { ToastContainer } from '@/components/ToastContainer';

import { useSettings } from '@/hooks/useSettings';
import { useTheme } from '@/hooks/useTheme';
import { useToast } from '@/hooks/useToast';
import { useDocuments } from '@/hooks/useDocuments';
import { useAppUpdater } from '@/hooks/useAppUpdater';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';
import { useExportDocument } from '@/hooks/useExportDocument';
import { usePaneScrollSync } from '@/hooks/usePaneScrollSync';
import { useWindowFileDrop } from '@/hooks/useWindowFileDrop';
import { useImageAssetInsertion } from '@/hooks/useImageAssetInsertion';
import { I18nProvider, useI18n } from '@/i18n';

import { cachedEditorStateIds, dropCachedEditorState } from '@/lib/editorStateCache';
import { extractOutline } from '@/lib/outline';
import { calculateStats } from '@/lib/stats';
import { ViewMode, ThemeMode, EditorSettings, DiffSideRef } from '@/types';
import { MarkdownAction } from '@/lib/markdownCommands';
import { showInFolder, openExternalUrl, setWindowTheme } from '@/lib/native';
import { resolveDocumentLink } from '@/lib/documentLinks';
import { toggleTaskCheckboxAtLine } from '@/lib/taskList';
import { clampRatio } from '@/lib/splitPane';
import { cycleTabIndex } from '@/lib/tabNavigation';

const LazyEditor = lazy(() =>
  import('@/components/Editor').then((m) => ({ default: m.Editor }))
);
const LazyPreview = lazy(() =>
  import('@/components/Preview').then((m) => ({ default: m.Preview }))
);
const LazyDiffView = lazy(() =>
  import('@/components/DiffView').then((m) => ({ default: m.DiffView }))
);
const LazySettingsModal = lazy(() =>
  import('@/components/SettingsModal').then((m) => ({ default: m.SettingsModal }))
);
const LazyShortcutsModal = lazy(() =>
  import('@/components/ShortcutsModal').then((m) => ({ default: m.ShortcutsModal }))
);
const LazyCompareModal = lazy(() =>
  import('@/components/CompareModal').then((m) => ({ default: m.CompareModal }))
);

const STORAGE_VIEW_MODE_KEY = 'markdown_editor_view_mode';
const STORAGE_SIDEBAR_KEY = 'markdown_editor_sidebar_open';
const STORAGE_SPLIT_RATIO_KEY = 'markdown_editor_split_ratio';

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
  const handleThemeChange = useCallback(
    (newTheme: ThemeMode) => {
      updateSetting('theme', newTheme);
    },
    [updateSetting]
  );

  const { theme, setTheme, isDark } = useTheme(settings.theme, handleThemeChange);

  useEffect(() => {
    void setWindowTheme(theme);
  }, [theme]);

  const { toasts, showToast, removeToast } = useToast();
  const { t } = useI18n();

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
    openFileByPath,
    openRecentFile,
    openDroppedDocument,
    reopenClosedFile,
    recentFiles,
    clearRecentFiles,
    saveActiveDocument,
    saveDocumentTab,
    requestCloseTab,
    closeOtherTabs,
    closeTabsToTheRight,
    closeSavedTabs,
    closeAllTabs,
    reloadTab,
    flushSession,
    prepareForAppUpdate,
    confirmDialog,
    setConfirmDialog,
  } = useDocuments(showToast, settings.restoreSession, settings.startupView, settings.autoSave);

  const updater = useAppUpdater(showToast);
  const handleBeforeUpdateInstall = useCallback(async () => {
    const ready = await prepareForAppUpdate();
    if (!ready) showToast(t('updates.saveCancelled'), 'warning');
    return ready;
  }, [prepareForAppUpdate, showToast, t]);

  const [linkAnchor, setLinkAnchor] = useState<{ path: string; anchor: string } | null>(null);
  const handleOpenLink = useCallback(
    async (href: string) => {
      try {
        const target = resolveDocumentLink(href, activeTab?.filePath);
        if (!target) {
          await openExternalUrl(href);
          return;
        }
        if (await openFileByPath(target.path)) {
          setLinkAnchor(target);
        }
      } catch (error) {
        showToast(String(error instanceof Error ? error.message : error), 'error');
      }
    },
    [activeTab?.filePath, openFileByPath, showToast]
  );

  const {
    isExporting,
    exportingType,
    exportWord,
    exportPdf,
    exportHtml,
    copyRichText,
  } = useExportDocument(activeTab, showToast, { embedImages: settings.exportEmbedImages });

  const [lastUsedViewMode, setLastUsedViewMode] = useState<ViewMode>(() => {
    const saved = localStorage.getItem(STORAGE_VIEW_MODE_KEY) as ViewMode | null;
    return saved === 'edit' || saved === 'split' || saved === 'read' ? saved : 'split';
  });

  const defaultViewMode: ViewMode =
    settings.startupView !== 'remember-last' ? settings.startupView : lastUsedViewMode;
  const viewMode: ViewMode = activeTab?.viewMode ?? defaultViewMode;

  const editorRef = useRef<EditorHandle>(null);
  const previewRef = useRef<PreviewHandle>(null);

  const {
    prepareModeSwitchLineSync,
    handleSelectHeading,
    handleEditorScroll,
    handlePreviewScroll,
  } = usePaneScrollSync({
    tabs,
    activeTabId,
    viewMode,
    editorRef,
    previewRef,
    updateScrollPositions,
    flushSession,
  });

  const setViewMode = useCallback(
    (mode: ViewMode) => {
      localStorage.setItem(STORAGE_VIEW_MODE_KEY, mode);
      setLastUsedViewMode(mode);
      if (activeTabId) {
        prepareModeSwitchLineSync(mode);
        updateViewMode(activeTabId, mode);
      }
    },
    [activeTabId, prepareModeSwitchLineSync, updateViewMode]
  );

  const [isSidebarOpen, setIsSidebarOpen] = useState<boolean>(() => {
    const saved = localStorage.getItem(STORAGE_SIDEBAR_KEY);
    return saved !== null ? saved === 'true' : true;
  });

  const [splitRatio, setSplitRatio] = useState(() => {
    const saved = Number.parseFloat(localStorage.getItem(STORAGE_SPLIT_RATIO_KEY) || '');
    return Number.isFinite(saved) ? clampRatio(saved) : 0.5;
  });

  const handleSplitRatioCommit = useCallback((ratio: number) => {
    try {
      localStorage.setItem(STORAGE_SPLIT_RATIO_KEY, String(ratio));
    } catch {
      // layout preference is non-critical
    }
  }, []);

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

  const [isShortcutsModalOpen, setIsShortcutsModalOpen] = useState(false);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [isCompareModalOpen, setIsCompareModalOpen] = useState(false);

  const handleOpenSettings = useCallback(() => setIsSettingsModalOpen(true), []);
  const handleCloseSettings = useCallback(() => setIsSettingsModalOpen(false), []);
  const handleToggleSettings = useCallback(() => setIsSettingsModalOpen((prev) => !prev), []);

  const handleOpenShortcuts = useCallback(() => setIsShortcutsModalOpen(true), []);
  const handleCloseShortcuts = useCallback(() => setIsShortcutsModalOpen(false), []);
  const handleToggleShortcuts = useCallback(() => setIsShortcutsModalOpen((prev) => !prev), []);

  const handleOpenCompare = useCallback(() => setIsCompareModalOpen(true), []);
  const handleCloseCompare = useCallback(() => setIsCompareModalOpen(false), []);
  const handleConfirmCompare = useCallback(
    (leftId: string, rightId: string) => {
      createDiffTab(leftId, rightId);
      setIsCompareModalOpen(false);
    },
    [createDiffTab]
  );

  const docTabs = useMemo(() => tabs.filter((tab) => tab.kind !== 'diff'), [tabs]);
  const defaultCompareLeftId =
    activeTab && activeTab.kind !== 'diff' ? activeTab.id : undefined;

  const resolveDiffSide = useCallback(
    (ref: DiffSideRef) => {
      const source = tabs.find((tab) => tab.id === ref.tabId);
      return {
        title: ref.title,
        content: source ? source.content : ref.snapshot,
        readOnly: !source,
        onChange: source ? (value: string) => updateContent(source.id, value) : undefined,
      };
    },
    [tabs, updateContent]
  );

  const handleNewTab = useCallback(() => createNewTab(), [createNewTab]);
  const handleSave = useCallback(() => {
    void saveActiveDocument(false);
  }, [saveActiveDocument]);
  const handleSaveAs = useCallback(() => {
    void saveActiveDocument(true);
  }, [saveActiveDocument]);
  const handleCloseActiveTab = useCallback(() => {
    if (activeTabId) requestCloseTab(activeTabId);
  }, [activeTabId, requestCloseTab]);

  const handleCancelConfirm = useCallback(() => {
    confirmDialog.onCancel?.();
    setConfirmDialog((prev) => ({ ...prev, isOpen: false }));
  }, [confirmDialog, setConfirmDialog]);

  useEffect(() => {
    if (
      !linkAnchor ||
      !activeTab ||
      activeTab.filePath?.replace(/\\/g, '/').toLowerCase() !== linkAnchor.path.toLowerCase()
    ) {
      return;
    }
    if (viewMode === 'edit') {
      updateViewMode(activeTab.id, 'read');
      return;
    }
    let inner = 0;
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => {
        if (linkAnchor.anchor) previewRef.current?.scrollToAnchor(linkAnchor.anchor);
        setLinkAnchor(null);
      });
    });
    return () => {
      cancelAnimationFrame(outer);
      cancelAnimationFrame(inner);
    };
  }, [linkAnchor, activeTab, viewMode, updateViewMode]);

  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const activeTabIdRef = useRef(activeTabId);
  activeTabIdRef.current = activeTabId;

  useEffect(() => {
    const liveIds = new Set(tabs.map((tab) => tab.id));
    for (const id of cachedEditorStateIds()) {
      if (!liveIds.has(id)) dropCachedEditorState(id);
    }
  }, [tabs]);

  const checkExternalChangesRef = useRef(checkExternalChanges);
  checkExternalChangesRef.current = checkExternalChanges;

  useEffect(() => {
    const run = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      void checkExternalChangesRef.current();
    };
    const timer = setInterval(run, 3000);
    window.addEventListener('focus', run);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', run);
    };
  }, []);

  const [isNarrowViewport, setIsNarrowViewport] = useState(() => window.innerWidth < 768);
  useEffect(() => {
    const handleResize = () => {
      const narrow = window.innerWidth < 768;
      setIsNarrowViewport(narrow);
      if (narrow && isSidebarOpen) {
        setIsSidebarOpen(false);
      }
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [isSidebarOpen]);

  useWindowFileDrop({
    openFilesByPaths,
    openDroppedDocument,
    showToast,
  });

  const handleOpenRecent = useCallback(
    (path: string) => {
      void openRecentFile(path);
    },
    [openRecentFile]
  );

  const handleReopenClosed = useCallback(() => {
    void reopenClosedFile();
  }, [reopenClosedFile]);

  const deferredActiveContent = useDeferredValue(activeTab?.content);
  const headings = useMemo(() => {
    if (deferredActiveContent === undefined) return [];
    return extractOutline(deferredActiveContent);
  }, [deferredActiveContent]);

  const stats = useMemo(() => {
    if (deferredActiveContent === undefined) {
      return { words: 0, chars: 0, charsNoSpaces: 0, lines: 0, readingTimeMinutes: 0 };
    }
    return calculateStats(deferredActiveContent);
  }, [deferredActiveContent]);

  const handleCycleTab = useCallback(
    (direction: 1 | -1) => {
      const currentTabs = tabsRef.current;
      const currentIndex = currentTabs.findIndex((tab) => tab.id === activeTabIdRef.current);
      const nextIndex = cycleTabIndex(currentIndex, currentTabs.length, direction);
      if (nextIndex !== null) setActiveTabId(currentTabs[nextIndex].id);
    },
    [setActiveTabId]
  );

  const handleNextTab = useCallback(() => handleCycleTab(1), [handleCycleTab]);
  const handlePreviousTab = useCallback(() => handleCycleTab(-1), [handleCycleTab]);

  const isModalOpen =
    isSettingsModalOpen || isShortcutsModalOpen || isCompareModalOpen || confirmDialog.isOpen;

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
    onNextTab: handleNextTab,
    onPreviousTab: handlePreviousTab,
    onReopenClosed: handleReopenClosed,
    enabled: !isModalOpen,
  });

  const handleToolbarAction = useCallback((action: MarkdownAction) => {
    editorRef.current?.applyAction(action);
  }, []);

  const handleCursorChange = useCallback(
    (line: number, col: number) => {
      if (activeTabId) {
        updateCursor(activeTabId, line, col);
      }
    },
    [activeTabId, updateCursor]
  );

  const handleToggleTask = useCallback(
    (line: number) => {
      const tabId = activeTabIdRef.current;
      const current = tabsRef.current.find((tab) => tab.id === tabId);
      if (!current) return;
      const next = toggleTaskCheckboxAtLine(current.content, line);
      if (next !== null) updateContent(current.id, next);
    },
    [updateContent]
  );

  const { handleImageFilesForEditor } = useImageAssetInsertion({
    tabs,
    activeTabId,
    editorRef,
    updateContent,
    showToast,
  });

  const handleEditorChange = useCallback(
    (val: string) => {
      if (activeTabId) {
        updateContent(activeTabId, val);
      }
    },
    [activeTabId, updateContent]
  );

  const renderEditor = () => (
    <LazyEditor
      ref={editorRef}
      docId={activeTab?.id}
      initialCursorLine={activeTab?.cursorLine}
      initialCursorCol={activeTab?.cursorCol}
      onImageFiles={handleImageFilesForEditor}
      value={activeTab?.content || ''}
      onChange={handleEditorChange}
      onCursorChange={handleCursorChange}
      onScroll={handleEditorScroll}
      isDark={isDark}
      fontSize={settings.fontSize}
      lineHeight={settings.lineHeight}
      tabSize={settings.tabSize}
      wordWrap={settings.wordWrap}
      lineNumbers={settings.lineNumbers}
      spellcheck={settings.spellcheck}
      typewriterMode={settings.typewriterMode}
      focusMode={settings.focusMode}
    />
  );

  const renderPreview = () => (
    <LazyPreview
      onOpenLink={handleOpenLink}
      onToggleTask={handleToggleTask}
      ref={previewRef}
      content={activeTab?.content || ''}
      sourcePath={activeTab?.filePath}
      showLineNumbers={settings.lineNumbers}
      onScroll={handlePreviewScroll}
    />
  );

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-app text-slate-900 dark:text-slate-100 font-sans">
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
        onCopyRichText={copyRichText}
        isExporting={isExporting}
        exportingType={exportingType}
        onOpenShortcuts={handleOpenShortcuts}
        onOpenSettings={handleOpenSettings}
        onCompare={handleOpenCompare}
        recentFiles={recentFiles}
        onOpenRecent={handleOpenRecent}
        onClearRecent={clearRecentFiles}
      />

      <TabBar
        tabs={tabs}
        activeTabId={activeTabId}
        onSelectTab={setActiveTabId}
        onCloseTab={requestCloseTab}
        onNewTab={handleNewTab}
        onMoveTab={moveTab}
        onCloseOthers={closeOtherTabs}
        onCloseToTheRight={closeTabsToTheRight}
        onCloseSaved={closeSavedTabs}
        onCloseAll={closeAllTabs}
        onReloadTab={reloadTab}
        onSaveTabAs={(id) => void saveDocumentTab(id, true)}
        onRevealInFolder={async (filePath) => {
          try {
            await showInFolder(filePath);
            showToast(t('toasts.revealedInFolder'), 'info');
          } catch (err: unknown) {
            const msg = (err as Error)?.message || String(err);
            showToast(t('toasts.revealFailed', { error: msg }), 'error');
          }
        }}
        onOpenFile={openDocument}
        showToast={showToast}
      />

      {viewMode !== 'read' && activeTab?.kind !== 'diff' && (
        <Toolbar onAction={handleToolbarAction} disabled={!activeTab} />
      )}

      <div className="flex-1 flex overflow-hidden relative">
        {activeTab?.kind !== 'diff' && (
          <Sidebar
            headings={headings}
            isOpen={isSidebarOpen}
            onClose={handleCloseSidebar}
            onSelectHeading={handleSelectHeading}
            currentLine={activeTab?.cursorLine || 1}
          />
        )}

        <main className="flex-1 flex overflow-hidden relative bg-workspace">
          <Suspense fallback={<div className="h-full w-full bg-workspace" />}>
            {activeTab?.kind === 'diff' && activeTab.diffRefs ? (
              (() => {
                const left = resolveDiffSide(activeTab.diffRefs.left);
                const right = resolveDiffSide(activeTab.diffRefs.right);
                return (
                  <LazyDiffView
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
            ) : viewMode === 'split' && !isNarrowViewport ? (
              <SplitPane
                ratio={splitRatio}
                onRatioChange={setSplitRatio}
                onRatioCommit={handleSplitRatioCommit}
                separatorLabel={t('splitPane.resize')}
                left={
                  <div className="h-full min-w-0 overflow-hidden">
                    <Suspense fallback={<div className="h-full w-full bg-workspace" />}>
                      {renderEditor()}
                    </Suspense>
                  </div>
                }
                right={
                  <div className="h-full min-w-0 overflow-hidden bg-app">
                    <Suspense fallback={<div className="h-full w-full bg-app" />}>
                      {renderPreview()}
                    </Suspense>
                  </div>
                }
              />
            ) : (
              <>
                {(viewMode === 'edit' || viewMode === 'split') && (
                  <div className="h-full w-full overflow-hidden">{renderEditor()}</div>
                )}
                {viewMode === 'read' && (
                  <div className="h-full w-full overflow-hidden bg-app">{renderPreview()}</div>
                )}
              </>
            )}
          </Suspense>
        </main>
      </div>

      <StatusBar
        stats={stats}
        cursorLine={activeTab?.cursorLine || 1}
        cursorCol={activeTab?.cursorCol || 1}
        isDirty={activeTab?.isDirty || false}
        viewMode={viewMode}
      />

      <ConfirmModal
        isOpen={confirmDialog.isOpen}
        title={confirmDialog.title}
        message={confirmDialog.message}
        confirmLabel={confirmDialog.confirmLabel}
        secondaryLabel={confirmDialog.secondaryLabel}
        cancelLabel={confirmDialog.cancelLabel}
        variant={confirmDialog.variant}
        onConfirm={confirmDialog.onConfirm}
        onSecondary={confirmDialog.onSecondary}
        onCancel={handleCancelConfirm}
      />

      {isShortcutsModalOpen && (
        <Suspense fallback={null}>
          <LazyShortcutsModal isOpen={isShortcutsModalOpen} onClose={handleCloseShortcuts} />
        </Suspense>
      )}

      {isCompareModalOpen && (
        <Suspense fallback={null}>
          <LazyCompareModal
            isOpen={isCompareModalOpen}
            docTabs={docTabs}
            defaultLeftId={defaultCompareLeftId}
            onConfirm={handleConfirmCompare}
            onCancel={handleCloseCompare}
          />
        </Suspense>
      )}

      {isSettingsModalOpen && (
        <Suspense fallback={null}>
          <LazySettingsModal
            isOpen={isSettingsModalOpen}
            onClose={handleCloseSettings}
            settings={settings}
            onUpdateSetting={updateSetting}
            onResetSettings={resetSettings}
            showToast={showToast}
            updater={updater}
            onBeforeUpdateInstall={handleBeforeUpdateInstall}
          />
        </Suspense>
      )}

      <ToastContainer toasts={toasts} onDismiss={removeToast} />
      <UpdateInstallOverlay state={updater.state} />
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
