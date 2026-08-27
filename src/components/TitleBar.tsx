import React, { useState, useRef, useEffect } from 'react';
import {
  FileText,
  FilePlus,
  FolderOpen,
  Save,
  HelpCircle,
  Sun,
  Moon,
  Monitor,
  Columns2,
  Edit3,
  BookOpen,
  PanelLeft,
  Download,
  LoaderCircle,
  ChevronDown,
  FileType,
  Settings,
} from 'lucide-react';
import { ThemeMode, ViewMode, DocumentTab } from '@/types';
import { useI18n } from '@/i18n';
import clsx from 'clsx';

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
  isExporting?: boolean;
  exportingType?: 'docx' | 'pdf' | null;
  onOpenShortcuts: () => void;
  onOpenSettings: () => void;
}

export const TitleBar: React.FC<TitleBarProps> = ({
  activeTab,
  viewMode,
  onSetViewMode,
  theme,
  onSetTheme,
  isSidebarOpen,
  onToggleSidebar,
  onNew,
  onOpen,
  onSave,
  onSaveAs,
  onExportWord,
  onExportPdf,
  isExporting = false,
  exportingType = null,
  onOpenShortcuts,
  onOpenSettings,
}) => {
  const { t } = useI18n();
  const [isExportMenuOpen, setIsExportMenuOpen] = useState(false);
  const exportDropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click or Escape
  useEffect(() => {
    if (!isExportMenuOpen) return;

    const handlePointerDown = (e: MouseEvent | TouchEvent) => {
      if (
        exportDropdownRef.current &&
        !exportDropdownRef.current.contains(e.target as Node)
      ) {
        setIsExportMenuOpen(false);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsExportMenuOpen(false);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('touchstart', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('touchstart', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isExportMenuOpen]);

  const hasActiveTab = Boolean(activeTab);
  const isButtonDisabled = !hasActiveTab || isExporting;

  const themeLabel =
    theme === 'light'
      ? t('titleBar.themeLight')
      : theme === 'dark'
      ? t('titleBar.themeDark')
      : t('titleBar.themeSystem');

  return (
    <header className="h-10 bg-slate-100 dark:bg-[#182234] border-b border-slate-200 dark:border-slate-800/80 px-3 flex items-center justify-between select-none text-xs text-slate-600 dark:text-slate-300 shrink-0">
      {/* Left: App Logo & Quick File Actions */}
      <div className="flex items-center space-x-1.5">
        <button
          type="button"
          onClick={onToggleSidebar}
          aria-label={
            isSidebarOpen
              ? t('titleBar.collapseOutline')
              : t('titleBar.expandOutline')
          }
          aria-expanded={isSidebarOpen}
          title={
            isSidebarOpen
              ? t('titleBar.collapseOutline')
              : t('titleBar.expandOutline')
          }
          className={clsx(
            'p-1.5 rounded transition-colors',
            isSidebarOpen
              ? 'bg-blue-100 text-blue-600 dark:bg-blue-900/40 dark:text-blue-400'
              : 'hover:bg-slate-200 dark:hover:bg-slate-700/60 text-slate-500'
          )}
        >
          <PanelLeft className="w-3.5 h-3.5" />
        </button>

        <div className="flex items-center space-x-1.5 font-semibold text-slate-800 dark:text-slate-100 mr-2">
          <div className="w-5 h-5 rounded bg-blue-600 flex items-center justify-center text-white shadow-sm font-bold text-[10px]">
            MD
          </div>
          <span className="hidden sm:inline tracking-tight font-medium text-xs">Markdown Editor</span>
        </div>

        <div className="h-3.5 w-[1px] bg-slate-300 dark:bg-slate-700 mx-1" />

        <button
          type="button"
          onClick={onNew}
          title={t('titleBar.newDocTooltip')}
          aria-label={t('titleBar.newDocTooltip')}
          className="flex items-center space-x-1 px-2 py-1 rounded hover:bg-slate-200 dark:hover:bg-slate-700/60 transition-colors"
        >
          <FilePlus className="w-3.5 h-3.5 text-blue-500" />
          <span className="hidden md:inline">{t('titleBar.newDoc')}</span>
        </button>

        <button
          type="button"
          onClick={onOpen}
          title={t('titleBar.openDocTooltip')}
          aria-label={t('titleBar.openDocTooltip')}
          className="flex items-center space-x-1 px-2 py-1 rounded hover:bg-slate-200 dark:hover:bg-slate-700/60 transition-colors"
        >
          <FolderOpen className="w-3.5 h-3.5 text-amber-500" />
          <span className="hidden md:inline">{t('titleBar.openDoc')}</span>
        </button>

        <button
          type="button"
          onClick={onSave}
          title={t('titleBar.saveDocTooltip')}
          aria-label={t('titleBar.saveDocTooltip')}
          className="flex items-center space-x-1 px-2 py-1 rounded hover:bg-slate-200 dark:hover:bg-slate-700/60 transition-colors"
        >
          <Save className="w-3.5 h-3.5 text-emerald-500" />
          <span className="hidden md:inline">{t('titleBar.saveDoc')}</span>
        </button>

        <button
          type="button"
          onClick={onSaveAs}
          title={t('titleBar.saveAsTooltip')}
          aria-label={t('titleBar.saveAsTooltip')}
          className="hidden lg:flex items-center space-x-1 px-2 py-1 rounded hover:bg-slate-200 dark:hover:bg-slate-700/60 transition-colors"
        >
          <FileText className="w-3.5 h-3.5 text-slate-400" />
          <span>{t('titleBar.saveAs')}</span>
        </button>

        {/* Export Dropdown Menu Button */}
        <div className="relative" ref={exportDropdownRef}>
          <button
            type="button"
            onClick={() => {
              if (!isButtonDisabled) {
                setIsExportMenuOpen((prev) => !prev);
              }
            }}
            disabled={isButtonDisabled}
            aria-label={t('titleBar.exportWordOrPdfTooltip')}
            aria-expanded={isExportMenuOpen}
            aria-haspopup="menu"
            title={
              !hasActiveTab
                ? t('titleBar.noOpenDocTooltip')
                : isExporting
                ? t('titleBar.exportingTypeTooltip', { type: exportingType?.toUpperCase() || '' })
                : t('titleBar.exportWordOrPdfTooltip')
            }
            className={clsx(
              'flex items-center space-x-1 px-2 py-1 rounded transition-colors',
              isButtonDisabled
                ? 'opacity-45 cursor-not-allowed text-slate-400 dark:text-slate-500'
                : isExportMenuOpen
                ? 'bg-slate-200 dark:bg-slate-700 text-slate-900 dark:text-slate-100'
                : 'hover:bg-slate-200 dark:hover:bg-slate-700/60 text-slate-700 dark:text-slate-200'
            )}
          >
            {isExporting ? (
              <LoaderCircle className="w-3.5 h-3.5 text-blue-500 animate-spin" />
            ) : (
              <Download className="w-3.5 h-3.5 text-indigo-500" />
            )}
            <span className="hidden md:inline">
              {isExporting ? t('titleBar.exporting') : t('titleBar.export')}
            </span>
            <ChevronDown
              className={clsx(
                'w-3 h-3 text-slate-400 transition-transform duration-150',
                isExportMenuOpen && 'rotate-180'
              )}
            />
          </button>

          {/* Export Dropdown Popup Menu */}
          {isExportMenuOpen && (
            <div className="absolute left-0 top-full mt-1.5 w-52 bg-white dark:bg-[#1e293b] border border-slate-200 dark:border-slate-700 rounded-md shadow-lg py-1 z-50 animate-in fade-in zoom-in-95 duration-100">
              <button
                onClick={() => {
                  setIsExportMenuOpen(false);
                  onExportWord();
                }}
                className="w-full px-3 py-2 text-left flex items-center space-x-2.5 hover:bg-slate-100 dark:hover:bg-slate-700/60 transition-colors text-slate-700 dark:text-slate-200 font-medium"
              >
                <div className="w-6 h-6 rounded bg-blue-50 dark:bg-blue-950/50 flex items-center justify-center text-blue-600 dark:text-blue-400">
                  <FileText className="w-3.5 h-3.5" />
                </div>
                <div className="flex flex-col">
                  <span className="text-xs">{t('titleBar.exportWord')}</span>
                  <span className="text-[10px] text-slate-400 dark:text-slate-500">{t('titleBar.exportWordDesc')}</span>
                </div>
              </button>

              <div className="h-[1px] bg-slate-100 dark:bg-slate-800 my-0.5" />

              <button
                onClick={() => {
                  setIsExportMenuOpen(false);
                  onExportPdf();
                }}
                className="w-full px-3 py-2 text-left flex items-center space-x-2.5 hover:bg-slate-100 dark:hover:bg-slate-700/60 transition-colors text-slate-700 dark:text-slate-200 font-medium"
              >
                <div className="w-6 h-6 rounded bg-rose-50 dark:bg-rose-950/50 flex items-center justify-center text-rose-600 dark:text-rose-400">
                  <FileType className="w-3.5 h-3.5" />
                </div>
                <div className="flex flex-col">
                  <span className="text-xs">{t('titleBar.exportPdf')}</span>
                  <span className="text-[10px] text-slate-400 dark:text-slate-500">{t('titleBar.exportPdfDesc')}</span>
                </div>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Center: Current Document Title / Path */}
      <div className="flex-1 max-w-md mx-2 truncate text-center font-medium text-slate-700 dark:text-slate-200 text-xs flex items-center justify-center space-x-1.5">
        <span className="truncate">
          {activeTab ? activeTab.title : t('titleBar.noDocOpen')}
        </span>
        {activeTab?.isDirty && (
          <span
            className="w-2 h-2 rounded-full bg-amber-500 inline-block animate-pulse"
            title={t('titleBar.unsavedChanges')}
          />
        )}
      </div>

      {/* Right: View Mode, Theme Switcher & Shortcuts Help */}
      <div className="flex items-center space-x-1.5">
        {/* View Mode Segmented Controls */}
        <div className="flex items-center bg-slate-200 dark:bg-slate-800 p-0.5 rounded-md text-xs">
          <button
            onClick={() => onSetViewMode('edit')}
            title={t('titleBar.editModeTooltip')}
            className={clsx(
              'flex items-center space-x-1 px-2 py-0.5 rounded text-[11px] font-medium transition-colors',
              viewMode === 'edit'
                ? 'bg-white dark:bg-slate-700 text-blue-600 dark:text-blue-400 shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
            )}
          >
            <Edit3 className="w-3 h-3" />
            <span className="hidden lg:inline">{t('titleBar.editMode')}</span>
          </button>
          <button
            onClick={() => onSetViewMode('split')}
            title={t('titleBar.splitModeTooltip')}
            className={clsx(
              'flex items-center space-x-1 px-2 py-0.5 rounded text-[11px] font-medium transition-colors',
              viewMode === 'split'
                ? 'bg-white dark:bg-slate-700 text-blue-600 dark:text-blue-400 shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
            )}
          >
            <Columns2 className="w-3 h-3" />
            <span className="hidden lg:inline">{t('titleBar.splitMode')}</span>
          </button>
          <button
            onClick={() => onSetViewMode('read')}
            title={t('titleBar.readModeTooltip')}
            className={clsx(
              'flex items-center space-x-1 px-2 py-0.5 rounded text-[11px] font-medium transition-colors',
              viewMode === 'read'
                ? 'bg-white dark:bg-slate-700 text-blue-600 dark:text-blue-400 shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
            )}
          >
            <BookOpen className="w-3 h-3" />
            <span className="hidden lg:inline">{t('titleBar.readMode')}</span>
          </button>
        </div>

        <div className="h-3.5 w-[1px] bg-slate-300 dark:bg-slate-700 mx-0.5" />

        {/* Theme Mode Switcher */}
        <div className="flex items-center bg-slate-200 dark:bg-slate-800 p-0.5 rounded-md">
          <button
            type="button"
            onClick={() => onSetTheme(theme === 'dark' ? 'light' : theme === 'light' ? 'system' : 'dark')}
            title={t('titleBar.themeTooltip', { theme: themeLabel })}
            aria-label={t('titleBar.themeTooltip', { theme: themeLabel })}
            className="p-1 rounded text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 transition-colors"
          >
            {theme === 'light' && <Sun className="w-3.5 h-3.5 text-amber-500" />}
            {theme === 'dark' && <Moon className="w-3.5 h-3.5 text-blue-400" />}
            {theme === 'system' && <Monitor className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400" />}
          </button>
        </div>

        {/* Settings */}
        <button
          onClick={onOpenSettings}
          title={t('titleBar.settingsTooltip')}
          aria-label={t('titleBar.settings')}
          className="p-1.5 rounded hover:bg-slate-200 dark:hover:bg-slate-700/60 transition-colors text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
        >
          <Settings className="w-3.5 h-3.5" />
        </button>

        {/* Shortcuts Help */}
        <button
          onClick={onOpenShortcuts}
          title={t('titleBar.shortcutsTooltip')}
          aria-label={t('titleBar.shortcuts')}
          className="p-1.5 rounded hover:bg-slate-200 dark:hover:bg-slate-700/60 transition-colors text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
        >
          <HelpCircle className="w-3.5 h-3.5" />
        </button>
      </div>
    </header>
  );
};
