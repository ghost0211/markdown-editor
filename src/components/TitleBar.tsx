import React from 'react';
import {
  FileText, FilePlus, FolderOpen, Save, HelpCircle, Sun, Moon, Monitor,
  Columns2, Edit3, BookOpen, GitCompareArrows, PanelLeft, Search, Settings,
  FolderTree,
} from 'lucide-react';
import clsx from 'clsx';
import type { ThemeMode, ViewMode, DocumentTab } from '@/types';
import { useI18n } from '@/i18n';
import { DocumentToolsMenu } from './titleBar/DocumentToolsMenu';
import { ExportMenu } from './titleBar/ExportMenu';
import { RecentFilesMenu } from './titleBar/RecentFilesMenu';

interface TitleBarProps {
  activeTab?: DocumentTab;
  viewMode: ViewMode;
  onSetViewMode: (mode: ViewMode) => void;
  theme: ThemeMode;
  onSetTheme: (theme: ThemeMode) => void;
  isSidebarOpen: boolean;
  onToggleSidebar: () => void;
  onNew: () => void;
  onOpen: () => void;
  onSave: () => void;
  onSaveAs: () => void;
  onExportWord: () => void;
  onExportPdf: () => void;
  onExportHtml: () => void;
  onExportXmd?: () => void;
  onCopyRichText?: () => void;
  isExporting?: boolean;
  exportingType?: 'docx' | 'pdf' | 'html' | 'xmd' | null;
  onOpenShortcuts: () => void;
  onOpenSettings: () => void;
  onCompare?: () => void;
  recentFiles?: import('@/lib/recentFiles').RecentFile[];
  onOpenRecent?: (path: string) => void;
  onClearRecent?: () => void;
  onOpenResources?: () => void;
  onOpenSearch?: () => void;
  onOpenHistory?: () => void;
  onOpenTemplates?: () => void;
  onOpenQuality?: () => void;
  onOpenExportTheme?: () => void;
  onOpenWorkspace?: () => void;
}

const iconButtonClass = 'p-1.5 rounded-md text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-100 hover:bg-slate-200 dark:hover:bg-slate-700/60 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500';

export const TitleBar: React.FC<TitleBarProps> = ({
  activeTab, viewMode, onSetViewMode, theme, onSetTheme, isSidebarOpen, onToggleSidebar,
  onNew, onOpen, onSave, onSaveAs, onExportWord, onExportPdf, onExportHtml, onExportXmd,
  onCopyRichText, isExporting = false, exportingType = null, onOpenShortcuts, onOpenSettings,
  onCompare, recentFiles = [], onOpenRecent, onClearRecent, onOpenResources, onOpenSearch,
  onOpenHistory, onOpenTemplates, onOpenQuality, onOpenExportTheme, onOpenWorkspace,
}) => {
  const { t } = useI18n();
  const themeLabel = theme === 'light' ? t('titleBar.themeLight') : theme === 'dark' ? t('titleBar.themeDark') : t('titleBar.themeSystem');
  const modes: { mode: ViewMode; icon: React.ReactNode; label: string; tooltip: string }[] = [
    { mode: 'edit', icon: <Edit3 className="w-3.5 h-3.5" />, label: t('titleBar.editMode'), tooltip: t('titleBar.editModeTooltip') },
    { mode: 'split', icon: <Columns2 className="w-3.5 h-3.5" />, label: t('titleBar.splitMode'), tooltip: t('titleBar.splitModeTooltip') },
    { mode: 'read', icon: <BookOpen className="w-3.5 h-3.5" />, label: t('titleBar.readMode'), tooltip: t('titleBar.readModeTooltip') },
  ];

  return (
    <header className="relative z-30 h-12 px-3 flex items-center justify-between gap-3 bg-chrome border-b border-slate-200 dark:border-slate-800/80 select-none text-xs text-slate-600 dark:text-slate-300 shrink-0">
      <div className="flex min-w-0 items-center gap-1 shrink-0">
        <button type="button" onClick={onToggleSidebar}
          aria-label={isSidebarOpen ? t('titleBar.collapseOutline') : t('titleBar.expandOutline')}
          aria-expanded={isSidebarOpen}
          title={isSidebarOpen ? t('titleBar.collapseOutline') : t('titleBar.expandOutline')}
          className={clsx('p-1.5 rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500', isSidebarOpen ? 'bg-blue-100 text-blue-600 dark:bg-blue-950/60 dark:text-blue-300' : 'text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-700/60')}>
          <PanelLeft className="w-4 h-4" />
        </button>

        <div className="flex items-center gap-2 font-semibold text-slate-800 dark:text-slate-100 px-1 mr-1 shrink-0">
          <div className="w-6 h-6 rounded-md bg-blue-600 flex items-center justify-center text-white shadow-sm shadow-blue-600/15 font-bold text-[10px] tracking-tight">MD</div>
          <span className="hidden xl:inline tracking-tight font-medium text-xs">Markdown Editor</span>
        </div>
        <div className="h-5 w-px bg-slate-200 dark:bg-slate-700 mx-1 shrink-0" />

        <button type="button" onClick={onNew} title={t('titleBar.newDocTooltip')} aria-label={t('titleBar.newDocTooltip')} className="flex items-center gap-1.5 px-2 py-1.5 rounded-md hover:bg-slate-200 dark:hover:bg-slate-700/60 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
          <FilePlus className="w-3.5 h-3.5 text-blue-500" /><span className="hidden md:inline">{t('titleBar.newDoc')}</span>
        </button>
        <button type="button" onClick={onOpen} title={t('titleBar.openDocTooltip')} aria-label={t('titleBar.openDocTooltip')} className="flex items-center gap-1.5 px-2 py-1.5 rounded-md hover:bg-slate-200 dark:hover:bg-slate-700/60 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
          <FolderOpen className="w-3.5 h-3.5 text-amber-500" /><span className="hidden md:inline">{t('titleBar.openDoc')}</span>
        </button>
        <RecentFilesMenu recentFiles={recentFiles} onOpenRecent={onOpenRecent} onClearRecent={onClearRecent} />

        {onOpenWorkspace && <button type="button" onClick={onOpenWorkspace} title={t('titleBar.workspaceTooltip')} aria-label={t('titleBar.workspaceTooltip')} className="flex items-center gap-1.5 px-2 py-1.5 rounded-md hover:bg-slate-200 dark:hover:bg-slate-700/60 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
          <FolderTree className="w-3.5 h-3.5 text-emerald-500" /><span className="hidden 2xl:inline">{t('titleBar.workspace')}</span>
        </button>}

        {(onOpenResources || onOpenTemplates || onOpenQuality || onOpenHistory) && <DocumentToolsMenu activeTab={activeTab} onOpenResources={onOpenResources} onOpenTemplates={onOpenTemplates} onOpenQuality={onOpenQuality} onOpenHistory={onOpenHistory} />}

        <div className="h-5 w-px bg-slate-200 dark:bg-slate-700 mx-1 shrink-0" />
        <button type="button" onClick={onSave} title={t('titleBar.saveDocTooltip')} aria-label={t('titleBar.saveDocTooltip')} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-blue-600 text-white hover:bg-blue-700 shadow-sm shadow-blue-600/10 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:ring-offset-1 focus-visible:ring-offset-white dark:focus-visible:ring-offset-slate-900">
          <Save className="w-3.5 h-3.5" /><span className="hidden md:inline">{t('titleBar.saveDoc')}</span>
        </button>
        <button type="button" onClick={onSaveAs} title={t('titleBar.saveAsTooltip')} aria-label={t('titleBar.saveAsTooltip')} className="hidden lg:flex items-center gap-1.5 px-2 py-1.5 rounded-md hover:bg-slate-200 dark:hover:bg-slate-700/60 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
          <FileText className="w-3.5 h-3.5 text-slate-400" /><span>{t('titleBar.saveAs')}</span>
        </button>
        <ExportMenu disabled={!activeTab || isExporting} isExporting={isExporting} exportingType={exportingType} onExportWord={onExportWord} onExportPdf={onExportPdf} onExportHtml={onExportHtml} onExportXmd={onExportXmd} onCopyRichText={onCopyRichText} onOpenExportTheme={onOpenExportTheme} />
      </div>

      <div className="flex-1 min-w-0 max-w-md mx-1 text-center font-medium text-slate-700 dark:text-slate-200 flex items-center justify-center gap-1.5">
        <span className="truncate" title={activeTab?.filePath || activeTab?.title || t('titleBar.noDocOpen')}>{activeTab ? activeTab.title : t('titleBar.noDocOpen')}</span>
        {activeTab?.isDirty && <span className="w-2 h-2 rounded-full bg-amber-500 shrink-0" title={t('titleBar.unsavedChanges')} aria-label={t('titleBar.unsavedChanges')} role="status" />}
      </div>

      <div className="flex items-center gap-1 shrink-0">
        {onOpenSearch && <button type="button" onClick={onOpenSearch} title={t('search.tooltip')} aria-label={t('search.open')} className={iconButtonClass}><Search className="w-4 h-4" /></button>}
        {onCompare && <button type="button" onClick={onCompare} title={t('titleBar.compareTooltip')} aria-label={t('titleBar.compareTooltip')} className={iconButtonClass}><GitCompareArrows className="w-4 h-4" /></button>}

        {activeTab?.kind !== 'diff' && <div className="flex items-center bg-slate-200/70 dark:bg-slate-800/70 p-0.5 rounded-lg" role="group" aria-label={t('titleBar.viewModeGroupLabel')}>
          {modes.map(({ mode, icon, label, tooltip }) => <button key={mode} type="button" onClick={() => onSetViewMode(mode)} title={tooltip} aria-label={label} aria-pressed={viewMode === mode} className={clsx('flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500', viewMode === mode ? 'bg-white dark:bg-slate-700 text-blue-600 dark:text-blue-300 shadow-sm' : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200')}>
            {icon}<span className="hidden 2xl:inline">{label}</span>
          </button>)}
        </div>}

        <div className="h-5 w-px bg-slate-200 dark:bg-slate-700 mx-1" />
        <button type="button" onClick={() => onSetTheme(theme === 'dark' ? 'light' : theme === 'light' ? 'system' : 'dark')} title={t('titleBar.themeTooltip', { theme: themeLabel })} aria-label={t('titleBar.themeTooltip', { theme: themeLabel })} className={iconButtonClass}>
          {theme === 'light' && <Sun className="w-4 h-4 text-amber-500" />}
          {theme === 'dark' && <Moon className="w-4 h-4 text-blue-400" />}
          {theme === 'system' && <Monitor className="w-4 h-4 text-slate-500 dark:text-slate-400" />}
        </button>
        <button type="button" onClick={onOpenSettings} title={t('titleBar.settingsTooltip')} aria-label={t('titleBar.settings')} className={iconButtonClass}><Settings className="w-4 h-4" /></button>
        <button type="button" onClick={onOpenShortcuts} title={t('titleBar.shortcutsTooltip')} aria-label={t('titleBar.shortcuts')} className={iconButtonClass}><HelpCircle className="w-4 h-4" /></button>
      </div>
    </header>
  );
};
