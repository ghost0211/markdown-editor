import { describe, it, expect } from 'vitest';
import { EditorState, type TransactionSpec } from '@codemirror/state';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { ensureSyntaxTree } from '@codemirror/language';
import { history, undo, redo } from '@codemirror/commands';
import type { EditorView } from '@codemirror/view';
import { editorMarkdownFallbacks } from '../src/lib/editorMarkdown';
import { collectVisualTables, updateVisualTableCell, insertVisualTableColumn, setVisualTableColumnAlignment } from '../src/lib/visualTable';
import { applySlashCommand } from '../src/lib/slashCommands';
import { buildVisualImageEdit, visualImageTargetAt } from '../src/lib/visualImageCommands';
import { exportMarkdownToXmd } from '../src/lib/export/xmdExporter';
import { importXmdPackage } from '../src/lib/xmd';

// Cross-feature regression: second-phase tools must all edit the same Markdown
// buffer that the existing XMD exporter/importer consumes, never a parallel DOM.
describe('phase two source/XMD integration', () => {
  it('round-trips a table, slash insertion, image alt and attachment without losing bundled bytes', async () => {
    const original = '# Title\n\n| Name | State |\n| --- | --- |\n| item | todo |\n\n![photo](data:image/png;base64,iVBORw0KGgo= "keep")\n\n[file](data:text/plain;base64,aGVsbG8=)\n\n/h2';
    let state = EditorState.create({ doc: original, selection: { anchor: original.length }, extensions: [history(), markdown({ base: markdownLanguage, extensions: editorMarkdownFallbacks })] });
    const view = { get state() { return state; }, dispatch(spec: TransactionSpec) { state = state.update(spec).state; }, focus() {} };
    ensureSyntaxTree(state, state.doc.length, 1000);
    const table = collectVisualTables(state)[0];
    expect(table).toBeDefined();
    expect(updateVisualTableCell(view, table.from, 1, 1, 'done')).toBe(true);
    ensureSyntaxTree(state, state.doc.length, 1000);
    expect(insertVisualTableColumn(view, table.from, 0)).toBe(true);
    ensureSyntaxTree(state, state.doc.length, 1000);
    expect(setVisualTableColumnAlignment(view, table.from, 2, 'center')).toBe(true);
    ensureSyntaxTree(state, state.doc.length, 1000);
    const image = visualImageTargetAt(state, state.doc.toString().indexOf('![photo]') + 2)!;
    state = state.update({ changes: buildVisualImageEdit(state, image, { alt: 'new caption' })!, userEvent: 'input.image' }).state;
    ensureSyntaxTree(state, state.doc.length, 1000);
    state = state.update({ selection: { anchor: state.doc.length } }).state;
    expect(applySlashCommand(view as unknown as EditorView, 'h2', 'en-US')).toBe(true);
    const final = state.doc.toString();
    expect(final).toContain('## Heading');
    expect(final).toContain('![new caption](data:image/png;base64,iVBORw0KGgo= "keep")');
    expect(final).toContain('| done |');
    const imported = await importXmdPackage(await exportMarkdownToXmd(final, 'PhaseTwo.xmd'));
    expect(imported.manifest.resources).toHaveLength(2);
    expect(imported.markdown).toContain('data:image/png;base64,iVBORw0KGgo=');
    expect(imported.markdown).toContain('data:text/plain;base64,aGVsbG8=');
    const reopened = EditorState.create({ doc: imported.markdown, extensions: [markdown({ base: markdownLanguage, extensions: editorMarkdownFallbacks })] });
    ensureSyntaxTree(reopened, reopened.doc.length, 1000);
    expect(collectVisualTables(reopened)[0]).toMatchObject({ columns: 3, rows: 2, alignments: ['none', 'none', 'center'] });
  });

  it('keeps outside source byte-identical on cell changes and undo/redo restores exact padding', () => {
    const original = 'before\n\n| A   | B |\n|:--- | ---:|\n|  a  | b |\n\nafter';
    let state = EditorState.create({ doc: original, extensions: [history(), markdown({ base: markdownLanguage })] });
    const view = { get state() { return state; }, dispatch(spec: TransactionSpec) { state = state.update(spec).state; } };
    const table = collectVisualTables(state)[0];
    expect(updateVisualTableCell(view, table.from, 1, 1, 'new')).toBe(true);
    const changed = state.doc.toString();
    expect(changed.startsWith('before\n\n| A   | B |\n|:--- | ---:|\n')).toBe(true);
    expect(changed.endsWith('\n\nafter')).toBe(true);
    expect(undo({ state, dispatch(tr) { state = tr.state; } })).toBe(true);
    expect(state.doc.toString()).toBe(original);
    expect(redo({ state, dispatch(tr) { state = tr.state; } })).toBe(true);
    expect(state.doc.toString()).toBe(changed);
  });
});
