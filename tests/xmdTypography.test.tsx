import { history, undo } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { EditorState, Transaction, type TransactionSpec } from '@codemirror/state';
import JSZip from 'jszip';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Preview } from '../src/components/Preview';
import { I18nProvider } from '../src/i18n';
import { editorMarkdownFallbacks } from '../src/lib/editorMarkdown';
import { applyXmdTypographyEdit, getXmdTypographyEdit } from '../src/lib/editorXmdTypography';
import { buildStandaloneHtml } from '../src/lib/export/htmlExporter';
import { exportMarkdownToDocx } from '../src/lib/export/docxExporter';
import { buildRichTextHtml } from '../src/lib/export/richText';
import { exportMarkdownToXmd } from '../src/lib/export/xmdExporter';
import { importXmd } from '../src/lib/xmd';

const styled = '<xmd-style font="宋体" size="18.5" color="#b91c1c">**重要条款**</xmd-style>';
const backtick = String.fromCharCode(96);

function render(source: string, renderHtml = false): string {
  return renderToStaticMarkup(
    <I18nProvider language="zh-CN">
      <Preview content={source} renderHtml={renderHtml} />
    </I18nProvider>
  );
}

const editorExtensions = [markdown({ base: markdownLanguage, extensions: editorMarkdownFallbacks }), history()];

describe('XMD typography', () => {
  it('renders only validated inline styles with either HTML setting without affecting literal code', () => {
    const malformed = '<xmd-style font="Arial;color:red" size="9999" onclick="bad()">原文</xmd-style>';
    const source = ['# ' + styled, '', malformed, '', '示例：' + backtick + styled + backtick].join('\n');
    for (const renderHtml of [false, true]) {
      const html = render(source, renderHtml);
      expect(html).toContain('font-family:&quot;宋体&quot;;font-size:18.5pt;color:#b91c1c');
      expect(html).toContain('<strong>重要条款</strong></span>');
      expect(html).toContain('原文');
      expect(html).toContain('&lt;xmd-style');
      expect(html.match(/font-size:18.5pt/g)).toHaveLength(1);
      expect(html).not.toContain('font-size:9999pt');
      expect(html).not.toMatch(/<[^>]+\sonclick=/i);
    }
  });

  it('uses one undo step and allows editing or removing the style without rewriting Markdown', () => {
    const document = '# 标题\n\n待复核 **重要条款**。';
    const start = document.indexOf('**');
    let state = EditorState.create({ doc: document, selection: { anchor: start, head: start + '**重要条款**'.length }, extensions: editorExtensions });
    const view = {
      get state() { return state; },
      dispatch(spec: TransactionSpec | Transaction) { state = spec instanceof Transaction ? spec.state : state.update(spec).state; },
    };
    const edit = getXmdTypographyEdit(state);
    expect(edit).not.toBeNull();
    expect(applyXmdTypographyEdit(view, edit!, { font: '宋体', size: 18.5, color: '#b91c1c' })).toBe(true);
    expect(state.doc.toString()).toBe('# 标题\n\n待复核 ' + styled + '。');
    const existing = getXmdTypographyEdit(state);
    expect(existing?.style).toEqual({ font: '宋体', size: 18.5, color: '#b91c1c' });
    expect(existing?.existing).toBe(true);
    expect(applyXmdTypographyEdit(view, existing!, { size: 12 })).toBe(true);
    expect(state.doc.toString()).toContain('<xmd-style size="12">**重要条款**</xmd-style>');
    expect(applyXmdTypographyEdit(view, existing!, {})).toBe(false);
    expect(applyXmdTypographyEdit(view, getXmdTypographyEdit(state)!, {})).toBe(true);
    expect(state.doc.toString()).toBe(document);
    expect(undo(view)).toBe(true);
    expect(state.doc.toString()).toContain('<xmd-style size="12">**重要条款**</xmd-style>');
  });

  it('leaves fenced code and Markdown block markers outside the editor operation', () => {
    const fence = backtick.repeat(3);
    for (const source of ['# Title', fence + 'js\nconst a = 1;\n' + fence, 'line one\nline two']) {
      const state = EditorState.create({
        doc: source, selection: { anchor: 0, head: source.length }, extensions: editorExtensions,
      });
      expect(getXmdTypographyEdit(state)).toBeNull();
    }
  });

  it('round-trips through the XMD archive and exports the corresponding HTML and Word styles', async () => {
    const source = '注意 ' + styled + '。\n\n![图](data:image/png;base64,iVBORw0KGgo=)';
    expect(await importXmd(await exportMarkdownToXmd(source, '带样式.xmd'))).toBe(source);
    const html = await buildStandaloneHtml(source, '带样式');
    const clipboard = await buildRichTextHtml(source);
    for (const output of [html, clipboard]) {
      expect(output).toContain('font-size:18.5pt;color:#b91c1c');
      expect(output).toContain('<strong>重要条款</strong></span>');
      expect(output).not.toContain('data-xmd-font');
    }
    const docx = await JSZip.loadAsync(await exportMarkdownToDocx(source, '带样式'));
    const xml = await docx.file('word/document.xml')!.async('string');
    const run = xml.match(/<w:r><w:rPr>((?:(?!<\/w:rPr>).)*)<\/w:rPr><w:t[^>]*>重要条款<\/w:t><\/w:r>/)?.[1];
    expect(run).toContain('w:ascii="宋体"');
    expect(run).toMatch(/<w:color w:val="b91c1c"\/>/i);
    expect(run).toContain('<w:sz w:val="37"/>');
    expect(run).toContain('<w:b/>');
  });
});
