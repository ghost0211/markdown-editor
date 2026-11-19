import { describe, expect, it } from 'vitest';
import { Compartment, EditorState, StateEffect } from '@codemirror/state';
import { ensureSyntaxTree } from '@codemirror/language';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import {
  createVisualTableExtension,
  isVisualTableRendered,
  visualTableField,
  visualTableLabels,
  type VisualTableLabels,
} from '../src/lib/visualTable';

const labels: VisualTableLabels = {
  label: 'Markdown table',
  toolbar: 'Table toolbar',
  cellLabel: 'Row {row}, column {column} cell',
  headerLabel: 'Header, column {column}',
  hint: 'Tab / Shift+Tab, Escape, Alt+F10',
  addRow: 'Insert row below',
  deleteRow: 'Delete row',
  addColumn: 'Insert column right',
  deleteColumn: 'Delete column',
  alignGroup: 'Column alignment',
  alignLeft: 'Align left',
  alignCenter: 'Align center',
  alignRight: 'Align right',
  alignDefault: 'Default alignment',
  editSource: 'Edit source',
  stale: 'Source changed',
  rowAdded: 'Row inserted',
  rowDeleted: 'Row deleted',
  columnAdded: 'Column inserted',
  columnDeleted: 'Column deleted',
  alignmentChanged: 'Alignment updated',
  rowLimit: 'Row limit {rows}',
  pasteLimit: 'Paste exceeds the limit',
  columnLimit: 'Column limit {columns}',
};

const DOC = '| A | B |\n| --- | --- |\n| a | b |';

function fullState(doc: string, extension = createVisualTableExtension(labels)): EditorState {
  const state = EditorState.create({
    doc,
    selection: { anchor: 0 },
    extensions: [markdown({ base: markdownLanguage }), extension],
  });
  ensureSyntaxTree(state, doc.length, 5000);
  return state.update({}).state;
}

function widgetOf(state: EditorState) {
  let widget: unknown;
  state.field(visualTableField).decorations.between(0, state.doc.length, (_from, _to, decoration) => {
    widget = decoration.spec.widget;
  });
  return widget as { labels: VisualTableLabels; model: { from: number; source: string }; readOnly: boolean; estimatedHeight: number };
}

describe('visual table state field', () => {
  it('supplies block replace decorations directly from the field', () => {
    const state = fullState(DOC);
    expect(state.facet(visualTableLabels)).toBe(labels);
    const decorations = state.field(visualTableField).decorations;
    const found: { from: number; to: number; block: boolean }[] = [];
    decorations.between(0, state.doc.length, (from, to, decoration) => {
      found.push({ from, to, block: Boolean(decoration.spec.block) });
    });
    expect(found).toEqual([{ from: 0, to: DOC.length, block: true }]);
    const widget = widgetOf(state);
    expect(widget.model.source).toBe(DOC);
    expect(widget.labels).toBe(labels);
    expect(widget.estimatedHeight).toBeGreaterThan(0);
  });

  it('recomputes when labels are reconfigured without touching the document', () => {
    const compartment = new Compartment();
    let state = EditorState.create({
      doc: DOC,
      selection: { anchor: 0 },
      extensions: [markdown({ base: markdownLanguage }), compartment.of(createVisualTableExtension(labels))],
    });
    ensureSyntaxTree(state, DOC.length, 5000);
    state = state.update({}).state;
    const nextLabels = { ...labels, addRow: 'Add row' };
    state = state.update({ effects: compartment.reconfigure(createVisualTableExtension(nextLabels)) }).state;
    expect(state.doc.toString()).toBe(DOC);
    expect(state.facet(visualTableLabels)).toBe(nextLabels);
    expect(widgetOf(state).labels.addRow).toBe('Add row');
  });

  it('recomputes when the editor becomes read-only', () => {
    const compartment = new Compartment();
    let state = EditorState.create({
      doc: DOC,
      selection: { anchor: 0 },
      extensions: [
        markdown({ base: markdownLanguage }),
        compartment.of([]),
        createVisualTableExtension(labels),
      ],
    });
    ensureSyntaxTree(state, DOC.length, 5000);
    state = state.update({}).state;
    expect(widgetOf(state).readOnly).toBe(false);
    state = state.update({ effects: compartment.reconfigure(EditorState.readOnly.of(true)) }).state;
    expect(state.readOnly).toBe(true);
    expect(widgetOf(state).readOnly).toBe(true);
    state = state.update({ effects: compartment.reconfigure(EditorState.readOnly.of(false)) }).state;
    expect(widgetOf(state).readOnly).toBe(false);
  });

  it('maps table positions through edits before the table', () => {
    let state = fullState(DOC);
    const before = state.field(visualTableField).tables[0];
    state = state.update({ changes: { from: 0, insert: '# Title\n\n' } }).state;
    const after = state.field(visualTableField).tables[0];
    expect(after.from).toBe(before.from + 9);
    expect(after.source).toBe(before.source);
    expect(state.doc.toString()).toBe(`# Title\n\n${DOC}`);
  });

  it('keeps value identity for transactions that cannot affect tables', () => {
    const effect = StateEffect.define<null>();
    const state = fullState(DOC);
    const value = state.field(visualTableField);
    const next = state.update({ effects: effect.of(null) }).state;
    expect(next.field(visualTableField)).toBe(value);
    expect(next.doc.toString()).toBe(DOC);
  });

  it('recomputes after the background parser extends the tree', () => {
    const prefix = 'Paragraph text.\n\n'.repeat(300);
    const doc = `${prefix}${DOC}`;
    // The initial language viewport is bounded, so the table starts unparsed.
    let state = EditorState.create({
      doc,
      selection: { anchor: 0 },
      extensions: [markdown({ base: markdownLanguage }), createVisualTableExtension(labels)],
    });
    expect(state.field(visualTableField).tables).toEqual([]);
    ensureSyntaxTree(state, doc.length, 5000);
    state = state.update({}).state;
    expect(state.field(visualTableField).tables).toHaveLength(1);
    expect(state.field(visualTableField).tables[0].from).toBe(prefix.length);
  });

  it('drops the grid when an edit makes the table non-standard, without losing text', () => {
    let state = fullState(DOC);
    const table = state.field(visualTableField).tables[0];
    // Add an extra cell to the body row: ragged tables fall back to source.
    state = state.update({
      changes: { from: table.cellRanges[1][1].to, insert: ' | extra' },
    }).state;
    expect(state.field(visualTableField).tables).toEqual([]);
    expect(state.doc.toString()).toBe('| A | B |\n| --- | --- |\n| a | b | extra |');
    expect(isVisualTableRendered(state, table.from, table.to)).toBe(false);
  });

  it('reveals source when the selection enters and restores the grid at the boundary', () => {
    let state = fullState(DOC);
    const table = state.field(visualTableField).tables[0];
    state = state.update({ selection: { anchor: table.from + 3 } }).state;
    expect(state.field(visualTableField).tables).toEqual([]);
    state = state.update({ selection: { anchor: table.from } }).state;
    expect(state.field(visualTableField).tables).toHaveLength(1);
    state = state.update({ selection: { anchor: table.to } }).state;
    expect(state.field(visualTableField).tables).toHaveLength(1);
    expect(isVisualTableRendered(state, table.from, table.to)).toBe(true);
  });

  it('has no field or facet without the extension', () => {
    const state = EditorState.create({ doc: DOC, extensions: [markdown({ base: markdownLanguage })] });
    expect(state.field(visualTableField, false)).toBeUndefined();
    expect(state.facet(visualTableLabels)).toBeNull();
    expect(isVisualTableRendered(state, 0, DOC.length)).toBe(false);
  });

  it('keeps the source reusable after many selection-only transactions', () => {
    let state = fullState(DOC);
    for (let position = 0; position <= DOC.length; position++) {
      state = state.update({ selection: { anchor: position } }).state;
    }
    expect(state.doc.toString()).toBe(DOC);
    expect(state.field(visualTableField).tables).toHaveLength(1);
  });
});
