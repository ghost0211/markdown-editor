import { useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, RotateCcw } from 'lucide-react';
import { useI18n } from '@/i18n';
import type { XmdTypography } from '@/lib/xmdTypography';
import { XmdTypographyPalette, XMD_FONT_PRESETS, XMD_SIZE_PRESETS } from './XmdTypographyPresets';

export interface XmdTypographyQuickRequest {
  field: keyof XmdTypography;
  anchor: HTMLButtonElement;
}

export function XmdTypographyQuickPopover({ request, initial, canRemove, onApply, onDismiss }: {
  request: XmdTypographyQuickRequest;
  initial: XmdTypography;
  canRemove: boolean;
  onApply: (style: XmdTypography) => boolean;
  onDismiss: (focusEditor: boolean) => void;
}) {
  const { t } = useI18n();
  const { field, anchor } = request;
  const title = t(field === 'font' ? 'xmdTypography.font' : field === 'size' ? 'xmdTypography.size' : 'xmdTypography.color');
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const [stale, setStale] = useState(false);
  const owner = anchor.ownerDocument;

  useLayoutEffect(() => {
    const panel = panelRef.current;
    const win = owner.defaultView;
    if (!panel || !win) return;
    const position = () => {
      const rect = anchor.getBoundingClientRect();
      const viewport = owner.documentElement.clientWidth;
      panel.style.left = Math.max(8, Math.min(rect.left, viewport - panel.offsetWidth - 8)) + 'px';
      panel.style.top = Math.min(rect.bottom + 6, win.innerHeight - 48) + 'px';
      panel.style.maxHeight = Math.max(40, win.innerHeight - panel.offsetTop - 8) + 'px';
    };
    const clickOutside = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!panel.contains(target) && !anchor.contains(target)) onDismiss(false);
    };
    position();
    (panel.querySelector<HTMLButtonElement>('button[aria-pressed="true"]') ??
      panel.querySelector<HTMLButtonElement>('button'))?.focus({ preventScroll: true });
    owner.addEventListener('pointerdown', clickOutside, true);
    owner.addEventListener('scroll', position, true);
    win.addEventListener('resize', position);
    return () => {
      owner.removeEventListener('pointerdown', clickOutside, true);
      owner.removeEventListener('scroll', position, true);
      win.removeEventListener('resize', position);
    };
  }, [anchor, onDismiss, owner]);

  const choose = (patch: XmdTypography) => {
    if (patch[field] === initial[field]) {
      onDismiss(true);
      return;
    }
    if (!onApply({ ...initial, ...patch })) setStale(true);
  };
  const option = 'rounded px-2 py-1.5 text-left hover:bg-panel focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500';
  const selected = 'bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-200';

  return createPortal(
    <div ref={panelRef} role="dialog" aria-labelledby={titleId}
      className="fixed z-[60] w-64 max-w-[calc(100vw-1rem)] overflow-auto rounded-lg border border-slate-200 bg-elevated p-2 text-sm text-slate-800 shadow-xl dark:border-slate-700 dark:text-slate-100"
      onBlur={(event) => {
        if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) onDismiss(false);
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        event.stopPropagation();
        anchor.focus({ preventScroll: true });
        onDismiss(false);
      }}>
      <h2 id={titleId} className="px-1.5 pb-2 text-xs font-semibold">{title}</h2>
      {field === 'font' && (
        <div className="grid grid-cols-1 gap-0.5">
          {XMD_FONT_PRESETS.map((font) => (
            <button key={font} type="button" aria-pressed={initial.font === font}
              className={option + ' flex justify-between ' + (initial.font === font ? selected : '')}
              style={{ fontFamily: '"' + font + '"' }} onClick={() => choose({ font })}>
              {font}{initial.font === font && <Check className="h-4 w-4" aria-hidden />}
            </button>
          ))}
        </div>
      )}
      {field === 'size' && (
        <div className="grid grid-cols-4 gap-1">
          {XMD_SIZE_PRESETS.map((size) => (
            <button key={size} type="button" aria-pressed={initial.size === size} aria-label={size + ' pt'}
              className={option + ' text-center tabular-nums ' + (initial.size === size ? selected : '')}
              onClick={() => choose({ size })}>{size}</button>
          ))}
        </div>
      )}
      {field === 'color' && <XmdTypographyPalette selected={initial.color} onSelect={(color) => choose({ color })} />}
      {canRemove && initial[field] !== undefined && (
        <button type="button" className={option + ' mt-2 flex w-full items-center gap-2 border-t border-slate-200 text-xs dark:border-slate-700'}
          onClick={() => choose({ [field]: undefined })}>
          <RotateCcw className="h-3.5 w-3.5" aria-hidden />{t('xmdTypography.resetField')}
        </button>
      )}
      {stale && <p role="alert" className="px-1.5 pt-2 text-xs text-red-700 dark:text-red-300">{t('xmdTypography.stale')}</p>}
    </div>,
    owner.body,
  );
}
