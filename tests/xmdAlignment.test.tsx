import { history, undo } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { ensureSyntaxTree } from '@codemirror/language';
import { EditorState, Transaction, type Range, type TransactionSpec } from '@codemirror/state';
import type { Decoration } from '@codemirror/view';
import JSZip from 'jszip';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Preview } from '../src/components/Preview';
import { I18nProvider } from '../src/i18n';
import { editorMarkdownFallbacks } from '../src/lib/editorMarkdown';
import { applyEditorXmdAlignment, getEditorXmdAlignment } from '../src/lib/editorXmdAlignment';
import { exportMarkdownToDocx } from '../src/lib/export/docxExporter';
import { buildPrintableHtml } from '../src/lib/export/pdfExporter';
import { buildRichTextHtml } from '../src/lib/export/richText';
import { exportMarkdownToXmd } from '../src/lib/export/xmdExporter';
import { buildVisualDecorations, createVisualEditingExtension } from '../src/lib/visualEditing';
import { importXmd } from '../src/lib/xmd';
import { documentRequiresXmd } from '../src/lib/xmdSaveFormat';

function editorFor(doc: string, anchor: number, head = anchor) {
  let state = EditorState.create({
    doc,
    selection: { anchor, head },
    extensions: [
      markdown({ base: markdownLanguage, extensions: editorMarkdownFallbacks }),
      history(),
      createVisualEditingExtension({ taskToggle: '', imageEdit: '', imageLoading: '', imageFailed: '' }),
    ],
  });
  const prepare = (next: EditorState) => {
    ensureSyntaxTree(next, next.doc.length, 1000);
    return next.update({}).state;
  };
  state = prepare(state);
  return {
    get state() { return state; },
    dispatch(spec: TransactionSpec | Transaction) {
      state = prepare(spec instanceof Transaction ? spec.state : state.update(spec).state);
    },
  };
}

describe('XMD paragraph alignment', () => {
  it('aligns headings and paragraphs in one undoable edit and restores their exact source with left alignment', () => {
    const original = '# Title ###\n\n**Text**  \ncontinues  \n\nSubheading\n----------\n\nNext paragraph';
    const editor = editorFor(original, original.indexOf('Next'), 3);
    expect(getEditorXmdAlignment(editor.state)).toBe('left');
    expect(applyEditorXmdAlignment(editor, 'center')).toBe(true);
    const centered = '# Title <!-- xmd:align:center --> ###\n\n**Text**  \ncontinues <!-- xmd:align:center -->  \n\nSubheading <!-- xmd:align:center -->\n----------\n\nNext paragraph';
    expect(editor.state.doc.toString()).toBe(centered);
    expect(editor.state.selection.main.head).toBe(3);
    expect(editor.state.selection.main.anchor).toBe(centered.indexOf('Next'));
    expect(getEditorXmdAlignment(editor.state)).toBe('center');
    expect(applyEditorXmdAlignment(editor, 'center')).toBe(false);
    expect(applyEditorXmdAlignment(editor, 'right')).toBe(true);
    expect(editor.state.doc.toString()).toBe(centered.replaceAll('align:center', 'align:right'));
    expect(undo(editor)).toBe(true);
    expect(editor.state.doc.toString()).toBe(centered);
    expect(undo(editor)).toBe(true);
    expect(editor.state.doc.toString()).toBe(original);
    expect(applyEditorXmdAlignment(editor, 'justify')).toBe(true);
    expect(documentRequiresXmd(editor.state.doc.toString())).toBe(true);
    expect(applyEditorXmdAlignment(editor, 'left')).toBe(true);
    expect(editor.state.doc.toString()).toBe(original);
    expect(documentRequiresXmd(editor.state.doc.toString())).toBe(false);
  });

  it('decorates each editor line and hides the alignment metadata while the text is selected', () => {
    const source = 'First line\nSecond line <!-- xmd:align:justify -->';
    const { state } = editorFor(source, 0, source.length);
    const markers: Range<Decoration>[] = [];
    const lines = new Map<number, string>();
    buildVisualDecorations({ state, visibleRanges: [{ from: 0, to: source.length }] }, markers)
      .between(0, source.length, (from, _to, decoration) => {
        if (decoration.spec.class) lines.set(from, decoration.spec.class);
      });
    expect(lines.get(0)).toBe('cm-xmd-align-justify cm-xmd-align-continue');
    expect(lines.get(source.indexOf('Second'))).toBe('cm-xmd-align-justify');
    expect(markers.map(({ from, to }) => source.slice(from, to))).toEqual([' <!-- xmd:align:justify -->']);
  });

  it('keeps ordinary Markdown and examples in their original format', () => {
    const comment = '<!-- xmd:align:right -->';
    const fence = '~'.repeat(3);
    const code = String.fromCharCode(96);
    const original = ['# Title', 'Normal <!-- comment -->', comment, '> Quote ' + comment, '- List ' + comment,
      fence + '\n' + comment + '\n' + fence, 'Example ' + code + comment + code, 'Invalid <!-- xmd:align:middle -->'].join('\n\n');
    expect(documentRequiresXmd(original)).toBe(false);
    const editor = editorFor(original, original.indexOf('Quote'));
    expect(getEditorXmdAlignment(editor.state)).toBeUndefined();
    expect(applyEditorXmdAlignment(editor, 'right')).toBe(false);
    expect(editor.state.doc.toString()).toBe(original);
  });

  it('uses the caret line when the cursor is in heading indentation or trailing whitespace', () => {
    const original = '  ## Title ###  ';
    for (const cursor of [0, original.length]) {
      const editor = editorFor(original, cursor);
      expect(applyEditorXmdAlignment(editor, 'center')).toBe(true);
      expect(editor.state.doc.toString()).toBe('  ## Title <!-- xmd:align:center --> ###  ');
    }
  });

  it('round-trips through XMD and preserves alignment in preview, HTML, PDF, rich text and Word', async () => {
    const source = '# Title <!-- xmd:align:center --> ###\n\nRight **text** <!-- xmd:align:right -->\n\nJustified text <!-- xmd:align:justify -->\n\nDefault';
    const reopened = await importXmd(await exportMarkdownToXmd(source, 'Alignment.xmd'));
    expect(reopened).toBe(source);
    for (const renderHtml of [false, true]) {
      const html = renderToStaticMarkup(
        <I18nProvider language="zh-CN"><Preview content={reopened} renderHtml={renderHtml} /></I18nProvider>,
      );
      expect(html).toMatch(/<h1[^>]+style="text-align:center"[^>]*>Title<\/h1>/);
      expect(html).toMatch(/<p[^>]+style="text-align:right"[^>]*>Right <strong>text<\/strong><\/p>/);
      expect(html).toMatch(/<p[^>]+style="text-align:justify"[^>]*>Justified text<\/p>/);
      expect(html).not.toContain('xmd:align');
    }
    for (const html of [await buildPrintableHtml(reopened), await buildRichTextHtml(reopened)]) {
      expect(html).toMatch(/<h1[^>]+style="[^"]*text-align:center"[^>]*>Title<\/h1>/);
      expect(html).toMatch(/<p[^>]+style="[^"]*text-align:right"[^>]*>Right <strong>text<\/strong><\/p>/);
      expect(html).toMatch(/<p[^>]+style="[^"]*text-align:justify"[^>]*>Justified text<\/p>/);
      expect(html).not.toContain('xmd:align');
    }
    const docx = await JSZip.loadAsync(await exportMarkdownToDocx(reopened, 'Alignment'));
    const xml = await docx.file('word/document.xml')!.async('string');
    expect([...xml.matchAll(/<w:jc w:val="([^"]+)"/g)].map((match) => match[1])).toEqual(['center', 'right', 'both']);
  });
});
