import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import JSZip from 'jszip';
import { buildStandaloneHtml } from '../src/lib/export/htmlExporter';
import { exportMarkdownToDocx } from '../src/lib/export/docxExporter';
import { exportMarkdownToPdf } from '../src/lib/export/pdfExporter';
import {
  DEFAULT_EXPORT_STYLE,
  validateExportStyle,
  type ExportStyle,
} from '../src/lib/exportStyle';
import {
  DEFAULT_SETTINGS,
  SETTINGS_STORAGE_KEY,
  loadSettings,
  saveSettings,
  validateSettings,
} from '../src/lib/settings';

const exportPdfFromHtmlMock = vi.hoisted(() =>
  vi.fn(async (_path: string, _html: string, _showHeaderFooter = false) => undefined)
);
const invokeMock = vi.hoisted(() =>
  vi.fn(async (_command: string, _args?: unknown) => undefined)
);

vi.mock('../src/lib/native', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/native')>();
  return { ...actual, exportPdfFromHtml: exportPdfFromHtmlMock };
});
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn() }));

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

const THEMED_STYLE: ExportStyle = {
  fontFamily: 'serif',
  fontSize: 18,
  colorScheme: 'sepia',
  cover: true,
  toc: true,
  headerText: '机密 <b>页眉</b>',
  pageNumbers: true,
};

beforeEach(() => {
  exportPdfFromHtmlMock.mockClear();
  invokeMock.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('HTML export style integration', () => {
  it('keeps the legacy body/font and adds no cover, TOC, header, or footer by default', async () => {
    const html = await buildStandaloneHtml('# 标题\n\n正文', '默认文档', { lang: 'zh-CN' });

    expect(html).toContain('--export-font-size: 15px;');
    expect(html).toContain('--export-bg: #ffffff;');
    expect(html).toContain('--export-text: #1e293b;');
    expect(html).toContain('Microsoft YaHei');
    expect(html).not.toContain('<header class="export-header">');
    expect(html).not.toContain('<section class="export-cover"');
    expect(html).not.toContain('<nav class="export-toc"');
    expect(html).not.toContain('<footer class="export-page-footer"');
    expect(html).not.toMatch(/<h1 id="/);
  });

  it('renders the selected font, size, palette, escaped cover/header, and a real anchored TOC', async () => {
    const markdown = [
      '# 第一章 概述',
      '',
      '正文 **加粗**。',
      '',
      '## 第一节 细节',
      '',
      '<script>alert("xss")</script>',
      '',
      '### 更深一层的标题',
    ].join('\n');
    const html = await buildStandaloneHtml(markdown, '季度 "报告" <script>', {
      lang: 'zh-CN',
      style: THEMED_STYLE,
    });

    // Actual fixed palette/font/size values, not a no-op style.
    expect(html).toContain('--export-font: Georgia');
    expect(html).toContain('--export-font-size: 18px;');
    expect(html).toContain('--export-bg: #f4ecd8;');
    expect(html).toContain('--export-text: #3b2f2f;');
    expect(html).toContain('--export-heading: #2b2118;');

    // Cover with escaped title and a date, plus page break.
    expect(html).toContain('<section class="export-cover"');
    expect(html).toContain('季度 &quot;报告&quot; &lt;script&gt;');
    expect(html).toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(html).toContain('page-break-after: always;');

    // Plain-text header, escaped rather than injected as markup.
    expect(html).toContain('<header class="export-header">机密 &lt;b&gt;页眉&lt;/b&gt;</header>');
    expect(html).not.toContain('<header class="export-header">机密 <b>');

    // TOC uses real ids produced by rehype-slug and links to them.
    expect(html).toContain('<nav class="export-toc" aria-label="目录">');
    expect(html).toContain('目录');
    expect(html).toMatch(/<h1 id="[^"]+">/);
    const h1Id = html.match(/<h1 id="([^"]+)">/)?.[1];
    const h2Id = html.match(/<h2 id="([^"]+)">/)?.[1];
    expect(h1Id).toBeTruthy();
    expect(h2Id).toBeTruthy();
    expect(html).toContain(`href="#${h1Id}"`);
    expect(html).toContain(`href="#${h2Id}"`);
    expect(html).toContain('第一章 概述');
    expect(html).toContain('第一节 细节');
    expect(html).toContain('export-toc-level-3');

    // Markdown raw script is still stripped; the TOC itself has no script.
    expect(html).not.toContain('<script>alert');

    // HTML print footer is real; page counter is progressive enhancement.
    expect(html).toContain('<footer class="export-page-footer"');
    expect(html).toContain('content: attr(data-label) " " counter(page);');
  });

  it('ignores invalid style values and does not emit an empty TOC', async () => {
    const html = await buildStandaloneHtml('没有标题的正文', 'Doc', {
      lang: 'en-US',
      style: {
        ...DEFAULT_EXPORT_STYLE,
        fontFamily: 'comic' as never,
        fontSize: 200,
        colorScheme: 'neon' as never,
        toc: true,
      },
    });

    expect(html).toContain('--export-font-size: 20px;');
    expect(html).toContain('--export-bg: #ffffff;');
    expect(html).toContain('--export-font: -apple-system');
    expect(html).not.toContain('<nav class="export-toc"');
  });
});

describe('Word export style integration', () => {
  it('keeps the legacy footer/font and emits no cover, TOC, or header when style is omitted', async () => {
    const bytes = await exportMarkdownToDocx('# 第一章\n\n正文', '传统文档', 'zh-CN');
    const zip = await JSZip.loadAsync(bytes);
    const docXml = await zip.file('word/document.xml')!.async('string');
    const stylesXml = await zip.file('word/styles.xml')!.async('string');

    expect(stylesXml).toContain('Microsoft YaHei');
    expect(stylesXml).toMatch(/w:sz w:val="22"/);
    expect(stylesXml).toContain('1E293B');
    expect(zip.file('word/footer1.xml')).not.toBeNull();
    expect(zip.file('word/header1.xml')).toBeNull();
    expect(docXml).not.toContain('TOC');
    expect(docXml).not.toContain('目录');
    expect(docXml).not.toContain('w:type="page"');
  });

  it('writes a real TOC field, Word header, cover page break, custom font/size/colors, and no footer when disabled', async () => {
    const style: ExportStyle = {
      fontFamily: 'serif',
      fontSize: 20,
      colorScheme: 'dark',
      cover: true,
      toc: true,
      headerText: '机密 <script>alert(1)</script>',
      pageNumbers: false,
    };
    const bytes = await exportMarkdownToDocx(
      '# 第一章 概述\n\n正文 **加粗**\n\n## 第一节',
      '报告 <script>alert(2)</script>',
      'zh-CN',
      style
    );
    const zip = await JSZip.loadAsync(bytes);
    const docXml = await zip.file('word/document.xml')!.async('string');
    const stylesXml = await zip.file('word/styles.xml')!.async('string');

    // Theme derived from the fixed palette, not a no-op.
    expect(stylesXml).toContain('SimSun');
    expect(stylesXml).toMatch(/w:sz w:val="30"/);
    expect(stylesXml).toContain('E2E8F0');

    // Cover title/date and page break.
    expect(docXml).toContain('报告');
    expect(docXml).toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(docXml).toContain('w:type="page"');

    // Real Word TOC field and localized label.
    expect(docXml).toContain('目录');
    expect(docXml).toContain('TOC');
    expect(docXml).toContain('w:instrText');

    // Real Word header, XML-escaped, never raw HTML.
    const headerName = Object.keys(zip.files).find(
      (name) => name.startsWith('word/header') && name.endsWith('.xml')
    );
    expect(headerName).toBeTruthy();
    const headerXml = await zip.file(headerName!)!.async('string');
    expect(headerXml).toContain('机密');
    expect(headerXml).toContain('&lt;script&gt;');
    expect(headerXml).not.toContain('<script>');

    // Explicit pageNumbers=false removes the footer entirely.
    expect(
      Object.keys(zip.files).some(
        (name) => name.startsWith('word/footer') && name.endsWith('.xml')
      )
    ).toBe(false);

    expect(docXml).not.toContain('<script>');
  });

  it('keeps the page-number footer when an explicit style enables pageNumbers', async () => {
    const bytes = await exportMarkdownToDocx('# 标题', '页脚文档', 'en-US', {
      ...DEFAULT_EXPORT_STYLE,
      pageNumbers: true,
    });
    const zip = await JSZip.loadAsync(bytes);
    const footerName = Object.keys(zip.files).find(
      (name) => name.startsWith('word/footer') && name.endsWith('.xml')
    );
    expect(footerName).toBeTruthy();
    const footerXml = await zip.file(footerName!)!.async('string');
    expect(footerXml).toContain('PAGE');
    expect(footerXml).toContain('NUMPAGES');
  });

  it('uses the English Contents label for the TOC', async () => {
    const bytes = await exportMarkdownToDocx('# Heading', 'Doc', 'en-US', {
      ...DEFAULT_EXPORT_STYLE,
      toc: true,
    });
    const zip = await JSZip.loadAsync(bytes);
    const docXml = await zip.file('word/document.xml')!.async('string');
    expect(docXml).toContain('Contents');
    expect(docXml).not.toContain('目录');
  });
});

describe('PDF export style integration', () => {
  it('passes pageNumbers=true to Edge native header/footer and strips HTML-only header/footer', async () => {
    await exportMarkdownToPdf(
      '# 标题\n\n## 小节',
      'PDF 文档',
      'C:\\exports\\styled.pdf',
      undefined,
      'zh-CN',
      {
        ...THEMED_STYLE,
        headerText: '只用于 HTML/Word 的页眉',
        pageNumbers: true,
      }
    );

    expect(exportPdfFromHtmlMock).toHaveBeenCalledTimes(1);
    const [path, html, showHeaderFooter] = exportPdfFromHtmlMock.mock.calls[0];
    expect(path).toBe('C:\\exports\\styled.pdf');
    expect(showHeaderFooter).toBe(true);
    expect(html).toContain('--export-bg: #f4ecd8;');
    expect(html).toContain('<section class="export-cover"');
    expect(html).toContain('<nav class="export-toc"');
    expect(html).toContain('href="#');
    expect(html).not.toContain('<header class="export-header"');
    expect(html).not.toContain('只用于 HTML/Word 的页眉');
    expect(html).not.toContain('<footer class="export-page-footer"');
  });

  it('keeps legacy PDF behavior when style is omitted or pageNumbers is false', async () => {
    await exportMarkdownToPdf('# 标题', 'Legacy', 'C:\\legacy.pdf');
    expect(exportPdfFromHtmlMock).toHaveBeenLastCalledWith(
      'C:\\legacy.pdf',
      expect.stringContaining('<!DOCTYPE html>'),
      false
    );
    expect(exportPdfFromHtmlMock.mock.calls[0][1]).not.toContain('<section class="export-cover"');

    await exportMarkdownToPdf('# 标题', 'No numbers', 'C:\\plain.pdf', undefined, 'en-US', {
      ...DEFAULT_EXPORT_STYLE,
      pageNumbers: false,
    });
    expect(exportPdfFromHtmlMock).toHaveBeenLastCalledWith(
      'C:\\plain.pdf',
      expect.stringContaining('<!DOCTYPE html>'),
      false
    );
  });
});

describe('Native PDF option wiring', () => {
  it('forwards showHeaderFooter (default false) to the Tauri command', async () => {
    const native = await vi.importActual<typeof import('../src/lib/native')>('../src/lib/native');
    vi.stubGlobal('window', { __TAURI_INTERNALS__: {} });

    await native.exportPdfFromHtml('C:\\a.pdf', '<html>a</html>', true);
    expect(invokeMock).toHaveBeenLastCalledWith('export_pdf_from_html', {
      path: 'C:\\a.pdf',
      html: '<html>a</html>',
      showHeaderFooter: true,
    });

    await native.exportPdfFromHtml('C:\\b.pdf', '<html>b</html>');
    expect(invokeMock).toHaveBeenLastCalledWith('export_pdf_from_html', {
      path: 'C:\\b.pdf',
      html: '<html>b</html>',
      showHeaderFooter: false,
    });
  });
});

describe('Settings exportStyle persistence', () => {
  it('keeps old settings undefined and validates a provided style', () => {
    expect(validateSettings({}).exportStyle).toBeUndefined();
    expect(validateSettings({ ...DEFAULT_SETTINGS }).exportStyle).toBeUndefined();

    const provided = validateSettings({
      ...DEFAULT_SETTINGS,
      exportStyle: { ...THEMED_STYLE, fontSize: 999, fontFamily: 'bad' },
    });
    expect(provided.exportStyle).toEqual({
      ...THEMED_STYLE,
      fontFamily: 'system',
      fontSize: 20,
    });

    const malformed = validateSettings({
      ...DEFAULT_SETTINGS,
      exportStyle: 'not-an-object' as unknown as ExportStyle,
    });
    expect(malformed.exportStyle).toEqual(DEFAULT_EXPORT_STYLE);
  });

  it('round-trips exportStyle through saveSettings/loadSettings', () => {
    const storage = createMemoryStorage();
    vi.stubGlobal('localStorage', storage);

    const style = validateExportStyle({ ...THEMED_STYLE, fontSize: 16 });
    saveSettings({ ...DEFAULT_SETTINGS, exportStyle: style });

    const raw = storage.getItem(SETTINGS_STORAGE_KEY);
    expect(raw).toBeTruthy();
    expect(JSON.parse(raw!).exportStyle).toEqual(style);
    expect(loadSettings().exportStyle).toEqual(style);

    saveSettings(DEFAULT_SETTINGS);
    expect(JSON.parse(storage.getItem(SETTINGS_STORAGE_KEY)!).exportStyle).toBeUndefined();
  });
});
