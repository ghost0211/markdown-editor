import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as native from '../src/lib/native';
import {
  normalizePathKey,
  getFileNameFromPath,
  openOrFocusDocumentState,
} from '../src/lib/documentUtils';
import { createFileCoordinator } from '../src/lib/fileCoordinator';
import { DocumentTab } from '../src/types';

describe('Document Open & File Association Logic', () => {
  let mockStorage: Record<string, string> = {};

  class MockEventTarget {
    listeners: Record<string, ((e: unknown) => void)[]> = {};

    addEventListener(type: string, listener: (e: unknown) => void) {
      if (!this.listeners[type]) this.listeners[type] = [];
      this.listeners[type].push(listener);
    }

    removeEventListener(type: string, listener: (e: unknown) => void) {
      if (this.listeners[type]) {
        this.listeners[type] = this.listeners[type].filter((l) => l !== listener);
      }
    }

    dispatchEvent(event: { type: string } | string) {
      const type = typeof event === 'string' ? event : event.type;
      const list = this.listeners[type] || [];
      for (const listener of [...list]) {
        listener(typeof event === 'string' ? { type } : event);
      }
      return true;
    }
  }

  class MockDocument extends MockEventTarget {
    visibilityState: DocumentVisibilityState = 'visible';
  }

  let mockWindow: MockEventTarget;
  let mockDoc: MockDocument;

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

    mockWindow = new MockEventTarget();
    mockDoc = new MockDocument();
    (globalThis as unknown as { window: unknown }).window = mockWindow;
    (globalThis as unknown as { document: unknown }).document = mockDoc;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete (globalThis as unknown as { window?: unknown }).window;
    delete (globalThis as unknown as { document?: unknown }).document;
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

  describe('FileCoordinator Resiliency, Coalescing & Multi-channel Wake-up', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should recover from missed wake-up event via window focus event', async () => {
      let backendQueue = ['C:\\notes\\initial.md'];
      const openedFiles: string[] = [];

      const coordinator = createFileCoordinator({
        drainPendingFiles: async () => {
          const drained = [...backendQueue];
          backendQueue = [];
          return drained;
        },
        onFilesReceived: async (paths) => {
          openedFiles.push(...paths);
        },
        isTauri: () => true,
        subscribeOpenFiles: async () => () => {},
        pollIntervalMs: 2000,
      });

      await coordinator.start();
      expect(openedFiles).toEqual(['C:\\notes\\initial.md']);
      expect(backendQueue).toHaveLength(0);

      // Simulate a secondary instance arrives while WebView was suspended:
      // File is enqueued in backend, but native 'open-files' IPC event is DROPPED / MISSED
      backendQueue.push('C:\\notes\\missed_while_suspended.md');

      // The window unminimizes and receives OS window focus:
      window.dispatchEvent(new Event('focus'));

      // Allow microtasks to complete
      await Promise.resolve();
      await Promise.resolve();

      expect(openedFiles).toEqual([
        'C:\\notes\\initial.md',
        'C:\\notes\\missed_while_suspended.md',
      ]);
      expect(backendQueue).toHaveLength(0);

      coordinator.stop();
    });

    it('should recover from missed wake-up event via visibilitychange event', async () => {
      let backendQueue: string[] = [];
      const openedFiles: string[] = [];

      const coordinator = createFileCoordinator({
        drainPendingFiles: async () => {
          const drained = [...backendQueue];
          backendQueue = [];
          return drained;
        },
        onFilesReceived: async (paths) => {
          openedFiles.push(...paths);
        },
        isTauri: () => true,
        subscribeOpenFiles: async () => () => {},
        pollIntervalMs: 2000,
      });

      await coordinator.start();
      expect(openedFiles).toHaveLength(0);

      // Stranded file in backend queue
      backendQueue.push('C:\\notes\\restored_visibility.md');

      // Set document visibility to visible and dispatch visibilitychange
      Object.defineProperty(document, 'visibilityState', {
        value: 'visible',
        configurable: true,
      });
      document.dispatchEvent(new Event('visibilitychange'));

      await Promise.resolve();
      await Promise.resolve();

      expect(openedFiles).toEqual(['C:\\notes\\restored_visibility.md']);
      expect(backendQueue).toHaveLength(0);

      coordinator.stop();
    });

    it('should recover from missed wake-up event via low-overhead visible-window polling safety net', async () => {
      let backendQueue: string[] = [];
      const openedFiles: string[] = [];

      Object.defineProperty(document, 'visibilityState', {
        value: 'visible',
        configurable: true,
      });

      const coordinator = createFileCoordinator({
        drainPendingFiles: async () => {
          const drained = [...backendQueue];
          backendQueue = [];
          return drained;
        },
        onFilesReceived: async (paths) => {
          openedFiles.push(...paths);
        },
        isTauri: () => true,
        subscribeOpenFiles: async () => () => {},
        pollIntervalMs: 2000,
      });

      await coordinator.start();
      expect(openedFiles).toHaveLength(0);

      // File queued in backend, no events fired (complete IPC & event failure)
      backendQueue.push('C:\\notes\\polled_recovery.md');

      // Advance time by poll interval (2000ms)
      await vi.advanceTimersByTimeAsync(2000);

      expect(openedFiles).toEqual(['C:\\notes\\polled_recovery.md']);
      expect(backendQueue).toHaveLength(0);

      coordinator.stop();
    });

    it('should skip polling safety net when document is hidden to conserve battery and CPU', async () => {
      let backendQueue: string[] = ['C:\\notes\\hidden.md'];
      let drainCallCount = 0;

      // Start visible for initial drain
      Object.defineProperty(document, 'visibilityState', {
        value: 'visible',
        configurable: true,
      });

      const coordinator = createFileCoordinator({
        drainPendingFiles: async () => {
          drainCallCount++;
          const drained = [...backendQueue];
          backendQueue = [];
          return drained;
        },
        onFilesReceived: async () => {},
        isTauri: () => true,
        subscribeOpenFiles: async () => () => {},
        pollIntervalMs: 2000,
      });

      await coordinator.start();
      expect(drainCallCount).toBe(1); // 1 initial drain on start

      // Minimize / hide document
      Object.defineProperty(document, 'visibilityState', {
        value: 'hidden',
        configurable: true,
      });

      backendQueue.push('C:\\notes\\should_not_poll_while_hidden.md');

      // Advance timers by several intervals
      await vi.advanceTimersByTimeAsync(6000);

      // No new polling drain calls should have been made while hidden
      expect(drainCallCount).toBe(1);
      expect(backendQueue).toHaveLength(1);

      // Now restore document to visible
      Object.defineProperty(document, 'visibilityState', {
        value: 'visible',
        configurable: true,
      });
      document.dispatchEvent(new Event('visibilitychange'));

      await Promise.resolve();
      await Promise.resolve();

      expect(drainCallCount).toBe(2);
      expect(backendQueue).toHaveLength(0);

      coordinator.stop();
    });

    it('should coalesce rapid concurrent drain requests and serialize onFilesReceived execution', async () => {
      let backendQueue: string[] = ['C:\\initial.md'];
      const batchesReceived: string[][] = [];
      let concurrentExecutions = 0;
      let maxConcurrentExecutions = 0;

      let wakeUpCallback: (() => void) | null = null;

      const coordinator = createFileCoordinator({
        drainPendingFiles: async () => {
          const drained = [...backendQueue];
          backendQueue = [];
          return drained;
        },
        onFilesReceived: async (paths) => {
          concurrentExecutions++;
          if (concurrentExecutions > maxConcurrentExecutions) {
            maxConcurrentExecutions = concurrentExecutions;
          }
          // Simulate async processing (e.g. disk I/O, tab setup)
          await new Promise((r) => setTimeout(r, 100));
          batchesReceived.push([...paths]);
          concurrentExecutions--;
        },
        isTauri: () => true,
        subscribeOpenFiles: async (cb) => {
          wakeUpCallback = cb;
          return () => {
            wakeUpCallback = null;
          };
        },
        pollIntervalMs: 2000,
      });

      const startPromise = coordinator.start();
      // Complete initial start drain
      await vi.advanceTimersByTimeAsync(150);
      await startPromise;

      expect(batchesReceived).toHaveLength(1);
      expect(batchesReceived[0]).toEqual(['C:\\initial.md']);

      // Now enqueue batch 1 and start drain
      backendQueue.push('C:\\batch1.md');
      const drainPromise = coordinator.requestDrain();

      // While drain of batch 1 is in-flight (waiting for 100ms async read),
      // enqueue more files and fire multiple concurrent triggers in rapid succession
      backendQueue.push('C:\\batch2_file1.md', 'C:\\batch2_file2.md');

      const triggerCallback = wakeUpCallback as (() => void) | null;
      if (triggerCallback) {
        triggerCallback();
      }
      window.dispatchEvent(new Event('focus'));
      document.dispatchEvent(new Event('visibilitychange'));
      coordinator.requestDrain();

      // Fast-forward timers through the async operations of batch 1 and coalesced batch 2
      await vi.advanceTimersByTimeAsync(250);
      await drainPromise;

      expect(maxConcurrentExecutions).toBe(1); // Guaranteed strictly serialized, never concurrent!
      expect(batchesReceived).toHaveLength(3);
      expect(batchesReceived[0]).toEqual(['C:\\initial.md']);
      expect(batchesReceived[1]).toEqual(['C:\\batch1.md']);
      expect(batchesReceived[2]).toEqual(['C:\\batch2_file1.md', 'C:\\batch2_file2.md']);
      expect(backendQueue).toHaveLength(0);

      coordinator.stop();
    });

    it('should properly clean up all timers and listeners on stop()', async () => {
      let backendQueue = ['C:\\initial.md'];
      let drainCallCount = 0;
      let unlistenCalled = false;

      const coordinator = createFileCoordinator({
        drainPendingFiles: async () => {
          drainCallCount++;
          const drained = [...backendQueue];
          backendQueue = [];
          return drained;
        },
        onFilesReceived: async () => {},
        isTauri: () => true,
        subscribeOpenFiles: async () => {
          return () => {
            unlistenCalled = true;
          };
        },
        pollIntervalMs: 2000,
      });

      await coordinator.start();
      expect(drainCallCount).toBe(1);
      expect(coordinator.isActive()).toBe(true);

      coordinator.stop();
      expect(coordinator.isActive()).toBe(false);
      expect(unlistenCalled).toBe(true);

      // Fire events or timers after stop
      backendQueue.push('C:\\after_stop.md');
      window.dispatchEvent(new Event('focus'));
      document.dispatchEvent(new Event('visibilitychange'));
      await vi.advanceTimersByTimeAsync(5000);

      // Drain count should remain 1
      expect(drainCallCount).toBe(1);
      expect(backendQueue).toHaveLength(1);
    });

    it('should gracefully no-op in browser mode without polling or errors', async () => {
      let isTauriEnv = false;
      let drainCalled = false;

      const coordinator = createFileCoordinator({
        drainPendingFiles: async () => {
          drainCalled = true;
          return [];
        },
        onFilesReceived: async () => {},
        isTauri: () => isTauriEnv,
        subscribeOpenFiles: async () => () => {},
        pollIntervalMs: 2000,
      });

      await coordinator.start();
      // In browser mode, initial drain runs (calling drainPendingFiles which returns [])
      expect(drainCalled).toBe(true);

      // Advance timers -> No polling interval should have been created
      drainCalled = false;
      await vi.advanceTimersByTimeAsync(5000);
      expect(drainCalled).toBe(false);

      coordinator.stop();
    });

    it('should log bounded diagnostics with count and not leak full paths', async () => {
      const logs: { msg: string; count: unknown }[] = [];
      const debugLog = (msg: string, ...args: unknown[]) => {
        logs.push({ msg, count: args[0] });
      };

      const coordinator = createFileCoordinator({
        drainPendingFiles: async () => ['C:\\Users\\SecretUser\\PrivateFile.md'],
        onFilesReceived: async () => {},
        isTauri: () => true,
        subscribeOpenFiles: async () => () => {},
        pollIntervalMs: 0,
        debugLog,
      });

      await coordinator.start();

      expect(logs).toHaveLength(1);
      expect(logs[0].msg).toBe('[FileCoordinator] Drained %d pending file(s)');
      expect(logs[0].count).toBe(1);

      coordinator.stop();
    });
  });
});
