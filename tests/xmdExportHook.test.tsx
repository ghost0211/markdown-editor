import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nProvider } from '../src/i18n';
import { DocumentTab, ToastType } from '../src/types';
import type { UseExportDocumentResult } from '../src/hooks/useExportDocument';
import { useExportDocument } from '../src/hooks/useExportDocument';
import { exportFileDialog, writeBinaryFile } from '../src/lib/native';
import { exportMarkdownToXmd } from '../src/lib/export/xmdExporter';

vi.mock('../src/lib/native', () => ({
  exportFileDialog: vi.fn(),
  writeBinaryFile: vi.fn(),
}));

vi.mock('@/lib/export/xmdExporter', () => ({
  exportMarkdownToXmd: vi.fn(),
}));

const mockedExportFileDialog = vi.mocked(exportFileDialog);
const mockedWriteBinaryFile = vi.mocked(writeBinaryFile);
const mockedExportMarkdownToXmd = vi.mocked(exportMarkdownToXmd);

interface ProbeProps {
  tab: DocumentTab | undefined;
  showToast: (message: string, type?: ToastType, duration?: number) => string;
}

/**
 * The hook is exercised through `react-dom/server`: a probe component captures
 * its returned API, then the captured `exportXmd` callback is invoked. State
 * setters are no-ops server-side, which is fine because this test verifies the
 * dialog/exporter/write/toast contract rather than the loading spinner itself.
 */
function renderExportHook(props: ProbeProps): UseExportDocumentResult {
  let captured: UseExportDocumentResult | undefined;

  const Probe = ({ tab, showToast }: ProbeProps) => {
    captured = useExportDocument(tab, showToast);
    return null;
  };

  renderToStaticMarkup(
    <I18nProvider language="zh-CN">
      <Probe tab={props.tab} showToast={props.showToast} />
    </I18nProvider>
  );

  if (!captured) throw new Error('hook was not captured');
  return captured;
}

describe('useExportDocument — XMD export flow', () => {
  const tab: DocumentTab = {
    id: 'tab-xmd-flow',
    title: 'Guide.md',
    filePath: 'C:\\docs\\Guide.md',
    content: '# Guide\n\n![logo](./assets/logo.png)',
    savedContent: '# Guide\n\n![logo](./assets/logo.png)',
    isDirty: false,
    cursorLine: 1,
    cursorCol: 1,
  };

  let showToast: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    showToast = vi.fn(() => 'toast-id');
  });

  it('exports through the xmd dialog and binary writer with success feedback', async () => {
    const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);
    mockedExportFileDialog.mockResolvedValue('C:\\out\\Guide.xmd');
    mockedExportMarkdownToXmd.mockResolvedValue(bytes);
    mockedWriteBinaryFile.mockResolvedValue(undefined);

    const hook = renderExportHook({ tab, showToast });
    await hook.exportXmd();

    expect(mockedExportFileDialog).toHaveBeenCalledWith('xmd', 'Guide.xmd');
    expect(mockedExportMarkdownToXmd).toHaveBeenCalledWith(tab.content, 'Guide.md', {
      sourceFilePath: 'C:\\docs\\Guide.md',
    });
    expect(mockedWriteBinaryFile).toHaveBeenCalledWith('C:\\out\\Guide.xmd', bytes);

    const messages = showToast.mock.calls.map((call) => String(call[0]));
    expect(messages.some((msg) => msg.includes('正在打包 XMD'))).toBe(true);
    const successCall = showToast.mock.calls.find((call) => call[1] === 'success');
    expect(successCall).toBeDefined();
    expect(String(successCall?.[0])).toContain('C:\\out\\Guide.xmd');
    expect(showToast.mock.calls.some((call) => call[1] === 'error')).toBe(false);
  });

  it('treats a cancelled dialog as a no-op (no package, no write, no toast)', async () => {
    mockedExportFileDialog.mockResolvedValue(null);

    const hook = renderExportHook({ tab, showToast });
    await hook.exportXmd();

    expect(mockedExportFileDialog).toHaveBeenCalledWith('xmd', 'Guide.xmd');
    expect(mockedExportMarkdownToXmd).not.toHaveBeenCalled();
    expect(mockedWriteBinaryFile).not.toHaveBeenCalled();
    expect(showToast).not.toHaveBeenCalled();
  });

  it('surfaces packaging failures (e.g. a missing image) as an explicit error toast', async () => {
    mockedExportFileDialog.mockResolvedValue('C:\\out\\Guide.xmd');
    mockedExportMarkdownToXmd.mockRejectedValue(new Error('无法读取图片 ./assets/logo.png'));

    const hook = renderExportHook({ tab, showToast });
    await hook.exportXmd();

    expect(mockedWriteBinaryFile).not.toHaveBeenCalled();
    const errorCall = showToast.mock.calls.find((call) => call[1] === 'error');
    expect(errorCall).toBeDefined();
    expect(String(errorCall?.[0])).toContain('导出 XMD 失败');
    expect(String(errorCall?.[0])).toContain('无法读取图片');
  });

  it('refuses to write the bundle over the source document path', async () => {
    mockedExportFileDialog.mockResolvedValue('C:\\docs\\Guide.xmd');
    const xmdSourceTab: DocumentTab = { ...tab, title: 'Guide.xmd', filePath: 'C:\\docs\\Guide.xmd' };

    const hook = renderExportHook({ tab: xmdSourceTab, showToast });
    await hook.exportXmd();

    expect(mockedExportMarkdownToXmd).not.toHaveBeenCalled();
    expect(mockedWriteBinaryFile).not.toHaveBeenCalled();
    const errorCall = showToast.mock.calls.find((call) => call[1] === 'error');
    expect(errorCall).toBeDefined();
    expect(String(errorCall?.[0])).toContain('覆盖原文');
  });

  it('normalizes a dialog path without an extension to .xmd before writing', async () => {
    mockedExportFileDialog.mockResolvedValue('C:\\out\\Guide');
    mockedExportMarkdownToXmd.mockResolvedValue(new Uint8Array([1, 2, 3]));
    mockedWriteBinaryFile.mockResolvedValue(undefined);

    const hook = renderExportHook({ tab, showToast });
    await hook.exportXmd();

    expect(mockedWriteBinaryFile).toHaveBeenCalledWith(
      'C:\\out\\Guide.xmd',
      expect.any(Uint8Array)
    );
  });

  it('does nothing when no document is active', async () => {
    const hook = renderExportHook({ tab: undefined, showToast });
    await hook.exportXmd();

    expect(mockedExportFileDialog).not.toHaveBeenCalled();
    expect(showToast).not.toHaveBeenCalled();
  });
});
