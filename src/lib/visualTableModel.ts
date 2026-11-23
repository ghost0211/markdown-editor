import type { EditorState } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';
import { parseXmdTableMarker, type XmdTableStyle } from '@/lib/xmdTable';

/**
 * Pure geometry/validation for the visual GFM table grid.
 *
 * The visual table never re-serializes Markdown through HTML. A table is only
 * rendered when it is a top-level, rectangular GFM table that this module can
 * round-trip exactly; everything else (containers, ragged rows, images, data
 * payloads, oversized tables) is left untouched as source.
 */

export const VISUAL_TABLE_MAX_ROWS = 100;
export const VISUAL_TABLE_MAX_COLUMNS = 20;
export const VISUAL_TABLE_MAX_BYTES = 64 * 1024;

export type VisualTableAlignment = 'left' | 'center' | 'right' | 'none';

/** Display strings for the grid and its context toolbar. */
export interface VisualTableLabels {
  /** Accessible name of the table grid. */
  label: string;
  /** Accessible name of the context toolbar. */
  toolbar: string;
  /** Cell label template, e.g. `第 {row} 行第 {column} 列单元格`. */
  cellLabel: string;
  /** Header cell label template, e.g. `表头第 {column} 列`. */
  headerLabel: string;
  /** Keyboard hint announced through `aria-describedby`. */
  hint: string;
  addRow: string;
  deleteRow: string;
  addColumn: string;
  deleteColumn: string;
  alignGroup: string;
  alignLeft: string;
  alignCenter: string;
  alignRight: string;
  alignDefault: string;
  editSource: string;
  /** Shown when the source changed underneath a focused cell. */
  stale: string;
  rowAdded: string;
  rowDeleted: string;
  columnAdded: string;
  columnDeleted: string;
  alignmentChanged: string;
  /** `已达到 {rows} 行上限`. */
  rowLimit: string;
  pasteLimit: string;
  /** `已达到 {columns} 列上限`. */
  columnLimit: string;
  layoutTools?: {
    title: string;
    vertical: string;
    top: string;
    middle: string;
    bottom: string;
    repeat: string;
    default: string;
    yes: string;
    no: string;
    resetWidths: string;
    resize: string;
  };
  dataTools?: {
    title: string;
    column: string;
    columnNumber: string;
    filter: string;
    sortType: string;
    text: string;
    number: string;
    date: string;
    ascending: string;
    descending: string;
    sorted: string;
    visible: string;
    locale: string;
  };
}

export interface VisualTableCellRange {
  from: number;
  to: number;
}

export interface VisualTableInfo {
  /** Start of the header line (including up to three spaces of indentation). */
  from: number;
  /** End of the last row line, excluding its line break. */
  to: number;
  /** 1-based line number of the header row. */
  startLine: number;
  /** Leading indentation (spaces) preserved when the table is serialized. */
  indent: string;
  /** Editable rows, including the header row at index 0. */
  rows: number;
  columns: number;
  alignments: readonly VisualTableAlignment[];
  /** Exact Markdown source of every cell, trimmed. */
  cells: readonly (readonly string[])[];
  /** Absolute source range of every cell's content. */
  cellRanges: readonly (readonly VisualTableCellRange[])[];
  /** Exact table source, used for stale guards. */
  source: string;
  layout?: { style: XmdTableStyle; from: number; to: number };
}

interface ParsedRow {
  cells: string[];
  ranges: VisualTableCellRange[];
}

const INDENT = /^ {0,3}$/;
const ALIGNMENT_CELL = /^:?-+:?$/;
const DATA_PAYLOAD = /(?:data:|blob:)/i;

export function formatVisualTableLabel(
  template: string,
  values: Readonly<Record<string, string | number>>
): string {
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, key: string) =>
    Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : match
  );
}

export function visualTableAlignmentCell(alignment: VisualTableAlignment): string {
  switch (alignment) {
    case 'left':
      return ':---';
    case 'right':
      return '---:';
    case 'center':
      return ':---:';
    default:
      return '---';
  }
}

export function visualTableAlignmentOf(cell: string): VisualTableAlignment | null {
  if (!ALIGNMENT_CELL.test(cell)) return null;
  const left = cell.startsWith(':');
  const right = cell.endsWith(':');
  if (left && right) return 'center';
  if (right) return 'right';
  if (left) return 'left';
  return 'none';
}

/** 1-based document line number of an editable row (the delimiter line is skipped). */
export function visualTableRowLine(info: VisualTableInfo, row: number): number {
  return row === 0 ? info.startLine : info.startLine + row + 1;
}

/** Wrapping Tab/Shift+Tab neighbor inside the grid. */
export function visualTableCellNeighbor(
  rows: number,
  columns: number,
  row: number,
  column: number,
  direction: 1 | -1
): { row: number; column: number } {
  const total = rows * columns;
  const index = (row * columns + column + direction + total) % total;
  return { row: Math.floor(index / columns), column: index % columns };
}

export interface VisualTableCellSerialization {
  text: string;
  /** Maps a boundary of the input value into the serialized Markdown source. */
  mapBoundary(index: number): number;
}

/**
 * Escapes a cell value so it can never add a column or a row, and returns a
 * boundary map so an input selection can be preserved when the action falls
 * back to the source.
 */
export function serializeVisualTableCellWithMap(value: string): VisualTableCellSerialization {
  const chars: { char: string; from: number; to: number }[] = [];
  for (let i = 0; i < value.length; i++) {
    const from = i;
    let char = value[i];
    if (char === '\r') {
      if (value[i + 1] === '\n') i++;
      char = ' ';
    } else if (char === '\n' || char === '\t') {
      char = ' ';
    }
    chars.push({ char, from, to: i + 1 });
  }

  let start = 0;
  let end = chars.length;
  while (start < end && chars[start].char === ' ') start++;
  while (end > start && chars[end - 1].char === ' ') end--;

  const boundaries = new Array<number>(value.length + 1).fill(0);
  let output = '';
  for (let index = start; index < end; index++) {
    const item = chars[index];
    boundaries[item.from] = output.length;
    let backslashes = 0;
    for (let i = output.length - 1; i >= 0 && output[i] === '\\'; i--) backslashes++;
    if (item.char === '|' && backslashes % 2 === 0) output += '\\';
    output += item.char;
    for (let i = item.from + 1; i <= item.to; i++) boundaries[i] = output.length;
  }
  const trailingFrom = end > start ? chars[end - 1].to : 0;
  for (let i = trailingFrom; i <= value.length; i++) boundaries[i] = output.length;

  return {
    text: output,
    mapBoundary(index: number): number {
      return boundaries[Math.max(0, Math.min(value.length, index))];
    },
  };
}

/** Escapes a cell value so it can never add a column or a row. */
export function serializeVisualTableCell(value: string): string {
  return serializeVisualTableCellWithMap(value).text;
}

/** Serializes one row with its original indentation and exact cell sources. */
export function serializeVisualTableRow(indent: string, cells: readonly string[]): string {
  return `${indent}| ${cells.join(' | ')} |`;
}

export function serializeVisualTable(info: VisualTableInfo, cells: readonly (readonly string[])[],
  alignments: readonly VisualTableAlignment[]): string {
  const lines = [serializeVisualTableRow(info.indent, cells[0])];
  lines.push(`${info.indent}| ${alignments.map(visualTableAlignmentCell).join(' | ')} |`);
  for (let row = 1; row < cells.length; row++) lines.push(serializeVisualTableRow(info.indent, cells[row]));
  return lines.join('\n');
}

function isEscaped(text: string, index: number): boolean {
  let backslashes = 0;
  for (let i = index - 1; i >= 0 && text[i] === '\\'; i--) backslashes++;
  return backslashes % 2 === 1;
}

/**
 * Parses one GFM table row that starts and ends with an unescaped pipe.
 *
 * `lineStart` is the absolute document offset of the line. Cell content ranges
 * exclude the padding spaces around the pipes so edits only ever touch the
 * cell itself. Escaped pipes (`\|`) stay inside a cell; code spans do not
 * protect pipes (matching GFM), so a row that would split differently falls
 * back to source through the rectangularity checks in `readVisualTable`.
 */
type SyntaxNode = ReturnType<typeof syntaxTree>['topNode'];

function parseCell(line: string, segment: number, end: number, lineStart: number): { text: string; range: VisualTableCellRange } {
  const raw = line.slice(segment, end);
  const text = raw.trim();
  if (text === '') return { text: '', range: { from: lineStart + segment, to: lineStart + segment } };
  const leading = raw.length - raw.trimStart().length;
  return { text, range: { from: lineStart + segment + leading, to: lineStart + segment + leading + text.length } };
}

export function parseVisualTableRow(line: string, lineStart: number): ParsedRow | null {
  const first = line.search(/[^ ]/);
  if (first < 0) return null;
  const last = line.length - 1;
  if (line[last] !== '|' || isEscaped(line, last)) return null;
  if (line[first] !== '|') return null;

  const cells: string[] = [];
  const ranges: VisualTableCellRange[] = [];
  let segment = first + 1;
  for (let i = first + 1; i < last; i++) {
    const char = line[i];
    if (char === '\\') {
      i++;
      continue;
    }
    if (char !== '|') continue;
    const cell = parseCell(line, segment, i, lineStart);
    cells.push(cell.text);
    ranges.push(cell.range);
    segment = i + 1;
  }
  const cell = parseCell(line, segment, last, lineStart);
  cells.push(cell.text);
  ranges.push(cell.range);

  return { cells, ranges };
}

function tableHasImage(node: SyntaxNode): boolean {
  let found = false;
  node.toTree().iterate({
    enter(child) {
      if (child.name === 'Image') {
        found = true;
        return false;
      }
      return undefined;
    },
  });
  return found;
}

/**
 * Validates one parser `Table` node and extracts its exact grid. Returns null
 * for every unsupported shape, so the caller renders source instead.
 */
export function readVisualTable(state: EditorState, node: SyntaxNode): VisualTableInfo | null {
  const doc = state.doc;
  if (node.name !== 'Table' || node.from < 0 || node.to > doc.length) return null;
  // Containers (lists, quotes, ...) keep their source; only top-level tables
  // are rendered. This also avoids overlapping block replacements.
  if (node.parent?.name !== 'Document') return null;

  const firstLine = doc.lineAt(node.from);
  const lastLine = doc.lineAt(node.to);
  if (lastLine.to !== node.to) return null;
  const indent = doc.sliceString(firstLine.from, node.from);
  if (!INDENT.test(indent)) return null;
  const lineCount = lastLine.number - firstLine.number + 1;
  if (lineCount < 2) return null;
  const rows = lineCount - 1;
  if (rows > VISUAL_TABLE_MAX_ROWS) return null;
  if (node.to - node.from > VISUAL_TABLE_MAX_BYTES) return null;

  // A partially parsed tree can end in the middle of a table, or right before
  // the remaining rows. Refuse such blocks so the grid can never edit a
  // fragment and leave the rest of the table behind.
  if (firstLine.number > 1 && doc.line(firstLine.number - 1).text.trimStart().startsWith('|')) return null;
  if (lastLine.number < doc.lines && doc.line(lastLine.number + 1).text.trimStart().startsWith('|')) return null;

  const source = doc.sliceString(node.from, node.to);
  // Embedded payloads (including data: images or attachments in ordinary
  // links) are never exposed in a widget; the image chip stays in source.
  if (DATA_PAYLOAD.test(source)) return null;
  // Any Markdown image inside a table falls back to source so the image
  // address chip and the table block never replace overlapping ranges.
  if (tableHasImage(node)) return null;

  const lines: string[] = [];
  for (let line = firstLine.number; line <= lastLine.number; line++) lines.push(doc.line(line).text);
  if (lines.length < 2) return null;

  const header = parseVisualTableRow(lines[0], firstLine.from);
  const delimiter = parseVisualTableRow(lines[1], doc.line(firstLine.number + 1).from);
  if (!header || !delimiter) return null;
  if (header.cells.length < 1 || header.cells.length > VISUAL_TABLE_MAX_COLUMNS) return null;
  if (delimiter.cells.length !== header.cells.length) return null;

  const alignments: VisualTableAlignment[] = [];
  for (const cell of delimiter.cells) {
    const alignment = visualTableAlignmentOf(cell);
    if (!alignment) return null;
    alignments.push(alignment);
  }

  const cells: string[][] = [header.cells];
  const cellRanges: VisualTableCellRange[][] = [header.ranges];
  for (let row = 2; row < lines.length; row++) {
    const parsed = parseVisualTableRow(lines[row], doc.line(firstLine.number + row).from);
    if (!parsed || parsed.cells.length !== header.cells.length) return null;
    cells.push(parsed.cells);
    cellRanges.push(parsed.ranges);
  }

  const previous = firstLine.number > 1 ? doc.line(firstLine.number - 1) : undefined;
  const layout = previous && parseXmdTableMarker(previous.text);
  return {
    from: firstLine.from,
    to: lastLine.to,
    startLine: firstLine.number,
    indent,
    rows,
    columns: header.cells.length,
    alignments,
    cells,
    cellRanges,
    source,
    ...(layout && previous && { layout: { style: layout, from: previous.from, to: firstLine.from } }),
  };
}

export function findVisualTableAt(tables: readonly VisualTableInfo[], position: number): VisualTableInfo | null {
  return tables.find((table) => position >= table.from && position <= table.to) ?? null;
}

/** Every top-level standard table in the document, regardless of selection. */
export function collectVisualTables(state: EditorState): VisualTableInfo[] {
  const tree = syntaxTree(state);
  if (tree.length === 0) return [];
  const tables: VisualTableInfo[] = [];
  let child: SyntaxNode | null = tree.topNode.firstChild;
  while (child) {
    if (child.name === 'Table') {
      const info = readVisualTable(state, child);
      if (info) tables.push(info);
    }
    child = child.nextSibling;
  }
  return tables;
}
