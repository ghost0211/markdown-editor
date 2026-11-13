import { useCallback, useEffect, useRef } from 'react';
import { DocumentTab } from '@/types';
import { getFileMtime, isTauri } from '@/lib/native';
import { decideAutoSave, isAutoSaveEligible } from '@/lib/documentUtils';

/** Idle time after the last edit before an auto save is written to disk. */
export const AUTO_SAVE_DELAY_MS = 1500;

export interface UseAutoSaveOptions {
  autoSave: boolean;
  tabsRef: React.MutableRefObject<DocumentTab[]>;
  writeDocumentTab: (tabId: string, forceSaveAs?: boolean, silent?: boolean) => Promise<boolean>;
}

/**
 * Automatically writes dirty file-backed tabs to disk after `AUTO_SAVE_DELAY_MS`
 * of inactivity or when the window loses focus / becomes hidden.
 *
 * Never prompts, never touches untitled or browser documents, and refuses to
 * overwrite a file whose on-disk mtime moved since it was last read or saved.
 */
export function useAutoSave({
  autoSave,
  tabsRef,
  writeDocumentTab,
}: UseAutoSaveOptions): { scheduleAutoSave: () => void } {
  const autoSaveRef = useRef(autoSave);
  autoSaveRef.current = autoSave;

  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoSavingRef = useRef(false);
  const autoSaveRerunRef = useRef(false);
  const scheduleRef = useRef<() => void>(() => {});

  const clearAutoSaveTimer = useCallback(() => {
    if (autoSaveTimerRef.current !== null) {
      clearTimeout(autoSaveTimerRef.current);
      autoSaveTimerRef.current = null;
    }
  }, []);

  const runAutoSave = useCallback(async () => {
    if (!autoSaveRef.current) return;
    if (autoSavingRef.current) {
      autoSaveRerunRef.current = true;
      return;
    }
    autoSavingRef.current = true;
    try {
      const candidates = tabsRef.current.filter((tab) => isAutoSaveEligible(tab));
      for (const candidate of candidates) {
        if (!autoSaveRef.current) break;
        if (!isTauri()) continue;
        const mtime = await getFileMtime(candidate.filePath!);
        // Re-read after the await: the tab may have been saved, edited or closed.
        const current = tabsRef.current.find((tab) => tab.id === candidate.id);
        if (!decideAutoSave(current, mtime)) continue;
        await writeDocumentTab(candidate.id, false, true);
      }
    } finally {
      autoSavingRef.current = false;
      if (autoSaveRerunRef.current) {
        autoSaveRerunRef.current = false;
        scheduleRef.current();
      }
    }
  }, [tabsRef, writeDocumentTab]);

  const scheduleAutoSave = useCallback(() => {
    if (!autoSaveRef.current) return;
    clearAutoSaveTimer();
    autoSaveTimerRef.current = setTimeout(() => {
      autoSaveTimerRef.current = null;
      void runAutoSave();
    }, AUTO_SAVE_DELAY_MS);
  }, [clearAutoSaveTimer, runAutoSave]);

  scheduleRef.current = scheduleAutoSave;

  useEffect(() => {
    if (autoSave) {
      // Persist edits that were made while the setting was off.
      scheduleAutoSave();
    } else {
      clearAutoSaveTimer();
    }
  }, [autoSave, scheduleAutoSave, clearAutoSaveTimer]);

  useEffect(() => {
    const saveNow = () => {
      if (!autoSaveRef.current) return;
      clearAutoSaveTimer();
      void runAutoSave();
    };
    const handleVisibility = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        saveNow();
      }
    };
    window.addEventListener('blur', saveNow);
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      window.removeEventListener('blur', saveNow);
      document.removeEventListener('visibilitychange', handleVisibility);
      clearAutoSaveTimer();
    };
  }, [runAutoSave, clearAutoSaveTimer]);

  return { scheduleAutoSave };
}
