import { describe, expect, it } from 'vitest';
import { EditorSelection, EditorState } from '@codemirror/state';
import { ensureSyntaxTree } from '@codemirror/language';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { zhCN } from '../src/i18n/locales/zh-CN';
import { enUS } from '../src/i18n/locales/en-US';
import {
  applyFocusedVisualTableAction,
  createVisualTableExtension,
  findVisualTableAt,
  formatVisualTableLabel,
  isVisualTableRendered,
  serializeVisualTableCell,
  serializeVisualTableCellWithMap,
  VISUAL_TABLE_MAX_BYTES,
  VISUAL_TABLE_MAX_COLUMNS,
  VISUAL_TABLE_MAX_ROWS,
  visualTableAlignmentCell,
  visualTableAlignmentOf,
  visualTableCellNeighbor,
  visualTableField,
  visualTableRowLine,
  type VisualTableInfo,
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
  columnLimit: 'Column limit {columns}',
};

function baseExtensions(readOnly = false) {
  return [
    markdown({ base: markdownLanguage }),
    ...(readOnly ? [EditorState.readOnly.of(true)] : []),
    createVisualTableExtension(labels),
  ];
}

function createState(
  doc: string,
  selection: { anchor: number; head?: number } = { anchor: doc.length },
  readOnly = false
): EditorState {
  let state = EditorState.create({ doc, selection, extensions: baseExtensions(readOnly) });
  // The language field starts with a bounded initial viewport; force the full
  // tree and then let the field observe the new tree, like the real view does.
  ensureSyntaxTree(state, doc.length, 5000);
  state = state.update({}).state;
  return state;
}

function tableInfos(state: EditorState): readonly VisualTableInfo[] {
  return state.field(visualTableField).tables;
}

function tableDecorations(state: EditorState) {
  const result: { from: number; to: number; block: boolean; widget: unknown }[] = [];
  state.field(visualTableField).decorations.between(0, state.doc.length, (from, to, decoration) => {
    result.push({ from, to, block: Boolean(decoration.spec.block), widget: decoration.spec.widget });
  });
  return result;
}

function makeTable(rows: number, columns: number, fill = 'x'): string {
  const header = `| ${Array.from({ length: columns }, (_, index) => `H${index}`).join(' | ')} |`;
  const delimiter = `| ${Array.from({ length: columns }, () => '---').join(' | ')} |`;
  const body = Array.from({ length: Math.max(0, rows - 1) }, () =>
    `| ${Array.from({ length: columns }, () => fill).join(' | ')} |`);
  return [header, delimiter, ...body].join('\n');
}

describe('visual table model', () => {
  it('extracts a standard GFM table as a block grid with exact cell ranges', () => {
    const doc = '| Name | Value |\n| :--- | ---: |\n| a | b |\n\nTail';
    const state = createState(doc);
    const tables = tableInfos(state);
    expect(tables).toHaveLength(1);
    const [table] = tables;
    expect(table.rows).toBe(2);
    expect(table.columns).toBe(2);
    expect(table.alignments).toEqual(['left', 'right']);
    expect(table.cells).toEqual([['Name', 'Value'], ['a', 'b']]);
    expect(table.source).toBe('| Name | Value |\n| :--- | ---: |\n| a | b |');
    expect(table.from).toBe(0);
    expect(table.to).toBe(doc.indexOf('\n\nTail'));
    expect(doc.slice(table.cellRanges[0][0].from, table.cellRanges[0][0].to)).toBe('Name');
    expect(doc.slice(table.cellRanges[1][1].from, table.cellRanges[1][1].to)).toBe('b');

    const decorations = tableDecorations(state);
    expect(decorations).toHaveLength(1);
    expect(decorations[0]).toMatchObject({ from: table.from, to: table.to, block: true });
    expect(decorations[0].widget).toBeTruthy();
  });

  it('keeps escaped pipes, backslashes and backticks byte-exact', () => {
    const doc = [
      '| A | B |',
      '| --- | --- |',
      '| a \\| b | `x` |',
      '| c\\ | d |',
    ].join('\n');
    const [table] = tableInfos(createState(doc));
    expect(table.cells).toEqual([['A', 'B'], ['a \\| b', '`x`'], ['c\\', 'd']]);
    expect(doc.slice(table.cellRanges[2][0].from, table.cellRanges[2][0].to)).toBe('c\\');
    expect(doc.slice(table.cellRanges[1][0].from, table.cellRanges[1][0].to)).toBe('a \\| b');
  });

  it('falls back for ragged and non-rectangular tables without losing source', () => {
    for (const doc of [
      '| A | B |\n| - | - |\n| 1 | 2 | 3 |',
      '| A | B |\n| - | - |\n| 1 |',
      '| A | B | C |\n| - | - |',
      'A | B\n- | -\n1 | 2',
      '| A | B |\n| - | - |\n| `x|y` | z |',
    ]) {
      const state = createState(doc);
      expect(tableInfos(state), doc).toEqual([]);
      expect(state.doc.toString()).toBe(doc);
      expect(tableDecorations(state), doc).toEqual([]);
    }
  });

  it('falls back inside containers (quotes and lists)', () => {
    for (const doc of [
      '> | A | B |\n> | - | - |\n> | 1 | 2 |',
      '- | A | B |\n  | - | - |\n  | 1 | 2 |',
    ]) {
      expect(tableInfos(createState(doc)), doc).toEqual([]);
    }
  });

  it('falls back for any image node or data/blob payload in the table', () => {
    for (const cell of [
      '![alt](https://example.com/a.png)',
      '![alt](data:image/png;base64,AAAA)',
      '[file](data:text/plain;base64,AAAA)',
      '[file](blob:https://example.com/123)',
    ]) {
      const doc = `| A | B |\n| - | - |\n| ${cell} | b |`;
      const state = createState(doc);
      expect(tableInfos(state), cell).toEqual([]);
      expect(state.doc.toString()).toBe(doc);
    }
    // Ordinary links are not images and remain renderable.
    expect(tableInfos(createState('| A |\n| - |\n| [link](https://example.com) |'))).toHaveLength(1);
  });

  it('enforces row, column and byte limits', () => {
    const atRowLimit = createState(makeTable(VISUAL_TABLE_MAX_ROWS, 2));
    expect(tableInfos(atRowLimit)).toHaveLength(1);
    expect(tableInfos(createState(makeTable(VISUAL_TABLE_MAX_ROWS + 1, 2)))).toEqual([]);

    const atColumnLimit = createState(makeTable(2, VISUAL_TABLE_MAX_COLUMNS));
    expect(tableInfos(atColumnLimit)[0].columns).toBe(VISUAL_TABLE_MAX_COLUMNS);
    expect(tableInfos(createState(makeTable(2, VISUAL_TABLE_MAX_COLUMNS + 1)))).toEqual([]);

    const longCell = 'x'.repeat(VISUAL_TABLE_MAX_BYTES + 10);
    expect(tableInfos(createState(`| A |\n| - |\n| ${longCell} |`))).toEqual([]);
  });

  it('preserves up to three spaces of indentation and rejects code indentation', () => {
    const doc = '  | A |\n  | - |\n  | 1 |';
    const [table] = tableInfos(createState(doc));
    expect(table.indent).toBe('  ');
    expect(table.from).toBe(0);
    expect(table.to).toBe(doc.length);
    expect(table.cells).toEqual([['A'], ['1']]);
    expect(tableInfos(createState('    | A |\n    | - |'))).toEqual([]);
  });

  it('finds multiple tables and resolves the table at a position', () => {
    const doc = '| A |\n| - |\n| 1 |\n\nText\n\n| B |\n| - |\n| 2 |';
    const state = createState(doc);
    const tables = tableInfos(state);
    expect(tables).toHaveLength(2);
    expect(findVisualTableAt(tables, tables[1].from)).toBe(tables[1]);
    expect(findVisualTableAt(tables, tables[0].to + 2)).toBeNull();
    expect(tableDecorations(state).map(({ from, to }) => [from, to]))
      .toEqual(tables.map(({ from, to }) => [from, to]));
  });

  it('reveals source for carets inside and selections touching a table', () => {
    const doc = '| A | B |\n| - | - |\n| 1 | 2 |';
    const atStart = createState(doc, { anchor: 0 });
    expect(tableInfos(atStart)).toHaveLength(1);
    const atEnd = createState(doc, { anchor: doc.length });
    expect(tableInfos(atEnd)).toHaveLength(1);
    expect(tableInfos(createState(doc, { anchor: doc.indexOf('1') }))).toEqual([]);
    expect(tableInfos(createState(doc, { anchor: 0, head: 4 }))).toEqual([]);
    expect(tableInfos(createState(doc, { anchor: 0, head: doc.length }))).toEqual([]);

    let state = EditorState.create({ doc, extensions: [...baseExtensions(), EditorState.allowMultipleSelections.of(true)] });
    ensureSyntaxTree(state, doc.length, 5000);
    state = state.update({}).state;
    const multi = state.update({
      selection: EditorSelection.create([EditorSelection.cursor(0), EditorSelection.cursor(doc.indexOf('2'))]),
    }).state;
    expect(tableInfos(multi)).toEqual([]);
  });

  it('reports rendered tables for overlapping ranges only while they are rendered', () => {
    const doc = '| A | B |\n| - | - |\n| 1 | 2 |';
    const rendered = createState(doc, { anchor: 0 });
    const [table] = tableInfos(rendered);
    expect(isVisualTableRendered(rendered, table.from, table.to)).toBe(true);
    expect(isVisualTableRendered(rendered, table.from + 2, table.from + 4)).toBe(true);
    expect(isVisualTableRendered(rendered, table.to + 1, table.to + 3)).toBe(false);
    const revealed = createState(doc, { anchor: doc.indexOf('1') });
    expect(isVisualTableRendered(revealed, table.from, table.to)).toBe(false);

    const withoutExtension = EditorState.create({
      doc,
      extensions: [markdown({ base: markdownLanguage })],
    });
    expect(isVisualTableRendered(withoutExtension, 0, 5)).toBe(false);
  });

  it('renders in read-only editors and records read-only on the widget', () => {
    const doc = '| A |\n| - |\n| 1 |';
    const state = createState(doc, { anchor: 0 }, true);
    expect(tableInfos(state)).toHaveLength(1);
    const widget = tableDecorations(state)[0].widget as { readOnly: boolean };
    expect(widget.readOnly).toBe(true);
  });
});

describe('visual table serialization', () => {
  it('escapes bare pipes while preserving existing escapes', () => {
    expect(serializeVisualTableCell('a|b')).toBe('a\\|b');
    expect(serializeVisualTableCell('a\\|b')).toBe('a\\|b');
    expect(serializeVisualTableCell('a\\\\|b')).toBe('a\\\\\\|b');
    expect(serializeVisualTableCell('  a | b  ')).toBe('a \\| b');
    expect(serializeVisualTableCell('a\nb\tc')).toBe('a b c');
    expect(serializeVisualTableCell('')).toBe('');
  });

  it('maps alignments both ways', () => {
    expect(visualTableAlignmentOf('---')).toBe('none');
    expect(visualTableAlignmentOf(':---')).toBe('left');
    expect(visualTableAlignmentOf('---:')).toBe('right');
    expect(visualTableAlignmentOf(':---:')).toBe('center');
    expect(visualTableAlignmentOf('--x')).toBeNull();
    expect(visualTableAlignmentCell('left')).toBe(':---');
    expect(visualTableAlignmentCell('center')).toBe(':---:');
    expect(visualTableAlignmentCell('right')).toBe('---:');
    expect(visualTableAlignmentCell('none')).toBe('---');
  });

  it('maps rows to document lines and wraps Tab navigation', () => {
    const doc = '| A | B |\n| - | - |\n| 1 | 2 |\n| 3 | 4 |';
    const [table] = tableInfos(createState(doc));
    expect(visualTableRowLine(table, 0)).toBe(1);
    expect(visualTableRowLine(table, 1)).toBe(3);
    expect(visualTableRowLine(table, 2)).toBe(4);
    expect(visualTableCellNeighbor(3, 2, 2, 1, 1)).toEqual({ row: 0, column: 0 });
    expect(visualTableCellNeighbor(3, 2, 0, 0, -1)).toEqual({ row: 2, column: 1 });
    expect(visualTableCellNeighbor(2, 2, 0, 0, 1)).toEqual({ row: 0, column: 1 });
  });

  it('maps input selection boundaries through cell escaping', () => {
    const simple = serializeVisualTableCellWithMap('a|b');
    expect(simple.text).toBe('a\\|b');
    expect([0, 1, 2, 3].map((index) => simple.mapBoundary(index))).toEqual([0, 1, 3, 4]);
    const trimmed = serializeVisualTableCellWithMap('  a|b  ');
    expect(trimmed.text).toBe('a\\|b');
    expect([0, 2, 3, 4, 5, 7].map((index) => trimmed.mapBoundary(index))).toEqual([0, 0, 1, 3, 4, 4]);
    const normalized = serializeVisualTableCellWithMap('a\r\nb\tc');
    expect(normalized.text).toBe('a b c');
    expect(normalized.mapBoundary(6)).toBe(5);
    expect(serializeVisualTableCellWithMap('').mapBoundary(0)).toBe(0);
  });

  it('interpolates label placeholders', () => {
    expect(formatVisualTableLabel('Row {row}, column {column}', { row: 2, column: 3 })).toBe('Row 2, column 3');
    expect(formatVisualTableLabel('保留 {unknown}', { row: 1 })).toBe('保留 {unknown}');
  });
});

describe('visual table locale contract', () => {
  it('keeps zh-CN and en-US visualTable objects structurally identical', () => {
    expect(Object.keys(zhCN.visualTable).sort()).toEqual(Object.keys(enUS.visualTable).sort());
    for (const key of Object.keys(zhCN.visualTable) as (keyof typeof zhCN.visualTable)[]) {
      expect(enUS.visualTable[key], key).toBeTruthy();
      expect(zhCN.visualTable[key], key).toBeTruthy();
    }
    expect(zhCN.visualTable.cellLabel).toContain('{row}');
    expect(zhCN.visualTable.cellLabel).toContain('{column}');
    expect(enUS.visualTable.headerLabel).toContain('{column}');
    expect(zhCN.visualTable.rowLimit).toContain('{rows}');
    expect(enUS.visualTable.columnLimit).toContain('{columns}');
  });

  it('exposes the focused-cell formatting entry point', () => {
    expect(typeof applyFocusedVisualTableAction).toBe('function');
  });

  it('does not depend on visualEditing or the image address extension', () => {
    for (const file of ['visualTable.ts', 'visualTableModel.ts', 'visualTableCommands.ts', 'visualTableWidget.ts', 'visualTableExtension.ts']) {
      const source = readFileSync(resolve(__dirname, '../src/lib', file), 'utf8');
      expect(source, file).not.toContain('visualEditing');
      expect(source, file).not.toContain('imageAddressExtension');
    }
  });
});
