import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronDown, ClipboardCopy, Download, FileArchive, FileCode, FileText, FileType, LoaderCircle, Palette } from 'lucide-react';
import clsx from 'clsx';
import { useI18n } from '@/i18n';

interface ExportMenuProps {
  disabled: boolean;
  isExporting?: boolean;
  exportingType?: 'docx' | 'pdf' | 'html' | 'xmd' | null;
  onExportWord: () => void;
  onExportPdf: () => void;
  onExportHtml: () => void;
  onExportXmd?: () => void;
  onCopyRichText?: () => void;
  onOpenExportTheme?: () => void;
}

export function ExportMenu({ disabled, isExporting = false, exportingType = null, onExportWord, onExportPdf, onExportHtml, onExportXmd, onCopyRichText, onOpenExportTheme }: ExportMenuProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const outside = (event: MouseEvent | TouchEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); setOpen(false); triggerRef.current?.focus(); }
    };
    document.addEventListener('mousedown', outside); document.addEventListener('touchstart', outside); document.addEventListener('keydown', keydown);
    return () => { document.removeEventListener('mousedown', outside); document.removeEventListener('touchstart', outside); document.removeEventListener('keydown', keydown); };
  }, [open]);

  const item = (label: string, description: string, icon: ReactNode, action: () => void, labelOverride?: string) => (
    <button type="button" role="menuitem" tabIndex={-1} aria-label={labelOverride || label} onClick={() => { setOpen(false); action(); }} className="w-full px-2.5 py-2 text-left flex items-center gap-2.5 rounded-md hover:bg-slate-100 dark:hover:bg-slate-700/60 text-slate-700 dark:text-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
      <span className="w-7 h-7 rounded-md bg-slate-100 dark:bg-slate-800/70 flex items-center justify-center shrink-0">{icon}</span>
      <span className="min-w-0"><span className="block text-xs font-medium">{label}</span><span className="block text-[10px] text-slate-400 dark:text-slate-500">{description}</span></span>
    </button>
  );
  const openKeyboard = (event: React.KeyboardEvent) => {
    if (event.key !== 'ArrowDown' && event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault(); setOpen(true); requestAnimationFrame(() => menuRef.current?.querySelector<HTMLButtonElement>('button')?.focus());
  };

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button ref={triggerRef} type="button" disabled={disabled} onClick={() => { if (!disabled) setOpen((value) => !value); }} onKeyDown={openKeyboard}
        aria-label={t('titleBar.exportFormatsTooltip')} aria-expanded={open} aria-haspopup="menu"
        title={isExporting ? t('titleBar.exportingTypeTooltip', { type: exportingType?.toUpperCase() || '' }) : disabled ? t('titleBar.noOpenDocTooltip') : t('titleBar.exportFormatsTooltip')}
        className={clsx('flex items-center gap-1.5 px-2 py-1.5 rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500', disabled ? 'opacity-40 cursor-not-allowed text-slate-400' : open ? 'bg-slate-200 dark:bg-slate-700 text-slate-900 dark:text-slate-100' : 'hover:bg-slate-200 dark:hover:bg-slate-700/60 text-slate-700 dark:text-slate-200')}>
        {isExporting ? <LoaderCircle className="w-3.5 h-3.5 text-blue-500 animate-spin" /> : <Download className="w-3.5 h-3.5 text-indigo-500" />}
        <span className="hidden md:inline">{isExporting ? t('titleBar.exporting') : t('titleBar.export')}</span>
        <ChevronDown className={clsx('w-3 h-3 text-slate-400 transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div ref={menuRef} role="menu" aria-label={t('titleBar.exportMenuAriaLabel')}
          onKeyDown={(event) => {
            if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
            const buttons = [...(menuRef.current?.querySelectorAll<HTMLButtonElement>('button') || [])];
            const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
            event.preventDefault();
            buttons[event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus();
          }}
          className="absolute left-0 top-full mt-2 w-72 rounded-lg border border-slate-200 dark:border-slate-700 bg-elevated p-1.5 shadow-xl z-50 animate-in fade-in zoom-in-95 duration-100">
          {item(t('titleBar.exportWord'), t('titleBar.exportWordDesc'), <FileText className="w-3.5 h-3.5 text-blue-500" />, onExportWord)}
          {item(t('titleBar.exportPdf'), t('titleBar.exportPdfDesc'), <FileType className="w-3.5 h-3.5 text-rose-500" />, onExportPdf)}
          {item(t('titleBar.exportHtml'), t('titleBar.exportHtmlDesc'), <FileCode className="w-3.5 h-3.5 text-emerald-500" />, onExportHtml)}
          {onExportXmd && item(t('titleBar.exportXmd'), t('titleBar.exportXmdDesc'), <FileArchive className="w-3.5 h-3.5 text-violet-500" />, onExportXmd)}
          {onCopyRichText && item(t('titleBar.copyRichText'), t('titleBar.copyRichTextDesc'), <ClipboardCopy className="w-3.5 h-3.5 text-amber-500" />, onCopyRichText)}
          {onOpenExportTheme && <>
            <div className="h-px bg-slate-100 dark:bg-slate-800 my-1.5" />
            {item(t('titleBar.exportTheme'), t('exportTheme.description'), <Palette className="w-3.5 h-3.5 text-fuchsia-500" />, onOpenExportTheme, t('titleBar.exportThemeTooltip'))}
          </>}
        </div>
      )}
    </div>
  );
}
