import { parseInlineMarkdown, type InlineRun } from '@/lib/inlineMarkdown';

export type VisualTableSortKind = 'text' | 'number' | 'date';

export function visualTableCellText(markdown: string): string {
  const text = (runs: readonly InlineRun[]): string => runs.map((run) =>
    run.children ? text(run.children) : run.type === 'break' ? ' ' : run.text ?? ''
  ).join('');
  return text(parseInlineMarkdown(markdown, true)).trim();
}

function parseNumber(value: string): number | null {
  if (!/^[+-]?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?%?$/.test(value) &&
      !/^[+-]?\.\d+%?$/.test(value)) return null;
  const number = Number(value.replace(/[,%]/g, '')) / (value.endsWith('%') ? 100 : 1);
  return Number.isFinite(number) ? number : null;
}

function parseDate(value: string): number | null {
  const match = /^(\d{4})(?:-(\d{1,2})-(\d{1,2})|\/(\d{1,2})\/(\d{1,2})|年(\d{1,2})月(\d{1,2})日?)$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2] ?? match[4] ?? match[6]);
  const day = Number(match[3] ?? match[5] ?? match[7]);
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
    ? date.getTime() : null;
}

/** Returns stable, 1-based body row indices. Empty and invalid values sort last. */
export function sortedVisualTableRows(
  cells: readonly (readonly string[])[], column: number, kind: VisualTableSortKind, direction: 1 | -1, locale: string
): number[] {
  const collator = new Intl.Collator(locale, { sensitivity: 'base', numeric: true });
  const values = cells.slice(1).map((row, index) => {
    const text = visualTableCellText(row[column] ?? '');
    const key = kind === 'number' ? parseNumber(text) : kind === 'date' ? parseDate(text) : text || null;
    return { row: index + 1, key };
  });
  return values.sort((a, b) => {
    if (a.key === null) return b.key === null ? 0 : 1;
    if (b.key === null) return -1;
    const result = typeof a.key === 'number' && typeof b.key === 'number'
      ? a.key - b.key : collator.compare(String(a.key), String(b.key));
    return direction * result;
  }).map(({ row }) => row);
}
