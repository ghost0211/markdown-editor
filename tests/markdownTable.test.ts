import { describe, it, expect } from 'vitest';
import {
  displayWidth,
  findTableBlock,
  formatTableLines,
  isSingleUrl,
  linkifySelection,
  navigateTable,
  rowsToMarkdownTable,
  splitTableRow,
} from '../src/lib/markdownTable';

describe('markdownTable & paste helpers', () => {
  it('computes CJK-aware display widths', () => {
    expect(displayWidth('abc')).toBe(3);
    expect(displayWidth('中文')).toBe(4);
    expect(displayWidth('A中B')).toBe(4);
  });

  it('splits table rows while respecting escaped pipes and inline code spans', () => {
    expect(splitTableRow('| a | b\\|c | `x|y` |')).toEqual(['a', 'b\\|c', '`x|y`']);
  });

  it('aligns columns with left, center, and right delimiter markers and CJK text', () => {
    const raw = ['| 名称 | Qty | Note |', '| :--- | ---: | :---: |', '| 苹果 | 12 | ok |'];
    const formatted = formatTableLines(raw);
    expect(formatted).toEqual([
      '| 名称 | Qty | Note |',
      '| :--- | --: | :--: |',
      '| 苹果 |  12 |  ok  |',
    ]);
  });

  it('locates table blocks and ignores lone pipe lines without delimiters', () => {
    const lines = ['intro', '| A | B |', '| --- | --- |', '| 1 | 2 |', 'outro'];
    expect(findTableBlock(lines, 2)).toEqual({ start: 1, end: 3 });
    expect(findTableBlock(['| not a table |', 'plain'], 0)).toBeNull();
  });

  it('navigates forward with Tab, skips the delimiter row, and appends a new row at the end', () => {
    const rows = ['| A | B |', '| --- | --- |', '| 1 | 2 |'];
    // From header col 0 -> header col 1
    const step1 = navigateTable(rows, 0, 2, 1)!;
    expect(step1.row).toBe(0);
    expect(step1.lines[step1.row].slice(step1.from, step1.to)).toBe('B');

    // From header col 1 -> skips row 1 (delimiter) -> row 2 col 0
    const step2 = navigateTable(step1.lines, 0, step1.to, 1)!;
    expect(step2.row).toBe(2);
    expect(step2.lines[step2.row].slice(step2.from, step2.to)).toBe('1');

    // From last cell (row 2 col 1) -> appends row 3 and places cursor in col 0
    const stepLast = navigateTable(rows, 2, rows[2].length - 2, 1)!;
    expect(stepLast.row).toBe(3);
    expect(stepLast.lines).toHaveLength(4);
  });

  it('navigates backward with Shift+Tab and skips the delimiter row', () => {
    const rows = ['| A | B |', '| --- | --- |', '| 1 | 2 |'];
    const back = navigateTable(rows, 2, 2, -1)!;
    expect(back.row).toBe(0);
    expect(back.lines[back.row].slice(back.from, back.to)).toBe('B');
  });

  it('converts 2D tabular rows into an aligned Markdown table and escapes pipes/newlines', () => {
    const md = rowsToMarkdownTable([
      ['Item', 'Desc'],
      ['A', 'line1\nline2 | pipe'],
    ]);
    expect(md).toContain('\\|');
    expect(md.split('\n')).toHaveLength(3);
  });

  it('detects single http(s) URLs and formats selected text as a link', () => {
    expect(isSingleUrl('https://example.com/docs?q=1')).toBe(true);
    expect(isSingleUrl('http://localhost:5173')).toBe(true);
    expect(isSingleUrl('https://a.com https://b.com')).toBe(false);
    expect(isSingleUrl('javascript:alert(1)')).toBe(false);
    expect(linkifySelection('Docs', ' https://example.com ')).toBe('[Docs](https://example.com)');
  });
});
