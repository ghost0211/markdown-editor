import { describe, it, expect } from 'vitest';
import {
  getDisambiguatedTabTitles,
  getParentFolderName,
} from '../src/lib/documentUtils';
import { DocumentTab } from '../src/types';

const makeTab = (id: string, title: string, filePath: string | null): DocumentTab => ({
  id,
  title,
  filePath,
  content: '',
  savedContent: '',
  isDirty: false,
  cursorLine: 1,
  cursorCol: 1,
});

describe('getParentFolderName', () => {
  it('extracts the folder for Windows and POSIX paths', () => {
    expect(getParentFolderName('C:\\docs\\notes\\README.md')).toBe('notes');
    expect(getParentFolderName('/home/me/docs/README.md')).toBe('docs');
  });

  it('returns empty string when there is no parent folder', () => {
    expect(getParentFolderName(null)).toBe('');
    expect(getParentFolderName(undefined)).toBe('');
    expect(getParentFolderName('README.md')).toBe('');
  });
});

describe('getDisambiguatedTabTitles', () => {
  it('leaves unique titles untouched', () => {
    const tabs = [
      makeTab('a', 'README.md', 'C:/docs/README.md'),
      makeTab('b', 'GUIDE.md', 'C:/docs/GUIDE.md'),
    ];
    const titles = getDisambiguatedTabTitles(tabs);

    expect(titles.get('a')).toBe('README.md');
    expect(titles.get('b')).toBe('GUIDE.md');
  });

  it('appends the parent folder to duplicated file names', () => {
    const tabs = [
      makeTab('a', 'README.md', 'C:/proj/docs/README.md'),
      makeTab('b', 'README.md', 'C:/proj/website/README.md'),
      makeTab('c', 'GUIDE.md', 'C:/proj/GUIDE.md'),
    ];
    const titles = getDisambiguatedTabTitles(tabs);

    expect(titles.get('a')).toBe('README.md (docs)');
    expect(titles.get('b')).toBe('README.md (website)');
    // Unrelated tabs keep their plain title.
    expect(titles.get('c')).toBe('GUIDE.md');
  });

  it('falls back to the plain title when a duplicate has no file path', () => {
    const tabs = [
      makeTab('a', '未命名', null),
      makeTab('b', '未命名', null),
    ];
    const titles = getDisambiguatedTabTitles(tabs);

    expect(titles.get('a')).toBe('未命名');
    expect(titles.get('b')).toBe('未命名');
  });

  it('keeps every tab addressable', () => {
    const tabs = [makeTab('a', 'X.md', 'C:/a/X.md')];
    expect(getDisambiguatedTabTitles(tabs).size).toBe(1);
    expect(getDisambiguatedTabTitles([]).size).toBe(0);
  });
});
