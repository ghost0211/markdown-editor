import { describe, it, expect, beforeEach } from 'vitest';
import {
  MAX_RECENT_FILES,
  RECENT_FILES_STORAGE_KEY,
  addRecentFile,
  isRecordablePath,
  loadRecentFiles,
  pushClosedFile,
  removeRecentFile,
  sanitizeRecentFiles,
  saveRecentFiles,
} from '../src/lib/recentFiles';

describe('recentFiles', () => {
  beforeEach(() => {
    // The suite runs in a node environment, so provide a minimal localStorage.
    const store = new Map<string, string>();
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      writable: true,
      value: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => void store.set(key, String(value)),
        removeItem: (key: string) => void store.delete(key),
        clear: () => store.clear(),
      },
    });
  });

  it('only records real file paths', () => {
    expect(isRecordablePath('C:\\docs\\a.md')).toBe(true);
    expect(isRecordablePath('browser://a.md')).toBe(false);
    expect(isRecordablePath('')).toBe(false);
    expect(isRecordablePath(null)).toBe(false);
    expect(addRecentFile([], 'browser://a.md')).toEqual([]);
  });

  it('puts the newest file first with its file name', () => {
    let list = addRecentFile([], 'C:\\docs\\a.md', 1);
    list = addRecentFile(list, 'C:\\docs\\b.md', 2);
    expect(list.map((f) => f.name)).toEqual(['b.md', 'a.md']);
    expect(list[0]).toMatchObject({ path: 'C:\\docs\\b.md', openedAt: 2 });
  });

  it('deduplicates by normalized path and moves the file to the front', () => {
    let list = addRecentFile([], 'C:\\Docs\\a.md', 1);
    list = addRecentFile(list, 'C:\\docs\\b.md', 2);
    list = addRecentFile(list, 'c:/docs/a.md', 3);
    expect(list).toHaveLength(2);
    expect(list[0].path).toBe('c:/docs/a.md');
  });

  it('caps the list length', () => {
    let list: ReturnType<typeof addRecentFile> = [];
    for (let i = 0; i < MAX_RECENT_FILES + 5; i++) list = addRecentFile(list, `C:\\d\\f${i}.md`, i);
    expect(list).toHaveLength(MAX_RECENT_FILES);
    expect(list[0].name).toBe(`f${MAX_RECENT_FILES + 4}.md`);
  });

  it('removes entries and keeps identity when nothing changed', () => {
    const list = addRecentFile([], 'C:\\d\\a.md', 1);
    expect(removeRecentFile(list, 'c:/D/A.md')).toEqual([]);
    expect(removeRecentFile(list, 'C:\\d\\other.md')).toBe(list);
  });

  it('sanitizes malformed persisted data', () => {
    const result = sanitizeRecentFiles([
      { path: 'C:\\d\\a.md', openedAt: 5 },
      { path: 'C:\\d\\a.md', openedAt: 9 },
      { path: 'browser://x.md' },
      { path: 42 },
      null,
      'nope',
      { path: 'C:\\d\\b.md', openedAt: 'bad' },
    ]);
    expect(result.map((f) => f.name)).toEqual(['a.md', 'b.md']);
    expect(result[1].openedAt).toBe(0);
    expect(sanitizeRecentFiles('garbage')).toEqual([]);
  });

  it('round-trips through localStorage and survives corrupt JSON', () => {
    const list = addRecentFile([], 'C:\\d\\a.md', 1);
    saveRecentFiles(list);
    expect(loadRecentFiles()).toEqual(list);

    localStorage.setItem(RECENT_FILES_STORAGE_KEY, '{not json');
    expect(loadRecentFiles()).toEqual([]);
  });

  it('tracks closed files newest-last without duplicates', () => {
    let stack: string[] = [];
    stack = pushClosedFile(stack, 'C:\\d\\a.md');
    stack = pushClosedFile(stack, 'C:\\d\\b.md');
    stack = pushClosedFile(stack, 'c:/d/a.md');
    expect(stack).toEqual(['C:\\d\\b.md', 'c:/d/a.md']);
    expect(pushClosedFile(stack, null)).toBe(stack);
    expect(pushClosedFile(stack, 'browser://x.md')).toBe(stack);
    expect(pushClosedFile(['1.md', '2.md'], 'C:\\d\\3.md', 2)).toEqual(['2.md', 'C:\\d\\3.md']);
  });
});
