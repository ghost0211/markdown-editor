import { describe, it, expect, vi } from 'vitest';
import {
  STORAGE_ACTIVE_TAB_KEY,
  STORAGE_SESSION_KEY,
  SessionNativeBackend,
  SessionStorageLike,
  hydrateNativeSession,
  loadLocalSessionSync,
  mergeHydratedSessionWithCurrentTabs,
  parseSessionPayload,
  persistSession,
  serializeSessionEnvelope,
} from '../src/lib/sessionStorage';
import { DocumentTab } from '../src/types';

function createMemoryStorage(initial: Record<string, string> = {}): SessionStorageLike & {
  dump: () => Record<string, string>;
} {
  const store: Record<string, string> = { ...initial };
  return {
    getItem: (key) => (key in store ? store[key] : null),
    setItem: (key, value) => {
      store[key] = String(value);
    },
    removeItem: (key) => {
      delete store[key];
    },
    dump: () => ({ ...store }),
  };
}

function makeTab(overrides: Partial<DocumentTab> & { id: string; title: string }): DocumentTab {
  return {
    filePath: null,
    content: '# Hello',
    savedContent: '# Hello',
    isDirty: false,
    cursorLine: 1,
    cursorCol: 1,
    ...overrides,
  };
}

describe('sessionStorage (App-Data native persistence + migration + Web fallback)', () => {
  it('parses both versioned envelope and legacy array formats', () => {
    const tab1 = makeTab({ id: 'tab-1', title: 'One.md' });
    const tab2 = makeTab({ id: 'tab-2', title: 'Two.md', content: 'Draft', isDirty: true });

    const envelopeJson = serializeSessionEnvelope([tab1, tab2], 'tab-2');
    const parsedEnvelope = parseSessionPayload(envelopeJson);
    expect(parsedEnvelope).not.toBeNull();
    expect(parsedEnvelope!.tabs).toHaveLength(2);
    expect(parsedEnvelope!.activeTabId).toBe('tab-2');
    expect(parsedEnvelope!.tabs[1].isDirty).toBe(true);

    const legacyJson = JSON.stringify([tab1, tab2]);
    const parsedLegacy = parseSessionPayload(legacyJson, 'remember-last', 'tab-2');
    expect(parsedLegacy).not.toBeNull();
    expect(parsedLegacy!.tabs).toHaveLength(2);
    expect(parsedLegacy!.activeTabId).toBe('tab-2');

    expect(parseSessionPayload('')).toBeNull();
    expect(parseSessionPayload('not-json')).toBeNull();
    expect(parseSessionPayload('[]')).toBeNull();
  });

  it('loadLocalSessionSync respects restoreSession=false without deleting stored data', () => {
    const tab1 = makeTab({ id: 'tab-1', title: 'Draft.md', content: 'Unsaved', isDirty: true });
    const storage = createMemoryStorage({
      [STORAGE_SESSION_KEY]: JSON.stringify([tab1]),
      [STORAGE_ACTIVE_TAB_KEY]: 'tab-1',
    });

    expect(loadLocalSessionSync(false, 'remember-last', storage)).toBeNull();
    expect(storage.getItem(STORAGE_SESSION_KEY)).not.toBeNull();

    const loaded = loadLocalSessionSync(true, 'remember-last', storage);
    expect(loaded?.tabs).toHaveLength(1);
    expect(loaded?.tabs[0].title).toBe('Draft.md');
  });

  it('migrates legacy localStorage session to Tauri native app-data file on first upgrade and frees localStorage quota', async () => {
    const legacyTab = makeTab({
      id: 'legacy-1',
      title: 'Legacy.md',
      content: '# Migrated Content',
      savedContent: '',
      isDirty: true,
    });
    const storage = createMemoryStorage({
      [STORAGE_SESSION_KEY]: JSON.stringify([legacyTab]),
      [STORAGE_ACTIVE_TAB_KEY]: 'legacy-1',
    });

    let nativeFileContent: string | null = null;
    const backend: SessionNativeBackend = {
      isTauri: () => true,
      readSessionData: vi.fn(async () => nativeFileContent),
      writeSessionData: vi.fn(async (data: string) => {
        nativeFileContent = data;
      }),
    };

    const result = await hydrateNativeSession({
      restoreSession: true,
      backend,
      storage,
    });

    expect(result.source).toBe('migrated');
    expect(result.session?.tabs).toHaveLength(1);
    expect(result.session?.tabs[0].id).toBe('legacy-1');
    expect(result.session?.activeTabId).toBe('legacy-1');

    // Native file written & bulky localStorage key cleared
    expect(nativeFileContent).not.toBeNull();
    expect(JSON.parse(nativeFileContent!).version).toBe(1);
    expect(storage.getItem(STORAGE_SESSION_KEY)).toBeNull();
  });

  it('preserves legacy localStorage if native migration write fails', async () => {
    const legacyTab = makeTab({ id: 'legacy-1', title: 'KeepMe.md' });
    const storage = createMemoryStorage({
      [STORAGE_SESSION_KEY]: JSON.stringify([legacyTab]),
    });

    const backend: SessionNativeBackend = {
      isTauri: () => true,
      readSessionData: vi.fn(async () => null),
      writeSessionData: vi.fn(async () => {
        throw new Error('Disk full');
      }),
    };

    const result = await hydrateNativeSession({
      restoreSession: true,
      backend,
      storage,
    });

    expect(result.source).toBe('migrated');
    expect(result.session?.tabs[0].id).toBe('legacy-1');
    // Must NOT delete localStorage backup when native write threw
    expect(storage.getItem(STORAGE_SESSION_KEY)).not.toBeNull();
  });

  it('loads native session directly and leaves native file intact when restoreSession=false', async () => {
    const nativeTab = makeTab({ id: 'native-1', title: 'Native.md', filePath: 'D:\\docs\\Native.md' });
    const nativePayload = serializeSessionEnvelope([nativeTab], 'native-1');
    const storage = createMemoryStorage({
      [STORAGE_SESSION_KEY]: '[{"id":"stale"}]',
    });

    const backend: SessionNativeBackend = {
      isTauri: () => true,
      readSessionData: vi.fn(async () => nativePayload),
      writeSessionData: vi.fn(async () => {}),
    };

    const skipped = await hydrateNativeSession({
      restoreSession: false,
      backend,
      storage,
    });
    expect(skipped.source).toBe('skipped');
    expect(skipped.session).toBeNull();
    expect(backend.writeSessionData).not.toHaveBeenCalled();
    expect(storage.getItem(STORAGE_SESSION_KEY)).toBeNull();

    const restored = await hydrateNativeSession({
      restoreSession: true,
      backend,
      storage,
    });
    expect(restored.source).toBe('native');
    expect(restored.session?.tabs).toHaveLength(1);
    expect(restored.session?.tabs[0].id).toBe('native-1');
  });

  it('merges hydrated session tabs with cold-start CLI files without losing or duplicating tabs', () => {
    const welcomePlaceholder = makeTab({
      id: 'doc-welcome',
      title: 'Welcome',
      filePath: null,
      isDirty: false,
    });

    const hydrated = {
      tabs: [
        makeTab({ id: 'h-1', title: 'Notes.md', filePath: 'C:\\Work\\Notes.md' }),
        makeTab({ id: 'h-2', title: 'Readme.md', filePath: 'C:\\Work\\Readme.md', content: 'old' }),
      ],
      activeTabId: 'h-1',
    };

    // Case 1: only untouched welcome placeholder is open -> replaced cleanly by hydrated tabs
    const cleanMerge = mergeHydratedSessionWithCurrentTabs(
      hydrated,
      [welcomePlaceholder],
      'doc-welcome'
    );
    expect(cleanMerge.tabs.map((t) => t.id)).toEqual(['h-1', 'h-2']);
    expect(cleanMerge.activeTabId).toBe('h-1');

    // Case 2: CLI file opened concurrently before hydration finished (same path as h-2, fresher content)
    const cliOpenedTab = makeTab({
      id: 'cli-readme',
      title: 'Readme.md',
      filePath: 'c:/work/readme.md',
      content: 'fresh from disk',
    });
    const concurrentMerge = mergeHydratedSessionWithCurrentTabs(
      hydrated,
      [welcomePlaceholder, cliOpenedTab],
      'cli-readme'
    );
    expect(concurrentMerge.tabs.map((t) => t.id)).toEqual(['h-1', 'cli-readme']);
    expect(concurrentMerge.tabs[1].content).toBe('fresh from disk');
    expect(concurrentMerge.activeTabId).toBe('cli-readme');
  });

  it('persists large sessions via Tauri backend without hitting localStorage, and falls back to localStorage on Web', async () => {
    const bigContent = 'A'.repeat(6 * 1024 * 1024); // 6 MB > 5 MB localStorage quota
    const bigTab = makeTab({ id: 'big-1', title: 'Huge.md', content: bigContent, isDirty: true });

    let writtenNative = '';
    const quotaStorage: SessionStorageLike = {
      getItem: () => null,
      setItem: (key) => {
        if (key === STORAGE_SESSION_KEY) {
          throw new Error('QuotaExceededError');
        }
      },
      removeItem: () => {},
    };

    const tauriBackend: SessionNativeBackend = {
      isTauri: () => true,
      readSessionData: async () => null,
      writeSessionData: async (data) => {
        writtenNative = data;
      },
    };

    const nativeOk = await persistSession({
      tabs: [bigTab],
      activeTabId: 'big-1',
      backend: tauriBackend,
      storage: quotaStorage,
    });
    expect(nativeOk).toBe(true);
    expect(writtenNative.length).toBeGreaterThan(6 * 1024 * 1024);

    // Web mode with quota exceeded surfaces false so caller shows toast warning
    const webBackend: SessionNativeBackend = {
      isTauri: () => false,
      readSessionData: async () => null,
      writeSessionData: async () => {},
    };
    const webFail = await persistSession({
      tabs: [bigTab],
      activeTabId: 'big-1',
      backend: webBackend,
      storage: quotaStorage,
    });
    expect(webFail).toBe(false);
  });
});
