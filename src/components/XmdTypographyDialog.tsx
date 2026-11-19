import { useId, useState } from 'react';
import { useI18n } from '@/i18n';
import { hasXmdTypography, MAX_XMD_FONT_SIZE, MIN_XMD_FONT_SIZE, parseXmdTypography, type XmdTypography } from '@/lib/xmdTypography';
import { WorkflowDialog } from './WorkflowDialog';
import { XmdTypographyPalette, XMD_FONT_PRESETS } from './XmdTypographyPresets';

export function XmdTypographyDialog({ initial, canRemove, selectedText, onApply, onClose }: {
  initial: XmdTypography;
  canRemove: boolean;
  selectedText: string;
  onApply: (style: XmdTypography) => boolean;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const fontsId = useId();
  const [font, setFont] = useState(initial.font ?? '');
  const [size, setSize] = useState(String(initial.size ?? ''));
  const [color, setColor] = useState(initial.color ?? '');
  const [stale, setStale] = useState(false);
  const value = parseXmdTypography(font, size, color);
  const control = 'w-full rounded border border-slate-300 bg-app px-2 py-1.5 dark:border-slate-600';
  const label = 'flex min-w-0 flex-col gap-1.5';
  const submit = (style: XmdTypography) => {
    if (!onApply(style)) setStale(true);
  };

  return (
    <WorkflowDialog title={t('xmdTypography.title')} onClose={onClose}>
      <form className="min-h-0 overflow-y-auto text-sm" onSubmit={(event) => {
        event.preventDefault();
        if (value && hasXmdTypography(value)) submit(value);
      }}>
        <div className="grid gap-x-5 gap-y-4 p-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="flex min-w-0 flex-col gap-3">
            <label className={label}>
              {t('xmdTypography.font')}
              <input autoFocus className={control} list={fontsId} value={font} maxLength={80}
                onChange={(event) => setFont(event.target.value)} placeholder={t('xmdTypography.inherit')} />
              <datalist id={fontsId}>{XMD_FONT_PRESETS.map((suggestion) => <option key={suggestion} value={suggestion} />)}</datalist>
            </label>
            <label className={label}>
              {t('xmdTypography.size')}
              <input className={control} type="number" min={MIN_XMD_FONT_SIZE} max={MAX_XMD_FONT_SIZE} step="0.5"
                value={size} onChange={(event) => setSize(event.target.value)} placeholder={t('xmdTypography.inherit')} />
            </label>
          </div>
          <div className="flex min-w-0 flex-col gap-2">
            <div className="flex items-baseline justify-between gap-2">
              <label htmlFor={fontsId + '-color'}>{t('xmdTypography.color')}</label>
              {color && <button type="button" className="text-xs text-slate-500 hover:text-blue-600 dark:text-slate-400 dark:hover:text-blue-300"
                onClick={() => setColor('')}>{t('xmdTypography.inherit')}</button>}
            </div>
            <XmdTypographyPalette selected={color} onSelect={setColor} />
            <div className="flex gap-1.5">
              <input id={fontsId + '-color'} className={control + ' min-w-0'} value={color} maxLength={7}
                onChange={(event) => setColor(event.target.value)} placeholder={t('xmdTypography.inherit')} />
              <input type="color" className="h-8 w-9 shrink-0 rounded border border-slate-300 bg-app p-0.5 dark:border-slate-600"
                value={/^#[0-9a-f]{6}$/i.test(color) ? color : '#111827'}
                onChange={(event) => setColor(event.target.value)} aria-label={t('xmdTypography.pickColor')} />
            </div>
          </div>
          <div className="max-h-40 overflow-auto break-words rounded border border-slate-200 bg-app p-3 leading-tight dark:border-slate-700 sm:col-span-2"
            style={{ fontFamily: value?.font && '"' + value.font + '"', fontSize: value?.size && value.size + 'pt', color: value?.color }}>
            {selectedText || t('xmdTypography.sample')}
          </div>
          {(stale || !value) && (
            <p role="alert" className="text-xs text-red-700 dark:text-red-300 sm:col-span-2">
              {t(stale ? 'xmdTypography.stale' : 'xmdTypography.invalid')}
            </p>
          )}
        </div>
        <footer className="flex items-center justify-end gap-2 border-t border-slate-200 px-4 py-3 text-xs dark:border-slate-700">
          {canRemove && <button type="button" className="rounded px-3 py-1.5 hover:bg-panel" onClick={() => submit({})}>
            {t('xmdTypography.remove')}
          </button>}
          <button type="submit" disabled={stale || !value || !hasXmdTypography(value)}
            className="rounded bg-blue-600 px-3 py-1.5 text-white hover:bg-blue-700 disabled:opacity-45">
            {t('xmdTypography.apply')}
          </button>
        </footer>
      </form>
    </WorkflowDialog>
  );
}
