import { DocumentTab, StartupViewMode } from '@/types';
import { normalizePathKey, sanitizeRestoredTabs } from '@/lib/documentUtils';
import { isTauri, readSessionData, writeSessionData } from '@/lib/native';

export const STORAGE_SESSION_KEY = 'markdown_editor_tabs_v1';
export const STORAGE_ACTIVE_TAB_KEY = 'markdown_editor_active_tab_v1';

export interface PersistedSessionEnvelope {
  version: 1;
  tabs: DocumentTab[];
  activeTabId: string | null;
}

export interface ParsedSession {
  tabs: DocumentTab[];
  activeTabId: string | null;
}

export interface SessionStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface SessionNativeBackend {
  isTauri: () => boolean;
  readSessionData: () => Promise<string | null>;
  writeSessionData: (data: string) => Promise<void>;
}

const defaultNativeBackend: SessionNativeBackend = {
  isTauri,
  readSessionData,
  writeSessionData,
};

function getDefaultWebStorage(): SessionStorageLike | null {
  try {
    if (typeof localStorage !== 'undefined') {
      return localStorage;
    }
  } catch {
    // localStorage may be disabled or unavailable in Node test environments
  }
  return null;
}

/**
 * Serializes tabs and activeTabId into the versioned native session JSON format.
 */
export function serializeSessionEnvelope(
  tabs: DocumentTab[],
  activeTabId: string | null
): string {
  const envelope: PersistedSessionEnvelope = {
    version: 1,
    tabs,
    activeTabId,
  };
  return JSON.stringify(envelope);
}

/**
 * Parses either a versioned native session envelope `{ version: 1, tabs, activeTabId }`
 * or a legacy `localStorage` raw `DocumentTab[]` array, sanitizing each tab.
 */
export function parseSessionPayload(
  raw: string | null | undefined,
  startupView: StartupViewMode = 'remember-last',
  fallbackActiveTabId: string | null = null
): ParsedSession | null {
  if (!raw || typeof raw !== 'string' || !raw.trim()) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(raw);
    let rawTabs: unknown[] | null = null;
    let envelopeActiveId: string | null = fallbackActiveTabId;

    if (Array.isArray(parsed)) {
      rawTabs = parsed;
    } else if (parsed && typeof parsed === 'object') {
      const record = parsed as Record<string, unknown>;
      if (Array.isArray(record.tabs)) {
        rawTabs = record.tabs;
      }
      if (typeof record.activeTabId === 'string' && record.activeTabId.trim()) {
        envelopeActiveId = record.activeTabId;
      }
    }

    if (!rawTabs || rawTabs.length === 0) {
      return null;
    }

    const sanitized = sanitizeRestoredTabs(rawTabs as DocumentTab[], startupView);
    if (sanitized.length === 0) {
      return null;
    }

    const resolvedActiveId =
      envelopeActiveId && sanitized.some((tab) => tab.id === envelopeActiveId)
        ? envelopeActiveId
        : sanitized[0].id;

    return {
      tabs: sanitized,
      activeTabId: resolvedActiveId,
    };
  } catch {
    return null;
  }
}

/**
 * Synchronously reads a session from `localStorage` (used in Web mode and as an
 * immediate pre-migration snapshot before native hydration completes).
 * Never mutates or clears saved data when `restoreSession === false`.
 */
export function loadLocalSessionSync(
  restoreSession: boolean,
  startupView: StartupViewMode = 'remember-last',
  storage: SessionStorageLike | null = getDefaultWebStorage()
): ParsedSession | null {
  if (!restoreSession || !storage) {
    return null;
  }

  try {
    const rawTabs = storage.getItem(STORAGE_SESSION_KEY);
    const savedActive = storage.getItem(STORAGE_ACTIVE_TAB_KEY);
    return parseSessionPayload(rawTabs, startupView, savedActive);
  } catch {
    return null;
  }
}

export interface HydrateSessionResult {
  source: 'web' | 'native' | 'migrated' | 'empty' | 'skipped';
  session: ParsedSession | null;
}

/**
 * Loads session data from Tauri's native app-data file (`session_v1.json`),
 * automatically migrating any legacy `localStorage` session on first upgrade
 * and freeing the bulky `localStorage` key once native persistence succeeds.
 *
 * When `restoreSession` is `false`, legacy `localStorage` data is still migrated
 * non-destructively so it isn't stranded, while `session: null` is returned so
 * the UI starts with a clean welcome document without wiping saved sessions.
 */
export async function hydrateNativeSession(options: {
  restoreSession: boolean;
  startupView?: StartupViewMode;
  backend?: SessionNativeBackend;
  storage?: SessionStorageLike | null;
}): Promise<HydrateSessionResult> {
  const {
    restoreSession,
    startupView = 'remember-last',
    backend = defaultNativeBackend,
    storage = getDefaultWebStorage(),
  } = options;

  if (!backend.isTauri()) {
    return {
      source: 'web',
      session: loadLocalSessionSync(restoreSession, startupView, storage),
    };
  }

  let nativeRaw: string | null = null;
  try {
    nativeRaw = await backend.readSessionData();
  } catch (err) {
    console.warn('读取原生会话文件失败，尝试回退本地存储:', err);
  }

  if (nativeRaw) {
    // Clean up any leftover legacy localStorage tabs now that native session is authoritative
    try {
      storage?.removeItem(STORAGE_SESSION_KEY);
    } catch {
      // ignore storage cleanup errors
    }

    if (!restoreSession) {
      return { source: 'skipped', session: null };
    }

    const fallbackActive = (() => {
      try {
        return storage?.getItem(STORAGE_ACTIVE_TAB_KEY) ?? null;
      } catch {
        return null;
      }
    })();

    const parsed = parseSessionPayload(nativeRaw, startupView, fallbackActive);
    return {
      source: parsed ? 'native' : 'empty',
      session: parsed,
    };
  }

  // No native session file exists yet: check for legacy localStorage session to migrate
  let legacyRaw: string | null = null;
  let legacyActive: string | null = null;
  try {
    legacyRaw = storage?.getItem(STORAGE_SESSION_KEY) ?? null;
    legacyActive = storage?.getItem(STORAGE_ACTIVE_TAB_KEY) ?? null;
  } catch {
    // ignore storage read errors
  }

  if (legacyRaw) {
    const migrated = parseSessionPayload(legacyRaw, startupView, legacyActive);
    if (migrated) {
      try {
        await backend.writeSessionData(
          serializeSessionEnvelope(migrated.tabs, migrated.activeTabId)
        );
        // Free WebView localStorage ~5 MB quota only after native file write succeeds
        try {
          storage?.removeItem(STORAGE_SESSION_KEY);
        } catch {
          // ignore
        }
      } catch (err) {
        console.warn('迁移旧版会话到应用数据目录失败:', err);
      }

      if (!restoreSession) {
        return { source: 'skipped', session: null };
      }
      return { source: 'migrated', session: migrated };
    }
  }

  return { source: 'empty', session: null };
}

function isUnmodifiedWelcomeTab(tab: DocumentTab): boolean {
  return tab.id === 'doc-welcome' && !tab.isDirty && !tab.filePath;
}

/**
 * Merges asynchronously hydrated session tabs with the live tab list so tabs
 * opened concurrently during cold start (e.g. CLI file arguments or user edits)
 * are never overwritten or lost.
 */
export function mergeHydratedSessionWithCurrentTabs(
  hydrated: ParsedSession,
  currentTabs: DocumentTab[],
  currentActiveId: string
): ParsedSession {
  // Filter out the untouched startup placeholder tab
  const liveAdditions = currentTabs.filter((tab) => !isUnmodifiedWelcomeTab(tab));

  if (liveAdditions.length === 0) {
    return {
      tabs: hydrated.tabs,
      activeTabId:
        hydrated.activeTabId && hydrated.tabs.some((t) => t.id === hydrated.activeTabId)
          ? hydrated.activeTabId
          : hydrated.tabs[0].id,
    };
  }

  // Deduplicate by normalized file path (or exact tab id when already restored from localStorage):
  // live tabs win because they hold the freshest disk read or user keystrokes.
  const liveIds = new Set(liveAdditions.map((t) => t.id));
  const livePaths = new Set(
    liveAdditions
      .map((t) => normalizePathKey(t.filePath))
      .filter((k): k is string => Boolean(k))
  );

  const keptHydrated = hydrated.tabs.filter((tab) => {
    if (liveIds.has(tab.id)) return false;
    const key = normalizePathKey(tab.filePath);
    if (key && livePaths.has(key)) return false;
    return true;
  });

  const mergedTabs = [...keptHydrated, ...liveAdditions];
  const currentActiveIsLive = liveAdditions.some((t) => t.id === currentActiveId);

  let mergedActiveId: string;
  if (currentActiveIsLive && mergedTabs.some((t) => t.id === currentActiveId)) {
    mergedActiveId = currentActiveId;
  } else if (hydrated.activeTabId && mergedTabs.some((t) => t.id === hydrated.activeTabId)) {
    mergedActiveId = hydrated.activeTabId;
  } else {
    mergedActiveId = mergedTabs[0].id;
  }

  return {
    tabs: mergedTabs,
    activeTabId: mergedActiveId,
  };
}

/**
 * Persists the current session to Tauri's native app-data file (in desktop mode)
 * or `localStorage` (in Web mode). Returns `true` on success, `false` on failure.
 */
export async function persistSession(options: {
  tabs: DocumentTab[];
  activeTabId: string | null;
  backend?: SessionNativeBackend;
  storage?: SessionStorageLike | null;
}): Promise<boolean> {
  const {
    tabs,
    activeTabId,
    backend = defaultNativeBackend,
    storage = getDefaultWebStorage(),
  } = options;

  if (backend.isTauri()) {
    try {
      await backend.writeSessionData(serializeSessionEnvelope(tabs, activeTabId));
      if (activeTabId) {
        try {
          storage?.setItem(STORAGE_ACTIVE_TAB_KEY, activeTabId);
        } catch {
          // non-critical pointer
        }
      }
      return true;
    } catch {
      return false;
    }
  }

  if (!storage) {
    return false;
  }

  try {
    storage.setItem(STORAGE_SESSION_KEY, JSON.stringify(tabs));
    if (activeTabId) {
      storage.setItem(STORAGE_ACTIVE_TAB_KEY, activeTabId);
    }
    return true;
  } catch {
    return false;
  }
}
