import { describe, it, expect } from 'vitest';
import {
  generateDocId,
  getFileNameFromPath,
  normalizePathKey,
  computeSavedTabState,
  createDefaultTab,
  getExportFilename,
  sanitizeRestoredTabs,
  decideExternalChangeAction,
  moveTabState,
  createDiffTabState,
} from '../src/lib/documentUtils';
import { DocumentTab } from '../src/types';

describe('documentUtils', () => {
  describe('generateDocId', () => {
    it('should generate valid doc id starting with doc-', () => {
      const id = generateDocId();
      expect(id).toMatch(/^doc-.+/);
    });

    it('should generate unique ids without collision', () => {
      const ids = new Set<string>();
      const iterations = 500;
      for (let i = 0; i < iterations; i++) {
        const id = generateDocId();
        expect(ids.has(id)).toBe(false);
        ids.add(id);
      }
      expect(ids.size).toBe(iterations);
    });
  });

  describe('getFileNameFromPath', () => {
    it('should extract filename from Windows backslash path', () => {
      expect(getFileNameFromPath('C:\\Users\\User\\Documents\\Note.md')).toBe('Note.md');
    });

    it('should extract filename from POSIX forward slash path', () => {
      expect(getFileNameFromPath('/home/user/workspace/project/README.markdown')).toBe('README.markdown');
    });

    it('should return the filename itself if no directory separators', () => {
      expect(getFileNameFromPath('my-file.txt')).toBe('my-file.txt');
    });

    it('should return fallback if path is empty or null', () => {
      expect(getFileNameFromPath('')).toBe('未命名.md');
      expect(getFileNameFromPath(null)).toBe('未命名.md');
      expect(getFileNameFromPath(undefined)).toBe('未命名.md');
    });
  });

  describe('normalizePathKey', () => {
    it('should treat Windows backslashes and forward slashes identically', () => {
      const key1 = normalizePathKey('C:\\Users\\Work\\doc.md');
      const key2 = normalizePathKey('C:/Users/Work/doc.md');
      expect(key1).toBe('c:/users/work/doc.md');
      expect(key1).toBe(key2);
    });

    it('should ignore letter casing (case-insensitive for Windows filesystems)', () => {
      const keyUpper = normalizePathKey('D:\\Projects\\Notes\\TODO.MD');
      const keyLower = normalizePathKey('d:/projects/notes/todo.md');
      expect(keyUpper).toBe(keyLower);
      expect(keyUpper).toBe('d:/projects/notes/todo.md');
    });

    it('should collapse multiple consecutive slashes', () => {
      const key = normalizePathKey('C:\\\\Users\\\\Work///Docs//file.md');
      expect(key).toBe('c:/users/work/docs/file.md');
    });

    it('should handle UNC paths properly', () => {
      const unc1 = normalizePathKey('\\\\Server\\Share\\Folder\\file.md');
      const unc2 = normalizePathKey('//server/share/folder/file.md');
      expect(unc1).toBe('//server/share/folder/file.md');
      expect(unc1).toBe(unc2);
    });

    it('should handle custom browser:// protocol', () => {
      const p1 = normalizePathKey('browser://document.md');
      const p2 = normalizePathKey('browser://Document.md');
      expect(p1).toBe('browser://document.md');
      expect(p1).toBe(p2);
    });

    it('should trim surrounding whitespace', () => {
      const key = normalizePathKey('   E:\\notes\\daily.md   ');
      expect(key).toBe('e:/notes/daily.md');
    });

    it('should return empty string for null, undefined or empty strings', () => {
      expect(normalizePathKey('')).toBe('');
      expect(normalizePathKey('   ')).toBe('');
      expect(normalizePathKey(null)).toBe('');
      expect(normalizePathKey(undefined)).toBe('');
    });
  });

  describe('getExportFilename', () => {
    it('should format default names correctly for docx, pdf, and html', () => {
      expect(getExportFilename('My Document.md', 'html')).toBe('My Document.html');
      expect(getExportFilename('My Document.md', 'docx')).toBe('My Document.docx');
      expect(getExportFilename('My Document.md', 'pdf')).toBe('My Document.pdf');
      expect(getExportFilename('Report.markdown', 'html')).toBe('Report.html');
      expect(getExportFilename('Report.mdown', 'docx')).toBe('Report.docx');
      expect(getExportFilename('Report.mkd', 'pdf')).toBe('Report.pdf');
      expect(getExportFilename('Report.mkd', 'html')).toBe('Report.html');
      expect(getExportFilename('Report.MKD', 'docx')).toBe('Report.docx');
      expect(getExportFilename('Report.html', 'html')).toBe('Report.html');
      expect(getExportFilename('Report.htm', 'html')).toBe('Report.html');
      expect(getExportFilename('Report.docx', 'html')).toBe('Report.html');
      expect(getExportFilename('Report.pdf', 'html')).toBe('Report.html');
      expect(getExportFilename('notes.txt', 'html')).toBe('notes.html');
      expect(getExportFilename('package.tar.gz', 'html')).toBe('package.tar.gz.html');
    });

    it('should fallback to 未命名 when title is missing or whitespace', () => {
      expect(getExportFilename('', 'html')).toBe('未命名.html');
      expect(getExportFilename(null, 'html')).toBe('未命名.html');
      expect(getExportFilename('   ', 'html')).toBe('未命名.html');
      expect(getExportFilename('   .html  ', 'html')).toBe('未命名.html');
    });
  });

  describe('computeSavedTabState (Race condition & snapshot safety)', () => {
    it('should correctly mark tab as clean when content equals savedSnapshot', () => {
      const initialTab: DocumentTab = {
        id: 'doc-1',
        title: '未命名文档.md',
        filePath: null,
        content: '# Hello World',
        savedContent: '',
        isDirty: true,
        cursorLine: 1,
        cursorCol: 1,
      };

      const saved = computeSavedTabState(
        initialTab,
        'C:\\Users\\User\\Desktop\\hello.md',
        '# Hello World'
      );

      expect(saved.filePath).toBe('C:\\Users\\User\\Desktop\\hello.md');
      expect(saved.title).toBe('hello.md');
      expect(saved.savedContent).toBe('# Hello World');
      expect(saved.content).toBe('# Hello World');
      expect(saved.isDirty).toBe(false);
    });

    it('should retain dirty state and preserve user edits if user typed during async save', () => {
      // User started save with '# Snapshot', but typed ' new edit' while save was in flight
      const currentTabDuringSave: DocumentTab = {
        id: 'doc-1',
        title: '未命名文档.md',
        filePath: null,
        content: '# Snapshot new edit',
        savedContent: '',
        isDirty: true,
        cursorLine: 1,
        cursorCol: 15,
      };

      const saved = computeSavedTabState(
        currentTabDuringSave,
        'C:\\Users\\User\\Desktop\\hello.md',
        '# Snapshot' // Content snapshot actually written to disk
      );

      expect(saved.filePath).toBe('C:\\Users\\User\\Desktop\\hello.md');
      expect(saved.title).toBe('hello.md');
      expect(saved.savedContent).toBe('# Snapshot');
      expect(saved.content).toBe('# Snapshot new edit'); // Edits not lost!
      expect(saved.isDirty).toBe(true); // Correctly remains dirty!
    });
  });

  describe('createDefaultTab', () => {
    it('should create a clean document tab with default parameters', () => {
      const tab = createDefaultTab();
      expect(tab.id).toMatch(/^doc-.+/);
      expect(tab.title).toBe('未命名文档.md');
      expect(tab.filePath).toBeNull();
      expect(tab.content).toBe('');
      expect(tab.savedContent).toBe('');
      expect(tab.isDirty).toBe(false);
      expect(tab.viewMode).toBeUndefined();
    });

    it('should accept custom title and content', () => {
      const tab = createDefaultTab('custom.md', 'some content', 'custom-id');
      expect(tab.id).toBe('custom-id');
      expect(tab.title).toBe('custom.md');
      expect(tab.content).toBe('some content');
      expect(tab.savedContent).toBe('some content');
      expect(tab.isDirty).toBe(false);
    });
  });

  describe('sanitizeRestoredTabs', () => {
    const makeTab = (id: string, viewMode?: unknown): DocumentTab =>
      ({
        id,
        title: `${id}.md`,
        filePath: null,
        content: '',
        savedContent: '',
        isDirty: false,
        cursorLine: 1,
        cursorCol: 1,
        viewMode,
      }) as DocumentTab;

    it('keeps valid per-tab view modes when startupView is remember-last', () => {
      const tabs = [makeTab('a', 'edit'), makeTab('b', 'read'), makeTab('c')];
      const result = sanitizeRestoredTabs(tabs, 'remember-last');
      expect(result[0].viewMode).toBe('edit');
      expect(result[1].viewMode).toBe('read');
      expect(result[2].viewMode).toBeUndefined();
    });

    it('drops corrupted view mode values so tabs fall back to the default', () => {
      const tabs = [makeTab('a', 'fullscreen'), makeTab('b', 42)];
      const result = sanitizeRestoredTabs(tabs, 'remember-last');
      expect(result[0].viewMode).toBeUndefined();
      expect(result[1].viewMode).toBeUndefined();
    });

    it('clears stored per-tab modes when startupView is an explicit mode', () => {
      const tabs = [makeTab('a', 'edit'), makeTab('b', 'split'), makeTab('c', 'read')];
      for (const startupView of ['edit', 'split', 'read'] as const) {
        const result = sanitizeRestoredTabs(tabs, startupView);
        expect(result.every((t) => t.viewMode === undefined)).toBe(true);
      }
    });

    it('does not mutate the original tab objects', () => {
      const tabs = [makeTab('a', 'edit')];
      sanitizeRestoredTabs(tabs, 'read');
      expect(tabs[0].viewMode).toBe('edit');
    });
  });

  describe('moveTabState', () => {
    const makeTabs = (...ids: string[]) =>
      ids.map((id) => createDefaultTab(`${id}.md`, '', id));
    const idsOf = (tabs: ReturnType<typeof makeTabs>) => tabs.map((t) => t.id);

    it('moves a tab before the target (left to right)', () => {
      const tabs = makeTabs('a', 'b', 'c', 'd');
      expect(idsOf(moveTabState(tabs, 'a', 'c', 'before'))).toEqual(['b', 'a', 'c', 'd']);
    });

    it('moves a tab after the target (right to left)', () => {
      const tabs = makeTabs('a', 'b', 'c', 'd');
      expect(idsOf(moveTabState(tabs, 'd', 'a', 'after'))).toEqual(['a', 'd', 'b', 'c']);
    });

    it('moves a tab to the very end via after on the last tab', () => {
      const tabs = makeTabs('a', 'b', 'c');
      expect(idsOf(moveTabState(tabs, 'a', 'c', 'after'))).toEqual(['b', 'c', 'a']);
    });

    it('returns the same array reference for no-op moves', () => {
      const tabs = makeTabs('a', 'b');
      expect(moveTabState(tabs, 'a', 'a', 'before')).toBe(tabs);
      expect(moveTabState(tabs, 'missing', 'a', 'before')).toBe(tabs);
      expect(moveTabState(tabs, 'a', 'missing', 'before')).toBe(tabs);
    });

    it('does not mutate the original array', () => {
      const tabs = makeTabs('a', 'b', 'c');
      moveTabState(tabs, 'a', 'c', 'before');
      expect(idsOf(tabs)).toEqual(['a', 'b', 'c']);
    });
  });

  describe('createDiffTabState', () => {
    it('creates a diff tab referencing both sides with snapshots', () => {
      const left = createDefaultTab('left.md', '# Left', 'id-left');
      const right = createDefaultTab('right.md', '# Right', 'id-right');
      const diff = createDiffTabState(left, right, 'id-diff');

      expect(diff.id).toBe('id-diff');
      expect(diff.kind).toBe('diff');
      expect(diff.title).toBe('left.md ↔ right.md');
      expect(diff.filePath).toBeNull();
      expect(diff.isDirty).toBe(false);
      expect(diff.diffRefs?.left).toEqual({
        tabId: 'id-left',
        title: 'left.md',
        snapshot: '# Left',
      });
      expect(diff.diffRefs?.right).toEqual({
        tabId: 'id-right',
        title: 'right.md',
        snapshot: '# Right',
      });
    });
  });

  describe('decideExternalChangeAction', () => {
    const baseTab = {
      fileMtime: 1000,
      savedContent: '# Saved',
      isDirty: false,
    };

    it('returns none when mtime is unavailable', () => {
      expect(decideExternalChangeAction(baseTab, null, 'x')).toBe('none');
      expect(decideExternalChangeAction(baseTab, NaN, 'x')).toBe('none');
    });

    it('returns baseline when the tab has no known mtime yet', () => {
      expect(
        decideExternalChangeAction({ ...baseTab, fileMtime: undefined }, 2000, null)
      ).toBe('baseline');
    });

    it('returns none when mtime is unchanged', () => {
      expect(decideExternalChangeAction(baseTab, 1000, null)).toBe('none');
    });

    it('returns none when mtime changed but content cannot be read', () => {
      expect(decideExternalChangeAction(baseTab, 2000, null)).toBe('none');
    });

    it('returns baseline when content matches the saved snapshot (mtime-only change)', () => {
      expect(decideExternalChangeAction(baseTab, 2000, '# Saved')).toBe('baseline');
    });

    it('returns reload when file changed on disk and tab is not dirty', () => {
      expect(decideExternalChangeAction(baseTab, 2000, '# Externally edited')).toBe('reload');
    });

    it('returns prompt when file changed on disk and tab has unsaved edits', () => {
      expect(
        decideExternalChangeAction({ ...baseTab, isDirty: true }, 2000, '# Externally edited')
      ).toBe('prompt');
    });
  });
});
