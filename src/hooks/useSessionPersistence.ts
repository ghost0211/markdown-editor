import { useCallback, useEffect, useRef } from 'react';
import { DocumentTab, StartupViewMode } from '@/types';
import { isTauri } from '@/lib/native';
import {
  STORAGE_ACTIVE_TAB_KEY,
  hydrateNativeSession,
  mergeHydratedSessionWithCurrentTabs,
  persistSession,
} from '@/lib/sessionStorage';
import { useI18n } from '@/i18n';

/**
 * Debounce window for persisting the session. Every keystroke changes a tab,
 * and serializing every open document on each keystroke is wasteful; flush()
 * paths guarantee nothing is lost when the window hides or closes.
 */
export const SESSION_SAVE_DEBOUNCE_MS = 400;

export interface UseSessionPersistenceOptions {
  restoreSession: boolean;
  startupView: StartupViewMode;
  activeTabId: string;
  tabsRef: React.MutableRefObject<DocumentTab[]>;
  setTabs: React.Dispatch<React.SetStateAction<DocumentTab[]>>;
  setActiveTabId: React.Dispatch<React.SetStateAction<string>>;
  showToast: (msg: string, type: 'info' | 'success' | 'warning' | 'error') => void;
}

export function useSessionPersistence({
  restoreSession,
  startupView,
  activeTabId,
  tabsRef,
  setTabs,
  setActiveTabId,
  showToast,
}: UseSessionPersistenceOptions) {
  const { t } = useI18n();

  const activeTabIdRef = useRef(activeTabId);
  activeTabIdRef.current = activeTabId;

  const sessionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSessionRef = useRef<DocumentTab[] | null>(null);
  const sessionWarningShownRef = useRef(false);
  // In Tauri mode, block writes until initial native hydration completes so
  // frame-0 placeholder state never overwrites an existing session_v1.json.
  const isHydratedRef = useRef(!isTauri());
  const hasSessionMutatedRef = useRef(false);

  const showToastRef = useRef(showToast);
  showToastRef.current = showToast;
  const tRef = useRef(t);
  tRef.current = t;

  const writeSessionNow = useCallback((updatedTabs: DocumentTab[], currentActiveId?: string) => {
    void persistSession({
      tabs: updatedTabs,
      activeTabId: currentActiveId ?? activeTabIdRef.current,
    }).then((ok) => {
      if (ok) {
        sessionWarningShownRef.current = false;
      } else if (!sessionWarningShownRef.current) {
        sessionWarningShownRef.current = true;
        showToastRef.current(tRef.current('toasts.sessionSaveFailed'), 'warning');
      }
    });
  }, []);

  /** Writes any debounced session update immediately. */
  const flushSession = useCallback(() => {
    if (sessionTimerRef.current !== null) {
      clearTimeout(sessionTimerRef.current);
      sessionTimerRef.current = null;
    }
    if (!isHydratedRef.current) return;
    const pending = pendingSessionRef.current;
    pendingSessionRef.current = null;
    if (pending) {
      writeSessionNow(pending);
    }
  }, [writeSessionNow]);

  const saveSession = useCallback(
    (updatedTabs: DocumentTab[]) => {
      hasSessionMutatedRef.current = true;
      pendingSessionRef.current = updatedTabs;
      if (!isHydratedRef.current) return;
      if (sessionTimerRef.current !== null) return;

      sessionTimerRef.current = setTimeout(() => {
        sessionTimerRef.current = null;
        const pending = pendingSessionRef.current;
        pendingSessionRef.current = null;
        if (pending) {
          writeSessionNow(pending);
        }
      }, SESSION_SAVE_DEBOUNCE_MS);
    },
    [writeSessionNow]
  );

  // Hydrate from Tauri's native app-data file (and migrate legacy localStorage if needed)
  const startupRestoreRef = useRef({ restoreSession, startupView });
  useEffect(() => {
    if (!isTauri()) {
      isHydratedRef.current = true;
      return;
    }

    let cancelled = false;
    void hydrateNativeSession({
      restoreSession: startupRestoreRef.current.restoreSession,
      startupView: startupRestoreRef.current.startupView,
    }).then((result) => {
      if (cancelled) return;
      isHydratedRef.current = true;

      if (result.session) {
        const merged = mergeHydratedSessionWithCurrentTabs(
          result.session,
          tabsRef.current,
          activeTabIdRef.current
        );
        tabsRef.current = merged.tabs;
        setTabs(merged.tabs);
        if (merged.activeTabId) {
          activeTabIdRef.current = merged.activeTabId;
          setActiveTabId(merged.activeTabId);
        }
        // If new tabs/edits arrived while hydrating, persist the merged list
        if (pendingSessionRef.current !== null) {
          pendingSessionRef.current = null;
          writeSessionNow(merged.tabs, merged.activeTabId ?? undefined);
        }
      } else if (pendingSessionRef.current !== null) {
        const pending = pendingSessionRef.current;
        pendingSessionRef.current = null;
        writeSessionNow(pending);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [setActiveTabId, setTabs, tabsRef, writeSessionNow]);

  // Persist activeTabId changes without destroying saved sessions when restoreSession is false
  const prevActiveIdRef = useRef(activeTabId);
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_ACTIVE_TAB_KEY, activeTabId);
    } catch {
      // ignore storage failures
    }
    if (prevActiveIdRef.current !== activeTabId) {
      prevActiveIdRef.current = activeTabId;
      if (isTauri() && isHydratedRef.current && (restoreSession || hasSessionMutatedRef.current)) {
        saveSession(tabsRef.current);
      }
    }
  }, [activeTabId, restoreSession, saveSession, tabsRef]);

  // Never lose the tail of a debounced write when the window hides or unloads
  useEffect(() => {
    const handleLeave = () => flushSession();
    const handleVisibility = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        flushSession();
      }
    };

    window.addEventListener('beforeunload', handleLeave);
    window.addEventListener('pagehide', handleLeave);
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      window.removeEventListener('beforeunload', handleLeave);
      window.removeEventListener('pagehide', handleLeave);
      document.removeEventListener('visibilitychange', handleVisibility);
      flushSession();
    };
  }, [flushSession]);

  return { saveSession, flushSession };
}
