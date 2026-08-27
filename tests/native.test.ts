import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  isValidExternalUrl,
  openExternalUrl,
  exportFileDialog,
  writeBinaryFile,
  exportPdfFromHtml,
  drainPendingOpenFiles,
  subscribeOpenFiles,
  openWindowsDefaultAppsSettings,
} from '../src/lib/native';

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
    });

    it('should keep extension if user entered it', async () => {
      mockPrompt.mockReturnValue('custom-report.pdf');
      const res = await exportFileDialog('pdf', 'custom-report.pdf');
      expect(res).toBe('browser://custom-report.pdf');
    });

    it('should return null when user cancels prompt', async () => {
      mockPrompt.mockReturnValue(null);
      const res = await exportFileDialog('docx', 'MyDoc.md');
      expect(res).toBeNull();
    });
  });

  describe('writeBinaryFile (Web fallback mode)', () => {
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
});
