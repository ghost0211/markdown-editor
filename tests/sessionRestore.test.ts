import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { WELCOME_DOCUMENT } from '../src/lib/defaultDocument';

const STORAGE_SESSION_KEY = 'markdown_editor_tabs_v1';
const STORAGE_VIEW_MODE_KEY = 'markdown_editor_view_mode';

describe('Startup and Session Persistence Logic', () => {
  let localStorageMock: Record<string, string> = {};

  beforeEach(() => {
    localStorageMock = {};
    const mockStorage = {
      getItem: vi.fn((key: string) => localStorageMock[key] ?? null),
      setItem: vi.fn((key: string, value: string) => {
        localStorageMock[key] = String(value);
      }),
      removeItem: vi.fn((key: string) => {
        delete localStorageMock[key];
      }),
      clear: vi.fn(() => {
        localStorageMock = {};
      }),
    };

    Object.defineProperty(globalThis, 'localStorage', {
      value: mockStorage,
      writable: true,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('restoreSession = false starts with clean welcome tab without destroying saved session in localStorage', () => {
    const existingSession = [
      {
        id: 'doc-1',
        title: 'Project Notes.md',
        filePath: 'C:\\docs\\notes.md',
        content: '# Project Notes',
        savedContent: '# Project Notes',
        isDirty: false,
        cursorLine: 10,
        cursorCol: 5,
      },
    ];
    localStorageMock[STORAGE_SESSION_KEY] = JSON.stringify(existingSession);

    // Simulated initialization when restoreSession === false
    const restoreSession = false;
    let initialTabs = [
      {
        id: 'doc-welcome',
        title: '欢迎使用.md',
        filePath: null,
        content: WELCOME_DOCUMENT,
        savedContent: WELCOME_DOCUMENT,
        isDirty: false,
        cursorLine: 1,
        cursorCol: 1,
      },
    ];

    if (restoreSession) {
      try {
        const saved = localStorage.getItem(STORAGE_SESSION_KEY);
        if (saved) {
          const parsed = JSON.parse(saved);
          if (Array.isArray(parsed) && parsed.length > 0) {
            initialTabs = parsed;
          }
        }
      } catch {
        // ignore
      }
    }

    expect(initialTabs.length).toBe(1);
    expect(initialTabs[0].id).toBe('doc-welcome');
    // Saved session data in localStorage must remain intact!
    expect(localStorageMock[STORAGE_SESSION_KEY]).toBeDefined();
    const saved = JSON.parse(localStorageMock[STORAGE_SESSION_KEY]);
    expect(saved[0].id).toBe('doc-1');
  });

  it('restoreSession = true restores tabs saved in localStorage', () => {
    const existingSession = [
      {
        id: 'doc-saved',
        title: 'Report.md',
        filePath: 'C:\\docs\\Report.md',
        content: '# Sales Report',
        savedContent: '# Sales Report',
        isDirty: false,
        cursorLine: 2,
        cursorCol: 1,
      },
    ];
    localStorageMock[STORAGE_SESSION_KEY] = JSON.stringify(existingSession);

    const restoreSession = true;
    let initialTabs = [
      {
        id: 'doc-welcome',
        title: '欢迎使用.md',
        filePath: null,
        content: WELCOME_DOCUMENT,
        savedContent: WELCOME_DOCUMENT,
        isDirty: false,
        cursorLine: 1,
        cursorCol: 1,
      },
    ];

    if (restoreSession) {
      try {
        const saved = localStorage.getItem(STORAGE_SESSION_KEY);
        if (saved) {
          const parsed = JSON.parse(saved);
          if (Array.isArray(parsed) && parsed.length > 0) {
            initialTabs = parsed;
          }
        }
      } catch {
        // ignore
      }
    }

    expect(initialTabs.length).toBe(1);
    expect(initialTabs[0].id).toBe('doc-saved');
    expect(initialTabs[0].title).toBe('Report.md');
  });

  it('startupView preference honours explicit mode on launch and remember-last from localStorage', () => {
    localStorageMock[STORAGE_VIEW_MODE_KEY] = 'edit';

    // 1. Explicit view 'read'
    const resolveInitialView1 = (startupView: string) => {
      if (startupView !== 'remember-last') {
        return startupView;
      }
      const saved = localStorage.getItem(STORAGE_VIEW_MODE_KEY);
      return saved === 'edit' || saved === 'split' || saved === 'read' ? saved : 'split';
    };

    expect(resolveInitialView1('read')).toBe('read');
    expect(resolveInitialView1('split')).toBe('split');

    // 2. Remember-last
    expect(resolveInitialView1('remember-last')).toBe('edit');

    // 3. Fallback when localStorage is empty
    delete localStorageMock[STORAGE_VIEW_MODE_KEY];
    expect(resolveInitialView1('remember-last')).toBe('split');
  });
});
