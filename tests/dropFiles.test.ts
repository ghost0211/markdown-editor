import { describe, it, expect } from 'vitest';
import { dragCarriesFiles, filterMarkdownFiles, isMarkdownFileName } from '../src/lib/dropFiles';

const file = (name: string) => new File(['x'], name);

describe('dropFiles', () => {
  it('recognizes supported markdown / text extensions case-insensitively', () => {
    for (const name of ['a.md', 'A.MD', 'b.markdown', 'c.mdown', 'd.mkd', 'notes.txt']) {
      expect(isMarkdownFileName(name)).toBe(true);
    }
    for (const name of ['a.png', 'a.md.exe', 'md', 'a.docx']) {
      expect(isMarkdownFileName(name)).toBe(false);
    }
  });

  it('keeps only markdown files from a mixed drop', () => {
    const result = filterMarkdownFiles([file('a.md'), file('b.png'), file('c.txt')]);
    expect(result.map((f) => f.name)).toEqual(['a.md', 'c.txt']);
  });

  it('detects file drags but not text or tab drags', () => {
    expect(dragCarriesFiles({ types: ['Files'] })).toBe(true);
    expect(dragCarriesFiles({ types: ['text/plain', 'Files'] })).toBe(true);
    expect(dragCarriesFiles({ types: ['text/plain'] })).toBe(false);
    expect(dragCarriesFiles(null)).toBe(false);
    expect(dragCarriesFiles(undefined)).toBe(false);
  });
});
