import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as native from '../src/lib/native';
import {
  normalizePathKey,
  getFileNameFromPath,
  openOrFocusDocumentState,
} from '../src/lib/documentUtils';
import { DocumentTab } from '../src/types';

describe('Document Open & File Association Logic', () => {
  let mockStorage: Record<string, string> = {};

  beforeEach(() => {
    mockStorage = {};
    const localStorageMock = {
      getItem: (key: string) => mockStorage[key] || null,
      setItem: (key: string, value: string) => {
        mockStorage[key] = value;
      },
      removeItem: (key: string) => {
        delete mockStorage[key];
      },
      clear: () => {
        mockStorage = {};
      },
    };
    (globalThis as unknown as { localStorage: typeof localStorageMock }).localStorage = localStorageMock;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Path Deduplication for File Association', () => {
    it('should deduplicate mixed case and slash paths', () => {
      const paths = [
        'C:\\Users\\Notes\\test.md',
        'c:/users/notes/test.md',
        'C:\\Users\\Notes\\OTHER.MD',
        'c:\\users\\notes\\other.md',
      ];

      const seen = new Set<string>();
      const unique: string[] = [];
      for (const p of paths) {
        const key = normalizePathKey(p);
        if (key && !seen.has(key)) {
          seen.add(key);
          unique.push(p);
        }
      }

      expect(unique).toHaveLength(2);
      expect(unique[0]).toBe('C:\\Users\\Notes\\test.md');
      expect(unique[1]).toBe('C:\\Users\\Notes\\OTHER.MD');
    });

    it('should ignore empty or whitespace strings during deduplication', () => {
      const paths = ['', '   ', 'C:\\valid.md', '   '];
      const seen = new Set<string>();
      const unique: string[] = [];
      for (const p of paths) {
        if (!p || typeof p !== 'string') continue;
        const key = normalizePathKey(p);
        if (key && !seen.has(key)) {
          seen.add(key);
          unique.push(p.trim());
        }
      }

      expect(unique).toEqual(['C:\\valid.md']);
    });
  });

  describe('Batch open error isolation', () => {
    it('one bad file error must not prevent subsequent valid files from being processed', async () => {
      const fileContents: Record<string, string> = {
        'C:\\docs\\good1.md': '# Good 1 Content',
        'C:\\docs\\good2.md': '# Good 2 Content',
      };

      const readSpy = vi.spyOn(native, 'readTextFile').mockImplementation(async (path: string) => {
        if (path in fileContents) {
          return fileContents[path];
        }
        throw new Error(`文件不存在: ${path}`);
      });

      const toasts: { msg: string; type: string }[] = [];
      const showToast = (msg: string, type: 'info' | 'success' | 'warning' | 'error') => {
        toasts.push({ msg, type });
      };

      const openedDocuments: { path: string; content: string }[] = [];

      const openFileByPath = async (filePath: string) => {
        const trimmed = filePath.trim();
        try {
          const content = await native.readTextFile(trimmed);
          openedDocuments.push({ path: trimmed, content });
          showToast(`已打开: ${getFileNameFromPath(trimmed)}`, 'success');
          return true;
        } catch (err: unknown) {
          const msg = (err as Error)?.message || String(err);
          const fileName = getFileNameFromPath(trimmed);
          showToast(`打开文件失败 (${fileName}): ${msg}`, 'error');
          return false;
        }
      };

      const batch = [
        'C:\\docs\\good1.md',
        'C:\\docs\\corrupted_or_missing.md',
        'C:\\docs\\good2.md',
      ];

      for (const p of batch) {
        await openFileByPath(p);
      }

      expect(readSpy).toHaveBeenCalledTimes(3);
      expect(openedDocuments).toHaveLength(2);
      expect(openedDocuments[0].path).toBe('C:\\docs\\good1.md');
      expect(openedDocuments[1].path).toBe('C:\\docs\\good2.md');

      expect(toasts).toHaveLength(3);
      expect(toasts[0]).toEqual({ msg: '已打开: good1.md', type: 'success' });
      expect(toasts[1].type).toBe('error');
      expect(toasts[1].msg).toContain('打开文件失败 (corrupted_or_missing.md)');
      expect(toasts[2]).toEqual({ msg: '已打开: good2.md', type: 'success' });
    });
  });

  describe('Browser mode graceful handling', () => {
    it('should reject readTextFile with Chinese error in browser mode', async () => {
      await expect(native.readTextFile('C:\\some\\path.md')).rejects.toThrow(
        'Web 浏览器环境不支持直接通过路径读取本地文件'
      );
    });
  });

  describe('Tab Management & Pristine Welcome Replacement Logic (Production Pure Helper)', () => {
    it('should replace pristine untouched welcome tab on opening first file', () => {
      const initialTabs: DocumentTab[] = [
        {
          id: 'doc-welcome',
          title: '欢迎使用.md',
          filePath: null,
          content: '# Welcome',
          savedContent: '# Welcome',
          isDirty: false,
          cursorLine: 1,
          cursorCol: 1,
        },
      ];

      const res = openOrFocusDocumentState(
        initialTabs,
        'C:\\Users\\notes\\readme.md',
        '# Readme'
      );
      expect(res.action).toBe('opened');
      expect(res.tabs).toHaveLength(1);
      expect(res.tabs[0].title).toBe('readme.md');
      expect(res.tabs[0].filePath).toBe('C:\\Users\\notes\\readme.md');
      expect(res.activeTabId).toBe(res.tabs[0].id);
      expect(res.tab.id).toBe(res.tabs[0].id);
    });

    it('should NOT replace welcome tab if user has modified it (isDirty is true)', () => {
      const dirtyWelcomeTabs: DocumentTab[] = [
        {
          id: 'doc-welcome',
          title: '欢迎使用.md',
          filePath: null,
          content: '# Welcome with user edits',
          savedContent: '# Welcome',
          isDirty: true,
          cursorLine: 1,
          cursorCol: 1,
        },
      ];

      const res = openOrFocusDocumentState(
        dirtyWelcomeTabs,
        'C:\\Users\\notes\\readme.md',
        '# Readme'
      );
      expect(res.action).toBe('opened');
      expect(res.tabs).toHaveLength(2);
      expect(res.tabs[0].id).toBe('doc-welcome');
      expect(res.tabs[1].title).toBe('readme.md');
      expect(res.activeTabId).toBe(res.tabs[1].id);
    });

    it('should focus existing tab and not duplicate when file is already opened', () => {
      const tabs: DocumentTab[] = [
        {
          id: 'doc-1',
          title: 'guide.md',
          filePath: 'C:\\docs\\guide.md',
          content: '# Guide',
          savedContent: '# Guide',
          isDirty: false,
          cursorLine: 1,
          cursorCol: 1,
        },
      ];

      // Re-open with different slash/case
      const res = openOrFocusDocumentState(tabs, 'c:/docs/GUIDE.md', '# Guide');
      expect(res.action).toBe('focused');
      expect(res.tabs).toHaveLength(1);
      expect(res.activeTabId).toBe('doc-1');
      expect(res.tab.id).toBe('doc-1');
      expect(res.tab.title).toBe('guide.md');
    });

    it('should append a second tab when first tab is an existing open file', () => {
      const tabs: DocumentTab[] = [
        {
          id: 'doc-1',
          title: 'file1.md',
          filePath: 'C:\\docs\\file1.md',
          content: '# File 1',
          savedContent: '# File 1',
          isDirty: false,
          cursorLine: 1,
          cursorCol: 1,
        },
      ];

      const res = openOrFocusDocumentState(tabs, 'C:\\docs\\file2.md', '# File 2');
      expect(res.action).toBe('opened');
      expect(res.tabs).toHaveLength(2);
      expect(res.tabs[0].title).toBe('file1.md');
      expect(res.tabs[1].title).toBe('file2.md');
      expect(res.activeTabId).toBe(res.tabs[1].id);
    });

    it('should sequentially process batch opens deterministically preserving every tab', () => {
      let currentTabs: DocumentTab[] = [
        {
          id: 'doc-welcome',
          title: '欢迎使用.md',
          filePath: null,
          content: '# Welcome',
          savedContent: '# Welcome',
          isDirty: false,
          cursorLine: 1,
          cursorCol: 1,
        },
      ];

      const batchFiles = [
        { path: 'C:\\docs\\chapter1.md', content: '# Chapter 1' },
        { path: 'C:\\docs\\chapter2.md', content: '# Chapter 2' },
        { path: 'C:\\docs\\chapter3.md', content: '# Chapter 3' },
        { path: 'c:/docs/CHAPTER1.MD', content: '# Chapter 1 duplicate' },
      ];

      for (const file of batchFiles) {
        const res = openOrFocusDocumentState(currentTabs, file.path, file.content);
        currentTabs = res.tabs;
      }

      expect(currentTabs).toHaveLength(3);
      expect(currentTabs[0].title).toBe('chapter1.md');
      expect(currentTabs[1].title).toBe('chapter2.md');
      expect(currentTabs[2].title).toBe('chapter3.md');
    });
  });

  describe('Pending File Queue & Single-Instance Wake-Up Semantics', () => {
    it('should support subscribe-before-initial-drain without duplicate opens or missed events', async () => {
      // Simulate native backend pending queue
      let backendQueue: string[] = ['C:\\cold_start.md'];
      let wakeUpCallback: (() => void) | null = null;

      // Mock native API
      const drainSpy = vi.spyOn(native, 'drainPendingOpenFiles').mockImplementation(async () => {
        const drained = [...backendQueue];
        backendQueue = [];
        return drained;
      });

      const subscribeSpy = vi.spyOn(native, 'subscribeOpenFiles').mockImplementation(async (cb) => {
        wakeUpCallback = cb;
        return () => {
          wakeUpCallback = null;
        };
      });

      const openedFiles: string[] = [];
      const drainAndOpen = async () => {
        const pending = await native.drainPendingOpenFiles();
        for (const p of pending) {
          openedFiles.push(p);
        }
      };

      // 1. Subscribe first
      const unlisten = await native.subscribeOpenFiles(() => {
        drainAndOpen();
      });

      // 2. Initial drain of cold-start paths
      await drainAndOpen();

      expect(openedFiles).toEqual(['C:\\cold_start.md']);
      expect(backendQueue).toHaveLength(0);

      // 3. Secondary instance arrives: pushes to backend queue and triggers wake-up signal
      backendQueue.push('C:\\second_instance_1.md');
      backendQueue.push('C:\\second_instance_2.md');
      expect(wakeUpCallback).toBeTruthy();
      if (wakeUpCallback) {
        await (wakeUpCallback as () => void)();
      }

      expect(openedFiles).toEqual([
        'C:\\cold_start.md',
        'C:\\second_instance_1.md',
        'C:\\second_instance_2.md',
      ]);
      expect(backendQueue).toHaveLength(0); // Queue drained cleanly, no stale queue growth

      // 4. Subsequent spurious wake-up with empty queue does nothing
      if (wakeUpCallback) {
        await (wakeUpCallback as () => void)();
      }
      expect(openedFiles).toHaveLength(3);

      expect(drainSpy).toHaveBeenCalledTimes(3);
      expect(subscribeSpy).toHaveBeenCalledTimes(1);

      unlisten();
    });
  });
});
