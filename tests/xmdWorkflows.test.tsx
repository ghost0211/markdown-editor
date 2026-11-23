import { history, undo } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { ensureSyntaxTree } from '@codemirror/language';
import { EditorState, Transaction, type TransactionSpec } from '@codemirror/state';
import JSZip from 'jszip';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Preview } from '../src/components/Preview';
import { quickOpenEntries } from '../src/components/QuickOpenDialog';
import { I18nProvider } from '../src/i18n';
import { createDefaultTab } from '../src/lib/documentUtils';
import { editorMarkdownFallbacks } from '../src/lib/editorMarkdown';
import { applyEditorXmdParagraph } from '../src/lib/editorXmdAlignment';
import { exportMarkdownToDocx } from '../src/lib/export/docxExporter';
import { buildPrintableHtml } from '../src/lib/export/pdfExporter';
import { buildRichTextHtml } from '../src/lib/export/richText';
import { exportMarkdownToXmd } from '../src/lib/export/xmdExporter';
import { setVisualTableLayout, insertVisualTableColumn, deleteVisualTableColumn } from '../src/lib/visualTableCommands';
import { collectVisualTables } from '../src/lib/visualTableModel';
import { importXmd } from '../src/lib/xmd';
import { readXmdDocumentTheme, setXmdDocumentTheme } from '../src/lib/xmdLayout';
import { DEFAULT_EXPORT_STYLE } from '../src/lib/exportStyle';
import { xmdParagraphMarker } from '../src/lib/xmdParagraph';
import { locateXmdReview, makeXmdReview, readXmdReviews, stripXmdReviews, writeXmdReview } from '../src/lib/xmdReview';
import { documentRequiresXmd } from '../src/lib/xmdSaveFormat';
import { xmdTableMarker } from '../src/lib/xmdTable';

function editorFor(doc: string, to = 0) {
  function prepare(state: EditorState) {
    ensureSyntaxTree(state, state.doc.length, 1000);
    return state.update({}).state;
  }
  let state = prepare(EditorState.create({
    doc, selection: { anchor: 0, head: to },
    extensions: [markdown({ base: markdownLanguage, extensions: editorMarkdownFallbacks }), history()],
  }));
  return {
    get state() { return state; },
    dispatch(spec: TransactionSpec | Transaction) {
      state = prepare(spec instanceof Transaction ? spec.state : state.update(spec).state);
    },
  };
}

const plainTable = '| Field | Value |\n| --- | --- |\n| One | Two |';
const style = { font: 'Microsoft YaHei', size: 13, color: '#112233', before: 3, after: 8, indent: 18, lineHeight: 1.5 };
const layout = { widths: [1, 3], vertical: 'bottom', repeatHeader: true } as const;

describe('XMD document workflows', () => {
  it('applies paragraph style and alignment to multiple text blocks in one transaction', () => {
    const source = '# Title ###\n\nParagraph **example**\n\n' + plainTable;
    const editor = editorFor(source, source.length);
    expect(applyEditorXmdParagraph(editor, style, 'center')).toBe(true);
    const styled = editor.state.doc.toString();
    expect(styled.split('xmd:paragraph ').length).toBe(3);
    expect(styled.split('xmd:align:center').length).toBe(3);
    expect(styled).toMatch(/ --> ###/);
    expect(styled.endsWith(plainTable)).toBe(true);
    expect(documentRequiresXmd(styled)).toBe(true);
    expect(undo(editor)).toBe(true);
    expect(editor.state.doc.toString()).toBe(source);
    expect(documentRequiresXmd(source)).toBe(false);
  });

  it('stores review notes next to metadata, relocates quoted text, and removes the note without editing the body', () => {
    const original = setXmdDocumentTheme('---\ntitle: Sample\n---\n\n# Title\n\nUnique text\n\n~~~js\nunclosed', DEFAULT_EXPORT_STYLE);
    const from = original.indexOf('Unique');
    const note = makeXmdReview(original, from, from + 'Unique text'.length, 'Draft --> <tag>');
    expect(note).toBeDefined();
    const annotated = writeXmdReview(original, note!.id, note);
    expect(annotated).not.toContain('Draft -->');
    expect(readXmdReviews(annotated)).toEqual([note]);
    expect(readXmdDocumentTheme(annotated)).toEqual(DEFAULT_EXPORT_STYLE);
    expect(annotated.endsWith('~~~js\nunclosed')).toBe(true);
    const moved = annotated.replace('\n# Title\n', '\n# Updated title\n');
    const located = locateXmdReview(moved, note!);
    expect(moved.slice(located?.from, located?.to)).toBe('Unique text');
    const edited = moved.slice(0, located!.from) + 'Edited text' + moved.slice(located!.to);
    expect(locateXmdReview(edited, note!)).toBeUndefined();
    const resolved = writeXmdReview(annotated, note!.id, { ...note!, resolved: true });
    expect(readXmdReviews(resolved)[0].resolved).toBe(true);
    expect(writeXmdReview(resolved, note!.id)).toBe(original);
    expect(stripXmdReviews(resolved)).not.toContain('xmd:review');
    expect(documentRequiresXmd(writeXmdReview('Unique text', note!.id, note))).toBe(true);
  });

  it('retains the selected occurrence when duplicate text has identical surrounding context', () => {
    const paragraph = 'a'.repeat(30) + ' selected ' + 'b'.repeat(30);
    const source = paragraph + '\n\n' + paragraph;
    const from = source.lastIndexOf('selected');
    const note = makeXmdReview(source, from, from + 8, 'Use the second occurrence')!;
    const marked = writeXmdReview(source, note.id, note);
    const located = locateXmdReview(marked, note);
    expect(located?.from).toBe(marked.lastIndexOf('selected'));
    expect(stripXmdReviews(marked)).toBe(source);
  });

  it('keeps table widths associated with columns when inserting or deleting columns', () => {
    const editor = editorFor(plainTable);
    expect(setVisualTableLayout(editor, 0, { ...layout, widths: [1, 3] }, plainTable)).toBe(true);
    let table = collectVisualTables(editor.state)[0];
    expect(table.layout?.style.widths).toEqual([1, 3]);
    expect(insertVisualTableColumn(editor, table.from, 0, table.source)).toBe(true);
    table = collectVisualTables(editor.state)[0];
    expect(table.layout?.style.widths).toEqual([1, 1, 3]);
    expect(deleteVisualTableColumn(editor, table.from, 1, table.source)).toBe(true);
    table = collectVisualTables(editor.state)[0];
    expect(table.layout?.style.widths).toEqual([1, 3]);
    expect(undo(editor)).toBe(true);
    expect(collectVisualTables(editor.state)[0].layout?.style.widths).toEqual([1, 1, 3]);
  });

  it('round-trips layout and comments in XMD and exports layout without exposing comments', async () => {
    const markdown = 'Styled paragraph ' + xmdParagraphMarker(style) + ' <!-- xmd:align:right -->\n\n' +
      xmdTableMarker({ ...layout, widths: [1, 3] }) + '\n' + plainTable;
    const note = makeXmdReview(markdown, 0, 16, 'Review text 456')!;
    const source = writeXmdReview(markdown, note.id, note);
    expect(await importXmd(await exportMarkdownToXmd(source, 'Example.xmd'))).toBe(source);
    const previews = [false, true].map((renderHtml) =>
      renderToStaticMarkup(<I18nProvider language="zh-CN"><Preview content={source} renderHtml={renderHtml} /></I18nProvider>));
    const html = await buildPrintableHtml(source);
    for (const output of [...previews, html, await buildRichTextHtml(source)]) {
      expect(output).toContain('text-align:right');
      expect(output).toContain('line-height:1.5');
      expect(output).toContain('text-indent:18pt');
      expect(output).toContain('vertical-align:bottom');
      expect(output).toContain('width:25.000%');
      expect(output).toContain('data-xmd-repeat-header="true"');
      expect(output).not.toContain('xmd:review');
      expect(output).not.toContain('Review text 456');
    }
    const zip = await JSZip.loadAsync(await exportMarkdownToDocx(source, 'Example'));
    const doc = await zip.file('word/document.xml')!.async('string');
    expect(doc).toContain('w:firstLine="360"');
    expect(doc).toContain('w:line="360"');
    expect(doc).toContain('w:after="160"');
    expect(doc).toContain('w:val="112233"');
    expect(doc).toContain('<w:gridCol w:w="2250"/>');
    expect(doc).toContain('<w:vAlign w:val="bottom"/>');
    expect(doc).toContain('<w:tblHeader/>');
    expect(doc).not.toContain('Review text 456');
  });

  it('ignores marker examples and leaves Markdown save behavior intact', () => {
    const marker = xmdParagraphMarker(style);
    const table = xmdTableMarker({ ...layout, widths: [1, 3] });
    const note = makeXmdReview('Original', 0, 8, 'Note')!;
    const source = '~~~md\n' + writeXmdReview(marker + '\n' + table + '\n' + plainTable, note.id, note) + '\n~~~';
    expect(documentRequiresXmd(source)).toBe(false);
    expect(readXmdReviews(source)).toEqual([]);
    expect(stripXmdReviews(source)).toBe(source);
  });
});

it('deduplicates Quick Open across workspace, open tabs and recent paths', () => {
  const tab = { ...createDefaultTab('Notes.md'), filePath: 'D:/Team/docs/Notes.md' };
  const entries = quickOpenEntries([tab], [{ name: 'Notes.md', path: 'd:\\Team\\docs\\Notes.md', openedAt: 1 }], {
    root: 'D:/Team',
    truncated: false,
    entries: [
      { kind: 'document', name: 'Notes.md', path: 'docs/Notes.md' },
      { kind: 'document', name: 'New.xmd', path: 'docs/New.xmd' },
      { kind: 'document', name: 'Outside.md', path: '../Outside.md' },
      { kind: 'directory', name: 'docs', path: 'docs' },
    ],
  });
  expect(entries.map((entry) => [entry.name, entry.tabId, entry.detail])).toEqual([
    ['Notes.md', tab.id, 'docs/Notes.md'], ['New.xmd', undefined, 'docs/New.xmd'],
  ]);
});
