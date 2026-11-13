/**
 * Pure helpers for editing GFM tables in the source editor: column alignment
 * (CJK-aware), Tab / Shift+Tab cell navigation, and converting pasted tabular
 * data into Markdown.
 */

export type ColumnAlign = 'left' | 'center' | 'right' | 'none';

/** Terminal-style display width: CJK / full-width characters take two columns. */
export function displayWidth(text: string): number {
  let width = 0;
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    const wide =
      (code >= 0x1100 && code <= 0x115f) ||
      (code >= 0x2e80 && code <= 0xa4cf) ||
      (code >= 0xac00 && code <= 0xd7a3) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xfe30 && code <= 0xfe6f) ||
      (code >= 0xff00 && code <= 0xff60) ||
      (code >= 0xffe0 && code <= 0xffe6) ||
      (code >= 0x1f300 && code <= 0x1faff) ||
      (code >= 0x20000 && code <= 0x3fffd);
    width += wide ? 2 : 1;
  }
  return width;
}

export function isTableRowLine(line: string): boolean {
  return line.trim().startsWith('|');
}

/** Splits a table row into trimmed cells, honouring `\|` escapes and `code` spans. */
export function splitTableRow(line: string): string[] {
  let text = line.trim();
  if (text.startsWith('|')) text = text.slice(1);
  if (text.endsWith('|') && !text.endsWith('\\|')) text = text.slice(0, -1);

  const cells: string[] = [];
  let current = '';
  let inCode = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '\\' && i + 1 < text.length) {
      current += char + text[i + 1];
      i++;
    } else if (char === '`') {
      inCode = !inCode;
      current += char;
    } else if (char === '|' && !inCode) {
      cells.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  cells.push(current.trim());
  return cells;
}

export function isDelimiterRow(cells: string[]): boolean {
  return cells.length > 0 && cells.every((cell) => /^:?-+:?$/.test(cell));
}

function alignmentOf(cell: string): ColumnAlign {
  const left = cell.startsWith(':');
  const right = cell.endsWith(':');
  if (left && right) return 'center';
  if (right) return 'right';
  if (left) return 'left';
  return 'none';
}

function padCell(text: string, width: number, align: ColumnAlign): string {
  const gap = Math.max(0, width - displayWidth(text));
  if (align === 'right') return ' '.repeat(gap) + text;
  if (align === 'center') {
    const left = Math.floor(gap / 2);
    return ' '.repeat(left) + text + ' '.repeat(gap - left);
  }
  return text + ' '.repeat(gap);
}

function delimiterCell(width: number, align: ColumnAlign): string {
  switch (align) {
    case 'left':
      return ':' + '-'.repeat(width - 1);
    case 'right':
      return '-'.repeat(width - 1) + ':';
    case 'center':
      return ':' + '-'.repeat(Math.max(1, width - 2)) + ':';
    default:
      return '-'.repeat(width);
  }
}

export interface TableBlock {
  /** Index in `lines` of the first row of the table. */
  start: number;
  /** Index in `lines` of the last row of the table (inclusive). */
  end: number;
}

/**
 * Finds the GFM table (header + delimiter + body) containing `lineIndex`, or
 * null when that line is not part of a valid table.
 */
export function findTableBlock(lines: string[], lineIndex: number): TableBlock | null {
  if (lineIndex < 0 || lineIndex >= lines.length || !isTableRowLine(lines[lineIndex])) return null;
  let start = lineIndex;
  while (start > 0 && isTableRowLine(lines[start - 1])) start--;
  let end = lineIndex;
  while (end < lines.length - 1 && isTableRowLine(lines[end + 1])) end++;

  if (end - start < 1) return null;
  if (!isDelimiterRow(splitTableRow(lines[start + 1]))) return null;
  return { start, end };
}

/** Re-aligns every row of a table so the pipes line up. Returns the new lines. */
export function formatTableLines(rows: string[]): string[] {
  const parsed = rows.map(splitTableRow);
  if (parsed.length < 2 || !isDelimiterRow(parsed[1])) return rows;

  const columns = Math.max(...parsed.map((cells) => cells.length));
  const aligns: ColumnAlign[] = Array.from({ length: columns }, (_, i) =>
    parsed[1][i] !== undefined ? alignmentOf(parsed[1][i]) : 'none'
  );
  const widths = Array.from({ length: columns }, (_, col) =>
    Math.max(
      3,
      ...parsed.map((cells, row) =>
        row === 1 ? 3 : displayWidth(cells[col] ?? '')
      )
    )
  );

  return parsed.map((cells, row) => {
    const rendered = widths.map((width, col) => {
      if (row === 1) return delimiterCell(width, aligns[col]);
      return padCell(cells[col] ?? '', width, aligns[col] === 'none' ? 'left' : aligns[col]);
    });
    return `| ${rendered.join(' | ')} |`;
  });
}

/** Column offsets of the content of each cell in an already formatted row. */
export function cellContentRanges(formattedLine: string): Array<{ from: number; to: number }> {
  const ranges: Array<{ from: number; to: number }> = [];
  let inCode = false;
  let cellStart = -1;
  for (let i = 0; i < formattedLine.length; i++) {
    const char = formattedLine[i];
    if (char === '\\') {
      i++;
      continue;
    }
    if (char === '`') inCode = !inCode;
    if (char === '|' && !inCode) {
      if (cellStart >= 0) ranges.push(trimRange(formattedLine, cellStart, i));
      cellStart = i + 1;
    }
  }
  return ranges;
}

function trimRange(text: string, from: number, to: number): { from: number; to: number } {
  let start = from;
  let end = to;
  while (start < end && text[start] === ' ') start++;
  while (end > start && text[end - 1] === ' ') end--;
  return { from: start, to: end };
}

/** Index of the cell the column offset `col` falls in (0-based). */
export function cellIndexAtColumn(line: string, col: number): number {
  let index = -1;
  let inCode = false;
  const text = line.slice(0, col);
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '\\') {
      i++;
      continue;
    }
    if (char === '`') inCode = !inCode;
    if (char === '|' && !inCode) index++;
  }
  return Math.max(0, index);
}

export interface TableNavigationResult {
  /** The whole table, re-aligned (and with a new row when Tab ran off the end). */
  lines: string[];
  /** Row index within `lines` and the column range to select. */
  row: number;
  from: number;
  to: number;
}

/**
 * Computes the result of pressing Tab (direction 1) or Shift+Tab (-1) with the
 * cursor in row `rowIndex` at column `col` of `tableLines`. Returns null when
 * the block is not a table.
 */
export function navigateTable(
  tableLines: string[],
  rowIndex: number,
  col: number,
  direction: 1 | -1
): TableNavigationResult | null {
  const parsed = tableLines.map(splitTableRow);
  if (parsed.length < 2 || !isDelimiterRow(parsed[1])) return null;

  const columns = Math.max(...parsed.map((cells) => cells.length));
  let cell = Math.min(cellIndexAtColumn(tableLines[rowIndex], col), columns - 1);
  let row = rowIndex;
  let lines = tableLines;

  cell += direction;
  if (cell >= columns) {
    cell = 0;
    row += 1;
    if (row === 1) row = 2; // skip the delimiter row
  } else if (cell < 0) {
    cell = columns - 1;
    row -= 1;
    if (row === 1) row = 0;
  }

  if (row < 0) {
    row = 0;
    cell = 0;
  }
  if (row >= tableLines.length) {
    // Tab past the last cell appends an empty row, like a spreadsheet.
    lines = [...tableLines, `| ${Array(columns).fill('').join(' | ')} |`];
  }

  const formatted = formatTableLines(lines);
  const range = cellContentRanges(formatted[row])[cell] ?? { from: 0, to: 0 };
  return { lines: formatted, row, from: range.from, to: range.to };
}

/** Escapes characters that would break a table cell. */
export function escapeCell(text: string): string {
  return text.replace(/\r?\n/g, ' ').replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();
}

/** Builds an aligned Markdown table from rows of plain cell text (first row = header). */
export function rowsToMarkdownTable(rows: string[][]): string {
  const cleaned = rows.filter((row) => row.some((cell) => cell.trim() !== ''));
  if (cleaned.length === 0) return '';
  const columns = Math.max(...cleaned.map((row) => row.length));
  const normalized = cleaned.map((row) =>
    Array.from({ length: columns }, (_, i) => escapeCell(row[i] ?? ''))
  );
  const header = `| ${normalized[0].join(' | ')} |`;
  const delimiter = `| ${Array(columns).fill('---').join(' | ')} |`;
  const body = normalized.slice(1).map((row) => `| ${row.join(' | ')} |`);
  return formatTableLines([header, delimiter, ...body]).join('\n');
}

/** Extracts the rows of the first `<table>` in clipboard HTML (browser only). */
export function parseHtmlTable(html: string): string[][] | null {
  if (typeof DOMParser === 'undefined' || !/<table[\s>]/i.test(html)) return null;
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const table = doc.querySelector('table');
  if (!table) return null;
  const rows = Array.from(table.querySelectorAll('tr')).map((tr) =>
    Array.from(tr.querySelectorAll('th,td')).map((cell) => cell.textContent ?? '')
  );
  return rows.length >= 1 && rows.some((row) => row.length >= 2) ? rows : null;
}

const SINGLE_URL = /^https?:\/\/[^\s<>]+$/i;

export function isSingleUrl(text: string): boolean {
  return SINGLE_URL.test(text.trim());
}

/** `[selected](url)` for pasting a URL over selected text. */
export function linkifySelection(selected: string, url: string): string {
  return `[${selected}](${url.trim()})`;
}
