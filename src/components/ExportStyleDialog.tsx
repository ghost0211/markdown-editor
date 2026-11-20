import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ChangeEvent,
} from 'react';
import { Palette, Plus, Trash2, X } from 'lucide-react';
import clsx from 'clsx';
import { interpolate, useI18n, type TranslationKey, type TranslationParams } from '@/i18n';
import {
  EXPORT_COLOR_PALETTES,
  EXPORT_COLOR_SCHEMES,
  EXPORT_FONT_FAMILIES,
  EXPORT_FONT_SIZE_MAX,
  EXPORT_FONT_SIZE_MIN,
  EXPORT_FONT_STACKS,
  EXPORT_HEADER_TEXT_MAX_LENGTH,
  EXPORT_PRESET_NAME_MAX_LENGTH,
  MAX_EXPORT_PRESETS,
  clampExportFontSize,
  deleteExportPreset,
  loadExportPresets,
  sanitizePresetName,
  upsertExportPreset,
  validateExportStyle,
  type ExportColorScheme,
  type ExportFontFamily,
  type ExportStyle,
  type ExportStylePreset,
} from '@/lib/exportStyle';

export interface ExportStyleDialogProps {
  isOpen: boolean;
  onClose: () => void;
  value: ExportStyle;
  onSave: (style: ExportStyle) => void;
  title?: string;
  removal?: { label: string; onRemove: () => void };
}

/**
 * Locale keys owned by this dialog. They are resolved through `t()` first;
 * the local fallback only keeps isolated builds/SSR readable until the
 * translation catalog is updated.
 */
const EXPORT_THEME_FALLBACK = {
  'exportTheme.title': { zh: '导出样式主题', en: 'Export style theme' },
  'exportTheme.description': {
    zh: '设置 Word、PDF 与 HTML 导出的字体、配色和页面元素。',
    en: 'Configure fonts, colors, and page elements for Word, PDF, and HTML exports.',
  },
  'exportTheme.preview': { zh: '实时预览', en: 'Live preview' },
  'exportTheme.previewTitle': { zh: '文档标题', en: 'Document title' },
  'exportTheme.previewDate': { zh: '文档日期', en: 'Document date' },
  'exportTheme.previewBody': {
    zh: '这是导出样式的预览文本，实际内容会使用相同的字体、字号和配色。',
    en: 'This is preview text; exported content uses the same font, size, and palette.',
  },
  'exportTheme.fontFamily': { zh: '字体', en: 'Font family' },
  'exportTheme.fontFamilySystem': { zh: '系统无衬线', en: 'System sans-serif' },
  'exportTheme.fontFamilySerif': { zh: '衬线 / 宋体', en: 'Serif / Songti' },
  'exportTheme.fontFamilyMono': { zh: '等宽', en: 'Monospace' },
  'exportTheme.fontSize': { zh: '字号', en: 'Font size' },
  'exportTheme.fontSizeUnit': { zh: 'px', en: 'px' },
  'exportTheme.colorScheme': { zh: '配色方案', en: 'Color scheme' },
  'exportTheme.colorLight': { zh: '浅色', en: 'Light' },
  'exportTheme.colorSepia': { zh: '护眼复古', en: 'Sepia' },
  'exportTheme.colorDark': { zh: '深色', en: 'Dark' },
  'exportTheme.cover': { zh: '封面页', en: 'Cover page' },
  'exportTheme.coverDesc': {
    zh: '在正文前插入包含标题与日期的封面。',
    en: 'Insert a cover page with the title and date before the content.',
  },
  'exportTheme.toc': { zh: '目录', en: 'Table of contents' },
  'exportTheme.tocDesc': {
    zh: '根据标题生成带链接锚点的目录。',
    en: 'Generate a linked table of contents from headings.',
  },
  'exportTheme.headerText': { zh: '页眉文字', en: 'Header text' },
  'exportTheme.headerTextPlaceholder': {
    zh: '留空则不显示页眉',
    en: 'Leave empty for no header',
  },
  'exportTheme.headerTextDesc': {
    zh: '纯文本，最多 100 个字符；用于 HTML 和 Word 页眉，PDF 使用浏览器原生页眉。',
    en: 'Plain text, up to 100 characters; used in HTML/Word headers, while PDF uses the browser native header.',
  },
  'exportTheme.headerTextCount': { zh: '{count}/{max}', en: '{count}/{max}' },
  'exportTheme.pageNumbers': { zh: '页码', en: 'Page numbers' },
  'exportTheme.pageNumbersDesc': {
    zh: '开启后 PDF 使用 Edge 原生打印页眉页脚，HTML 提供渐进式页码页脚，Word 显示页码页脚；关闭时不输出这些页脚。',
    en: 'When on, PDF uses Edge native print header/footer, HTML provides a progressive page-number footer, and Word shows its page-number footer; when off, these footers are omitted.',
  },
  'exportTheme.pageNumbersHint': {
    zh: '注意：PDF 页码由浏览器原生打印页眉页脚提供；自定义页眉文字仅用于 HTML 和 Word。',
    en: 'Note: PDF page numbers use the browser native print header/footer; custom header text applies to HTML and Word only.',
  },
  'exportTheme.presets': { zh: '本地预设', en: 'Local presets' },
  'exportTheme.presetsDesc': {
    zh: '仅保存在本机浏览器存储中，最多 10 个。',
    en: 'Stored only in this browser on this device, up to 10.',
  },
  'exportTheme.presetName': { zh: '预设名称', en: 'Preset name' },
  'exportTheme.presetNamePlaceholder': { zh: '例如：技术文档', en: 'e.g. Technical docs' },
  'exportTheme.presetSave': { zh: '保存预设', en: 'Save preset' },
  'exportTheme.presetLoad': { zh: '载入', en: 'Load' },
  'exportTheme.presetDelete': { zh: '删除', en: 'Delete' },
  'exportTheme.presetEmpty': { zh: '暂无本地预设', en: 'No local presets yet' },
  'exportTheme.presetLimit': {
    zh: '最多保存 10 个预设，请先删除一个。',
    en: 'At most 10 presets; delete one first.',
  },
  'exportTheme.presetNameRequired': { zh: '请输入预设名称。', en: 'Enter a preset name.' },
  'exportTheme.presetSaved': { zh: '预设已保存。', en: 'Preset saved.' },
  'exportTheme.presetLoaded': { zh: '预设已载入。', en: 'Preset loaded.' },
  'exportTheme.presetDeleted': { zh: '预设已删除。', en: 'Preset deleted.' },
  'exportTheme.cancel': { zh: '取消', en: 'Cancel' },
  'exportTheme.save': { zh: '应用样式', en: 'Apply style' },
  'exportTheme.close': { zh: '关闭', en: 'Close' },
} as const;

type ExportThemeKey = keyof typeof EXPORT_THEME_FALLBACK;

const FONT_LABEL_KEY: Record<ExportFontFamily, ExportThemeKey> = {
  system: 'exportTheme.fontFamilySystem',
  serif: 'exportTheme.fontFamilySerif',
  mono: 'exportTheme.fontFamilyMono',
};

const COLOR_LABEL_KEY: Record<ExportColorScheme, ExportThemeKey> = {
  light: 'exportTheme.colorLight',
  sepia: 'exportTheme.colorSepia',
  dark: 'exportTheme.colorDark',
};

type DialogStatus = {
  kind: 'success' | 'error';
  key: ExportThemeKey;
  params?: TranslationParams;
} | null;

/** Typed `t()` wrapper with a local fallback for catalogs that lag behind. */
function useExportTheme() {
  const { language, t } = useI18n();
  return useCallback(
    (key: ExportThemeKey, params?: TranslationParams) => {
      const translated = t(key as unknown as TranslationKey, params);
      if (translated !== key) {
        return translated;
      }
      const fallback = language === 'en-US' ? EXPORT_THEME_FALLBACK[key].en : EXPORT_THEME_FALLBACK[key].zh;
      return params ? interpolate(fallback, params) : fallback;
    },
    [language, t]
  );
}

function focusableElements(root: HTMLElement): HTMLElement[] {
  return Array.from(
    root.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )
  );
}

export function ExportStyleDialog({
  isOpen,
  onClose,
  value,
  onSave,
  title,
  removal,
}: ExportStyleDialogProps) {
  const tr = useExportTheme();
  const modalRef = useRef<HTMLDivElement>(null);
  const initialFocusRef = useRef<HTMLInputElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  const wasOpenRef = useRef(false);

  const [draft, setDraft] = useState<ExportStyle>(() => validateExportStyle(value));
  const [presets, setPresets] = useState<ExportStylePreset[]>([]);
  const [presetName, setPresetName] = useState('');
  const [status, setStatus] = useState<DialogStatus>(null);

  // Open a fresh draft every time the dialog transitions from closed to open.
  useEffect(() => {
    if (isOpen && !wasOpenRef.current) {
      setDraft(validateExportStyle(value));
      setPresets(loadExportPresets());
      setPresetName('');
      setStatus(null);
    }
    wasOpenRef.current = isOpen;
  }, [isOpen, value]);

  // Scroll lock for narrow/mobile viewports.
  useEffect(() => {
    if (!isOpen || typeof document === 'undefined') return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isOpen]);

  // Focus trap, Escape, and focus restoration.
  useEffect(() => {
    if (!isOpen) return;

    if (typeof document !== 'undefined' && document.activeElement instanceof HTMLElement) {
      previouslyFocusedRef.current = document.activeElement;
    }

    const focusTimer = setTimeout(() => {
      initialFocusRef.current?.focus();
    }, 0);

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab' || !modalRef.current) {
        return;
      }

      const focusable = focusableElements(modalRef.current);
      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (event.shiftKey) {
        if (document.activeElement === first || !modalRef.current.contains(document.activeElement)) {
          event.preventDefault();
          last.focus();
        }
      } else if (
        document.activeElement === last ||
        !modalRef.current.contains(document.activeElement)
      ) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      clearTimeout(focusTimer);
      window.removeEventListener('keydown', handleKeyDown);
      if (previouslyFocusedRef.current?.focus) {
        previouslyFocusedRef.current.focus();
      }
    };
  }, [isOpen, onClose]);

  const update = <K extends keyof ExportStyle>(key: K, nextValue: ExportStyle[K]) => {
    setDraft((current) => ({ ...current, [key]: nextValue }));
  };

  const handleHeaderTextChange = (event: ChangeEvent<HTMLInputElement>) => {
    update('headerText', event.target.value.slice(0, EXPORT_HEADER_TEXT_MAX_LENGTH));
  };

  const handleFontSizeChange = (event: ChangeEvent<HTMLInputElement>) => {
    const parsed = Number(event.target.value);
    if (Number.isFinite(parsed)) {
      update('fontSize', clampExportFontSize(parsed));
    }
  };

  const handleSave = () => {
    onSave(validateExportStyle(draft));
    onClose();
  };

  const handleSavePreset = () => {
    const cleanName = sanitizePresetName(presetName);
    if (!cleanName) {
      setStatus({ kind: 'error', key: 'exportTheme.presetNameRequired' });
      return;
    }
    const alreadyExists = presets.some((preset) => preset.name === cleanName);
    if (!alreadyExists && presets.length >= MAX_EXPORT_PRESETS) {
      setStatus({ kind: 'error', key: 'exportTheme.presetLimit' });
      return;
    }
    const next = upsertExportPreset(cleanName, draft);
    setPresets(next);
    setPresetName('');
    setStatus({ kind: 'success', key: 'exportTheme.presetSaved' });
  };

  const handleLoadPreset = (preset: ExportStylePreset) => {
    setDraft(validateExportStyle(preset.style));
    setPresetName(preset.name);
    setStatus({ kind: 'success', key: 'exportTheme.presetLoaded' });
  };

  const handleDeletePreset = (preset: ExportStylePreset) => {
    setPresets(deleteExportPreset(preset.id));
    setStatus({ kind: 'success', key: 'exportTheme.presetDeleted' });
  };

  if (!isOpen) return null;

  const palette = EXPORT_COLOR_PALETTES[draft.colorScheme];
  const fontStack = EXPORT_FONT_STACKS[draft.fontFamily];
  const previewStyle: CSSProperties = {
    backgroundColor: palette.background,
    color: palette.text,
    borderColor: palette.border,
    fontFamily: fontStack,
    fontSize: `${draft.fontSize}px`,
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs animate-in fade-in duration-150"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="export-style-dialog-title"
      aria-describedby="export-style-dialog-description"
    >
      <div
        ref={modalRef}
        className="flex max-h-[calc(100vh-2rem)] w-full max-w-2xl flex-col overflow-hidden rounded-lg border border-slate-200 bg-elevated text-slate-800 shadow-2xl dark:border-slate-700 dark:text-slate-100 sm:max-h-[90vh]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-700">
          <div className="flex items-center space-x-2 text-sm font-medium">
            <Palette className="h-4 w-4 text-blue-500" />
            <span id="export-style-dialog-title">{title ?? tr('exportTheme.title')}</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={tr('exportTheme.close')}
            className="rounded p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <p id="export-style-dialog-description" className="sr-only">
          {tr('exportTheme.description')}
        </p>

        <div className="flex-1 space-y-4 overflow-y-auto overscroll-contain p-4 text-xs">
          {/* Live preview. Colors/fonts come only from fixed whitelists. */}
          <section className="space-y-2" aria-label={tr('exportTheme.preview')}>
            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              {tr('exportTheme.preview')}
            </h3>
            <div className="rounded-lg border p-3 shadow-inner" style={previewStyle}>
              {draft.headerText && (
                <div
                  className="mb-2 border-b pb-1 text-[0.75em]"
                  style={{ borderColor: palette.border, color: palette.muted }}
                >
                  {draft.headerText}
                </div>
              )}
              {draft.cover && (
                <div
                  className="mb-3 border-b pb-3 text-center"
                  style={{ borderColor: palette.border }}
                >
                  <div className="text-[1.5em] font-semibold" style={{ color: palette.heading }}>
                    {tr('exportTheme.previewTitle')}
                  </div>
                  <div className="mt-1 text-[0.75em]" style={{ color: palette.muted }}>
                    {tr('exportTheme.previewDate')}
                  </div>
                </div>
              )}
              <div className="text-[1.2em] font-semibold" style={{ color: palette.heading }}>
                {tr('exportTheme.previewTitle')}
              </div>
              {draft.toc && (
                <div
                  className="my-2 border-y py-1 text-[0.85em]"
                  style={{ borderColor: palette.border, color: palette.muted }}
                >
                  <div className="font-semibold">{tr('exportTheme.toc')}</div>
                  <div>1. {tr('exportTheme.previewTitle')}</div>
                  <div className="pl-3">1.1 {tr('exportTheme.previewBody').slice(0, 18)}...</div>
                </div>
              )}
              <p className="mt-1 leading-relaxed">{tr('exportTheme.previewBody')}</p>
              <div className="mt-2 flex items-center justify-between text-[0.75em]" style={{ color: palette.muted }}>
                <span style={{ color: palette.link }}>example.com</span>
                {draft.pageNumbers && <span>1 / 3</span>}
              </div>
            </div>
          </section>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <fieldset className="space-y-2">
              <legend className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                {tr('exportTheme.fontFamily')}
              </legend>
              <div className="grid grid-cols-1 gap-2">
                {EXPORT_FONT_FAMILIES.map((family) => (
                  <label
                    key={family}
                    className={clsx(
                      'flex cursor-pointer items-center gap-2 rounded border px-2.5 py-2 transition-colors focus-within:ring-2 focus-within:ring-blue-500',
                      draft.fontFamily === family
                        ? 'border-blue-500 bg-blue-50/70 dark:bg-blue-900/20'
                        : 'border-slate-200 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800/60'
                    )}
                  >
                    <input
                      type="radio"
                      name="export-font-family"
                      value={family}
                      checked={draft.fontFamily === family}
                      onChange={() => update('fontFamily', family)}
                      className="sr-only"
                    />
                    <span
                      className="w-7 shrink-0 text-center text-base font-semibold text-slate-700 dark:text-slate-200"
                      style={{ fontFamily: EXPORT_FONT_STACKS[family] }}
                      aria-hidden="true"
                    >
                      Aa
                    </span>
                    <span className="min-w-0 truncate">{tr(FONT_LABEL_KEY[family])}</span>
                  </label>
                ))}
              </div>
            </fieldset>

            <fieldset className="space-y-2">
              <legend className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                {tr('exportTheme.colorScheme')}
              </legend>
              <div className="grid grid-cols-1 gap-2">
                {EXPORT_COLOR_SCHEMES.map((scheme) => {
                  const schemePalette = EXPORT_COLOR_PALETTES[scheme];
                  return (
                    <label
                      key={scheme}
                      className={clsx(
                        'flex cursor-pointer items-center gap-2 rounded border px-2.5 py-2 transition-colors focus-within:ring-2 focus-within:ring-blue-500',
                        draft.colorScheme === scheme
                          ? 'border-blue-500 bg-blue-50/70 dark:bg-blue-900/20'
                          : 'border-slate-200 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800/60'
                      )}
                    >
                      <input
                        type="radio"
                        name="export-color-scheme"
                        value={scheme}
                        checked={draft.colorScheme === scheme}
                        onChange={() => update('colorScheme', scheme)}
                        className="sr-only"
                      />
                      <span
                        className="flex h-6 w-6 shrink-0 items-center justify-center rounded border"
                        style={{
                          backgroundColor: schemePalette.background,
                          borderColor: schemePalette.border,
                        }}
                        aria-hidden="true"
                      >
                        <span
                          className="h-2 w-2 rounded-full"
                          style={{ backgroundColor: schemePalette.text }}
                        />
                      </span>
                      <span className="min-w-0 truncate">{tr(COLOR_LABEL_KEY[scheme])}</span>
                    </label>
                  );
                })}
              </div>
            </fieldset>
          </div>

          <fieldset className="space-y-2">
            <legend className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              {tr('exportTheme.fontSize')}
            </legend>
            <div className="flex items-center gap-3">
              <input
                ref={initialFocusRef}
                id="export-style-font-size"
                type="range"
                min={EXPORT_FONT_SIZE_MIN}
                max={EXPORT_FONT_SIZE_MAX}
                step={1}
                value={draft.fontSize}
                onChange={handleFontSizeChange}
                aria-label={tr('exportTheme.fontSize')}
                className="h-1.5 flex-1 cursor-pointer accent-blue-600"
              />
              <div className="flex items-center gap-1">
                <input
                  type="number"
                  min={EXPORT_FONT_SIZE_MIN}
                  max={EXPORT_FONT_SIZE_MAX}
                  step={1}
                  value={draft.fontSize}
                  onChange={handleFontSizeChange}
                  aria-label={tr('exportTheme.fontSize')}
                  className="w-14 rounded border border-slate-300 bg-white px-2 py-1 text-right text-xs text-slate-800 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                />
                <span className="text-slate-500 dark:text-slate-400">
                  {tr('exportTheme.fontSizeUnit')}
                </span>
              </div>
            </div>
          </fieldset>

          <fieldset className="space-y-2">
            <legend className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              {tr('exportTheme.headerText')}
            </legend>
            <input
              type="text"
              value={draft.headerText}
              onChange={handleHeaderTextChange}
              maxLength={EXPORT_HEADER_TEXT_MAX_LENGTH}
              placeholder={tr('exportTheme.headerTextPlaceholder')}
              aria-label={tr('exportTheme.headerText')}
              aria-describedby="export-style-header-help"
              className="w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-800 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
            />
            <div
              id="export-style-header-help"
              className="flex items-start justify-between gap-3 text-[11px] text-slate-500 dark:text-slate-400"
            >
              <span>{tr('exportTheme.headerTextDesc')}</span>
              <span className="shrink-0 tabular-nums">
                {tr('exportTheme.headerTextCount', {
                  count: draft.headerText.length,
                  max: EXPORT_HEADER_TEXT_MAX_LENGTH,
                })}
              </span>
            </div>
          </fieldset>

          <div className="space-y-2">
            {(
              [
                ['cover', 'exportTheme.cover', 'exportTheme.coverDesc'],
                ['toc', 'exportTheme.toc', 'exportTheme.tocDesc'],
                ['pageNumbers', 'exportTheme.pageNumbers', 'exportTheme.pageNumbersDesc'],
              ] as const
            ).map(([key, labelKey, descKey]) => (
              <label
                key={key}
                className="flex cursor-pointer items-start gap-2 rounded border border-slate-200 px-2.5 py-2 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800/60"
              >
                <input
                  type="checkbox"
                  checked={draft[key]}
                  onChange={(event) => update(key, event.target.checked)}
                  className="mt-0.5 h-3.5 w-3.5 shrink-0 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                />
                <span className="min-w-0">
                  <span className="block font-medium text-slate-700 dark:text-slate-200">
                    {tr(labelKey)}
                  </span>
                  <span className="mt-0.5 block text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
                    {tr(descKey)}
                  </span>
                </span>
              </label>
            ))}
            {draft.pageNumbers && (
              <p className="rounded border border-amber-200 bg-amber-50 px-2.5 py-2 text-[11px] leading-relaxed text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
                {tr('exportTheme.pageNumbersHint')}
              </p>
            )}
          </div>

          <section className="space-y-2 border-t border-slate-200 pt-3 dark:border-slate-700">
            <div className="flex items-center justify-between">
              <h3 className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                {tr('exportTheme.presets')}
              </h3>
              <span className="text-[11px] tabular-nums text-slate-400">
                {presets.length}/{MAX_EXPORT_PRESETS}
              </span>
            </div>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              {tr('exportTheme.presetsDesc')}
            </p>

            <div className="flex items-center gap-2">
              <input
                type="text"
                value={presetName}
                onChange={(event) =>
                  setPresetName(event.target.value.slice(0, EXPORT_PRESET_NAME_MAX_LENGTH))
                }
                maxLength={EXPORT_PRESET_NAME_MAX_LENGTH}
                placeholder={tr('exportTheme.presetNamePlaceholder')}
                aria-label={tr('exportTheme.presetName')}
                className="min-w-0 flex-1 rounded border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-800 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
              />
              <button
                type="button"
                onClick={handleSavePreset}
                className="inline-flex shrink-0 items-center gap-1 rounded bg-blue-600 px-2.5 py-1.5 text-xs font-medium text-white transition-colors hover:bg-blue-700"
              >
                <Plus className="h-3.5 w-3.5" />
                {tr('exportTheme.presetSave')}
              </button>
            </div>

            {presets.length === 0 ? (
              <p className="rounded border border-dashed border-slate-300 px-2.5 py-3 text-center text-[11px] text-slate-400 dark:border-slate-600">
                {tr('exportTheme.presetEmpty')}
              </p>
            ) : (
              <ul className="divide-y divide-slate-200 rounded border border-slate-200 dark:divide-slate-700 dark:border-slate-700">
                {presets.map((preset) => (
                  <li key={preset.id} className="flex items-center gap-2 px-1 py-1">
                    <button
                      type="button"
                      onClick={() => handleLoadPreset(preset)}
                      aria-label={`${tr('exportTheme.presetLoad')}: ${preset.name}`}
                      className="min-w-0 flex-1 rounded px-1.5 py-1 text-left hover:bg-slate-100 dark:hover:bg-slate-800"
                    >
                      <span className="block truncate font-medium text-slate-700 dark:text-slate-200">
                        {preset.name}
                      </span>
                      <span className="block truncate text-[11px] text-slate-500 dark:text-slate-400">
                        {tr(FONT_LABEL_KEY[preset.style.fontFamily])} · {preset.style.fontSize}
                        {tr('exportTheme.fontSizeUnit')} · {tr(COLOR_LABEL_KEY[preset.style.colorScheme])}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeletePreset(preset)}
                      aria-label={`${tr('exportTheme.presetDelete')}: ${preset.name}`}
                      className="shrink-0 rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/30 dark:hover:text-red-400"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {status && (
              <p
                role={status.kind === 'error' ? 'alert' : 'status'}
                className={clsx(
                  'text-[11px]',
                  status.kind === 'error'
                    ? 'text-red-600 dark:text-red-400'
                    : 'text-emerald-600 dark:text-emerald-400'
                )}
              >
                {tr(status.key, status.params)}
              </p>
            )}
          </section>
        </div>

        <div className="flex items-center justify-end space-x-2 border-t border-slate-200 bg-panel px-4 py-3 dark:border-slate-700">
          {removal && <button type="button"
            className="mr-auto rounded px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-200 dark:text-slate-300 dark:hover:bg-slate-700"
            onClick={() => { removal.onRemove(); onClose(); }}>
            {removal.label}
          </button>}
          <button
            type="button"
            onClick={onClose}
            className="rounded px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-200 dark:text-slate-300 dark:hover:bg-slate-700"
          >
            {tr('exportTheme.cancel')}
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white shadow-sm transition-colors hover:bg-blue-700"
          >
            {tr('exportTheme.save')}
          </button>
        </div>
      </div>
    </div>
  );
}
