import React, { useState, useRef, useMemo, useEffect, useCallback } from 'react';
import { TitleBar } from '@/components/TitleBar';
import { TabBar } from '@/components/TabBar';
import { Toolbar } from '@/components/Toolbar';
import { Sidebar } from '@/components/Sidebar';
import { Editor, EditorHandle } from '@/components/Editor';
import { Preview, PreviewHandle } from '@/components/Preview';
import { StatusBar } from '@/components/StatusBar';
import { ConfirmModal } from '@/components/ConfirmModal';
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
import { ViewMode, HeadingItem, ThemeMode, EditorSettings } from '@/types';
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
    openDocument,
    openFilesByPaths,
    saveActiveDocument,
    requestCloseTab,
    confirmDialog,
    setConfirmDialog,
  } = useDocuments(showToast, settings.restoreSession);

  // Document export hook
  const {
    isExporting,
    exportingType,
    exportWord,
    exportPdf,
    exportHtml,
  } = useExportDocument(activeTab, showToast);

  // View mode state
  const [viewMode, setViewModeState] = useState<ViewMode>(() => {
    if (settings.startupView !== 'remember-last') {
      return settings.startupView;
    }
    const saved = localStorage.getItem(STORAGE_VIEW_MODE_KEY) as ViewMode | null;
    return saved === 'edit' || saved === 'split' || saved === 'read' ? saved : 'split';
  });

  const setViewMode = useCallback((mode: ViewMode) => {
    setViewModeState(mode);
    localStorage.setItem(STORAGE_VIEW_MODE_KEY, mode);
  }, []);

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

  // Synchronized scroll from Editor to Preview in split mode
  const handleEditorScroll = useCallback(
    (scrollTop: number, scrollHeight: number, clientHeight: number) => {
      if (viewMode !== 'split' || isSyncingScroll.current) return;
      const maxScroll = scrollHeight - clientHeight;
      if (maxScroll > 0) {
        const ratio = scrollTop / maxScroll;
        isSyncingScroll.current = true;
        previewRef.current?.scrollToRatio(ratio);
        setTimeout(() => {
          isSyncingScroll.current = false;
        }, 50);
      }
    },
    [viewMode]
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
      />

      {/* 2. TabBar (Multi-document tabs) */}
      <TabBar
        tabs={tabs}
        activeTabId={activeTabId}
        onSelectTab={setActiveTabId}
        onCloseTab={requestCloseTab}
        onNewTab={handleNewTab}
      />

      {/* 3. Toolbar (Markdown insertion ribbon) */}
      {viewMode !== 'read' && (
        <Toolbar onAction={handleToolbarAction} disabled={!activeTab} />
      )}

      {/* 4. Main Body: Sidebar + Editor + Preview */}
      <div className="flex-1 flex overflow-hidden relative">
        {/* Left Outline Sidebar */}
        <Sidebar
          headings={headings}
          isOpen={isSidebarOpen}
          onClose={handleCloseSidebar}
          onSelectHeading={handleSelectHeading}
          currentLine={activeTab?.cursorLine || 1}
        />

        {/* Central Workspace */}
        <main className="flex-1 flex overflow-hidden relative bg-slate-100/50 dark:bg-[#0b1120]">
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
              />
            </div>
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
