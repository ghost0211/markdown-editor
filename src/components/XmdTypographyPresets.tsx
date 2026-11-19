import { Check } from 'lucide-react';
import { useI18n, type TranslationKey } from '@/i18n';

export const XMD_FONT_PRESETS = ['微软雅黑', '宋体', '黑体', '楷体', '等线', '苹方', 'Microsoft YaHei', 'Arial', 'Times New Roman', 'Consolas'];
export const XMD_SIZE_PRESETS = [10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48];

const COLORS: ReadonlyArray<{ value: string; label: TranslationKey }> = [
  { value: '#0f172a', label: 'xmdTypography.colors.black' },
  { value: '#64748b', label: 'xmdTypography.colors.gray' },
  { value: '#ffffff', label: 'xmdTypography.colors.white' },
  { value: '#dc2626', label: 'xmdTypography.colors.red' },
  { value: '#ea580c', label: 'xmdTypography.colors.orange' },
  { value: '#ca8a04', label: 'xmdTypography.colors.gold' },
  { value: '#16a34a', label: 'xmdTypography.colors.green' },
  { value: '#0d9488', label: 'xmdTypography.colors.teal' },
  { value: '#0891b2', label: 'xmdTypography.colors.cyan' },
  { value: '#2563eb', label: 'xmdTypography.colors.blue' },
  { value: '#4f46e5', label: 'xmdTypography.colors.indigo' },
  { value: '#9333ea', label: 'xmdTypography.colors.purple' },
  { value: '#db2777', label: 'xmdTypography.colors.pink' },
  { value: '#92400e', label: 'xmdTypography.colors.brown' },
];

export function XmdTypographyPalette({ selected, onSelect }: {
  selected?: string;
  onSelect: (value: string) => void;
}) {
  const { t } = useI18n();
  return (
    <div role="group" aria-label={t('xmdTypography.presets')} className="grid grid-cols-7 gap-1.5">
      {COLORS.map(({ value, label }) => {
        const name = t(label) + ' ' + value.toUpperCase();
        const active = selected?.toLowerCase() === value;
        return (
          <button type="button" key={value} aria-label={name} title={name} aria-pressed={active}
            className={'flex h-7 min-w-0 items-center justify-center rounded-md border border-black/15 transition-shadow hover:ring-2 hover:ring-blue-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:border-white/25 ' +
              (active ? 'ring-2 ring-blue-500 ring-offset-1 ring-offset-[var(--bg-elevated)]' : '')}
            style={{ backgroundColor: value }}
            onClick={() => onSelect(value)}>
            {active && <Check className={value === '#ffffff' ? 'h-4 w-4 text-slate-900' : 'h-4 w-4 text-white drop-shadow'} aria-hidden />}
          </button>
        );
      })}
    </div>
  );
}
