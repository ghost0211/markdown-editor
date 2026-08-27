import { describe, it, expect } from 'vitest';
import {
  generateDocId,
  getFileNameFromPath,
  normalizePathKey,
  computeSavedTabState,
  createDefaultTab,
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
});
