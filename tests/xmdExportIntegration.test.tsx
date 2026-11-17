import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  ensureExportPathExtension,
  getExportFilename,
  isExportTargetSameAsSource,
} from '../src/lib/documentUtils';
import {
  XMD_MIME_TYPE,
  exportFileDialog,
  fetchXmdImage,
  readXmdResource,
  writeBinaryFile,
} from '../src/lib/native';
import { TitleBar } from '../src/components/TitleBar';
import { I18nProvider, t } from '../src/i18n';
import { DocumentTab } from '../src/types';

// `native.ts` calls Tauri's `invoke` for raw XMD read/write. Keeping the real
// module exports (e.g. for `@tauri-apps/api/event`) while stubbing `invoke`
// lets these tests assert the exact IPC command names and raw frame layout.
const invokeMock = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tauri-apps/api/core')>();
  return { ...actual, invoke: invokeMock };
});

/**
 * UI/native integration coverage for the `.xmd` single-file export:
 * default file names, save-dialog wiring, browser MIME type, remote-image
 * wrapper, and the export-menu/prop plumbing.
 */
describe('XMD export filename handling (documentUtils.ts)', () => {
  it('builds .xmd default names from every supported source extension', () => {
    expect(getExportFilename('Guide.md', 'xmd')).toBe('Guide.xmd');
    expect(getExportFilename('Guide.markdown', 'xmd')).toBe('Guide.xmd');
    expect(getExportFilename('Guide.mdown', 'xmd')).toBe('Guide.xmd');
    expect(getExportFilename('Guide.mkd', 'xmd')).toBe('Guide.xmd');
    expect(getExportFilename('Guide.MKD', 'xmd')).toBe('Guide.xmd');
    expect(getExportFilename('Guide.txt', 'xmd')).toBe('Guide.xmd');
    expect(getExportFilename('Guide.html', 'xmd')).toBe('Guide.xmd');
    expect(getExportFilename('Guide.htm', 'xmd')).toBe('Guide.xmd');
    expect(getExportFilename('Guide.docx', 'xmd')).toBe('Guide.xmd');
    // Re-exporting an .xmd bundle must not produce `Guide.xmd.xmd`.
    expect(getExportFilename('Guide.xmd', 'xmd')).toBe('Guide.xmd');
    expect(getExportFilename('Guide.XMD', 'xmd')).toBe('Guide.xmd');
    // A real base name keeps its dots.
    expect(getExportFilename('archive.tar.gz', 'xmd')).toBe('archive.tar.gz.xmd');
  });

  it('falls back to 未命名.xmd when the title is empty', () => {
    expect(getExportFilename('', 'xmd')).toBe('未命名.xmd');
    expect(getExportFilename(null, 'xmd')).toBe('未命名.xmd');
    expect(getExportFilename('   ', 'xmd')).toBe('未命名.xmd');
  });

  it('keeps existing docx/pdf/html default-name behavior unchanged', () => {
    expect(getExportFilename('Guide.md', 'docx')).toBe('Guide.docx');
    expect(getExportFilename('Guide.md', 'pdf')).toBe('Guide.pdf');
    expect(getExportFilename('Guide.md', 'html')).toBe('Guide.html');
    // .xmd is now a recognized extension, so it is stripped for other formats too.
    expect(getExportFilename('Already.xmd', 'docx')).toBe('Already.docx');
  });

  it('ensures the destination carries .xmd and never a .md suffix alone', () => {
    expect(ensureExportPathExtension('C:\\docs\\Guide', 'xmd')).toBe('C:\\docs\\Guide.xmd');
    expect(ensureExportPathExtension('C:\\docs\\Guide.xmd', 'xmd')).toBe('C:\\docs\\Guide.xmd');
    expect(ensureExportPathExtension('C:\\docs\\Guide.XMD', 'xmd')).toBe('C:\\docs\\Guide.XMD');
    expect(ensureExportPathExtension('browser://Guide', 'xmd')).toBe('browser://Guide.xmd');
    expect(ensureExportPathExtension('browser://Guide.xmd', 'xmd')).toBe('browser://Guide.xmd');
    // A typed source extension is not accepted as-is; `.xmd` is appended so
    // the source markdown file can never be the write target.
    expect(ensureExportPathExtension('C:\\docs\\Guide.md', 'xmd')).toBe(
      'C:\\docs\\Guide.md.xmd'
    );
    expect(ensureExportPathExtension('  C:\\docs\\Guide  ', 'xmd')).toBe('C:\\docs\\Guide.xmd');
    expect(ensureExportPathExtension('', 'xmd')).toBe('');
  });

  it('detects an export destination that would overwrite the source document', () => {
    expect(
      isExportTargetSameAsSource('C:\\Docs\\Guide.md', 'c:/docs/guide.md')
    ).toBe(true);
    expect(
      isExportTargetSameAsSource('C:\\Docs\\Guide.xmd', 'C:\\Docs\\Guide.xmd')
    ).toBe(true);
    expect(
      isExportTargetSameAsSource('C:\\Docs\\Guide.xmd', 'C:\\Docs\\Guide.md')
    ).toBe(false);
    expect(isExportTargetSameAsSource('browser://Guide.xmd', null)).toBe(false);
    expect(isExportTargetSameAsSource('', 'C:\\Docs\\Guide.md')).toBe(false);
    expect(isExportTargetSameAsSource(null, 'C:\\Docs\\Guide.md')).toBe(false);
  });
});

describe('XMD export dialog wiring (native.ts)', () => {
  let mockPrompt: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockPrompt = vi.fn();
    (globalThis as unknown as { window?: unknown }).window = {
      prompt: mockPrompt,
    };
  });

  afterEach(() => {
    delete (globalThis as unknown as { window?: unknown }).window;
    vi.restoreAllMocks();
  });

  it('uses the xmd format and default name, and keeps .xmd for typed names', async () => {
    mockPrompt.mockReturnValue('MyExport');
    const res = await exportFileDialog('xmd', 'MyDoc.md');
    expect(res).toBe('browser://MyExport.xmd');

    // Prompt text advertises XMD and the prefilled default name is `.xmd`.
    expect(mockPrompt).toHaveBeenCalledWith('请输入导出的 XMD 文件名', 'MyDoc.xmd');

    mockPrompt.mockReturnValue('custom-report.xmd');
    await expect(exportFileDialog('xmd', 'MyDoc.xmd')).resolves.toBe(
      'browser://custom-report.xmd'
    );

    // Typing a Markdown name replaces the source extension instead of
    // producing `notes.md.xmd`.
    mockPrompt.mockReturnValue('notes.md');
    await expect(exportFileDialog('xmd', 'MyDoc.md')).resolves.toBe('browser://notes.xmd');

    // Uppercase extension is preserved.
    mockPrompt.mockReturnValue('notes.XMD');
    await expect(exportFileDialog('xmd', 'MyDoc.md')).resolves.toBe('browser://notes.XMD');
  });

  it('returns null when the user cancels the xmd dialog', async () => {
    mockPrompt.mockReturnValue(null);
    await expect(exportFileDialog('xmd', 'MyDoc.md')).resolves.toBeNull();
  });

  it('writes .xmd bundles with the application/vnd.xmd+zip MIME type', async () => {
    let createdBlob: Blob | null = null;
    let downloadedName = '';

    const originalURL = (globalThis as unknown as { URL?: unknown }).URL;
    const originalDocument = (globalThis as unknown as { document?: unknown }).document;

    const mockCreateObjectURL = vi.fn((blob: Blob) => {
      createdBlob = blob;
      return 'blob:http://localhost/xmd';
    });
    const mockRevokeObjectURL = vi.fn();

    (globalThis as unknown as { URL?: unknown }).URL = {
      createObjectURL: mockCreateObjectURL,
      revokeObjectURL: mockRevokeObjectURL,
    };
    (globalThis as unknown as { document?: unknown }).document = {
      createElement: vi.fn(() => ({
        href: '',
        download: '',
        click: vi.fn(),
      })),
      body: {
        appendChild: vi.fn((el: { download: string }) => {
          downloadedName = el.download;
        }),
        removeChild: vi.fn(),
      },
    };

    try {
      const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00, 0x01]);
      await writeBinaryFile('browser://我的文档.xmd', bytes);

      expect(XMD_MIME_TYPE).toBe('application/vnd.xmd+zip');
      expect(mockCreateObjectURL).toHaveBeenCalledTimes(1);
      expect(createdBlob).not.toBeNull();
      expect((createdBlob as unknown as Blob).type).toBe('application/vnd.xmd+zip');
      expect(downloadedName).toBe('我的文档.xmd');
      expect(mockRevokeObjectURL).toHaveBeenCalled();
    } finally {
      (globalThis as unknown as { URL?: unknown }).URL = originalURL;
      (globalThis as unknown as { document?: unknown }).document = originalDocument;
    }
  });
});

describe('Remote image fetching for XMD bundles (native.ts)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('rejects non-http(s) and empty URLs before any network access', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchXmdImage('')).rejects.toThrow(/为空/);
    await expect(fetchXmdImage('javascript:alert(1)')).rejects.toThrow(/无效|不支持/);
    await expect(fetchXmdImage('file:///C:/secret.png')).rejects.toThrow(/无效|不支持/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fetches remote images without credentials or referrer in Web mode', async () => {
    const payload = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: { get: (name: string) => (name === 'content-type' ? 'image/png' : null) },
      arrayBuffer: async () => payload.buffer,
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchXmdImage('https://example.com/assets/logo.png');

    expect(result.contentType).toBe('image/png');
    expect(result.data).toBeInstanceOf(Uint8Array);
    expect(Array.from(result.data)).toEqual(Array.from(payload));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [calledUrl, init] = fetchMock.mock.calls[0];
    expect(calledUrl).toBe('https://example.com/assets/logo.png');
    expect(init).toMatchObject({ credentials: 'omit', referrerPolicy: 'no-referrer' });
  });

  it('throws when the remote server answers with a failure status', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        headers: { get: () => null },
        arrayBuffer: async () => new ArrayBuffer(0),
      })
    );

    await expect(fetchXmdImage('https://example.com/missing.png')).rejects.toThrow(/404/);
  });
});

describe('XMD export menu item wiring (TitleBar.tsx / App.tsx / locales)', () => {
  const baseProps = {
    viewMode: 'split' as const,
    onSetViewMode: vi.fn(),
    theme: 'system' as const,
    onSetTheme: vi.fn(),
    isSidebarOpen: true,
    onToggleSidebar: vi.fn(),
    onNew: vi.fn(),
    onOpen: vi.fn(),
    onSave: vi.fn(),
    onSaveAs: vi.fn(),
    onExportWord: vi.fn(),
    onExportPdf: vi.fn(),
    onExportHtml: vi.fn(),
    onExportXmd: vi.fn(),
    onCopyRichText: vi.fn(),
    onOpenShortcuts: vi.fn(),
    onOpenSettings: vi.fn(),
  };

  const activeTab: DocumentTab = {
    id: 'tab-xmd',
    title: 'Guide.md',
    filePath: 'C:\\docs\\Guide.md',
    content: '# Guide',
    savedContent: '# Guide',
    isDirty: false,
    cursorLine: 1,
    cursorCol: 1,
  };

  it('renders the export button and reports XMD as the active export type', () => {
    const html = renderToStaticMarkup(
      <I18nProvider language="zh-CN">
        <TitleBar {...baseProps} activeTab={activeTab} isExporting exportingType="xmd" />
      </I18nProvider>
    );

    expect(html).toContain('aria-label="导出为 Word、PDF、HTML 或 XMD 文档"');
    expect(html).toContain('title="正在导出 XMD..."');
  });

  it('exposes the XMD menu entry and App wires the hook result into TitleBar', () => {
    const titleBarSource = readFileSync(
      resolve(__dirname, '../src/components/TitleBar.tsx'),
      'utf-8'
    );
    expect(titleBarSource).toContain('onExportXmd');
    expect(titleBarSource).toContain('<ExportMenu');
    const exportMenuSource = readFileSync(resolve(__dirname, '../src/components/titleBar/ExportMenu.tsx'), 'utf-8');
    expect(exportMenuSource).toContain("t('titleBar.exportXmd')");
    expect(exportMenuSource).toContain("t('titleBar.exportXmdDesc')");
    expect(exportMenuSource).toContain('FileArchive');

    const appSource = readFileSync(resolve(__dirname, '../src/App.tsx'), 'utf-8');
    expect(appSource).toContain('exportXmd');
    expect(appSource).toContain('onExportXmd={exportXmd}');
  });

  it('provides localized XMD labels and toasts in both locales', () => {
    expect(t('zh-CN', 'titleBar.exportXmd')).toContain('XMD');
    expect(t('zh-CN', 'titleBar.exportXmdDesc')).toContain('Markdown + 资源包');
    expect(t('zh-CN', 'titleBar.exportFormatsTooltip')).toContain('XMD');
    expect(t('zh-CN', 'toasts.exportingXmd')).toContain('XMD');
    expect(t('zh-CN', 'toasts.xmdExportSuccess', { path: 'C:\\out.xmd' })).toContain(
      'C:\\out.xmd'
    );
    expect(t('zh-CN', 'toasts.xmdExportFailed', { error: 'boom' })).toContain('boom');
    expect(t('zh-CN', 'toasts.xmdSourceOverwriteBlocked')).not.toBe(
      'toasts.xmdSourceOverwriteBlocked'
    );

    expect(t('en-US', 'titleBar.exportXmd')).toContain('XMD');
    expect(t('en-US', 'titleBar.exportXmdDesc')).toContain('Markdown');
    expect(t('en-US', 'titleBar.exportFormatsTooltip')).toContain('XMD');
    expect(t('en-US', 'toasts.exportingXmd')).toContain('XMD');
    expect(t('en-US', 'toasts.xmdExportFailed', { error: 'boom' })).toContain('boom');
    expect(t('en-US', 'toasts.xmdSourceOverwriteBlocked')).not.toBe(
      'toasts.xmdSourceOverwriteBlocked'
    );
  });
});

describe('XMD raw native IPC (read_xmd_resource / write_xmd_file)', () => {
  const originalWindow = (globalThis as unknown as { window?: unknown }).window;

  const enterTauri = () => {
    (globalThis as unknown as { window?: unknown }).window = {
      __TAURI_INTERNALS__: {},
    };
  };

  const leaveTauri = () => {
    (globalThis as unknown as { window?: unknown }).window = originalWindow;
  };

  beforeEach(() => {
    invokeMock.mockReset();
    enterTauri();
  });

  afterEach(() => {
    leaveTauri();
    vi.restoreAllMocks();
  });

  it('reads XMD resources through read_xmd_resource and returns raw bytes', async () => {
    const payload = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    invokeMock.mockResolvedValue(payload.buffer);

    const bytes = await readXmdResource('C:\\docs\\assets\\图 1.png');

    expect(invokeMock).toHaveBeenCalledWith('read_xmd_resource', {
      path: 'C:\\docs\\assets\\图 1.png',
    });
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(Array.from(bytes)).toEqual(Array.from(payload));
  });

  it('propagates native read failures (e.g. the 32 MiB pre-check) instead of returning empty data', async () => {
    invokeMock.mockRejectedValue('图片超过 32 MiB / Image exceeds 32 MiB');

    await expect(readXmdResource('C:\\huge.png')).rejects.toThrow(/32 MiB/);
    expect(invokeMock).toHaveBeenCalledWith('read_xmd_resource', { path: 'C:\\huge.png' });
  });

  it('fails fast in Web mode without invoking the native command', async () => {
    leaveTauri();

    await expect(readXmdResource('C:\\docs\\a.png')).rejects.toThrow(/Web 浏览器环境|不支持/);
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it('writes .xmd through write_xmd_file using a LE u32 length-prefixed path frame', async () => {
    invokeMock.mockResolvedValue(undefined);
    const path = 'C:\\out\\我的文档.xmd';
    const zip = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0xff]);

    await writeBinaryFile(path, zip);

    expect(invokeMock).toHaveBeenCalledTimes(1);
    const [command, frame] = invokeMock.mock.calls[0];
    expect(command).toBe('write_xmd_file');
    expect(frame).toBeInstanceOf(Uint8Array);

    const pathBytes = new TextEncoder().encode(path);
    const frameBytes = frame as Uint8Array;
    expect(frameBytes.length).toBe(4 + pathBytes.length + zip.length);

    // 4-byte little-endian UTF-8 path length.
    const declaredLength = new DataView(
      frameBytes.buffer,
      frameBytes.byteOffset,
      frameBytes.byteLength
    ).getUint32(0, true);
    expect(declaredLength).toBe(pathBytes.length);

    // UTF-8 path, then the untouched ZIP bytes.
    expect(Array.from(frameBytes.subarray(4, 4 + pathBytes.length))).toEqual(
      Array.from(pathBytes)
    );
    expect(Array.from(frameBytes.subarray(4 + pathBytes.length))).toEqual(Array.from(zip));
  });

  it('frames upper-case .XMD and bare number[] payloads identically', async () => {
    invokeMock.mockResolvedValue(undefined);

    await writeBinaryFile('C:\\out\\UPPER.XMD', [1, 2, 3]);

    const [command, frame] = invokeMock.mock.calls[0];
    expect(command).toBe('write_xmd_file');
    const pathBytes = new TextEncoder().encode('C:\\out\\UPPER.XMD');
    const frameBytes = frame as Uint8Array;
    expect(
      new DataView(frameBytes.buffer, frameBytes.byteOffset, frameBytes.byteLength).getUint32(
        0,
        true
      )
    ).toBe(pathBytes.length);
    expect(Array.from(frameBytes.subarray(4 + pathBytes.length))).toEqual([1, 2, 3]);
  });

  it('keeps the existing write_binary_file JSON path for non-xmd formats', async () => {
    invokeMock.mockResolvedValue(undefined);
    const docx = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);

    await writeBinaryFile('C:\\out\\Doc.docx', docx);
    await writeBinaryFile('C:\\out\\Report.pdf', [9, 8, 7]);

    expect(invokeMock).toHaveBeenNthCalledWith(1, 'write_binary_file', {
      path: 'C:\\out\\Doc.docx',
      data: [0x50, 0x4b, 0x03, 0x04],
    });
    expect(invokeMock).toHaveBeenNthCalledWith(2, 'write_binary_file', {
      path: 'C:\\out\\Report.pdf',
      data: [9, 8, 7],
    });
  });

  it('surfaces write_xmd_file failures as a save error', async () => {
    invokeMock.mockRejectedValue('磁盘已满 / Disk full');

    await expect(writeBinaryFile('C:\\out\\Doc.xmd', new Uint8Array([1]))).rejects.toThrow(
      /磁盘已满|Disk full/
    );
  });
});
