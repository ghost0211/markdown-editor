import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nProvider } from '../src/i18n';
import { useDocumentResources } from '../src/hooks/useDocumentResources';

const native = vi.hoisted(() => ({
  fetchXmdImage: vi.fn(), getFileSize: vi.fn(), isTauri: vi.fn(() => true),
  readXmdResource: vi.fn(), saveResourceDialog: vi.fn(), showInFolder: vi.fn(), writeResourceFile: vi.fn(), settleCreatedResourceFiles: vi.fn(),
}));
vi.mock('@/lib/native', () => native);
vi.mock('@/lib/export/xmdExporter', async (original) => ({ ...await original<typeof import('@/lib/export/xmdExporter')>() }));

const data = 'data:image/png;base64,iVBORw0KGgo=';
function createHook(path: string | null = 'C:\\docs\\note.md', markdown = `![a](<${data}>)`) {
  const updateContent = vi.fn();
  const showToast = vi.fn();
  let current: ReturnType<typeof useDocumentResources> | undefined;
  function Probe() {
    current = useDocumentResources({ documentId: 'doc-1', document: markdown, sourceFilePath: path, enabled: true, updateContent, showToast });
    return null;
  }
  renderToStaticMarkup(<I18nProvider language="zh-CN"><Probe /></I18nProvider>);
  if (!current) throw new Error('Hook not captured');
  return { hook: current, updateContent, showToast };
}

beforeEach(() => {
  vi.clearAllMocks(); native.isTauri.mockReturnValue(true);
  native.saveResourceDialog.mockResolvedValue('C:\\exports\\pic.png');
  native.readXmdResource.mockResolvedValue(Uint8Array.of(1, 2, 3));
  native.writeResourceFile.mockResolvedValue('receipt-1');
  native.settleCreatedResourceFiles.mockResolvedValue(undefined);
});

describe('resource manager operations', () => {
  it('converts an embedded image to a new local asset without flattening Markdown', async () => {
    const { hook, updateContent, showToast } = createHook();
    expect(hook.canConvert).toBe(true);
    expect(hook.resources[0].location).toBe('embedded');
    await hook.convertResource(hook.resources[0]);
    expect(native.writeResourceFile).toHaveBeenCalledOnce();
    const [path, bytes] = native.writeResourceFile.mock.calls[0];
    expect(path).toMatch(/^C:\/docs\/assets\/pasted-.*\.png$/);
    expect(Array.from(bytes)).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    const [id, markdown] = updateContent.mock.calls[0];
    expect(id).toBe('doc-1');
    expect(markdown).toMatch(/^!\[a]\(<assets\/pasted-.*\.png>\)$/);
    expect(showToast.mock.calls.at(-1)?.[0]).toContain('请保存文档');
  });

  it('does not externalize XMD resources or write assets for unsaved documents', async () => {
    const xmd = createHook('C:\\docs\\bundle.xmd');
    expect(xmd.hook.canConvert).toBe(false);
    expect(xmd.hook.convertReason).toContain('XMD');
    await xmd.hook.convertResource(xmd.hook.resources[0]);
    expect(native.writeResourceFile).not.toHaveBeenCalled();
    const unsaved = createHook(null);
    expect(unsaved.hook.convertReason).toContain('保存');
    await unsaved.hook.convertAll();
    expect(native.writeResourceFile).not.toHaveBeenCalled();
  });

  it('exports local resources byte-for-byte through the generic save dialog', async () => {
    const { hook } = createHook('C:\\docs\\note.md', '![a](assets/a.png)');
    expect(hook.resources[0]).toMatchObject({ localPath: 'C:/docs/assets/a.png', status: 'loading' });
    await hook.exportResource(hook.resources[0]);
    expect(native.saveResourceDialog).toHaveBeenCalledWith('a.png');
    expect(native.readXmdResource).toHaveBeenCalledWith('C:/docs/assets/a.png');
    expect(native.writeResourceFile).toHaveBeenCalledWith('C:\\exports\\pic.png', Uint8Array.of(1, 2, 3));
  });

  it('exports embedded attachments without Markdown conversion and honors cancel', async () => {
    const { hook } = createHook(null, '[PDF](data:application/pdf;base64,JVBERg==)');
    await hook.exportResource(hook.resources[0]);
    expect(native.saveResourceDialog).toHaveBeenCalledWith(expect.stringContaining('resource'));
    expect(native.writeResourceFile).toHaveBeenCalledWith(expect.any(String), new TextEncoder().encode('%PDF'));
    native.writeResourceFile.mockClear(); native.saveResourceDialog.mockResolvedValue(null);
    await hook.exportResource(hook.resources[0]);
    expect(native.writeResourceFile).not.toHaveBeenCalled();
  });

  it('reports export and conversion failures without changing content', async () => {
    const { hook, updateContent, showToast } = createHook();
    native.writeResourceFile.mockRejectedValue(new Error('Disk full'));
    await hook.convertResource(hook.resources[0]);
    expect(updateContent).not.toHaveBeenCalled();
    expect(showToast.mock.calls.at(-1)?.[0]).toContain('Disk full');
  });

  it('preserves TIFF media type and does not rewrite an attachment with the same data URL', async () => {
    const tiff = 'data:image/tiff;base64,SUkqAA==';
    const { hook, updateContent } = createHook('C:\\docs\\note.md', `![image](<${tiff}>)\n[attachment](<${tiff}>)`);
    await hook.convertResource(hook.resources[0]);
    expect(native.writeResourceFile.mock.calls[0][0]).toMatch(/\.tiff$/);
    expect(updateContent.mock.calls[0][1]).toContain(`[attachment](<${tiff}>)`);
    expect(native.settleCreatedResourceFiles).toHaveBeenCalledWith(['receipt-1'], false);
  });

  it('rolls back created resources if a later write fails without changing the document', async () => {
    const { hook, updateContent } = createHook('C:\\docs\\note.md', `![one](<${data}>)\n![two](data:image/png;base64,AAAA)`);
    native.writeResourceFile.mockResolvedValueOnce('first').mockRejectedValueOnce(new Error('Disk full'));
    await hook.convertAll();
    expect(updateContent).not.toHaveBeenCalled();
    expect(native.settleCreatedResourceFiles).toHaveBeenCalledWith(['first'], true);
  });

  it('does not attempt to export expired temporary resources', async () => {
    const { hook, showToast } = createHook(null, '![a](blob:https://example.com/id)');
    await hook.exportResource(hook.resources[0]);
    expect(native.writeResourceFile).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith(expect.stringContaining('临时'), 'error');
  });
});
