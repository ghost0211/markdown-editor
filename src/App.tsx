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
import { useDocumentResources } from '@/hooks/useDocumentResources';
import type { DocumentResource } from '@/lib/documentResources';
import { I18nProvider, useI18n } from '@/i18n';

import { applyCachedDocumentChange, cachedEditorStateIds, dropCachedEditorState } from '@/lib/editorStateCache';
import { extractOutline } from '@/lib/outline';
import { calculateStats } from '@/lib/stats';
import { ViewMode, ThemeMode, EditorSettings, DiffSideRef, type EditorPresentation } from '@/types';
import { MarkdownAction } from '@/lib/markdownCommands';
import { showInFolder, openExternalUrl, setWindowTheme, isTauri, chooseWorkspaceFolder, listWorkspace, createWorkspaceDocument, createWorkspaceFolder, renameWorkspacePath as renameWorkspaceFile } from '@/lib/native';
import { workspaceEntryAbsolutePath, type WorkspaceEntry, type WorkspaceListing } from '@/lib/workspace';
import { DEFAULT_EXPORT_STYLE, type ExportStyle } from '@/lib/exportStyle';
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
const LazyResourceManager = lazy(() =>
  import('@/components/ResourceManager').then((m) => ({ default: m.ResourceManager }))
);
const LazyDocumentSearch = lazy(() =>
  import('@/components/DocumentSearch').then((m) => ({ default: m.DocumentSearch }))
);
const LazyDocumentHistory = lazy(() =>
  import('@/components/DocumentHistory').then((m) => ({ default: m.DocumentHistory }))
);
const LazyTemplateManager = lazy(() => import('@/components/TemplateManager').then((m) => ({ default: m.TemplateManager })));
const LazyQualityPanel = lazy(() => import('@/components/QualityPanel').then((m) => ({ default: m.QualityPanel })));
const LazyExportStyleDialog = lazy(() => import('@/components/ExportStyleDialog').then((m) => ({ default: m.ExportStyleDialog })));
const LazyWorkspacePanel = lazy(() => import('@/components/WorkspacePanel').then((m) => ({ default: m.WorkspacePanel })));

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
    renameWorkspacePath,
    updateContent,
    applyContentUpdates,
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
    exportXmd,
    copyRichText,
  } = useExportDocument(activeTab, showToast, { embedImages: settings.exportEmbedImages, style: settings.exportStyle });

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

  const [isTemplatesOpen, setIsTemplatesOpen] = useState(false);
  const [isQualityOpen, setIsQualityOpen] = useState(false);
  const [isExportThemeOpen, setIsExportThemeOpen] = useState(false);
  const closeFeatureModals = useCallback(() => {
    setIsSearchOpen(false); setIsResourceManagerOpen(false); setHistoryTabId(null);
    setIsTemplatesOpen(false); setIsQualityOpen(false); setIsExportThemeOpen(false);
  }, []);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchSelection, setSearchSelection] = useState<{ id: string; from: number; to: number; content: string } | null>(null);
  const [isResourceManagerOpen, setIsResourceManagerOpen] = useState(false);
  const [historyTabId, setHistoryTabId] = useState<string | null>(null);
  const isHistoryOpen = historyTabId !== null;
  const historyTab = historyTabId ? tabs.find((tab) => tab.id === historyTabId && tab.kind !== 'diff') : undefined;
  useEffect(() => {
    if (historyTabId && !historyTab) setHistoryTabId(null);
  }, [historyTabId, historyTab]);
  const handleOpenHistory = useCallback(() => {
    closeFeatureModals();
    setHistoryTabId(activeTab?.kind !== 'diff' ? activeTab.id : null);
  }, [activeTab, closeFeatureModals]);
  const handleCloseHistory = useCallback(() => setHistoryTabId(null), []);
  const handleRestoreHistory = useCallback((content: string): boolean => {
    const tab = tabsRef.current.find((item) => item.id === historyTabId && item.kind !== 'diff');
    if (!tab) return false;
    if (activeTab?.id === tab.id && editorRef.current?.replaceDocument(tab.content, content)) {
      showToast(t('history.restored'), 'success');
      return true;
    }
    applyCachedDocumentChange(tab.id, tab.content, content);
    updateContent(tab.id, content);
    showToast(t('history.restored'), 'success');
    return true;
  }, [activeTab, historyTabId, showToast, t, updateContent]);
  const updateResourceContent = useCallback((id: string, content: string) => {
    if (activeTab?.id === id && editorRef.current?.replaceDocument(activeTab.content, content)) return;
    if (activeTab?.id === id) applyCachedDocumentChange(id, activeTab.content, content);
    updateContent(id, content);
  }, [activeTab, updateContent]);
  const documentResources = useDocumentResources({
    documentId: activeTab?.id || '',
    document: activeTab?.content || '',
    sourceFilePath: activeTab?.filePath,
    enabled: isResourceManagerOpen && activeTab?.kind !== 'diff',
    updateContent: updateResourceContent,
    showToast,
  });
  const handleOpenResources = useCallback(() => {
    closeFeatureModals();
    if (activeTab && activeTab.kind !== 'diff') setIsResourceManagerOpen(true);
  }, [activeTab, closeFeatureModals]);
  const handleCloseResources = useCallback(() => setIsResourceManagerOpen(false), []);
  const handleOpenTemplates = useCallback(() => { closeFeatureModals(); setIsTemplatesOpen(true); }, [closeFeatureModals]);
  const handleOpenQuality = useCallback(() => { if (activeTab?.kind === 'diff') return; closeFeatureModals(); setIsQualityOpen(true); }, [activeTab, closeFeatureModals]);
  const handleOpenExportTheme = useCallback(() => { closeFeatureModals(); setIsExportThemeOpen(true); }, [closeFeatureModals]);
  const handleCloseTemplates = useCallback(() => setIsTemplatesOpen(false), []);
  const handleCloseQuality = useCallback(() => setIsQualityOpen(false), []);
  const handleCloseExportTheme = useCallback(() => setIsExportThemeOpen(false), []);
  const handleCreateTemplate = useCallback((title: string, content: string) => createNewTab(title, content), [createNewTab]);
  const handleInsertTemplate = useCallback((content: string) => {
    if (!activeTab || activeTab.kind === 'diff') { createNewTab(undefined, content); return; }
    if (viewMode === 'read') {
      const separator = !activeTab.content || activeTab.content.endsWith('\n') ? '' : '\n';
      updateResourceContent(activeTab.id, activeTab.content + separator + content);
      setViewMode('edit');
    } else editorRef.current?.insertText(content);
  }, [activeTab, createNewTab, setViewMode, updateResourceContent, viewMode]);
  const handleQualityLocate = useCallback((line: number) => {
    requestAnimationFrame(() => {
      if (viewMode === 'read') previewRef.current?.scrollToSourceLine(line);
      else editorRef.current?.jumpToLine(line);
    });
  }, [viewMode]);
  const handleSaveExportTheme = useCallback((style: ExportStyle) => updateSetting('exportStyle', style), [updateSetting]);
  useEffect(() => {
    if (!activeTab || activeTab.kind === 'diff') setIsResourceManagerOpen(false);
  }, [activeTab]);
  const handleLocateResource = useCallback((resource: DocumentResource, line?: number) => {
    const targetLine = line || resource.references[0]?.line || 1;
    setIsResourceManagerOpen(false);
    // Run after modal cleanup has restored its previous focus.
    requestAnimationFrame(() => {
      if (viewMode === 'read') previewRef.current?.scrollToSourceLine(targetLine);
      else editorRef.current?.jumpToLine(targetLine);
    });
  }, [viewMode]);

  const [isSidebarOpen, setIsSidebarOpen] = useState<boolean>(() => {
    const saved = localStorage.getItem(STORAGE_SIDEBAR_KEY);
    return saved !== null ? saved === 'true' : true;
  });

  const [sidebarMode, setSidebarMode] = useState<'outline' | 'workspace'>('outline');
  const [workspaceRoot, setWorkspaceRoot] = useState<string | null>(() => isTauri() ? localStorage.getItem('markdown_editor_workspace_root_v1') : null);
  const [workspaceListing, setWorkspaceListing] = useState<WorkspaceListing | null>(null);
  const [workspaceBusy, setWorkspaceBusy] = useState(false);
  const [workspaceDialogOpen, setWorkspaceDialogOpen] = useState(false);
  const workspaceRequestRef = useRef(0);
  const refreshWorkspace = useCallback(async () => {
    if (!workspaceRoot || !isTauri()) { setWorkspaceListing(null); return; }
    const request = ++workspaceRequestRef.current;
    setWorkspaceBusy(true);
    try {
      const listing = await listWorkspace(workspaceRoot);
      if (workspaceRequestRef.current === request) setWorkspaceListing(listing);
    } catch (error) {
      if (workspaceRequestRef.current === request) showToast(error instanceof Error ? error.message : String(error), 'error');
    } finally {
      if (workspaceRequestRef.current === request) setWorkspaceBusy(false);
    }
  }, [workspaceRoot, showToast]);
  const toggleWorkspace = useCallback(() => {
    setSidebarMode('workspace');
    setIsSidebarOpen((open) => {
      const next = sidebarMode === 'workspace' ? !open : true;
      localStorage.setItem(STORAGE_SIDEBAR_KEY, String(next));
      return next;
    });
  }, [sidebarMode]);
  useEffect(() => {
    if (isSidebarOpen && sidebarMode === 'workspace' && workspaceRoot) void refreshWorkspace();
  }, [isSidebarOpen, sidebarMode, workspaceRoot, refreshWorkspace]);
  const chooseWorkspace = useCallback(async () => {
    if (!isTauri()) { showToast(t('workspace.desktopOnly'), 'warning'); return; }
    const selected = await chooseWorkspaceFolder();
    if (!selected) return;
    setWorkspaceRoot(selected);
    try { localStorage.setItem('markdown_editor_workspace_root_v1', selected); } catch { /* Optional preference. */ }
    if (selected === workspaceRoot) await refreshWorkspace();
  }, [refreshWorkspace, showToast, t, workspaceRoot]);
  const createWorkspaceDoc = useCallback(async (parent: string, name: string) => {
    if (!workspaceRoot) return;
    setWorkspaceBusy(true);
    try {
      const path = await createWorkspaceDocument(workspaceRoot, parent, name);
      await refreshWorkspace();
      await openFileByPath(path);
    } finally { setWorkspaceBusy(false); }
  }, [workspaceRoot, refreshWorkspace, openFileByPath]);
  const createWorkspaceDir = useCallback(async (parent: string, name: string) => {
    if (!workspaceRoot) return;
    setWorkspaceBusy(true);
    try {
      await createWorkspaceFolder(workspaceRoot, parent, name);
      await refreshWorkspace();
    } finally { setWorkspaceBusy(false); }
  }, [workspaceRoot, refreshWorkspace]);
  const renameWorkspaceEntry = useCallback(async (entry: WorkspaceEntry, name: string) => {
    if (!workspaceRoot) return;
    const path = workspaceEntryAbsolutePath(workspaceRoot, entry.path);
    if (!path) throw new Error(t('workspace.invalidName'));
    setWorkspaceBusy(true);
    try {
      const moved = await renameWorkspaceFile(workspaceRoot, path, name);
      if (moved.oldPath !== moved.newPath) {
        const changes = await renameWorkspacePath(moved.oldPath, moved.newPath);
        for (const change of changes) {
          if (activeTab?.id === change.id && editorRef.current?.replaceDocument(change.original, change.content)) continue;
          applyCachedDocumentChange(change.id, change.original, change.content);
        }
      }
      await refreshWorkspace();
    } finally { setWorkspaceBusy(false); }
  }, [workspaceRoot, renameWorkspacePath, activeTab, refreshWorkspace, t]);

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
    // The outline button also provides a way back from the folder workspace.
    if (sidebarMode === 'workspace') {
      setSidebarMode('outline');
      setIsSidebarOpen(true);
      localStorage.setItem(STORAGE_SIDEBAR_KEY, 'true');
      return;
    }
    setIsSidebarOpen((prev) => {
      const next = !prev;
      localStorage.setItem(STORAGE_SIDEBAR_KEY, String(next));
      return next;
    });
  }, [sidebarMode]);

  const handleCloseSidebar = useCallback(() => {
    setIsSidebarOpen(false);
  }, []);

  const [isShortcutsModalOpen, setIsShortcutsModalOpen] = useState(false);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [isCompareModalOpen, setIsCompareModalOpen] = useState(false);

  const handleOpenSettings = useCallback(() => {
    closeFeatureModals();
    setIsSettingsModalOpen(true);
  }, [closeFeatureModals]);
  const handleCloseSettings = useCallback(() => setIsSettingsModalOpen(false), []);
  const handleToggleSettings = useCallback(() => {
    closeFeatureModals();
    setIsShortcutsModalOpen(false);
    setIsSettingsModalOpen((prev) => !prev);
  }, [closeFeatureModals]);

  const handleOpenShortcuts = useCallback(() => {
    closeFeatureModals();
    setIsShortcutsModalOpen(true);
  }, [closeFeatureModals]);
  const handleCloseShortcuts = useCallback(() => setIsShortcutsModalOpen(false), []);
  const handleToggleShortcuts = useCallback(() => {
    closeFeatureModals();
    setIsSettingsModalOpen(false);
    setIsShortcutsModalOpen((prev) => !prev);
  }, [closeFeatureModals]);

  const handleOpenCompare = useCallback(() => {
    closeFeatureModals();
    setIsCompareModalOpen(true);
  }, [closeFeatureModals]);
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

  const resourceCacheTabIdsRef = useRef(new Set(tabs.map((tab) => tab.id)));
  useEffect(() => {
    const liveIds = new Set(tabs.map((tab) => tab.id));
    if ([...resourceCacheTabIdsRef.current].some((id) => !liveIds.has(id))) {
      // Save As can change a cache scope's path; clearing all on a close is
      // conservative and releases every old-scope Base64 key as well.
      void import('@/lib/export/xmdExporter').then(({ clearXmdExportCache }) => clearXmdExportCache());
    }
    resourceCacheTabIdsRef.current = liveIds;
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

  const handleOpenSearch = useCallback(() => {
    closeFeatureModals();
    setIsSearchOpen(true);
  }, [closeFeatureModals]);
  const handleCloseSearch = useCallback(() => setIsSearchOpen(false), []);
  const handleLocateSearch = useCallback((id: string, from: number, to: number) => {
    const tab = tabsRef.current.find((item) => item.id === id && item.kind !== 'diff');
    if (!tab) return;
    setIsSearchOpen(false);
    setActiveTabId(id);
    if ((tab.viewMode ?? defaultViewMode) === 'read') updateViewMode(id, 'edit');
    setSearchSelection({ id, from, to, content: tab.content });
  }, [defaultViewMode, setActiveTabId, updateViewMode]);
  useEffect(() => {
    if (!searchSelection || activeTab?.id !== searchSelection.id) return;
    let frame = 0;
    let attempts = 0;
    const apply = () => {
      if (editorRef.current?.selectRange(searchSelection.from, searchSelection.to, searchSelection.content) || ++attempts >= 120) {
        setSearchSelection(null);
      } else frame = requestAnimationFrame(apply);
    };
    frame = requestAnimationFrame(apply);
    return () => cancelAnimationFrame(frame);
  }, [activeTab?.id, searchSelection, viewMode]);
  const handleApplySearch = useCallback((updates: { id: string; original: string; content: string }[]) => {
    const currentId = activeTabIdRef.current;
    const currentUpdate = updates.find((update) => update.id === currentId);
    // The document store validates the entire batch before changing any tab.
    if (!applyContentUpdates(updates)) return false;
    const activeApplied = currentUpdate ? editorRef.current?.replaceDocument(currentUpdate.original, currentUpdate.content) : false;
    for (const update of updates) {
      if (update.id !== currentId || !activeApplied) applyCachedDocumentChange(update.id, update.original, update.content);
    }
    return true;
  }, [applyContentUpdates]);

  const isModalOpen =
    isSettingsModalOpen || isShortcutsModalOpen || isCompareModalOpen || isResourceManagerOpen || isSearchOpen || isHistoryOpen || isTemplatesOpen || isQualityOpen || isExportThemeOpen || workspaceDialogOpen || confirmDialog.isOpen;

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
    onOpenSearch: handleOpenSearch,
    enabled: !isModalOpen,
  });

  const [activeFormats, setActiveFormats] = useState<readonly MarkdownAction[]>([]);
  const handlePresentationChange = useCallback((presentation: EditorPresentation) => {
    updateSetting('editorPresentation', presentation);
  }, [updateSetting]);

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
      onProtectedReplace={() => showToast(t('editor.resourceReplaceProtected'), 'warning')}
      value={activeTab?.content || ''}
      onChange={handleEditorChange}
      onCursorChange={handleCursorChange}
      presentation={settings.editorPresentation}
      renderHtml={settings.renderHtml}
      sourcePath={activeTab?.filePath}
      onFormatsChange={setActiveFormats}
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
      renderHtml={settings.renderHtml}
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
        onOpenResources={handleOpenResources}
        onOpenSearch={handleOpenSearch}
        onOpenHistory={handleOpenHistory}
        onOpenTemplates={handleOpenTemplates}
        onOpenQuality={handleOpenQuality}
        onOpenExportTheme={handleOpenExportTheme}
        onOpenWorkspace={toggleWorkspace}
        onSave={handleSave}
        onSaveAs={handleSaveAs}
        onExportWord={exportWord}
        onExportPdf={exportPdf}
        onExportHtml={exportHtml}
        onExportXmd={exportXmd}
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
        <Toolbar onAction={handleToolbarAction} disabled={!activeTab}
          presentation={settings.editorPresentation} onPresentationChange={handlePresentationChange}
          activeFormats={activeFormats} />
      )}

      <div className="flex-1 flex overflow-hidden relative">
        {sidebarMode === 'workspace' ? (
          <Suspense fallback={<aside className="w-80 bg-panel border-r border-slate-200 dark:border-slate-800" />}>
            <LazyWorkspacePanel
              isOpen={isSidebarOpen}
              onClose={handleCloseSidebar}
              rootPath={workspaceRoot}
              entries={workspaceListing?.entries || []}
              truncated={workspaceListing?.truncated}
              activePath={activeTab?.filePath}
              busy={workspaceBusy}
              onChoose={() => void chooseWorkspace()}
              onOpen={(path) => { void openFileByPath(path); }}
              onRefresh={refreshWorkspace}
              onCreateDocument={createWorkspaceDoc}
              onCreateFolder={createWorkspaceDir}
              onRename={renameWorkspaceEntry}
              onDialogOpenChange={setWorkspaceDialogOpen}
            />
          </Suspense>
        ) : activeTab?.kind !== 'diff' && (
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

      {isSearchOpen && (
        <Suspense fallback={null}>
          <LazyDocumentSearch
            isOpen={isSearchOpen}
            onClose={handleCloseSearch}
            tabs={tabs}
            activeTabId={activeTabId}
            onLocate={handleLocateSearch}
            onApply={handleApplySearch}
            showToast={showToast}
          />
        </Suspense>
      )}

      {isResourceManagerOpen && activeTab && activeTab.kind !== 'diff' && (
        <Suspense fallback={null}>
          <LazyResourceManager
            key={activeTab.id}
            isOpen={isResourceManagerOpen}
            onClose={handleCloseResources}
            documentTitle={activeTab.title}
            resources={documentResources.resources}
            error={documentResources.error}
            isRefreshing={documentResources.isRefreshing}
            onRefresh={documentResources.refresh}
            onLocate={handleLocateResource}
            onExport={documentResources.exportResource}
            onReveal={documentResources.revealResource}
            onConvert={documentResources.convertResource}
            onConvertAll={documentResources.convertAll}
            canConvert={documentResources.canConvert}
            convertReason={documentResources.convertReason}
            busyId={documentResources.busyId}
            sourceFilePath={activeTab.filePath}
          />
        </Suspense>
      )}

      {isTemplatesOpen && <Suspense fallback={null}><LazyTemplateManager isOpen={isTemplatesOpen} onClose={handleCloseTemplates} onCreateDocument={handleCreateTemplate} onInsert={handleInsertTemplate} /></Suspense>}

      {isQualityOpen && activeTab && activeTab.kind !== 'diff' && <Suspense fallback={null}><LazyQualityPanel isOpen={isQualityOpen} onClose={handleCloseQuality} content={activeTab.content} sourceFilePath={activeTab.filePath} onLocate={handleQualityLocate} /></Suspense>}

      {isExportThemeOpen && <Suspense fallback={null}><LazyExportStyleDialog isOpen={isExportThemeOpen} onClose={handleCloseExportTheme} value={settings.exportStyle ?? DEFAULT_EXPORT_STYLE} onSave={handleSaveExportTheme} /></Suspense>}

      {isHistoryOpen && historyTab && (
        <Suspense fallback={null}>
          <LazyDocumentHistory
            key={historyTab.id}
            isOpen={isHistoryOpen}
            onClose={handleCloseHistory}
            sourceFilePath={historyTab.filePath}
            content={historyTab.content}
            title={historyTab.title}
            isDark={isDark}
            onRestore={handleRestoreHistory}
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
