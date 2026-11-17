import { describe, expect, it } from 'vitest';
import { EditorSelection, EditorState, type TransactionSpec } from '@codemirror/state';
import { ensureSyntaxTree } from '@codemirror/language';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { history, redo, undo } from '@codemirror/commands';
import {
  createVisualTableExtension,
  deleteVisualTableColumn,
  deleteVisualTableRow,
  insertVisualTableColumn,
  insertVisualTableRow,
  revealVisualTableSource,
  setVisualTableColumnAlignment,
  updateVisualTableCell,
  visualTableField,
  type VisualTableInfo,
  type VisualTableLabels,
} from '../src/lib/visualTable';
import type { VisualTableView } from '../src/lib/visualTableCommands';

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
  columnLimit: 'Column limit {columns}',
};

interface Harness {
  view: VisualTableView;
  readonly state: EditorState;
  readonly specs: TransactionSpec[];
}

function harness(doc: string, readOnly = false): Harness {
  let state = EditorState.create({
    doc,
    selection: { anchor: 0 },
    extensions: [
      markdown({ base: markdownLanguage }),
      history(),
      ...(readOnly ? [EditorState.readOnly.of(true)] : []),
      createVisualTableExtension(labels),
    ],
  });
  ensureSyntaxTree(state, doc.length, 5000);
  state = state.update({}).state;
  const specs: TransactionSpec[] = [];
  const view: VisualTableView = {
    get state() {
      return state;
    },
    dispatch(spec: TransactionSpec) {
      specs.push(spec);
      state = state.update(spec).state;
    },
  };
  return {
    view,
    get state() {
      return state;
    },
    specs,
  };
}

function info(state: EditorState, index = 0): VisualTableInfo {
  return state.field(visualTableField).tables[index];
}

const DOC = '| A | B |\n| --- | --- |\n| a | b |\n| c | d |';

describe('visual table cell transactions', () => {
  it('replaces only the edited row line and is undoable', () => {
    const h = harness(DOC);
    const table = info(h.state);
    const originalLine = h.state.doc.line(3);
    expect(updateVisualTableCell(h.view, table.from, 1, 1, 'b2', 'b')).toBe(true);
    expect(h.state.doc.toString()).toBe(DOC.replace('| a | b |', '| a | b2 |'));
    expect(h.specs).toHaveLength(1);
    const change = h.specs[0].changes as { from: number; to: number; insert: string };
    expect(change).toMatchObject({ from: originalLine.from, to: originalLine.to });
    expect(h.specs[0].userEvent).toBe('input.visualTable.cell');

    expect(info(h.state).cells).toEqual([['A', 'B'], ['a', 'b2'], ['c', 'd']]);
    expect(undo(h.view)).toBe(true);
    expect(h.state.doc.toString()).toBe(DOC);
    expect(redo(h.view)).toBe(true);
    expect(h.state.doc.toString()).toBe(DOC.replace('| a | b |', '| a | b2 |'));
  });

  it('guards against stale cell snapshots', () => {
    const h = harness(DOC);
    const table = info(h.state);
    expect(updateVisualTableCell(h.view, table.from, 1, 1, 'x', 'stale')).toBe(false);
    expect(h.state.doc.toString()).toBe(DOC);
    expect(h.specs).toEqual([]);
  });

  it('escapes bare pipes and normalizes newlines without losing other cells', () => {
    const h = harness(DOC);
    const table = info(h.state);
    expect(updateVisualTableCell(h.view, table.from, 2, 0, 'c|d\ne', 'c')).toBe(true);
    expect(info(h.state).cells[2][0]).toBe('c\\|d e');
    expect(info(h.state).cells[2][1]).toBe('d');
    expect(h.state.field(visualTableField).tables).toHaveLength(1);
  });

  it('edits header cells and empty cells', () => {
    const emptyDoc = '| A | B |\n| --- | --- |\n|  | b |';
    const h = harness(emptyDoc);
    const table = info(h.state);
    expect(updateVisualTableCell(h.view, table.from, 1, 0, '', '')).toBe(true);
    expect(h.specs).toEqual([]);
    expect(updateVisualTableCell(h.view, table.from, 1, 0, 'x', '')).toBe(true);
    expect(h.state.doc.toString()).toBe('| A | B |\n| --- | --- |\n| x | b |');
    const header = info(h.state);
    expect(updateVisualTableCell(h.view, header.from, 0, 0, 'H', 'A')).toBe(true);
    expect(info(h.state).cells[0][0]).toBe('H');
  });

  it('rejects invalid coordinates and read-only editors', () => {
    const h = harness(DOC);
    const table = info(h.state);
    expect(updateVisualTableCell(h.view, table.from, -1, 0, 'x')).toBe(false);
    expect(updateVisualTableCell(h.view, table.from, 9, 0, 'x')).toBe(false);
    expect(updateVisualTableCell(h.view, table.to + 1, 1, 1, 'x')).toBe(false);
    const readOnly = harness(DOC, true);
    expect(updateVisualTableCell(readOnly.view, info(readOnly.state).from, 1, 1, 'x')).toBe(false);
    expect(readOnly.specs).toEqual([]);
  });
});

describe('visual table structural transactions', () => {
  it('inserts a row below the active row and undoes atomically', () => {
    const h = harness(DOC);
    const table = info(h.state);
    expect(insertVisualTableRow(h.view, table.from, 1, table.source)).toBe(true);
    expect(h.specs).toHaveLength(1);
    expect(h.specs[0].userEvent).toBe('input.visualTable.structure');
    expect(info(h.state).rows).toBe(4);
    expect(info(h.state).cells[2]).toEqual(['', '']);
    expect(h.state.doc.toString()).toBe(
      '| A | B |\n| --- | --- |\n| a | b |\n|  |  |\n| c | d |'
    );
    expect(undo(h.view)).toBe(true);
    expect(h.state.doc.toString()).toBe(DOC);
  });

  it('inserts a row after the header and refuses past the row limit', () => {
    const h = harness(DOC);
    expect(insertVisualTableRow(h.view, info(h.state).from, 0, info(h.state).source)).toBe(true);
    expect(info(h.state).cells[1]).toEqual(['', '']);
    expect(info(h.state).cells[2]).toEqual(['a', 'b']);

    const header = `| ${Array.from({ length: 2 }, () => 'H').join(' | ')} |`;
    const delimiter = '| --- | --- |';
    const body = Array.from({ length: 99 }, () => '| x | y |');
    const full = [header, delimiter, ...body].join('\n');
    const limited = harness(full);
    expect(info(limited.state).rows).toBe(100);
    expect(insertVisualTableRow(limited.view, info(limited.state).from, 99, info(limited.state).source)).toBe(false);
    expect(limited.state.doc.toString()).toBe(full);
  });

  it('deletes body and header rows', () => {
    const h = harness(DOC);
    expect(deleteVisualTableRow(h.view, info(h.state).from, 1, info(h.state).source)).toBe(true);
    expect(info(h.state).cells).toEqual([['A', 'B'], ['c', 'd']]);
    expect(undo(h.view)).toBe(true);
    expect(deleteVisualTableRow(h.view, info(h.state).from, 0, info(h.state).source)).toBe(true);
    expect(info(h.state).cells).toEqual([['a', 'b'], ['c', 'd']]);
    expect(info(h.state).alignments).toEqual(['none', 'none']);

    const minimal = harness('| A |\n| --- |');
    expect(deleteVisualTableRow(minimal.view, info(minimal.state).from, 0, info(minimal.state).source)).toBe(false);
  });

  it('inserts and deletes columns, preserving every cell source', () => {
    const doc = '| A | B |\n| --- | --- |\n| a \\| x | b |';
    const h = harness(doc);
    const table = info(h.state);
    expect(insertVisualTableColumn(h.view, table.from, 0, table.source)).toBe(true);
    expect(info(h.state).columns).toBe(3);
    expect(info(h.state).cells[1]).toEqual(['a \\| x', '', 'b']);
    expect(info(h.state).alignments).toEqual(['none', 'none', 'none']);
    expect(undo(h.view)).toBe(true);
    expect(h.state.doc.toString()).toBe(doc);

    expect(deleteVisualTableColumn(h.view, info(h.state).from, 1, info(h.state).source)).toBe(true);
    expect(info(h.state).cells[1]).toEqual(['a \\| x']);
    expect(h.state.doc.toString()).toBe('| A |\n| --- |\n| a \\| x |');
  });

  it('enforces column limits', () => {
    const columns = 20;
    const header = `| ${Array.from({ length: columns }, (_, index) => `H${index}`).join(' | ')} |`;
    const delimiter = `| ${Array.from({ length: columns }, () => '---').join(' | ')} |`;
    const full = `${header}\n${delimiter}\n${header.replaceAll('H', 'x')}`;
    const h = harness(full);
    expect(info(h.state).columns).toBe(20);
    expect(insertVisualTableColumn(h.view, info(h.state).from, 19, info(h.state).source)).toBe(false);
    const single = harness('| A |\n| --- |\n| a |');
    expect(deleteVisualTableColumn(single.view, info(single.state).from, 0, info(single.state).source)).toBe(false);
  });

  it('updates only the delimiter row when aligning a column', () => {
    const h = harness(DOC);
    const table = info(h.state);
    expect(setVisualTableColumnAlignment(h.view, table.from, 1, 'center', table.source)).toBe(true);
    expect(h.state.doc.toString()).toBe('| A | B |\n| --- | :---: |\n| a | b |\n| c | d |');
    expect(info(h.state).alignments).toEqual(['none', 'center']);
    expect(undo(h.view)).toBe(true);
    expect(h.state.doc.toString()).toBe(DOC);
    h.specs.length = 0;
    expect(setVisualTableColumnAlignment(h.view, info(h.state).from, 1, 'left', info(h.state).source)).toBe(true);
    expect(h.specs).toHaveLength(1);
    expect(setVisualTableColumnAlignment(h.view, info(h.state).from, 1, 'left', info(h.state).source)).toBe(true);
    expect(h.specs).toHaveLength(1);
  });

  it('refuses stale structural snapshots', () => {
    const h = harness(DOC);
    const table = info(h.state);
    expect(insertVisualTableRow(h.view, table.from, 1, 'stale')).toBe(false);
    expect(deleteVisualTableRow(h.view, table.from, 1, 'stale')).toBe(false);
    expect(insertVisualTableColumn(h.view, table.from, 1, 'stale')).toBe(false);
    expect(deleteVisualTableColumn(h.view, table.from, 1, 'stale')).toBe(false);
    expect(setVisualTableColumnAlignment(h.view, table.from, 1, 'center', 'stale')).toBe(false);
    expect(h.state.doc.toString()).toBe(DOC);
    expect(h.specs).toEqual([]);
  });

  it('never rewrites ragged extra cells because such tables are not rendered', () => {
    const doc = '| A | B |\n| --- | --- |\n| 1 | 2 | 3 |';
    const h = harness(doc);
    expect(h.state.field(visualTableField).tables).toEqual([]);
    expect(updateVisualTableCell(h.view, 0, 1, 0, 'x')).toBe(false);
    expect(insertVisualTableRow(h.view, 0, 1)).toBe(false);
    expect(h.state.doc.toString()).toBe(doc);
    expect(h.specs).toEqual([]);
  });

  it('targets the correct table when several are rendered', () => {
    const doc = '| A |\n| --- |\n| a |\n\nText\n\n| B |\n| --- |\n| b |';
    const h = harness(doc);
    const second = info(h.state, 1);
    expect(updateVisualTableCell(h.view, second.from, 1, 0, 'B2', 'b')).toBe(true);
    expect(h.state.doc.toString()).toBe('| A |\n| --- |\n| a |\n\nText\n\n| B |\n| --- |\n| B2 |');
  });
});

describe('visual table source fallback', () => {
  it('moves the selection into the cell and hides the grid', () => {
    const h = harness(DOC);
    const table = info(h.state);
    expect(revealVisualTableSource(h.view, table.from, 2, 1)).toBe(true);
    expect(h.state.selection.main.head).toBe(table.cellRanges[2][1].from);
    expect(h.state.doc.toString()).toBe(DOC);
    expect(h.state.field(visualTableField).tables).toEqual([]);
    expect(h.specs[0].userEvent).toBe('select.visualTable.source');
  });

  it('rejects out-of-range cells', () => {
    const h = harness(DOC);
    expect(revealVisualTableSource(h.view, info(h.state).from, 9, 9)).toBe(false);
  });

  it('supports multi-range selections through the transaction model', () => {
    const doc = '| A |\n| --- |\n| a |\n\ntext';
    let state = EditorState.create({
      doc,
      extensions: [
        markdown({ base: markdownLanguage }),
        EditorState.allowMultipleSelections.of(true),
        createVisualTableExtension(labels),
      ],
    });
    ensureSyntaxTree(state, doc.length, 5000);
    state = state.update({}).state;
    expect(state.field(visualTableField).tables).toHaveLength(1);
    const selected = state.update({
      selection: EditorSelection.create([EditorSelection.cursor(doc.length), EditorSelection.cursor(4)]),
    }).state;
    expect(selected.field(visualTableField).tables).toEqual([]);
    expect(selected.doc.toString()).toBe(doc);
  });
});
