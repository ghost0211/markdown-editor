import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { History, Images, LayoutTemplate, Link2, ShieldCheck, Wrench } from 'lucide-react';
import clsx from 'clsx';
import { useI18n } from '@/i18n';
import type { DocumentTab } from '@/types';

export interface DocumentToolAvailability {
  resources: boolean;
  quality: boolean;
  history: boolean;
}

export function getDocumentToolAvailability(tab?: DocumentTab): DocumentToolAvailability {
  const documentOpen = Boolean(tab && tab.kind !== 'diff');
  return {
    resources: documentOpen,
    quality: documentOpen,
    history: Boolean(documentOpen && tab?.filePath && !tab.filePath.startsWith('browser://')),
  };
}

interface DocumentToolsMenuProps {
  activeTab?: DocumentTab;
  onOpenResources?: () => void;
  onOpenTemplates?: () => void;
  onOpenQuality?: () => void;
  onOpenHistory?: () => void;
  onOpenReferences?: () => void;
}

export function DocumentToolsMenu({ activeTab, onOpenResources, onOpenTemplates, onOpenQuality, onOpenHistory, onOpenReferences }: DocumentToolsMenuProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const id = useId();
  const available = getDocumentToolAvailability(activeTab);

  useEffect(() => {
    if (!open) return;
    const outside = (event: MouseEvent | TouchEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    const keydown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault(); setOpen(false); triggerRef.current?.focus();
    };
    document.addEventListener('mousedown', outside);
    document.addEventListener('touchstart', outside);
    document.addEventListener('keydown', keydown);
    return () => {
      document.removeEventListener('mousedown', outside);
      document.removeEventListener('touchstart', outside);
      document.removeEventListener('keydown', keydown);
    };
  }, [open]);

  const focusFirst = () => requestAnimationFrame(() => menuRef.current?.querySelector<HTMLButtonElement>('button:not([disabled])')?.focus());
  const item = (label: string, description: string, icon: ReactNode, action: (() => void) | undefined, disabled = false, disabledLabel?: string, ariaLabel?: string) => {
    if (!action) return null;
    return (
      <button
        key={label} type="button" role="menuitem" tabIndex={-1} disabled={disabled}
        aria-label={ariaLabel || label} title={disabled ? disabledLabel : description}
        onClick={() => { setOpen(false); action(); }}
        className={clsx('w-full flex items-center gap-2.5 px-3 py-2 text-left rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500',
          disabled ? 'text-slate-400 dark:text-slate-500 cursor-not-allowed opacity-60' : 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700/60')}
      >
        <span className="w-7 h-7 rounded-md bg-slate-100 dark:bg-slate-800/70 flex items-center justify-center shrink-0">{icon}</span>
        <span className="min-w-0"><span className="block text-xs font-medium">{label}</span><span className="block text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">{description}</span></span>
      </button>
    );
  };

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        ref={triggerRef} id={id} type="button"
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
            event.preventDefault(); setOpen(true); focusFirst();
          }
        }}
        aria-label={t('titleBar.toolsTooltip')} title={t('titleBar.toolsTooltip')}
        aria-expanded={open} aria-haspopup="menu" aria-controls={`${id}-menu`}
        className={clsx('flex items-center gap-1.5 px-2 py-1.5 rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500', open ? 'bg-blue-100 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300' : 'text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700/60')}
      >
        <Wrench className="w-3.5 h-3.5" /><span className="hidden xl:inline">{t('titleBar.tools')}</span>
      </button>
      {open && (
        <div
          ref={menuRef} id={`${id}-menu`} role="menu" aria-label={t('titleBar.toolsMenuLabel')}
          onKeyDown={(event) => {
            const buttons = [...(menuRef.current?.querySelectorAll<HTMLButtonElement>('button:not([disabled])') || [])];
            const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Home' || event.key === 'End') {
              event.preventDefault();
              const target = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
                : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
              buttons[target]?.focus();
            }
          }}
          className="absolute left-0 top-full mt-2 w-72 rounded-lg border border-slate-200 dark:border-slate-700 bg-elevated p-1.5 shadow-xl z-50 animate-in fade-in zoom-in-95 duration-100"
        >
          <p className="px-2 py-1.5 text-[10px] font-medium uppercase tracking-wider text-slate-400 dark:text-slate-500">{t('titleBar.toolsMenuTitle')}</p>
          {item(t('titleBar.resources'), t('titleBar.toolResourcesDescription'), <Images className="w-4 h-4 text-violet-500" />, onOpenResources, !available.resources, activeTab ? t('titleBar.resourcesDiffUnavailable') : t('titleBar.noOpenDocTooltip'), t('titleBar.resourcesTooltip'))}
          {item(t('titleBar.templates'), t('titleBar.toolTemplatesDescription'), <LayoutTemplate className="w-4 h-4 text-blue-500" />, onOpenTemplates, false, undefined, t('titleBar.templatesTooltip'))}
          {item(t('titleBar.quality'), t('titleBar.toolQualityDescription'), <ShieldCheck className="w-4 h-4 text-teal-500" />, onOpenQuality, !available.quality, t('titleBar.noOpenDocTooltip'), t('titleBar.qualityTooltip'))}
          {item(t('titleBar.history'), t('titleBar.toolHistoryDescription'), <History className="w-4 h-4 text-blue-500" />, onOpenHistory, !available.history, t('titleBar.historyTooltip'), t('titleBar.historyTooltip'))}
          {item(t('chapterLinks.references'), t('chapterLinks.description'), <Link2 className="w-4 h-4 text-blue-500" />, onOpenReferences, !available.quality)}
        </div>
      )}
    </div>
  );
}
