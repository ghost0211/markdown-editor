import { describe, it, expect } from 'vitest';
import { EditorState } from '@codemirror/state';
import { SearchQuery } from '@codemirror/search';
import { getActiveParagraphRange } from '../src/lib/focusMode';
import {
  computeSearchMatchSummary,
  formatSearchMatchSummary,
} from '../src/lib/searchMatchCount';

describe('Editor enhancements (Focus Mode & Search Match Counter)', () => {
  describe('getActiveParagraphRange', () => {
    it('selects contiguous non-blank lines as the active paragraph', () => {
      const lines = ['first para 1', 'first para 2', '', 'second para 1', 'second para 2', ''];
      expect(getActiveParagraphRange(lines, 0)).toEqual({ start: 0, end: 1 });
      expect(getActiveParagraphRange(lines, 1)).toEqual({ start: 0, end: 1 });
      expect(getActiveParagraphRange(lines, 2)).toEqual({ start: 2, end: 2 });
      expect(getActiveParagraphRange(lines, 4)).toEqual({ start: 3, end: 4 });
    });

    it('treats an entire fenced code block (including blank lines inside) as one unit', () => {
      const lines = ['intro', '```ts', 'const a = 1;', '', 'const b = 2;', '```', 'outro'];
      expect(getActiveParagraphRange(lines, 3)).toEqual({ start: 1, end: 5 });
      expect(getActiveParagraphRange(lines, 0)).toEqual({ start: 0, end: 0 });
    });
  });

  describe('computeSearchMatchSummary & formatSearchMatchSummary', () => {
    it('returns null for empty queries and 0 / 0 when nothing matches', () => {
      const state = EditorState.create({ doc: 'alpha beta alpha gamma' });
      expect(computeSearchMatchSummary(state, new SearchQuery({ search: '' }))).toBeNull();

      const none = computeSearchMatchSummary(state, new SearchQuery({ search: 'zzz' }));
      expect(none).toEqual({ total: 0, current: 0, capped: false });
      expect(formatSearchMatchSummary(none)).toBe('0 / 0');
    });

    it('identifies the 1-based index when selection matches an occurrence', () => {
      const doc = 'foo bar foo baz foo';
      // Select the second 'foo' at [8, 11]
      const state = EditorState.create({
        doc,
        selection: { anchor: 8, head: 11 },
      });
      const summary = computeSearchMatchSummary(state, new SearchQuery({ search: 'foo' }));
      expect(summary).toEqual({ total: 3, current: 2, capped: false });
      expect(formatSearchMatchSummary(summary)).toBe('2 / 3');
    });

    it('caps match counting cleanly on repetitive queries', () => {
      const state = EditorState.create({ doc: 'a'.repeat(50) });
      const summary = computeSearchMatchSummary(state, new SearchQuery({ search: 'a' }), 10);
      expect(summary).toEqual({ total: 10, current: 0, capped: true });
      expect(formatSearchMatchSummary(summary)).toBe('– / 10+');
    });
  });
});
