import React from 'react';
import { TextStats, ViewMode } from '@/types';
import { CheckCircle2, Clock, FileEdit, Sparkles } from 'lucide-react';
import { useI18n } from '@/i18n';

interface StatusBarProps {
  stats: TextStats;
  cursorLine: number;
  cursorCol: number;
  isDirty: boolean;
  viewMode: ViewMode;
}

export const StatusBar: React.FC<StatusBarProps> = ({
  stats,
  cursorLine,
  cursorCol,
  isDirty,
  viewMode,
}) => {
  const { t } = useI18n();

  const viewModeLabel = {
    edit: t('statusBar.modeEdit'),
    split: t('statusBar.modeSplit'),
    read: t('statusBar.modeRead'),
  }[viewMode];

  return (
    <footer className="h-6 bg-slate-100 dark:bg-[#131b2a] border-t border-slate-200 dark:border-slate-800/80 px-3 flex items-center justify-between select-none text-[11px] text-slate-500 dark:text-slate-400 font-sans shrink-0">
      {/* Left: Document Statistics */}
      <div className="flex items-center space-x-3">
        <div className="flex items-center space-x-1" title={t('statusBar.wordsTooltip')}>
          <span className="font-semibold text-slate-700 dark:text-slate-200">{stats.words}</span>
          <span>{t('statusBar.words')}</span>
        </div>

        <div className="h-3 w-[1px] bg-slate-300 dark:bg-slate-700" />

        <div className="flex items-center space-x-1" title={t('statusBar.charsTooltip')}>
          <span className="font-semibold text-slate-700 dark:text-slate-200">{stats.chars}</span>
          <span>{t('statusBar.chars')}</span>
          <span className="text-[10px] text-slate-400">({stats.charsNoSpaces})</span>
        </div>

        <div className="h-3 w-[1px] bg-slate-300 dark:bg-slate-700 hidden sm:block" />

        <div className="items-center space-x-1 hidden sm:flex" title={t('statusBar.linesTooltip')}>
          <span className="font-semibold text-slate-700 dark:text-slate-200">{stats.lines}</span>
          <span>{t('statusBar.lines')}</span>
        </div>

        <div className="h-3 w-[1px] bg-slate-300 dark:bg-slate-700 hidden md:block" />

        <div className="items-center space-x-1 text-slate-400 hidden md:flex" title={t('statusBar.readingTimeTooltip')}>
          <Clock className="w-3 h-3 text-slate-400" />
          <span>{t('statusBar.readingTime', { time: stats.readingTimeMinutes })}</span>
        </div>
      </div>

      {/* Right: Cursor, Encoding, Save Status, View Mode */}
      <div className="flex items-center space-x-3">
        {/* Cursor Position (Only when editing) */}
        {viewMode !== 'read' && (
          <>
            <div className="font-mono text-slate-600 dark:text-slate-300" title={t('statusBar.cursorPosTooltip')}>
              {t('statusBar.cursorPos', { line: cursorLine, col: cursorCol })}
            </div>
            <div className="h-3 w-[1px] bg-slate-300 dark:bg-slate-700" />
          </>
        )}

        {/* Save Status */}
        <div className="flex items-center space-x-1">
          {isDirty ? (
            <span className="flex items-center text-amber-500 font-medium space-x-1">
              <FileEdit className="w-3 h-3" />
              <span>{t('statusBar.unsaved')}</span>
            </span>
          ) : (
            <span className="flex items-center text-emerald-500 font-medium space-x-1">
              <CheckCircle2 className="w-3 h-3" />
              <span>{t('statusBar.saved')}</span>
            </span>
          )}
        </div>

        <div className="h-3 w-[1px] bg-slate-300 dark:bg-slate-700 hidden sm:block" />

        {/* Encoding */}
        <div className="text-slate-400 hidden sm:block">{t('common.utf8')}</div>

        <div className="h-3 w-[1px] bg-slate-300 dark:bg-slate-700" />

        {/* Mode Badge */}
        <div className="flex items-center space-x-1 text-blue-600 dark:text-blue-400 font-medium">
          <Sparkles className="w-3 h-3" />
          <span>{viewModeLabel}</span>
        </div>
      </div>
    </footer>
  );
};
