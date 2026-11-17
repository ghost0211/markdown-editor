import { useEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import clsx from 'clsx';
import { useI18n } from '@/i18n';
import type { RecentFile } from '@/lib/recentFiles';

interface RecentFilesMenuProps {
  recentFiles: RecentFile[];
  onOpenRecent?: (path: string) => void;
  onClearRecent?: () => void;
}

export function RecentFilesMenu({ recentFiles, onOpenRecent, onClearRecent }: RecentFilesMenuProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const outside = (event: MouseEvent | TouchEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    const keydown = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', outside); document.addEventListener('touchstart', outside); document.addEventListener('keydown', keydown);
    return () => { document.removeEventListener('mousedown', outside); document.removeEventListener('touchstart', outside); document.removeEventListener('keydown', keydown); };
  }, [open]);
  if (!onOpenRecent) return null;
  return (
    <div ref={rootRef} className="relative -ml-1 shrink-0">
      <button type="button" onClick={() => setOpen((value) => !value)} aria-label={t('titleBar.recentFilesTooltip')} aria-expanded={open} aria-haspopup="menu" title={t('titleBar.recentFilesTooltip')} className={clsx('p-1 rounded-md transition-colors text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500', open ? 'bg-slate-200 dark:bg-slate-700' : 'hover:bg-slate-200 dark:hover:bg-slate-700/60')}>
        <ChevronDown className={clsx('w-3 h-3 transition-transform', open && 'rotate-180')} />
      </button>
      {open && <div role="menu" aria-label={t('titleBar.recentFiles')} className="absolute left-0 top-full mt-2 w-72 max-h-80 overflow-y-auto rounded-lg border border-slate-200 dark:border-slate-700 bg-elevated py-1.5 shadow-xl z-50 animate-in fade-in zoom-in-95 duration-100">
        {recentFiles.length === 0 ? <div className="px-3 py-2 text-slate-400 dark:text-slate-500">{t('titleBar.recentFilesEmpty')}</div> : <>
          {recentFiles.map((file) => <button key={file.path} type="button" role="menuitem" title={file.path} onClick={() => { setOpen(false); onOpenRecent(file.path); }} className="w-full px-3 py-2 text-left flex flex-col rounded-md hover:bg-slate-100 dark:hover:bg-slate-700/60 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
            <span className="text-xs font-medium text-slate-700 dark:text-slate-200 truncate">{file.name}</span>
            <span className="text-[10px] text-slate-400 dark:text-slate-500 truncate">{file.path}</span>
          </button>)}
          {onClearRecent && <><div className="h-px bg-slate-100 dark:bg-slate-800 my-1" /><button type="button" role="menuitem" onClick={() => { setOpen(false); onClearRecent(); }} className="w-full px-3 py-1.5 text-left rounded-md hover:bg-slate-100 dark:hover:bg-slate-700/60 text-slate-500 dark:text-slate-400">{t('titleBar.clearRecentFiles')}</button></>}
        </>}
      </div>}
    </div>
  );
}
