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
} from 'lucide-react';
import { ThemeMode, ViewMode, DocumentTab } from '@/types';
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
}) => {
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

  return (
    <header className="h-10 bg-slate-100 dark:bg-[#182234] border-b border-slate-200 dark:border-slate-800/80 px-3 flex items-center justify-between select-none text-xs text-slate-600 dark:text-slate-300 shrink-0">
      {/* Left: App Logo & Quick File Actions */}
      <div className="flex items-center space-x-1.5">
        <button
          onClick={onToggleSidebar}
          title={isSidebarOpen ? '收起大纲 (Ctrl+Shift+O)' : '展开大纲 (Ctrl+Shift+O)'}
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
          onClick={onNew}
          title="新建文档 (Ctrl+N)"
          className="flex items-center space-x-1 px-2 py-1 rounded hover:bg-slate-200 dark:hover:bg-slate-700/60 transition-colors"
        >
          <FilePlus className="w-3.5 h-3.5 text-blue-500" />
          <span className="hidden md:inline">新建</span>
        </button>

        <button
          onClick={onOpen}
          title="打开文件 (Ctrl+O)"
          className="flex items-center space-x-1 px-2 py-1 rounded hover:bg-slate-200 dark:hover:bg-slate-700/60 transition-colors"
        >
          <FolderOpen className="w-3.5 h-3.5 text-amber-500" />
          <span className="hidden md:inline">打开</span>
        </button>

        <button
          onClick={onSave}
          title="保存文档 (Ctrl+S)"
          className="flex items-center space-x-1 px-2 py-1 rounded hover:bg-slate-200 dark:hover:bg-slate-700/60 transition-colors"
        >
          <Save className="w-3.5 h-3.5 text-emerald-500" />
          <span className="hidden md:inline">保存</span>
        </button>

        <button
          onClick={onSaveAs}
          title="另存为... (Ctrl+Shift+S)"
          className="hidden lg:flex items-center space-x-1 px-2 py-1 rounded hover:bg-slate-200 dark:hover:bg-slate-700/60 transition-colors"
        >
          <FileText className="w-3.5 h-3.5 text-slate-400" />
          <span>另存为</span>
        </button>

        {/* Export Dropdown Menu Button */}
        <div className="relative" ref={exportDropdownRef}>
          <button
            onClick={() => {
              if (!isButtonDisabled) {
                setIsExportMenuOpen((prev) => !prev);
              }
            }}
            disabled={isButtonDisabled}
            title={
              !hasActiveTab
                ? '暂无打开的文档'
                : isExporting
                ? `正在导出 ${exportingType?.toUpperCase() || ''}...`
                : '导出为 Word 或 PDF 文档'
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
              {isExporting ? '导出中...' : '导出'}
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
                  <span className="text-xs">导出 Word 文档</span>
                  <span className="text-[10px] text-slate-400 dark:text-slate-500">.docx 格式</span>
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
                  <span className="text-xs">导出 PDF 文档</span>
                  <span className="text-[10px] text-slate-400 dark:text-slate-500">.pdf 格式</span>
                </div>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Center: Current Document Title / Path */}
      <div className="flex-1 max-w-md mx-2 truncate text-center font-medium text-slate-700 dark:text-slate-200 text-xs flex items-center justify-center space-x-1.5">
        <span className="truncate">
          {activeTab ? activeTab.title : '未打开文档'}
        </span>
        {activeTab?.isDirty && (
          <span className="w-2 h-2 rounded-full bg-amber-500 inline-block animate-pulse" title="有未保存的修改" />
        )}
      </div>

      {/* Right: View Mode, Theme Switcher & Shortcuts Help */}
      <div className="flex items-center space-x-1.5">
        {/* View Mode Segmented Controls */}
        <div className="flex items-center bg-slate-200 dark:bg-slate-800 p-0.5 rounded-md text-xs">
          <button
            onClick={() => onSetViewMode('edit')}
            title="纯编辑模式 (Ctrl+1)"
            className={clsx(
              'flex items-center space-x-1 px-2 py-0.5 rounded text-[11px] font-medium transition-colors',
              viewMode === 'edit'
                ? 'bg-white dark:bg-slate-700 text-blue-600 dark:text-blue-400 shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
            )}
          >
            <Edit3 className="w-3 h-3" />
            <span className="hidden lg:inline">编辑</span>
          </button>
          <button
            onClick={() => onSetViewMode('split')}
            title="双栏分屏模式 (Ctrl+2)"
            className={clsx(
              'flex items-center space-x-1 px-2 py-0.5 rounded text-[11px] font-medium transition-colors',
              viewMode === 'split'
                ? 'bg-white dark:bg-slate-700 text-blue-600 dark:text-blue-400 shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
            )}
          >
            <Columns2 className="w-3 h-3" />
            <span className="hidden lg:inline">分屏</span>
          </button>
          <button
            onClick={() => onSetViewMode('read')}
            title="纯阅读模式 (Ctrl+3)"
            className={clsx(
              'flex items-center space-x-1 px-2 py-0.5 rounded text-[11px] font-medium transition-colors',
              viewMode === 'read'
                ? 'bg-white dark:bg-slate-700 text-blue-600 dark:text-blue-400 shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
            )}
          >
            <BookOpen className="w-3 h-3" />
            <span className="hidden lg:inline">阅读</span>
          </button>
        </div>

        <div className="h-3.5 w-[1px] bg-slate-300 dark:bg-slate-700 mx-0.5" />

        {/* Theme Mode Switcher */}
        <div className="flex items-center bg-slate-200 dark:bg-slate-800 p-0.5 rounded-md">
          <button
            onClick={() => onSetTheme(theme === 'dark' ? 'light' : theme === 'light' ? 'system' : 'dark')}
            title={`当前主题: ${theme === 'light' ? '浅色' : theme === 'dark' ? '深色' : '跟随系统'} (点击切换)`}
            className="p-1 rounded text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 transition-colors"
          >
            {theme === 'light' && <Sun className="w-3.5 h-3.5 text-amber-500" />}
            {theme === 'dark' && <Moon className="w-3.5 h-3.5 text-blue-400" />}
            {theme === 'system' && <Monitor className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400" />}
          </button>
        </div>

        {/* Shortcuts Help */}
        <button
          onClick={onOpenShortcuts}
          title="快捷键列表 (F1 或 Ctrl+/)"
          className="p-1.5 rounded hover:bg-slate-200 dark:hover:bg-slate-700/60 transition-colors text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
        >
          <HelpCircle className="w-3.5 h-3.5" />
        </button>
      </div>
    </header>
  );
};
