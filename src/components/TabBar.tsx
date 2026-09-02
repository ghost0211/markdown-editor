import React, { useRef, useState } from 'react';
import { FileText, Plus, X, Sparkles } from 'lucide-react';
import { DocumentTab } from '@/types';
import { useI18n } from '@/i18n';
import clsx from 'clsx';

interface TabBarProps {
  tabs: DocumentTab[];
  activeTabId: string;
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string) => void;
  onNewTab: () => void;
  onMoveTab?: (sourceId: string, targetId: string, position: 'before' | 'after') => void;
  onCloseOthers?: (id: string) => void;
}

interface DropIndicator {
  targetId: string;
  position: 'before' | 'after';
}

export const TabBar: React.FC<TabBarProps> = ({
  tabs,
  activeTabId,
  onSelectTab,
  onCloseTab,
  onNewTab,
  onMoveTab,
}) => {
  const { t } = useI18n();
  const scrollRef = useRef<HTMLDivElement>(null);
  const dragTabIdRef = useRef<string | null>(null);
  const [dropIndicator, setDropIndicator] = useState<DropIndicator | null>(null);

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

  return (
    <div
      className="h-9 bg-slate-200/80 dark:bg-[#131b2a] border-b border-slate-300 dark:border-slate-800 flex items-center px-1 select-none shrink-0 overflow-hidden"
      onWheel={handleWheel}
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
                  ? 'bg-white dark:bg-[#0f172a] text-slate-800 dark:text-slate-100 border-slate-300 dark:border-slate-800 border-b-white dark:border-b-[#0f172a] font-medium shadow-xs z-10'
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
    </div>
  );
};
