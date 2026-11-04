import { describe, expect, it } from 'vitest';
import { continueListAt, getListContinuation } from '../src/lib/listContinuation';
import { getMarkdownShortcutAction } from '../src/lib/editorKeymap';

describe('Markdown formatting shortcuts', () => {
  it.each([
    ['Mod-b', 'bold'],
    ['Mod-i', 'italic'],
    ['Mod-k', 'link'],
  ])('maps %s to %s', (key, action) => {
    expect(getMarkdownShortcutAction(key)).toBe(action);
  });

  it('normalizes modifier case and ignores unknown keys', () => {
    expect(getMarkdownShortcutAction('MOD-B')).toBe('bold');
    expect(getMarkdownShortcutAction('Mod-x')).toBeUndefined();
  });
});

describe('Markdown list continuation', () => {
  it('continues unordered lists with the same bullet', () => {
    expect(continueListAt('- first', 7)).toEqual({ text: '- first\n- ', cursor: 10 });
    expect(continueListAt('* first', 7)?.text).toBe('* first\n* ');
    expect(continueListAt('+ first', 7)?.text).toBe('+ first\n+ ');
  });

  it('increments ordered list numbers', () => {
    expect(continueListAt('3. third', 8)).toEqual({ text: '3. third\n4. ', cursor: 12 });
    expect(continueListAt('9) ninth', 8)?.text).toBe('9) ninth\n10) ');
  });

  it('creates an unchecked next task even after a checked task', () => {
    expect(continueListAt('- [x] done', 10)?.text).toBe('- [x] done\n- [ ] ');
    expect(continueListAt('1. [ ] todo', 11)?.text).toBe('1. [ ] todo\n2. [ ] ');
  });

  it('preserves indentation and blockquote markers', () => {
    expect(continueListAt('  - nested', 10)?.text).toBe('  - nested\n  - ');
    expect(continueListAt('> - quoted', 10)?.text).toBe('> - quoted\n> - ');
    expect(continueListAt('> 2. item', 9)?.text).toBe('> 2. item\n> 3. ');
  });

  it('splits a non-empty item at the cursor', () => {
    expect(continueListAt('- hello world', 7)).toEqual({
      text: '- hello\n-  world',
      cursor: 10,
    });
  });

  it('terminates the list on an empty item', () => {
    expect(continueListAt('- first\n- ', 10)).toEqual({
      text: '- first\n\n',
      cursor: 9,
    });
    expect(continueListAt('- [ ] ', 6)?.text).toBe('\n');
  });

  it('does not handle plain text or invalid cursor positions', () => {
    expect(getListContinuation('plain text')).toBeNull();
    expect(continueListAt('plain', 2)).toBeNull();
    expect(continueListAt('- item', -1)).toBeNull();
    expect(continueListAt('- item', 99)).toBeNull();
  });
});
