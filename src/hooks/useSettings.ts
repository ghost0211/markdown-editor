import { useState, useCallback, useEffect } from 'react';
import {
  EditorSettings,
  DEFAULT_SETTINGS,
  loadSettings,
  saveSettings,
  validateSettings,
  SETTINGS_STORAGE_KEY,
} from '@/lib/settings';

export function useSettings() {
  const [settings, setSettingsState] = useState<EditorSettings>(() => loadSettings());

  const updateSetting = useCallback(
    <K extends keyof EditorSettings>(key: K, value: EditorSettings[K]) => {
      setSettingsState((prev: EditorSettings) => {
        const next = validateSettings({ ...prev, [key]: value });
        saveSettings(next);
        return next;
      });
    },
    []
  );

  const updateSettings = useCallback((partial: Partial<EditorSettings>) => {
    setSettingsState((prev: EditorSettings) => {
      const next = validateSettings({ ...prev, ...partial });
      saveSettings(next);
      return next;
    });
  }, []);

  const resetSettings = useCallback(() => {
    saveSettings(DEFAULT_SETTINGS);
    setSettingsState(DEFAULT_SETTINGS);
  }, []);

  // Listen to storage events from other windows / tabs
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleStorage = (e: StorageEvent) => {
      if (e.key === SETTINGS_STORAGE_KEY && e.newValue) {
        try {
          const parsed = JSON.parse(e.newValue);
          setSettingsState(validateSettings(parsed));
        } catch {
          // ignore
        }
      }
    };

    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  return {
    settings,
    updateSetting,
    updateSettings,
    resetSettings,
  };
}
