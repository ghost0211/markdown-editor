import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { SettingsModal } from '../src/components/SettingsModal';
import { DEFAULT_SETTINGS } from '../src/lib/settings';
import { readTextFile, writeTextFile } from '../src/lib/native';
import { isMarkdownFileName, filterMarkdownFiles } from '../src/lib/dropFiles';
import { I18nProvider } from '../src/i18n';

const invokeMock = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));
const xmdMock = vi.hoisted(() => ({ importXmd: vi.fn(async () => '# Imported'), exportMarkdownToXmd: vi.fn(async () => new Uint8Array([80, 75, 3, 4])) }));
vi.mock('@/lib/xmd', () => xmdMock);
vi.mock('@/lib/export/xmdExporter', () => xmdMock);

beforeEach(() => { invokeMock.mockReset(); xmdMock.importXmd.mockClear(); xmdMock.exportMarkdownToXmd.mockClear(); vi.stubGlobal('window', { __TAURI_INTERNALS__: {} }); });
afterEach(() => vi.unstubAllGlobals());

describe('XMD system format support', () => {
  it('shows .xmd in the real association settings list and localized descriptions', () => {
    const props = { isOpen: true, onClose: vi.fn(), settings: DEFAULT_SETTINGS, onUpdateSetting: vi.fn(), onResetSettings: vi.fn(), showToast: vi.fn() };
    const html = renderToStaticMarkup(<I18nProvider language="zh-CN"><SettingsModal {...props} /></I18nProvider>);
    expect(html).toContain('.xmd');
    expect(html).toContain('Markdown、XMD 与文本文件');
    expect(readFileSync('src-tauri/tauri.conf.json', 'utf8')).toContain('"ext": ["xmd"]');
    expect(readFileSync('src-tauri/tauri.conf.json', 'utf8')).toContain('application/vnd.xmd+zip');
  });

  it('recognizes XMD across open/drop filters without treating lookalike suffixes as documents', () => {
    expect(isMarkdownFileName('package.XMD')).toBe(true);
    expect(isMarkdownFileName('package.xmd.zip')).toBe(false);
    expect(filterMarkdownFiles([new File([], 'a.xmd')]).map((file) => file.name)).toEqual(['a.xmd']);
    expect(readFileSync('src/hooks/useImageAssetInsertion.ts', 'utf8')).toContain(".endsWith('.xmd')");
  });

  it('reads an associated XMD as bounded raw bytes and safely imports it', async () => {
    const buffer = Uint8Array.of(80, 75, 3, 4).buffer;
    invokeMock.mockResolvedValue(buffer);
    expect(await readTextFile('C:\\docs\\pack.xmd')).toBe('# Imported');
    expect(invokeMock).toHaveBeenCalledWith('read_xmd_document', { path: 'C:\\docs\\pack.xmd' });
    expect(xmdMock.importXmd).toHaveBeenCalledWith(new Uint8Array(buffer));
  });

  it('repackages edited XMD on save instead of dumping Markdown over the ZIP', async () => {
    invokeMock.mockResolvedValue(undefined);
    await writeTextFile('C:\\docs\\pack.xmd', '# Edited\n\n![img](data:image/png;base64,AAAA)');
    expect(xmdMock.exportMarkdownToXmd).toHaveBeenCalledWith(expect.stringContaining('# Edited'), 'pack.xmd', { sourceFilePath: 'C:\\docs\\pack.xmd' });
    expect(invokeMock).toHaveBeenCalledWith('write_xmd_file', expect.any(Uint8Array));
    xmdMock.exportMarkdownToXmd.mockClear();
    await writeTextFile('C:\\target\\copy.xmd', '# Copied', 'C:\\source\\original.md');
    expect(xmdMock.exportMarkdownToXmd).toHaveBeenCalledWith('# Copied', 'copy.xmd', { sourceFilePath: 'C:\\source\\original.md' });
    expect(readFileSync('src/hooks/useDocuments.ts', 'utf8')).toContain('isTauri() && fileRes.path.toLowerCase()');
  });

  it('does not change plain Markdown text reads or writes', async () => {
    invokeMock.mockResolvedValue('# Plain');
    expect(await readTextFile('C:\\docs\\plain.md')).toBe('# Plain');
    await writeTextFile('C:\\docs\\plain.md', '# Edited');
    expect(invokeMock).toHaveBeenLastCalledWith('write_text_file', { path: 'C:\\docs\\plain.md', content: '# Edited' });
    expect(xmdMock.exportMarkdownToXmd).not.toHaveBeenCalled();
  });
});
