import React, { useState, useMemo } from 'react';
import { HeadingItem } from '@/types';
import {
  ListTree,
  Search,
  ChevronRight,
  Hash,
  FileQuestion,
  X,
} from 'lucide-react';
import { useI18n } from '@/i18n';
import clsx from 'clsx';

interface SidebarProps {
  headings: HeadingItem[];
  isOpen: boolean;
  onClose: () => void;
  onSelectHeading: (item: HeadingItem) => void;
  currentLine?: number;
}

export const Sidebar: React.FC<SidebarProps> = ({
  headings,
  isOpen,
  onClose,
  onSelectHeading,
  currentLine = 1,
}) => {
  const { t } = useI18n();
  const [search, setSearch] = useState('');

  const filteredHeadings = useMemo(() => {
    if (!search.trim()) return headings;
    const query = search.toLowerCase();
    return headings.filter((h) => h.text.toLowerCase().includes(query));
  }, [headings, search]);

  if (!isOpen) return null;

  return (
    <aside className="w-64 bg-slate-50 dark:bg-[#111927] border-r border-slate-200 dark:border-slate-800 flex flex-col shrink-0 select-none text-xs h-full z-20">
      {/* Header */}
      <div className="h-9 px-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between font-medium text-slate-700 dark:text-slate-200">
        <div className="flex items-center space-x-1.5">
          <ListTree className="w-4 h-4 text-blue-500" />
          <span>{t('sidebar.outlineTitle', { count: headings.length })}</span>
        </div>
        <button
          type="button"
          onClick={onClose}
          title={t('sidebar.collapse')}
          aria-label={t('sidebar.collapse')}
          className="p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Search Bar */}
      {headings.length > 0 && (
        <div className="p-2 border-b border-slate-200 dark:border-slate-800">
          <div className="relative flex items-center">
            <Search className="w-3.5 h-3.5 absolute left-2.5 text-slate-400 pointer-events-none" />
            <input
              type="text"
              placeholder={t('sidebar.searchPlaceholder')}
              aria-label={t('sidebar.searchPlaceholder')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full bg-white dark:bg-[#182234] border border-slate-200 dark:border-slate-700 rounded-md pl-8 pr-2 py-1 text-xs text-slate-800 dark:text-slate-200 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                title={t('sidebar.clearSearch')}
                aria-label={t('sidebar.clearSearch')}
                className="absolute right-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
        </div>
      )}

      {/* Headings Tree List */}
      <div
        className="flex-1 overflow-y-auto p-1.5 space-y-0.5"
        role="navigation"
        aria-label={t('sidebar.outlineTitle', { count: headings.length })}
      >
        {filteredHeadings.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-center px-4 text-slate-400 dark:text-slate-500">
            <FileQuestion className="w-8 h-8 mb-2 opacity-50 stroke-[1.5]" />
            <p className="font-medium text-xs text-slate-500 dark:text-slate-400">
              {search ? t('sidebar.noMatchingHeadings') : t('sidebar.noOutline')}
            </p>
            <p className="text-[11px] mt-1 leading-relaxed">
              {search
                ? t('sidebar.noMatchingHelp')
                : t('sidebar.noOutlineHelp')}
            </p>
          </div>
        ) : (
          filteredHeadings.map((heading) => {
            const isCurrent =
              currentLine >= heading.line &&
              (!headings.find(
                (h) => h.line > heading.line && currentLine >= h.line
              ) ||
                heading.id === headings[headings.length - 1].id);

            // Indentation padding per heading level
            const paddingLeft = `${(heading.level - 1) * 12 + 6}px`;

            return (
              <button
                key={heading.id}
                onClick={() => onSelectHeading(heading)}
                style={{ paddingLeft }}
                className={clsx(
                  'w-full flex items-center py-1.5 pr-2 rounded text-left transition-colors group',
                  isCurrent
                    ? 'bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 font-medium'
                    : 'text-slate-600 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-slate-800/60 hover:text-slate-900 dark:hover:text-slate-100'
                )}
                title={t('sidebar.headingItemTooltip', {
                  line: heading.line,
                  level: heading.level,
                  text: heading.text,
                })}
              >
                {/* Level indicator */}
                <span className="text-[10px] font-mono text-slate-400 dark:text-slate-500 group-hover:text-blue-500 mr-1.5 shrink-0 flex items-center">
                  {heading.level === 1 ? (
                    <ChevronRight className="w-3 h-3 text-blue-500" />
                  ) : (
                    <Hash className="w-2.5 h-2.5" />
                  )}
                  {heading.level}
                </span>

                {/* Heading Text */}
                <span className="truncate flex-1 text-xs">{heading.text}</span>

                {/* Line number badge */}
                <span className="text-[10px] text-slate-400 dark:text-slate-500 ml-1 font-mono opacity-60 group-hover:opacity-100">
                  L{heading.line}
                </span>
              </button>
            );
          })
        )}
      </div>
    </aside>
  );
};
