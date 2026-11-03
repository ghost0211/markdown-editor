import { describe, it, expect } from 'vitest';
import { findLastIndexWhere } from '../src/components/Preview';

/**
 * The scroll-sync anchor lookup used to be a linear scan executed on every
 * scroll event in both directions. It is now a binary search, so the
 * monotonicity assumptions and boundary behaviour need explicit coverage.
 */
describe('findLastIndexWhere (scroll-sync anchor lookup)', () => {
  const anchors = [
    { line: 1, top: 0 },
    { line: 4, top: 120 },
    { line: 9, top: 300 },
    { line: 20, top: 640 },
  ];

  it('returns -1 when no item satisfies the predicate', () => {
    expect(findLastIndexWhere(anchors, (a) => a.line <= 0)).toBe(-1);
    expect(findLastIndexWhere([], (a: { line: number }) => a.line <= 5)).toBe(-1);
  });

  it('returns the matching index for an exact hit', () => {
    expect(findLastIndexWhere(anchors, (a) => a.line <= 1)).toBe(0);
    expect(findLastIndexWhere(anchors, (a) => a.line <= 9)).toBe(2);
    expect(findLastIndexWhere(anchors, (a) => a.line <= 20)).toBe(3);
  });

  it('returns the last entry at or before a line between anchors', () => {
    expect(findLastIndexWhere(anchors, (a) => a.line <= 2)).toBe(0);
    expect(findLastIndexWhere(anchors, (a) => a.line <= 8)).toBe(1);
    expect(findLastIndexWhere(anchors, (a) => a.line <= 19)).toBe(2);
    expect(findLastIndexWhere(anchors, (a) => a.line <= 5000)).toBe(3);
  });

  it('agrees with a linear scan across the whole range (both directions)', () => {
    const linearLine = (line: number) => {
      let found = -1;
      anchors.forEach((a, i) => {
        if (a.line <= line) found = i;
      });
      return found;
    };
    for (let line = -3; line <= 25; line++) {
      expect(findLastIndexWhere(anchors, (a) => a.line <= line)).toBe(linearLine(line));
    }

    // Scroll-position direction (used by getTopSourceLine)
    const linearTop = (top: number) => {
      let found = -1;
      anchors.forEach((a, i) => {
        if (a.top <= top) found = i;
      });
      return found;
    };
    for (let top = -50; top <= 700; top += 10) {
      expect(findLastIndexWhere(anchors, (a) => a.top <= top)).toBe(linearTop(top));
    }
  });

  it('scales to large documents (O(log n) lookup)', () => {
    const big = Array.from({ length: 20000 }, (_, i) => ({ line: i + 1, top: i * 20 }));
    expect(findLastIndexWhere(big, (a) => a.line <= 1)).toBe(0);
    expect(findLastIndexWhere(big, (a) => a.line <= 12345)).toBe(12344);
    expect(findLastIndexWhere(big, (a) => a.line <= 20000)).toBe(19999);
  });
});
