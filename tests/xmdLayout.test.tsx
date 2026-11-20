import JSZip from 'jszip';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Preview } from '../src/components/Preview';
import { I18nProvider } from '../src/i18n';
import { DEFAULT_EXPORT_STYLE } from '../src/lib/exportStyle';
import { buildStandaloneHtml } from '../src/lib/export/htmlExporter';
import { exportMarkdownToDocx } from '../src/lib/export/docxExporter';
import { exportMarkdownToXmd } from '../src/lib/export/xmdExporter';
import { importXmd } from '../src/lib/xmd';
import { hasXmdPageBreak, planXmdPageBreak, readXmdDocumentTheme, setXmdDocumentTheme, XMD_PAGE_BREAK } from '../src/lib/xmdLayout';
import { documentRequiresXmd } from '../src/lib/xmdSaveFormat';

const theme = { ...DEFAULT_EXPORT_STYLE, fontFamily: 'serif' as const, fontSize: 19, headerText: 'A --> <B' };

describe('XMD document layout', () => {
  it('stores the validated theme after front matter and preserves the surrounding Markdown on removal', () => {
    const original = '\ufeff---\r\ntitle: Example\r\n---\r\n\r\n# Heading\r\n\r\nText';
    const marked = setXmdDocumentTheme(original, theme);
    expect(marked).toMatch(/^\ufeff---\r\ntitle: Example\r\n---\r\n\r\n<!-- xmd:document-theme /);
    expect(marked).not.toContain(theme.headerText);
    expect(readXmdDocumentTheme(marked)).toEqual(theme);
    expect(documentRequiresXmd(marked)).toBe(true);
    expect(setXmdDocumentTheme(marked)).toBe(original);
  });

  it('inserts pagination outside a fenced code block and retains the complete original block', () => {
    const fence = String.fromCharCode(96).repeat(3);
    const original = '# Before\n\n' + fence + 'js\nconsole.log(1);\n' + fence;
    const plan = planXmdPageBreak(original, original.indexOf('log'));
    expect(plan).toEqual({ from: '# Before\n\n'.length, insert: XMD_PAGE_BREAK + '\n\n' });
    const marked = original.slice(0, plan!.from) + plan!.insert + original.slice(plan!.from);
    expect(marked).toContain(XMD_PAGE_BREAK + '\n\n' + fence + 'js\nconsole.log(1);\n' + fence);
    expect(hasXmdPageBreak(marked)).toBe(true);
  });

  it('treats literal examples and ordinary Markdown as ordinary documents', async () => {
    const fence = String.fromCharCode(96).repeat(3);
    const examples = fence + 'markdown\n' + XMD_PAGE_BREAK + '\n' + fence + '\n\n---\n\nText';
    expect(documentRequiresXmd(examples)).toBe(false);
    expect(await buildStandaloneHtml(examples)).not.toContain('<div class="xmd-page-break">');
    expect(documentRequiresXmd('# Heading\n\n> Quote\n\n<!-- ordinary comment -->')).toBe(false);
  });

  it('survives XMD save/open and exports the stored theme and page breaks', async () => {
    const markdown = setXmdDocumentTheme('# First\n\n' + XMD_PAGE_BREAK + '\n\n# Second', theme);
    const reopened = await importXmd(await exportMarkdownToXmd(markdown, 'Example.xmd'));
    expect(reopened).toBe(markdown);
    const html = await buildStandaloneHtml(reopened);
    expect(html).toContain('<div class="xmd-page-break"></div>');
    expect(html).toContain('break-after: page');
    expect(html).toMatch(/font-size:\s*19px/);
    expect(html).not.toContain('xmd:document-theme');
    const docx = await JSZip.loadAsync(await exportMarkdownToDocx(reopened, 'Example'));
    const document = await docx.file('word/document.xml')!.async('string');
    expect(document).toContain('<w:br w:type="page"/>');
    const preview = renderToStaticMarkup(
      <I18nProvider language="zh-CN"><Preview content={reopened} /></I18nProvider>,
    );
    expect(preview).toContain('aria-label="分页符"');
    expect(preview).not.toContain('xmd:document-theme');
  });
});
