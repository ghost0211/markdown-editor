import { EditorSelection, type EditorState, type TransactionSpec } from '@codemirror/state';
import { isolateHistory } from '@codemirror/commands';
import type { EditorView } from '@codemirror/view';
import {
  executeCodeMirrorAction,
  type MarkdownAction,
  type MarkdownLocaleInput,
} from '@/lib/markdownCommands';
import {
  collectVisualTables,
  findVisualTableAt,
  serializeVisualTableCell,
  serializeVisualTableCellWithMap,
  serializeVisualTable,
  serializeVisualTableRow,
  VISUAL_TABLE_MAX_COLUMNS,
  VISUAL_TABLE_MAX_ROWS,
  visualTableAlignmentCell,
  visualTableRowLine,
  type VisualTableAlignment,
  type VisualTableInfo,
} from '@/lib/visualTableModel';

/** Minimal view surface commands need; tests drive real transactions through it. */
export interface VisualTableView {
  readonly state: EditorState;
  dispatch(spec: TransactionSpec): void;
}

function currentTable(view: VisualTableView, tableFrom: number): VisualTableInfo | null {
  return findVisualTableAt(collectVisualTables(view.state), tableFrom);
}

function validCell(table: VisualTableInfo, row: number, column: number): boolean {
  return Number.isInteger(row) && Number.isInteger(column) &&
    row >= 0 && row < table.rows && column >= 0 && column < table.columns;
}

function replaceTable(view: VisualTableView, table: VisualTableInfo, cells: readonly (readonly string[])[],
  alignments: readonly VisualTableAlignment[], userEvent: string): void {
  view.dispatch({
    changes: { from: table.from, to: table.to, insert: serializeVisualTable(table, cells, alignments) },
    // Structure edits must not merge with a previous cell typing session.
    annotations: isolateHistory.of('full'),
    userEvent,
  });
}

/**
 * Writes one cell's Markdown source. Only the containing row line is replaced,
 * so one input event is one local, undoable transaction and every other cell's
 * exact source (escaped pipes, backslashes, backticks) is preserved.
 *
 * `expectedCell` is the stale guard: when the current source no longer matches
 * the snapshot the widget rendered, nothing is written.
 */
export function updateVisualTableCell(
  view: VisualTableView,
  tableFrom: number,
  row: number,
  column: number,
  value: string,
  expectedCell?: string
): boolean {
  if (view.state.readOnly) return false;
  const table = currentTable(view, tableFrom);
  if (!table || !validCell(table, row, column)) return false;
  if (expectedCell !== undefined && table.cells[row][column] !== expectedCell) return false;

  const serialized = serializeVisualTableCell(value);
  if (serialized === table.cells[row][column]) return true;

  const cells = table.cells.map((line) => [...line]);
  cells[row][column] = serialized;
  const line = view.state.doc.line(visualTableRowLine(table, row));
  view.dispatch({
    changes: { from: line.from, to: line.to, insert: serializeVisualTableRow(table.indent, cells[row]) },
    userEvent: 'input.visualTable.cell',
  });
  return true;
}

/** Inserts an empty row after `row` (header included). */
export function insertVisualTableRow(
  view: VisualTableView,
  tableFrom: number,
  row: number,
  expectedTable?: string
): boolean {
  if (view.state.readOnly) return false;
  const table = currentTable(view, tableFrom);
  if (!table || row < 0 || row >= table.rows || table.rows >= VISUAL_TABLE_MAX_ROWS) return false;
  if (expectedTable !== undefined && table.source !== expectedTable) return false;
  const cells = table.cells.map((line) => [...line]);
  cells.splice(row + 1, 0, Array.from({ length: table.columns }, () => ''));
  replaceTable(view, table, cells, table.alignments, 'input.visualTable.structure');
  return true;
}

/** Deletes `row`; the following body row becomes the header when row 0 goes. */
export function deleteVisualTableRow(
  view: VisualTableView,
  tableFrom: number,
  row: number,
  expectedTable?: string
): boolean {
  if (view.state.readOnly) return false;
  const table = currentTable(view, tableFrom);
  if (!table || row < 0 || row >= table.rows || table.rows <= 1) return false;
  if (expectedTable !== undefined && table.source !== expectedTable) return false;
  const cells = table.cells.map((line) => [...line]);
  cells.splice(row, 1);
  replaceTable(view, table, cells, table.alignments, 'input.visualTable.structure');
  return true;
}

/** Inserts an empty column to the right of `column`. */
export function insertVisualTableColumn(
  view: VisualTableView,
  tableFrom: number,
  column: number,
  expectedTable?: string
): boolean {
  if (view.state.readOnly) return false;
  const table = currentTable(view, tableFrom);
  if (!table || column < 0 || column >= table.columns || table.columns >= VISUAL_TABLE_MAX_COLUMNS) return false;
  if (expectedTable !== undefined && table.source !== expectedTable) return false;
  const cells = table.cells.map((line) => {
    const next = [...line];
    next.splice(column + 1, 0, '');
    return next;
  });
  const alignments = [...table.alignments];
  alignments.splice(column + 1, 0, 'none');
  replaceTable(view, table, cells, alignments, 'input.visualTable.structure');
  return true;
}

export function deleteVisualTableColumn(
  view: VisualTableView,
  tableFrom: number,
  column: number,
  expectedTable?: string
): boolean {
  if (view.state.readOnly) return false;
  const table = currentTable(view, tableFrom);
  if (!table || column < 0 || column >= table.columns || table.columns <= 1) return false;
  if (expectedTable !== undefined && table.source !== expectedTable) return false;
  const cells = table.cells.map((line) => line.filter((_, index) => index !== column));
  const alignments = table.alignments.filter((_, index) => index !== column);
  replaceTable(view, table, cells, alignments, 'input.visualTable.structure');
  return true;
}

/** Replaces only the delimiter cell, keeping every data row byte-identical. */
export function setVisualTableColumnAlignment(
  view: VisualTableView,
  tableFrom: number,
  column: number,
  alignment: VisualTableAlignment,
  expectedTable?: string
): boolean {
  if (view.state.readOnly) return false;
  const table = currentTable(view, tableFrom);
  if (!table || column < 0 || column >= table.columns) return false;
  if (expectedTable !== undefined && table.source !== expectedTable) return false;
  if (table.alignments[column] === alignment) return true;
  const line = view.state.doc.line(table.startLine + 1);
  const cells = table.alignments.map((current, index) =>
    visualTableAlignmentCell(index === column ? alignment : current));
  view.dispatch({
    changes: { from: line.from, to: line.to, insert: `${table.indent}| ${cells.join(' | ')} |` },
    annotations: isolateHistory.of('full'),
    userEvent: 'input.visualTable.align',
  });
  return true;
}

/** Moves the editor selection into the cell so the source line is revealed. */
export function revealVisualTableSource(
  view: VisualTableView,
  tableFrom: number,
  row: number,
  column: number
): boolean {
  const table = currentTable(view, tableFrom);
  if (!table || !validCell(table, row, column)) return false;
  const range = table.cellRanges[row][column];
  view.dispatch({
    selection: EditorSelection.cursor(range.from),
    scrollIntoView: true,
    userEvent: 'select.visualTable.source',
  });
  return true;
}

interface FocusedVisualTableCell {
  container: HTMLElement;
  input: HTMLInputElement;
  row: number;
  column: number;
}

/** Last table cell focused per editor, surviving a blur to the app toolbar. */
const focusedCells = new WeakMap<EditorView, FocusedVisualTableCell>();

// Applying one of these to a cell's source cannot introduce a line break, so
// running the normal Markdown command over the revealed cell is safe. Every
// other action falls back to source and stops (the user completes it there).
const INLINE_CELL_ACTIONS = new Set<MarkdownAction>([
  'bold', 'italic', 'strike', 'inline-code', 'link', 'image',
]);

export function rememberVisualTableCellFocus(
  view: EditorView,
  container: HTMLElement,
  input: HTMLInputElement
): void {
  focusedCells.set(view, {
    container,
    input,
    row: Number(input.dataset.row),
    column: Number(input.dataset.col),
  });
}

export function forgetVisualTableCellFocus(view: EditorView): void {
  focusedCells.delete(view);
}

/**
 * EditorHandle.applyAction entry point for visual tables.
 *
 * When the last focused element belongs to a rendered table cell, the action is
 * never applied to the old CodeMirror selection. The cell is committed, its
 * source cell is revealed and selected (input selection mapped through pipe
 * escaping), and only inline actions are executed there. Block actions
 * (headings, lists, quotes, code blocks, tables, rules) return `true` after the
 * source fallback without changing the document, so they cannot corrupt the
 * table; the user can apply the action in source mode.
 *
 * Returns `false` when no rendered table cell is involved, letting the caller
 * use its normal formatting command.
 */
export function applyFocusedVisualTableAction(
  view: EditorView,
  action: MarkdownAction,
  localeInput?: MarkdownLocaleInput
): boolean {
  const document = view.dom.ownerDocument;
  const active = document.activeElement;
  let target: FocusedVisualTableCell | undefined;
  if (active instanceof HTMLInputElement && active.classList.contains('cm-visual-table-cell') && view.dom.contains(active)) {
    const container = active.closest<HTMLElement>('.cm-visual-table');
    if (container) {
      target = { container, input: active, row: Number(active.dataset.row), column: Number(active.dataset.col) };
    }
  } else {
    target = focusedCells.get(view);
  }
  if (!target) return false;
  const { container, input, row, column } = target;
  if (!input.isConnected || !container.isConnected || !view.dom.contains(container)) {
    focusedCells.delete(view);
    return false;
  }

  const table = currentTableAtElement(view, container);
  if (!table || !validCell(table, row, column)) {
    focusedCells.delete(view);
    return false;
  }

  const source = table.cells[row][column];
  if (input.dataset.source !== source) {
    // The document changed elsewhere: adopt the source instead of overwriting
    // it with text typed against an older cell.
    input.value = source;
    input.dataset.source = source;
  } else {
    const serialized = serializeVisualTableCell(input.value);
    if (serialized !== source && updateVisualTableCell(view, table.from, row, column, input.value, source)) {
      input.dataset.source = serialized;
    }
  }

  const updated = currentTableAtElement(view, container);
  if (!updated) return false;
  const range = updated.cellRanges[row][column];
  const value = input.value;
  const serialization = serializeVisualTableCellWithMap(value);
  const rawStart = input.selectionStart ?? value.length;
  const rawEnd = input.selectionEnd ?? rawStart;
  const start = Math.min(range.to, range.from + serialization.mapBoundary(Math.min(rawStart, rawEnd)));
  const end = Math.min(range.to, range.from + serialization.mapBoundary(Math.max(rawStart, rawEnd)));

  view.dispatch({
    selection: { anchor: start, head: end },
    scrollIntoView: true,
    userEvent: 'select.visualTable.source',
  });
  focusedCells.delete(view);
  view.focus();
  if (view.state.readOnly) return true;
  if (!INLINE_CELL_ACTIONS.has(action)) return true;
  executeCodeMirrorAction(view, action, localeInput);
  return true;
}

function currentTableAtElement(view: EditorView, container: HTMLElement): VisualTableInfo | null {
  try {
    return findVisualTableAt(collectVisualTables(view.state), view.posAtDOM(container));
  } catch {
    return null;
  }
}
