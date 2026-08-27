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
import { ToastContainer } from '@/components/ToastContainer';

import { useTheme } from '@/hooks/useTheme';
import { useToast } from '@/hooks/useToast';
import { useDocuments } from '@/hooks/useDocuments';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';
import { useExportDocument } from '@/hooks/useExportDocument';

import { extractOutline } from '@/lib/outline';
import { calculateStats } from '@/lib/stats';
import { ViewMode, HeadingItem } from '@/types';
import { MarkdownAction } from '@/lib/markdownCommands';

const STORAGE_VIEW_MODE_KEY = 'markdown_editor_view_mode';
const STORAGE_SIDEBAR_KEY = 'markdown_editor_sidebar_open';

export const App: React.FC = () => {
  // Theme hook
  const { theme, setTheme, isDark } = useTheme();

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
    saveActiveDocument,
    requestCloseTab,
    confirmDialog,
    setConfirmDialog,
  } = useDocuments(showToast);

  // Document export hook
  const {
    isExporting,
    exportingType,
    exportWord,
    exportPdf,
  } = useExportDocument(activeTab, showToast);

  // View mode state
  const [viewMode, setViewModeState] = useState<ViewMode>(() => {
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

  // Shortcuts modal state
  const [isShortcutsModalOpen, setIsShortcutsModalOpen] = useState(false);

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
    onNew: () => createNewTab(),
    onOpen: () => openDocument(),
    onSave: () => saveActiveDocument(false),
    onSaveAs: () => saveActiveDocument(true),
    onCloseTab: () => {
      if (activeTabId) requestCloseTab(activeTabId);
    },
    onSetViewMode: setViewMode,
    onToggleSidebar: toggleSidebar,
    onToggleShortcutsModal: () => setIsShortcutsModalOpen((prev) => !prev),
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
        onNew={() => createNewTab()}
        onOpen={openDocument}
        onSave={() => saveActiveDocument(false)}
        onSaveAs={() => saveActiveDocument(true)}
        onExportWord={exportWord}
        onExportPdf={exportPdf}
        isExporting={isExporting}
        exportingType={exportingType}
        onOpenShortcuts={() => setIsShortcutsModalOpen(true)}
      />

      {/* 2. TabBar (Multi-document tabs) */}
      <TabBar
        tabs={tabs}
        activeTabId={activeTabId}
        onSelectTab={setActiveTabId}
        onCloseTab={requestCloseTab}
        onNewTab={() => createNewTab()}
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
          onClose={() => setIsSidebarOpen(false)}
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
        onCancel={() => {
          confirmDialog.onCancel?.();
          setConfirmDialog((prev) => ({ ...prev, isOpen: false }));
        }}
      />

      <ShortcutsModal
        isOpen={isShortcutsModalOpen}
        onClose={() => setIsShortcutsModalOpen(false)}
      />

      <ToastContainer toasts={toasts} onDismiss={removeToast} />
    </div>
  );
};

export default App;
