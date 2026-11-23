import { useState } from 'react';
import { useI18n } from '@/i18n';
import type { XmdAlignment } from '@/lib/xmdAlignment';
import { validateXmdParagraph, xmdParagraphCss, type XmdParagraphStyle } from '@/lib/xmdParagraph';
import { WorkflowDialog } from './WorkflowDialog';

interface Preset {
  name: string;
  style: XmdParagraphStyle;
  alignment?: XmdAlignment;
}

const STORAGE = 'markdown_editor_paragraph_presets_v1';
const ALIGNMENTS: XmdAlignment[] = ['left', 'center', 'right', 'justify'];
const NUMBERS = [
  ['size', 'xmdParagraph.size', 6, 96, 0.5],
  ['lineHeight', 'xmdParagraph.lineHeight', 1, 3, 0.05],
  ['before', 'xmdParagraph.before', 0, 108, 0.5],
  ['after', 'xmdParagraph.after', 0, 108, 0.5],
  ['indent', 'xmdParagraph.indent', 0, 144, 0.5],
] as const;

function loadPresets(): Preset[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(STORAGE) ?? '[]');
    if (!Array.isArray(raw)) return [];
    return raw.slice(0, 20).flatMap((item) => {
      if (!item || typeof item.name !== 'string' || !item.name.trim() || item.name.length > 48 ||
        !item.style || typeof item.style !== 'object') return [];
      const style = validateXmdParagraph(item.style);
      return style ? [{ name: item.name, style, alignment: ALIGNMENTS.includes(item.alignment) ? item.alignment : undefined }] : [];
    });
  } catch { return []; }
}

export function XmdParagraphDialog({ style: initial, alignment: initialAlignment, onApply, onClose }: {
  style: XmdParagraphStyle;
  alignment?: XmdAlignment;
  onApply: (style: XmdParagraphStyle, alignment?: XmdAlignment) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [values, setValues] = useState(initial);
  const [alignment, setAlignment] = useState(initialAlignment);
  const [presets, setPresets] = useState(loadPresets);
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const clean = validateXmdParagraph({ ...values });
  const builtins: Preset[] = [
    { name: t('xmdParagraph.body'), style: { size: 11, lineHeight: 1.5, after: 6 }, alignment: 'left' },
    { name: t('xmdParagraph.heading'), style: { size: 18, lineHeight: 1.25, before: 12, after: 6 }, alignment: 'left' },
    { name: t('xmdParagraph.caption'), style: { size: 10, color: '#475569', lineHeight: 1.25, after: 9 }, alignment: 'center' },
  ];
  const control = 'min-w-0 rounded border border-slate-200 bg-panel px-2 py-1.5 text-sm dark:border-slate-700';
  const button = 'rounded border border-slate-200 px-3 py-1.5 text-sm hover:bg-panel disabled:opacity-40 dark:border-slate-700';
  const savePresets = (next: Preset[]) => {
    try { localStorage.setItem(STORAGE, JSON.stringify(next)); setPresets(next); setError(''); }
    catch { setError(t('xmdParagraph.saveFailed')); }
  };
  return (
    <WorkflowDialog title={t('xmdParagraph.title')} onClose={onClose}>
      <form className="overflow-auto p-4" onSubmit={(event) => { event.preventDefault(); if (clean) onApply(clean, alignment); }}>
        <label className="flex items-center gap-3 text-sm">
          {t('xmdParagraph.preset')}
          <select className={control} value="" onChange={(event) => {
            const preset = [...builtins, ...presets][Number(event.target.value)];
            if (preset) { setValues(preset.style); setAlignment(preset.alignment); setName(preset.name); }
          }}>
            <option value="">{t('xmdParagraph.choosePreset')}</option>
            {[...builtins, ...presets].map((preset, i) => <option key={i} value={i}>{preset.name}</option>)}
          </select>
        </label>
        <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
          <label className="flex min-w-0 flex-col gap-1">{t('xmdParagraph.font')}
            <input className={control} value={values.font ?? ''} maxLength={80} placeholder="Microsoft YaHei"
              onChange={(event) => setValues({ ...values, font: event.target.value || undefined })} />
          </label>
          <label className="flex min-w-0 flex-col gap-1">{t('xmdParagraph.color')}
            <input className={control} value={values.color ?? ''} maxLength={7} placeholder="#334155"
              onChange={(event) => setValues({ ...values, color: event.target.value || undefined })} />
          </label>
          {NUMBERS.map(([key, label, min, max, step]) => (
            <label key={key} className="flex min-w-0 flex-col gap-1">{t(label)}
                <input type="number" className={control} value={values[key] ?? ''} min={min} max={max} step={key === 'size' ? step : 'any'}
                onChange={(event) => setValues({ ...values, [key]: event.target.value === '' ? undefined : event.target.valueAsNumber })} />
            </label>
          ))}
          <label className="flex min-w-0 flex-col gap-1">{t('xmdLayout.alignment')}
            <select className={control} value={alignment ?? ''} onChange={(event) => setAlignment((event.target.value || undefined) as XmdAlignment | undefined)}>
              <option value="">{t('xmdParagraph.keepAlignment')}</option>
              <option value="left">{t('xmdLayout.alignLeft')}</option>
              <option value="center">{t('xmdLayout.alignCenter')}</option>
              <option value="right">{t('xmdLayout.alignRight')}</option>
              <option value="justify">{t('xmdLayout.alignJustify')}</option>
            </select>
          </label>
        </div>
        {clean && <div className="mt-4 overflow-auto rounded border border-slate-200 bg-panel px-3 py-2 dark:border-slate-700">
          <div ref={(el) => { if (el) el.style.cssText = xmdParagraphCss(clean) + (alignment ? ';text-align:' + alignment : ''); }}>
            {t('xmdParagraph.sample')}
          </div>
        </div>}
        <div className="mt-4 flex flex-wrap gap-2">
          <input className={control} aria-label={t('xmdParagraph.presetName')} placeholder={t('xmdParagraph.presetName')}
            value={name} maxLength={48} onChange={(event) => setName(event.target.value)} />
          <button type="button" className={button} disabled={!clean || !name.trim()} onClick={() => {
            if (!clean) return;
            const next = presets.filter((preset) => preset.name !== name.trim());
            if (next.length >= 20) { setError(t('xmdParagraph.presetLimit')); return; }
            savePresets([...next, { name: name.trim(), style: clean, alignment }]);
          }}>{t('xmdParagraph.savePreset')}</button>
          {presets.some((preset) => preset.name === name.trim()) &&
            <button type="button" className={button} onClick={() => savePresets(presets.filter((preset) => preset.name !== name.trim()))}>
              {t('xmdParagraph.deletePreset')}
            </button>}
        </div>
        {(!clean || error) && <p role="alert" className="mt-2 text-sm text-red-600 dark:text-red-400">{error || t('xmdParagraph.invalid')}</p>}
        <footer className="mt-4 flex justify-between gap-2 border-t border-slate-200 pt-4 dark:border-slate-700">
          <button type="button" className={button} onClick={() => onApply({}, undefined)}>{t('xmdParagraph.clear')}</button>
          <button type="submit" disabled={!clean} className="rounded bg-blue-600 px-4 py-1.5 text-sm text-white hover:bg-blue-700 disabled:opacity-50">{t('xmdParagraph.apply')}</button>
        </footer>
      </form>
    </WorkflowDialog>
  );
}
