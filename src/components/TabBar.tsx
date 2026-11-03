import React, { useRef, useState, useEffect } from 'react';
import {
  FileText,
  Plus,
  X,
  Sparkles,
  FolderOpen,
  Copy,
  RotateCw,
  Save,
  Layers,
  ArrowRight,
  CheckCheck,
  XCircle,
} from 'lucide-react';
import { DocumentTab } from '@/types';
import { useI18n } from '@/i18n';
import clsx from 'clsx';

export interface TabBarProps {
  tabs: DocumentTab[];
  activeTabId: string;
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string) => void;
  onNewTab: () => void;
  onMoveTab?: (sourceId: string, targetId: string, position: 'before' | 'after') => void;
  onCloseOthers?: (id: string) => void;
  onCloseToTheRight?: (id: string) => void;
  onCloseSaved?: () => void;
  onCloseAll?: () => void;
  onReloadTab?: (id: string) => void;
  onSaveTabAs?: (id: string) => void;
  onRevealInFolder?: (filePath: string) => void;
  onOpenFile?: () => void;
  showToast?: (msg: string, type: 'info' | 'success' | 'warning' | 'error') => void;
}

interface DropIndicator {
  targetId: string;
  position: 'before' | 'after';
}

interface ContextMenuState {
  isOpen: boolean;
  x: number;
  y: number;
  targetTab: DocumentTab | null;
}

interface MenuItemProps {
  icon: React.ReactNode;
  label: string;
  shortcut?: string;
  disabled?: boolean;
  onClick: () => void;
  title?: string;
  danger?: boolean;
}

const MenuItem: React.FC<MenuItemProps> = ({
  icon,
  label,
  shortcut,
  disabled = false,
  onClick,
  title,
  danger = false,
}) => (
  <button
    type="button"
    role="menuitem"
    disabled={disabled}
    title={title}
    onClick={(e) => {
      e.stopPropagation();
      if (disabled) return;
      onClick();
    }}
    className={clsx(
      'w-full flex items-center justify-between px-2.5 py-1.5 text-left text-xs rounded-md transition-colors select-none',
      disabled
        ? 'opacity-40 cursor-not-allowed text-slate-400 dark:text-slate-500'
        : danger
        ? 'hover:bg-red-50 dark:hover:bg-red-950/40 text-slate-700 dark:text-slate-200 hover:text-red-600 dark:hover:text-red-400 cursor-pointer'
        : 'hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 hover:text-slate-900 dark:hover:text-white cursor-pointer'
    )}
  >
    <span className="flex items-center gap-2 truncate">
      <span className="shrink-0 w-4 h-4 flex items-center justify-center text-slate-500 dark:text-slate-400">
        {icon}
      </span>
      <span className="truncate">{label}</span>
    </span>
    {shortcut && (
      <span className="text-[10px] text-slate-400 dark:text-slate-500 font-mono shrink-0 ml-2">
        {shortcut}
      </span>
    )}
  </button>
);

export const TabBar: React.FC<TabBarProps> = ({
  tabs,
  activeTabId,
  onSelectTab,
  onCloseTab,
  onNewTab,
  onMoveTab,
  onCloseOthers,
  onCloseToTheRight,
  onCloseSaved,
  onCloseAll,
  onReloadTab,
  onSaveTabAs,
  onRevealInFolder,
  onOpenFile,
  showToast,
}) => {
  const { t } = useI18n();
  const scrollRef = useRef<HTMLDivElement>(null);
  const dragTabIdRef = useRef<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [dropIndicator, setDropIndicator] = useState<DropIndicator | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState>({
    isOpen: false,
    x: 0,
    y: 0,
    targetTab: null,
  });

  const closeMenu = () => {
    setContextMenu((prev) => (prev.isOpen ? { ...prev, isOpen: false } : prev));
  };

  // Close context menu on outside click, Escape key, or resize
  useEffect(() => {
    if (!contextMenu.isOpen) return;

    const handlePointerDown = (e: MouseEvent | TouchEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        closeMenu();
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        closeMenu();
      }
    };

    window.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('resize', closeMenu);

    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('resize', closeMenu);
    };
  }, [contextMenu.isOpen]);

  const handleWheel = (e: React.WheelEvent) => {
    if (scrollRef.current && e.deltaY !== 0) {
      scrollRef.current.scrollLeft += e.deltaY;
    }
  };

  const clearDragState = () => {
    dragTabIdRef.current = null;
    setDropIndicator(null);
  };

  const handleDragStart = (e: React.DragEvent, tabId: string) => {
    dragTabIdRef.current = tabId;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', tabId);
  };

  const handleDragOverTab = (e: React.DragEvent, tabId: string) => {
    const sourceId = dragTabIdRef.current;
    if (!sourceId || sourceId === tabId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const rect = e.currentTarget.getBoundingClientRect();
    const position: 'before' | 'after' =
      e.clientX < rect.left + rect.width / 2 ? 'before' : 'after';
    setDropIndicator((prev) =>
      prev && prev.targetId === tabId && prev.position === position
        ? prev
        : { targetId: tabId, position }
    );
  };

  const handleDrop = (e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    const sourceId = dragTabIdRef.current;
    const indicator = dropIndicator;
    clearDragState();
    if (!sourceId || sourceId === targetId || !onMoveTab) return;
    const position =
      indicator && indicator.targetId === targetId ? indicator.position : 'before';
    onMoveTab(sourceId, targetId, position);
  };

  const handleTabContextMenu = (e: React.MouseEvent, tab: DocumentTab) => {
    e.preventDefault();
    e.stopPropagation();
    const menuWidth = 230;
    const menuHeight = 360;
    const x = Math.max(8, Math.min(e.clientX, window.innerWidth - menuWidth - 8));
    const y = Math.max(8, Math.min(e.clientY, window.innerHeight - menuHeight - 8));
    setContextMenu({
      isOpen: true,
      x,
      y,
      targetTab: tab,
    });
  };

  const handleBarContextMenu = (e: React.MouseEvent) => {
    if (e.defaultPrevented) return;
    e.preventDefault();
    const menuWidth = 200;
    const menuHeight = 130;
    const x = Math.max(8, Math.min(e.clientX, window.innerWidth - menuWidth - 8));
    const y = Math.max(8, Math.min(e.clientY, window.innerHeight - menuHeight - 8));
    setContextMenu({
      isOpen: true,
      x,
      y,
      targetTab: null,
    });
  };

  const copyToClipboard = (text: string, successMsg: string) => {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      navigator.clipboard
        .writeText(text)
        .then(() => showToast?.(successMsg, 'success'))
        .catch(() => fallbackCopy(text, successMsg));
    } else {
      fallbackCopy(text, successMsg);
    }
  };

  const fallbackCopy = (text: string, successMsg: string) => {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      showToast?.(successMsg, 'success');
    } catch {
      showToast?.('复制失败', 'error');
    }
  };

  const isSavedToDisk = (tab: DocumentTab | null): boolean => {
    return Boolean(tab?.filePath && !tab.filePath.startsWith('browser://'));
  };

  const targetTab = contextMenu.targetTab;
  const targetIdx = targetTab ? tabs.findIndex((t) => t.id === targetTab.id) : -1;
  const hasTabsToTheRight = targetIdx !== -1 && targetIdx < tabs.length - 1;
  const hasOtherTabs = tabs.length > 1;
  const hasSavedTabs = tabs.some((t) => !t.isDirty);
  const targetSaved = isSavedToDisk(targetTab);

  return (
    <div
      className="h-9 bg-slate-200/80 dark:bg-[#131b2a] border-b border-slate-300 dark:border-slate-800 flex items-center px-1 select-none shrink-0 overflow-hidden"
      onWheel={handleWheel}
      onContextMenu={handleBarContextMenu}
      role="tablist"
      aria-label="Document tabs"
    >
      <div
        ref={scrollRef}
        className="flex-1 flex items-center space-x-1 overflow-x-auto no-scrollbar py-0.5"
      >
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId;
          const isWelcome = tab.id === 'doc-welcome';

          return (
            <div
              key={tab.id}
              role="tab"
              aria-selected={isActive}
              tabIndex={0}
              draggable={!!onMoveTab}
              onDragStart={(e) => handleDragStart(e, tab.id)}
              onDragOver={(e) => handleDragOverTab(e, tab.id)}
              onDrop={(e) => handleDrop(e, tab.id)}
              onDragEnd={clearDragState}
              onClick={() => onSelectTab(tab.id)}
              onContextMenu={(e) => handleTabContextMenu(e, tab)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onSelectTab(tab.id);
                }
              }}
              onMouseDown={(e) => {
                // Middle click to close tab
                if (e.button === 1) {
                  e.preventDefault();
                  onCloseTab(tab.id);
                }
              }}
              className={clsx(
                'group relative flex items-center h-7 px-2.5 max-w-[200px] min-w-[110px] text-xs rounded-t-md cursor-pointer border-t border-x transition-all select-none',
                isActive
                  ? 'bg-white dark:bg-[#0f172a] text-slate-800 dark:text-slate-100 border-slate-300 dark:border-slate-800 border-b-white dark:border-b-[#0f172a] font-medium shadow-sm z-10'
                  : 'bg-transparent text-slate-600 dark:text-slate-400 border-transparent hover:bg-slate-300/60 dark:hover:bg-slate-800/60'
              )}
              title={tab.filePath || tab.title}
            >
              {/* Drag insertion indicator */}
              {dropIndicator?.targetId === tab.id && (
                <span
                  className={clsx(
                    'absolute top-0 bottom-0 w-0.5 bg-blue-500 rounded-full pointer-events-none',
                    dropIndicator.position === 'before' ? '-left-1' : '-right-1'
                  )}
                />
              )}

              {/* Tab Icon */}
              {isWelcome ? (
                <Sparkles className="w-3.5 h-3.5 text-blue-500 mr-1.5 shrink-0" />
              ) : (
                <FileText className="w-3.5 h-3.5 text-slate-400 dark:text-slate-500 mr-1.5 shrink-0" />
              )}

              {/* Title */}
              <span className="truncate flex-1 text-left text-xs">{tab.title}</span>

              {/* Dirty status dot or close button */}
              <div className="ml-1.5 flex items-center shrink-0">
                {tab.isDirty ? (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onCloseTab(tab.id);
                    }}
                    title={t('tabBar.unsavedCloseTooltip')}
                    aria-label={t('tabBar.unsavedCloseTooltip')}
                    className="w-4 h-4 flex items-center justify-center rounded hover:bg-slate-200 dark:hover:bg-slate-700"
                  >
                    <span className="w-2 h-2 rounded-full bg-amber-500 group-hover:hidden" />
                    <X className="w-3 h-3 hidden group-hover:block text-slate-600 dark:text-slate-300" />
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onCloseTab(tab.id);
                    }}
                    title={t('tabBar.closeTabTooltip')}
                    aria-label={t('tabBar.closeTabTooltip')}
                    className={clsx(
                      'p-0.5 rounded hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-opacity',
                      isActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                    )}
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>
            </div>
          );
        })}

        {/* New Tab Button */}
        <button
          type="button"
          onClick={onNewTab}
          title={t('tabBar.newTabTooltip')}
          aria-label={t('tabBar.newTabTooltip')}
          className="p-1 text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-100 hover:bg-slate-300/70 dark:hover:bg-slate-800 rounded transition-colors ml-0.5 shrink-0"
        >
          <Plus className="w-4 h-4" />
        </button>
      </div>

      {/* Tab Bar Context Menu */}
      {contextMenu.isOpen && (
        <div
          ref={menuRef}
          role="menu"
          aria-label="Tab context menu"
          style={{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px` }}
          className="fixed z-50 w-56 p-1 bg-white dark:bg-[#1e293b] border border-slate-200 dark:border-slate-700/80 rounded-lg shadow-xl text-xs text-slate-700 dark:text-slate-200 animate-in fade-in zoom-in-95 duration-75 select-none"
        >
          {targetTab ? (
            <>
              {/* Close actions */}
              <MenuItem
                icon={<X className="w-3.5 h-3.5" />}
                label={t('tabBar.contextMenu.close')}
                shortcut={t('tabBar.contextMenu.closeShortcut')}
                onClick={() => {
                  closeMenu();
                  onCloseTab(targetTab.id);
                }}
              />
              <MenuItem
                icon={<Layers className="w-3.5 h-3.5" />}
                label={t('tabBar.contextMenu.closeOthers')}
                disabled={!hasOtherTabs}
                onClick={() => {
                  closeMenu();
                  onCloseOthers?.(targetTab.id);
                }}
              />
              <MenuItem
                icon={<ArrowRight className="w-3.5 h-3.5" />}
                label={t('tabBar.contextMenu.closeToTheRight')}
                disabled={!hasTabsToTheRight}
                onClick={() => {
                  closeMenu();
                  onCloseToTheRight?.(targetTab.id);
                }}
              />
              <MenuItem
                icon={<CheckCheck className="w-3.5 h-3.5" />}
                label={t('tabBar.contextMenu.closeSaved')}
                disabled={!hasSavedTabs}
                onClick={() => {
                  closeMenu();
                  onCloseSaved?.();
                }}
              />
              <MenuItem
                icon={<XCircle className="w-3.5 h-3.5" />}
                label={t('tabBar.contextMenu.closeAll')}
                danger
                onClick={() => {
                  closeMenu();
                  onCloseAll?.();
                }}
              />

              <div className="my-1 border-t border-slate-100 dark:border-slate-700/60" />

              {/* File / Explorer actions */}
              <MenuItem
                icon={<FolderOpen className="w-3.5 h-3.5 text-amber-500" />}
                label={t('tabBar.contextMenu.revealInFolder')}
                disabled={!targetSaved}
                title={!targetSaved ? t('tabBar.contextMenu.revealInFolderDisabled') : undefined}
                onClick={() => {
                  closeMenu();
                  if (targetTab.filePath) {
                    onRevealInFolder?.(targetTab.filePath);
                  }
                }}
              />
              <MenuItem
                icon={<Copy className="w-3.5 h-3.5" />}
                label={t('tabBar.contextMenu.copyPath')}
                disabled={!targetSaved}
                onClick={() => {
                  closeMenu();
                  if (targetTab.filePath) {
                    copyToClipboard(targetTab.filePath, t('toasts.pathCopied'));
                  }
                }}
              />
              <MenuItem
                icon={<FileText className="w-3.5 h-3.5" />}
                label={t('tabBar.contextMenu.copyFileName')}
                onClick={() => {
                  closeMenu();
                  copyToClipboard(targetTab.title, t('toasts.fileNameCopied'));
                }}
              />

              <div className="my-1 border-t border-slate-100 dark:border-slate-700/60" />

              {/* Document actions */}
              <MenuItem
                icon={<RotateCw className="w-3.5 h-3.5 text-blue-500" />}
                label={t('tabBar.contextMenu.reloadFromDisk')}
                disabled={!targetSaved}
                onClick={() => {
                  closeMenu();
                  onReloadTab?.(targetTab.id);
                }}
              />
              <MenuItem
                icon={<Save className="w-3.5 h-3.5 text-emerald-500" />}
                label={t('tabBar.contextMenu.saveAs')}
                onClick={() => {
                  closeMenu();
                  onSaveTabAs?.(targetTab.id);
                }}
              />

              <div className="my-1 border-t border-slate-100 dark:border-slate-700/60" />

              {/* New Tab */}
              <MenuItem
                icon={<Plus className="w-3.5 h-3.5" />}
                label={t('tabBar.contextMenu.newTab')}
                shortcut="Ctrl+N"
                onClick={() => {
                  closeMenu();
                  onNewTab();
                }}
              />
            </>
          ) : (
            <>
              {/* Background context menu */}
              <MenuItem
                icon={<Plus className="w-3.5 h-3.5" />}
                label={t('tabBar.contextMenu.newTab')}
                shortcut="Ctrl+N"
                onClick={() => {
                  closeMenu();
                  onNewTab();
                }}
              />
              <MenuItem
                icon={<FolderOpen className="w-3.5 h-3.5 text-amber-500" />}
                label={t('tabBar.contextMenu.openFile')}
                shortcut="Ctrl+O"
                onClick={() => {
                  closeMenu();
                  onOpenFile?.();
                }}
              />
              <div className="my-1 border-t border-slate-100 dark:border-slate-700/60" />
              <MenuItem
                icon={<XCircle className="w-3.5 h-3.5" />}
                label={t('tabBar.contextMenu.closeAll')}
                danger
                onClick={() => {
                  closeMenu();
                  onCloseAll?.();
                }}
              />
            </>
          )}
        </div>
      )}
    </div>
  );
};
