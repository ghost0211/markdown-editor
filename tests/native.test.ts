import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  isValidExternalUrl,
  openExternalUrl,
  saveFileDialog,
  exportFileDialog,
  writeBinaryFile,
  writeTextFile,
  writeHtmlFile,
  readTextFile,
  exportPdfFromHtml,
  drainPendingOpenFiles,
  subscribeOpenFiles,
  openWindowsDefaultAppsSettings,
} from '../src/lib/native';
import { SETTINGS_STORAGE_KEY } from '../src/lib/settings';

describe('External URL Security (native.ts)', () => {
  describe('isValidExternalUrl', () => {
    it('should allow valid HTTPS and HTTP URLs', () => {
      expect(isValidExternalUrl('https://example.com')).toBe(true);
      expect(isValidExternalUrl('https://github.com/tauri-apps/tauri')).toBe(true);
      expect(isValidExternalUrl('http://localhost:5173')).toBe(true);
      expect(isValidExternalUrl('http://127.0.0.1:8080/path?query=1#hash')).toBe(true);
    });

    it('should allow valid mailto: links', () => {
      expect(isValidExternalUrl('mailto:developer@example.com')).toBe(true);
      expect(isValidExternalUrl('mailto:support@test.org?subject=Feedback&body=Hello')).toBe(true);
    });

    it('should strictly reject dangerous and unauthorized protocols', () => {
      expect(isValidExternalUrl('javascript:alert(1)')).toBe(false);
      expect(isValidExternalUrl('javascript:void(0)')).toBe(false);
      expect(isValidExternalUrl('data:text/html,<script>alert(1)</script>')).toBe(false);
      expect(isValidExternalUrl('file:///C:/Windows/System32/cmd.exe')).toBe(false);
      expect(isValidExternalUrl('file:///etc/passwd')).toBe(false);
      expect(isValidExternalUrl('blob:http://localhost:5173/1234-5678')).toBe(false);
      expect(isValidExternalUrl('ftp://ftp.example.com/download')).toBe(false);
      expect(isValidExternalUrl('ssh://root@example.com')).toBe(false);
      expect(isValidExternalUrl('powershell:calc.exe')).toBe(false);
      expect(isValidExternalUrl('vbscript:msgbox(1)')).toBe(false);
    });

    it('should reject malformed or empty URLs', () => {
      expect(isValidExternalUrl('')).toBe(false);
      expect(isValidExternalUrl('   ')).toBe(false);
      expect(isValidExternalUrl(null)).toBe(false);
      expect(isValidExternalUrl(undefined)).toBe(false);
      expect(isValidExternalUrl('not-a-valid-url')).toBe(false);
      expect(isValidExternalUrl('https://\u0000bad.com')).toBe(false);
    });
  });

  describe('openExternalUrl security execution', () => {
    let mockOpen: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      mockOpen = vi.fn();
      (globalThis as unknown as { window?: unknown }).window = {
        open: mockOpen,
      };
    });

    afterEach(() => {
      delete (globalThis as unknown as { window?: unknown }).window;
      vi.restoreAllMocks();
    });

    it('should throw error and NEVER call window.open for dangerous protocol', async () => {
      await expect(openExternalUrl('javascript:alert("hacked")')).rejects.toThrow(
        /不支持或不安全的链接协议/
      );
      expect(mockOpen).not.toHaveBeenCalled();
    });

    it('should throw error and NEVER call window.open for file: protocol', async () => {
      await expect(openExternalUrl('file:///C:/secrets.txt')).rejects.toThrow(
        /不支持或不安全的链接协议/
      );
      expect(mockOpen).not.toHaveBeenCalled();
    });

    it('should open verified HTTPS URL via window.open in browser mode', async () => {
      await openExternalUrl('https://example.com/docs');
      expect(mockOpen).toHaveBeenCalledWith('https://example.com/docs', '_blank', 'noopener,noreferrer');
    });

    it('should open verified mailto URL via window.open in browser mode', async () => {
      await openExternalUrl('mailto:info@example.com');
      expect(mockOpen).toHaveBeenCalledWith('mailto:info@example.com', '_blank', 'noopener,noreferrer');
    });
  });
});

describe('Native Export Wrappers (native.ts)', () => {
  describe('exportFileDialog (Web fallback mode)', () => {
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

    it('should prompt user and return browser:// path with format extension', async () => {
      mockPrompt.mockReturnValue('MyExportDoc');
      const res = await exportFileDialog('docx', 'MyDoc.md');
      expect(mockPrompt).toHaveBeenCalled();
      expect(res).toBe('browser://MyExportDoc.docx');

      mockPrompt.mockReturnValue('WebPage');
      const htmlRes = await exportFileDialog('html', 'MyDoc.md');
      expect(htmlRes).toBe('browser://WebPage.html');
    });

    it('should keep extension if user entered it', async () => {
      mockPrompt.mockReturnValue('custom-report.pdf');
      const res = await exportFileDialog('pdf', 'custom-report.pdf');
      expect(res).toBe('browser://custom-report.pdf');

      mockPrompt.mockReturnValue('custom-doc.html');
      const htmlRes = await exportFileDialog('html', 'custom-doc.html');
      expect(htmlRes).toBe('browser://custom-doc.html');
    });

    it('should return null when user cancels prompt', async () => {
      mockPrompt.mockReturnValue(null);
      const res = await exportFileDialog('docx', 'MyDoc.md');
      expect(res).toBeNull();
    });
  });

  describe('writeBinaryFile and writeHtmlFile (Web fallback mode)', () => {
    let mockCreateObjectURL: ReturnType<typeof vi.fn>;
    let mockRevokeObjectURL: ReturnType<typeof vi.fn>;
    let appendedElement: HTMLAnchorElement | null = null;
    let clicked = false;

    beforeEach(() => {
      mockCreateObjectURL = vi.fn().mockReturnValue('blob:http://localhost:5173/mock-blob-url');
      mockRevokeObjectURL = vi.fn();
      clicked = false;
      appendedElement = null;

      (globalThis as unknown as { URL?: unknown }).URL = {
        createObjectURL: mockCreateObjectURL,
        revokeObjectURL: mockRevokeObjectURL,
      };

      const mockBody = {
        appendChild: vi.fn((el: unknown) => {
          appendedElement = el as HTMLAnchorElement;
        }),
        removeChild: vi.fn(),
      };

      const mockDocument = {
        createElement: vi.fn((tag: string) => {
          if (tag === 'a') {
            const anchor = {
              href: '',
              download: '',
              click: vi.fn(() => {
                clicked = true;
              }),
            };
            return anchor;
          }
          return {};
        }),
        body: mockBody,
      };

      (globalThis as unknown as { document?: unknown }).document = mockDocument;
    });

    afterEach(() => {
      delete (globalThis as unknown as { URL?: unknown }).URL;
      delete (globalThis as unknown as { document?: unknown }).document;
      vi.restoreAllMocks();
    });

    it('should trigger browser download for Uint8Array binary file', async () => {
      const data = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);
      await writeBinaryFile('browser://test.docx', data);

      expect(mockCreateObjectURL).toHaveBeenCalled();
      expect(clicked).toBe(true);
      expect(appendedElement?.download).toBe('test.docx');
      expect(mockRevokeObjectURL).toHaveBeenCalled();
    });

    it('should trigger browser download for HTML file via writeHtmlFile with correct MIME type and Unicode round-trip', async () => {
      const unicodeHtml = `<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="utf-8"><title>中文测试 🚀</title></head>
<body>
<h1>你好，世界！</h1>
<p>这是包含特殊字符 &lt;&gt;&amp;&quot;&#39; 和 Unicode 表情 🚀 的 HTML 内容。</p>
</body>
</html>`;

      await writeHtmlFile('browser://测试页面.html', unicodeHtml);

      expect(mockCreateObjectURL).toHaveBeenCalledTimes(1);
      const passedBlob = mockCreateObjectURL.mock.calls[0][0];

      expect(passedBlob).toBeInstanceOf(Blob);
      expect(passedBlob.type).toBe('text/html;charset=utf-8');

      const extractedText = await (passedBlob as Blob).text();
      expect(extractedText).toBe(unicodeHtml);

      expect(clicked).toBe(true);
      expect(appendedElement?.download).toBe('测试页面.html');
      expect(mockRevokeObjectURL).toHaveBeenCalledWith('blob:http://localhost:5173/mock-blob-url');
    });

    it('should trigger browser download with text/html MIME when writeTextFile receives .html path and preserve Unicode content', async () => {
      const htmlContent = '<!DOCTYPE html><html><body><h1>文档导出 🚀</h1></body></html>';
      await writeTextFile('browser://export.html', htmlContent);

      expect(mockCreateObjectURL).toHaveBeenCalledTimes(1);
      const passedBlob = mockCreateObjectURL.mock.calls[0][0];

      expect(passedBlob).toBeInstanceOf(Blob);
      expect(passedBlob.type).toBe('text/html;charset=utf-8');

      const extractedText = await (passedBlob as Blob).text();
      expect(extractedText).toBe(htmlContent);

      expect(clicked).toBe(true);
      expect(appendedElement?.download).toBe('export.html');
      expect(mockRevokeObjectURL).toHaveBeenCalled();
    });
  });

  describe('exportPdfFromHtml (Web fallback mode)', () => {
    let mockPrint: ReturnType<typeof vi.fn>;
    let mockOpen: ReturnType<typeof vi.fn>;
    let mockDocOpen: ReturnType<typeof vi.fn>;
    let mockDocWrite: ReturnType<typeof vi.fn>;
    let mockDocClose: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      mockPrint = vi.fn();
      mockDocOpen = vi.fn();
      mockDocWrite = vi.fn();
      mockDocClose = vi.fn();

      const mockPrintWin = {
        document: {
          open: mockDocOpen,
          write: mockDocWrite,
          close: mockDocClose,
        },
        focus: vi.fn(),
        print: mockPrint,
      };

      mockOpen = vi.fn().mockReturnValue(mockPrintWin);

      (globalThis as unknown as { window?: unknown }).window = {
        open: mockOpen,
      };
    });

    afterEach(() => {
      delete (globalThis as unknown as { window?: unknown }).window;
      vi.restoreAllMocks();
    });

    it('should open print window and write HTML for browser printing', async () => {
      await exportPdfFromHtml('browser://report.pdf', '<html><body>Test PDF</body></html>');

      expect(mockOpen).toHaveBeenCalledWith('', '_blank');
      expect(mockDocWrite).toHaveBeenCalledWith('<html><body>Test PDF</body></html>');
      expect(mockDocClose).toHaveBeenCalled();
    });
  });

  describe('File Association & Startup Event Wrappers (native.ts)', () => {
    it('drainPendingOpenFiles should return empty array in browser mode', async () => {
      const result = await drainPendingOpenFiles();
      expect(Array.isArray(result)).toBe(true);
      expect(result).toEqual([]);
    });

    it('subscribeOpenFiles should return a no-op unlisten function in browser mode without error', async () => {
      const callback = vi.fn();
      const unlisten = await subscribeOpenFiles(callback);
      expect(typeof unlisten).toBe('function');
      expect(() => unlisten()).not.toThrow();
      expect(callback).not.toHaveBeenCalled();
    });

    it('openWindowsDefaultAppsSettings should throw friendly error in browser mode', async () => {
      await expect(openWindowsDefaultAppsSettings()).rejects.toThrow(
        /Web 浏览器环境.*仅在 Windows 桌面应用中支持/
      );
    });
  });

  describe('Localized Fallback Prompts & Error Messages (zh-CN & en-US)', () => {
    let mockPrompt: ReturnType<typeof vi.fn>;
    let storageMock: Record<string, string> = {};

    beforeEach(() => {
      mockPrompt = vi.fn();
      (globalThis as unknown as { window?: unknown }).window = {
        prompt: mockPrompt,
      };

      storageMock = {};
      const mockStorage = {
        getItem: vi.fn((key: string) => storageMock[key] ?? null),
        setItem: vi.fn((key: string, value: string) => {
          storageMock[key] = String(value);
        }),
        removeItem: vi.fn((key: string) => {
          delete storageMock[key];
        }),
        clear: vi.fn(() => {
          storageMock = {};
        }),
      };

      Object.defineProperty(globalThis, 'localStorage', {
        value: mockStorage,
        writable: true,
        configurable: true,
      });
    });

    afterEach(() => {
      delete (globalThis as unknown as { window?: unknown }).window;
      delete (globalThis as unknown as { localStorage?: unknown }).localStorage;
      vi.restoreAllMocks();
    });

    it('should localize prompts in English when language is en-US', async () => {
      storageMock[SETTINGS_STORAGE_KEY] = JSON.stringify({ language: 'en-US' });

      mockPrompt.mockReturnValue('MyDocument.md');
      await saveFileDialog();
      expect(mockPrompt).toHaveBeenCalledWith(
        'Please enter a file name to save',
        'Untitled.md'
      );

      mockPrompt.mockReturnValue('MyExport');
      await exportFileDialog('pdf');
      expect(mockPrompt).toHaveBeenCalledWith(
        'Please enter a file name for PDF export',
        'Untitled.pdf'
      );

      mockPrompt.mockReturnValue('MyHtmlExport');
      await exportFileDialog('html');
      expect(mockPrompt).toHaveBeenCalledWith(
        'Please enter a file name for HTML export',
        'Untitled.html'
      );
    });

    it('should localize prompts in Chinese when language is zh-CN', async () => {
      storageMock[SETTINGS_STORAGE_KEY] = JSON.stringify({ language: 'zh-CN' });

      mockPrompt.mockReturnValue('我的文档.md');
      await saveFileDialog();
      expect(mockPrompt).toHaveBeenCalledWith(
        '请输入保存的文件名',
        '未命名文档.md'
      );

      mockPrompt.mockReturnValue('导出文件');
      await exportFileDialog('docx');
      expect(mockPrompt).toHaveBeenCalledWith(
        '请输入导出的 DOCX 文件名',
        '未命名.docx'
      );

      mockPrompt.mockReturnValue('导出网页');
      await exportFileDialog('html');
      expect(mockPrompt).toHaveBeenCalledWith(
        '请输入导出的 HTML 文件名',
        '未命名.html'
      );
    });

    it('should localize read and settings errors in English when language is en-US', async () => {
      storageMock[SETTINGS_STORAGE_KEY] = JSON.stringify({ language: 'en-US' });

      await expect(readTextFile('C:/test.md')).rejects.toThrow(
        /Web browser environment does not support reading local files directly by path/
      );

      await expect(openWindowsDefaultAppsSettings()).rejects.toThrow(
        /Currently in Web browser environment/
      );

      await expect(openExternalUrl('ftp://example.com')).rejects.toThrow(
        /Unsupported or unsafe link protocol/
      );
    });
  });
});
