import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ExportStyleDialog } from '../src/components/ExportStyleDialog';
import {
  DEFAULT_EXPORT_STYLE,
  EXPORT_HEADER_TEXT_MAX_LENGTH,
  EXPORT_PRESET_NAME_MAX_LENGTH,
  EXPORT_PRESETS_STORAGE_KEY,
  MAX_EXPORT_PRESETS,
  deleteExportPreset,
  loadExportPresets,
  sanitizeHeaderText,
  sanitizePresetName,
  upsertExportPreset,
  validateExportStyle,
  type ExportStyle,
} from '../src/lib/exportStyle';

function createMemoryStorage(initial: Record<string, string> = {}): Storage {
  const data = new Map<string, string>(Object.entries(initial));
  return {
    get length() {
      return data.size;
    },
    clear() {
      data.clear();
    },
    getItem(key: string) {
      return data.has(key) ? (data.get(key) as string) : null;
    },
    key(index: number) {
      return Array.from(data.keys())[index] ?? null;
    },
    removeItem(key: string) {
      data.delete(key);
    },
    setItem(key: string, value: string) {
      data.set(key, String(value));
    },
  };
}

const CUSTOM_STYLE: ExportStyle = {
  fontFamily: 'serif',
  fontSize: 18,
  colorScheme: 'sepia',
  cover: true,
  toc: true,
  headerText: '安全页眉',
  pageNumbers: true,
};

describe('Export style model (exportStyle.ts)', () => {
  it('keeps today’s visual defaults and only exposes the closed style key set', () => {
    expect(DEFAULT_EXPORT_STYLE).toEqual({
      fontFamily: 'system',
      fontSize: 15,
      colorScheme: 'light',
      cover: false,
      toc: false,
      headerText: '',
      pageNumbers: false,
    });
    expect(Object.keys(DEFAULT_EXPORT_STYLE).sort()).toEqual(
      ['colorScheme', 'cover', 'fontFamily', 'fontSize', 'headerText', 'pageNumbers', 'toc'].sort()
    );
  });

  it('returns a fresh default for null, primitives, arrays, and malformed payloads', () => {
    for (const raw of [null, undefined, '', 42, true, [], ['serif'], () => undefined]) {
      const validated = validateExportStyle(raw);
      expect(validated).toEqual(DEFAULT_EXPORT_STYLE);
      expect(validated).not.toBe(DEFAULT_EXPORT_STYLE);
    }
  });

  it('copies valid values, drops unknown keys, and does not mutate the source', () => {
    const source = { ...CUSTOM_STYLE, css: 'body{display:none}' };
    const validated = validateExportStyle(source);

    expect(validated).toEqual(CUSTOM_STYLE);
    expect(validated).not.toBe(source);
    expect('css' in validated).toBe(false);

    validated.headerText = 'changed';
    expect(source.headerText).toBe('安全页眉');
    expect(DEFAULT_EXPORT_STYLE.headerText).toBe('');
  });

  it('clamps and rounds font size to 10..20 and rejects non-finite values', () => {
    expect(validateExportStyle({ fontSize: 1 }).fontSize).toBe(10);
    expect(validateExportStyle({ fontSize: 9.4 }).fontSize).toBe(10);
    expect(validateExportStyle({ fontSize: 12.6 }).fontSize).toBe(13);
    expect(validateExportStyle({ fontSize: 99 }).fontSize).toBe(20);
    expect(validateExportStyle({ fontSize: NaN }).fontSize).toBe(15);
    expect(validateExportStyle({ fontSize: Infinity }).fontSize).toBe(15);
    expect(validateExportStyle({ fontSize: '18' as unknown as number }).fontSize).toBe(15);
  });

  it('whitelists fonts/colors, accepts only real booleans, and ignores inherited values', () => {
    expect(validateExportStyle({ fontFamily: 'comic' as never }).fontFamily).toBe('system');
    expect(validateExportStyle({ colorScheme: 'neon' as never }).colorScheme).toBe('light');
    expect(validateExportStyle({ cover: 'true' as unknown as boolean }).cover).toBe(false);
    expect(validateExportStyle({ toc: 1 as unknown as boolean }).toc).toBe(false);
    expect(validateExportStyle({ pageNumbers: 'yes' as unknown as boolean }).pageNumbers).toBe(false);

    const inherited = Object.create({ fontFamily: 'mono', colorScheme: 'dark' });
    const validated = validateExportStyle(inherited);
    expect(validated.fontFamily).toBe('system');
    expect(validated.colorScheme).toBe('light');
  });

  it('sanitizes header text to one safe, bounded line without HTML-escaping it', () => {
    const raw = `  <b>Hello</b>\u0000\n\u202E世界\u200B  ${'x'.repeat(200)}  `;
    const sanitized = sanitizeHeaderText(raw);

    expect(sanitized.startsWith('<b>Hello</b> 世界')).toBe(true);
    expect(sanitized).not.toContain('\u0000');
    expect(sanitized).not.toContain('\u202E');
    expect(sanitized).not.toContain('\u200B');
    expect(sanitized).toHaveLength(EXPORT_HEADER_TEXT_MAX_LENGTH);
    expect(sanitizeHeaderText(123)).toBe('');
    expect(validateExportStyle({ headerText: '  a\n b  ' }).headerText).toBe('a b');
  });

  it('bounds preset names to 80 characters and strips control characters', () => {
    const name = sanitizePresetName(`  技术\u0000 文档 ${'名'.repeat(120)}  `);
    expect(name.startsWith('技术 文档')).toBe(true);
    expect(name).toHaveLength(EXPORT_PRESET_NAME_MAX_LENGTH);
    expect(sanitizePresetName(null)).toBe('');
  });
});

describe('Local export presets (markdown_editor_export_presets_v1)', () => {
  it('returns an empty list for missing, corrupt, or wrong-shaped storage', () => {
    expect(loadExportPresets(createMemoryStorage())).toEqual([]);
    expect(loadExportPresets(createMemoryStorage({ [EXPORT_PRESETS_STORAGE_KEY]: '{oops' }))).toEqual([]);
    expect(loadExportPresets(createMemoryStorage({ [EXPORT_PRESETS_STORAGE_KEY]: '{}' }))).toEqual([]);
    expect(loadExportPresets(createMemoryStorage({ [EXPORT_PRESETS_STORAGE_KEY]: 'null' }))).toEqual([]);
    expect(loadExportPresets(null)).toEqual([]);
  });

  it('saves, reloads, updates by name, and deletes presets locally', () => {
    const storage = createMemoryStorage();

    const afterSave = upsertExportPreset('  技术文档  ', CUSTOM_STYLE, storage);
    expect(afterSave).toHaveLength(1);
    expect(afterSave[0].name).toBe('技术文档');
    expect(afterSave[0].style).toEqual(CUSTOM_STYLE);
    expect(afterSave[0].id).toBeTruthy();

    const reloaded = loadExportPresets(storage);
    expect(reloaded).toEqual(afterSave);

    const updatedStyle = { ...CUSTOM_STYLE, fontSize: 20, colorScheme: 'dark' as const };
    const afterUpdate = upsertExportPreset('技术文档', updatedStyle, storage);
    expect(afterUpdate).toHaveLength(1);
    expect(afterUpdate[0].style).toEqual(updatedStyle);

    expect(upsertExportPreset('   ', CUSTOM_STYLE, storage)).toEqual(afterUpdate);

    const afterDelete = deleteExportPreset(afterUpdate[0].id, storage);
    expect(afterDelete).toEqual([]);
    expect(loadExportPresets(storage)).toEqual([]);

    expect(deleteExportPreset('missing-id', storage)).toEqual([]);
  });

  it('caps the list at 10 entries, newest first, and rejects duplicate ids/names on load', () => {
    const storage = createMemoryStorage();
    for (let index = 0; index < 12; index += 1) {
      upsertExportPreset(`Preset ${index}`, { ...DEFAULT_EXPORT_STYLE, fontSize: 10 + index }, storage);
    }

    const presets = loadExportPresets(storage);
    expect(presets).toHaveLength(MAX_EXPORT_PRESETS);
    expect(presets[0].name).toBe('Preset 11');
    expect(presets[9].name).toBe('Preset 2');

    const duplicatePayload = JSON.stringify([
      { id: 'same', name: 'One', style: DEFAULT_EXPORT_STYLE },
      { id: 'same', name: 'Two', style: DEFAULT_EXPORT_STYLE },
      { id: 'other', name: 'One', style: DEFAULT_EXPORT_STYLE },
    ]);
    const deduped = loadExportPresets(
      createMemoryStorage({ [EXPORT_PRESETS_STORAGE_KEY]: duplicatePayload })
    );
    expect(deduped).toHaveLength(1);
    expect(deduped[0].name).toBe('One');
  });

  it('does not throw when storage is unavailable or rejects writes', () => {
    const throwingStorage = createMemoryStorage();
    throwingStorage.setItem = () => {
      throw new Error('QuotaExceededError');
    };

    expect(() => upsertExportPreset('Doc', CUSTOM_STYLE, throwingStorage)).not.toThrow();
    expect(loadExportPresets(throwingStorage)).toEqual([]);

    // Node/SSR has no localStorage; the default resolver must stay a no-op.
    expect(loadExportPresets()).toEqual([]);
  });
});

describe('ExportStyleDialog (SSR and safe rendering)', () => {
  it('renders nothing when closed', () => {
    const html = renderToStaticMarkup(
      <ExportStyleDialog
        isOpen={false}
        onClose={vi.fn()}
        value={DEFAULT_EXPORT_STYLE}
        onSave={vi.fn()}
      />
    );
    expect(html).toBe('');
  });

  it('renders an accessible modal with the draft values when open', () => {
    const html = renderToStaticMarkup(
      <ExportStyleDialog
        isOpen
        onClose={vi.fn()}
        value={CUSTOM_STYLE}
        onSave={vi.fn()}
      />
    );

    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('aria-labelledby="export-style-dialog-title"');
    expect(html).toContain('aria-describedby="export-style-dialog-description"');
    expect(html).toContain('id="export-style-dialog-title"');
    expect(html).toContain('导出样式主题');
    expect(html).toContain('字体');
    expect(html).toContain('配色方案');
    expect(html).toContain('name="export-font-family"');
    expect(html).toContain('name="export-color-scheme"');
    expect(html).toContain('value="serif"');
    expect(html).toContain('value="sepia"');
    expect(html).toContain('value="18"');
    expect(html).toContain('安全页眉');
    expect(html).toContain('type="checkbox"');
    expect(html).toContain('1 / 3');
    expect(html).toContain('本地预设');
    expect(html).toContain('暂无本地预设');
  });

  it('escapes header text instead of emitting attacker-controlled markup', () => {
    const malicious = '"><script>alert("xss")</script><img src=x onerror=alert(1)>';
    const html = renderToStaticMarkup(
      <ExportStyleDialog
        isOpen
        onClose={vi.fn()}
        value={{ ...DEFAULT_EXPORT_STYLE, headerText: malicious.slice(0, 100) }}
        onSave={vi.fn()}
      />
    );

    expect(html).not.toContain('<script>alert');
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&lt;img');
  });

  it('renders without browser globals during server rendering', () => {
    const html = renderToStaticMarkup(
      <ExportStyleDialog isOpen onClose={vi.fn()} value={DEFAULT_EXPORT_STYLE} onSave={vi.fn()} />
    );
    expect(html).toContain('导出样式主题');
    expect(html).toContain('本地预设');
  });
});
