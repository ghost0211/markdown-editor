import { describe, it, expect } from 'vitest';
import { toggleTaskCheckboxAtLine } from '../src/lib/taskList';

/**
 * Coverage for the preview's clickable task-list checkboxes (1.5.0).
 * Before this, remark-gfm's `disabled` checkboxes made the preview read-only
 * for task items.
 */
describe('toggleTaskCheckboxAtLine', () => {
  it('checks an unchecked item', () => {
    const content = '- [ ] buy milk\n- [ ] walk dog';
    expect(toggleTaskCheckboxAtLine(content, 2)).toBe('- [ ] buy milk\n- [x] walk dog');
  });

  it('unchecks a checked item', () => {
    expect(toggleTaskCheckboxAtLine('- [x] done', 1)).toBe('- [ ] done');
  });

  it('accepts uppercase X and other bullet styles', () => {
    expect(toggleTaskCheckboxAtLine('* [X] done', 1)).toBe('* [ ] done');
    expect(toggleTaskCheckboxAtLine('+ [ ] todo', 1)).toBe('+ [x] todo');
    expect(toggleTaskCheckboxAtLine('1. [ ] first', 1)).toBe('1. [x] first');
  });

  it('preserves indentation and quote prefixes', () => {
    expect(toggleTaskCheckboxAtLine('  - [ ] nested', 1)).toBe('  - [x] nested');
    expect(toggleTaskCheckboxAtLine('> - [ ] quoted', 1)).toBe('> - [x] quoted');
  });

  it('leaves surrounding text untouched', () => {
    const content = '# Title\n\n- [ ] task **bold** `code`\n\nEnd.';
    const next = toggleTaskCheckboxAtLine(content, 3);
    expect(next).toBe('# Title\n\n- [x] task **bold** `code`\n\nEnd.');
  });

  it('only touches the requested line', () => {
    const content = '- [ ] a\n- [ ] b\n- [ ] c';
    expect(toggleTaskCheckboxAtLine(content, 2)).toBe('- [ ] a\n- [x] b\n- [ ] c');
  });

  it('returns null for a line that is not a task item', () => {
    const content = '- [ ] a\nplain paragraph';
    expect(toggleTaskCheckboxAtLine(content, 2)).toBeNull();
  });

  it('returns null for out-of-range or invalid lines', () => {
    expect(toggleTaskCheckboxAtLine('- [ ] a', 2)).toBeNull();
    expect(toggleTaskCheckboxAtLine('- [ ] a', 0)).toBeNull();
    expect(toggleTaskCheckboxAtLine('- [ ] a', 1.5)).toBeNull();
  });

  it('handles CRLF content without corrupting line endings', () => {
    // CRLF is split on '\n', leaving '\r' at the end of each line; the marker
    // flip must not swallow it.
    const content = '- [ ] a\r\n- [ ] b';
    expect(toggleTaskCheckboxAtLine(content, 1)).toBe('- [x] a\r\n- [ ] b');
  });
});
