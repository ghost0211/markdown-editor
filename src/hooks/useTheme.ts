import { useState, useEffect, useCallback } from 'react';
import { ThemeMode } from '@/types';
import { loadSettings, saveSettings, LEGACY_THEME_KEY } from '@/lib/settings';

export function useTheme(
  externalTheme?: ThemeMode,
  onExternalThemeChange?: (newTheme: ThemeMode) => void
) {
  const [internalTheme, setInternalTheme] = useState<ThemeMode>(() => {
    if (externalTheme) return externalTheme;
    return loadSettings().theme;
  });

  const theme = externalTheme !== undefined ? externalTheme : internalTheme;

  const [resolvedDark, setResolvedDark] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    if (theme === 'dark') return true;
    if (theme === 'light') return false;
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  });

  const applyTheme = useCallback((currentTheme: ThemeMode) => {
    let isDark = false;
    if (currentTheme === 'dark') {
      isDark = true;
    } else if (currentTheme === 'light') {
      isDark = false;
    } else {
      isDark =
        typeof window !== 'undefined' &&
        window.matchMedia('(prefers-color-scheme: dark)').matches;
    }

    setResolvedDark(isDark);
    if (typeof document !== 'undefined') {
      if (isDark) {
        document.documentElement.classList.add('dark');
      } else {
        document.documentElement.classList.remove('dark');
      }
    }
  }, []);

  const setTheme = useCallback(
    (newTheme: ThemeMode) => {
      if (onExternalThemeChange) {
        onExternalThemeChange(newTheme);
      } else {
        setInternalTheme(newTheme);
        const current = loadSettings();
        saveSettings({ ...current, theme: newTheme });
      }
      try {
        localStorage.setItem(LEGACY_THEME_KEY, newTheme);
      } catch {
        // ignore
      }
      applyTheme(newTheme);
    },
    [onExternalThemeChange, applyTheme]
  );

  useEffect(() => {
    applyTheme(theme);

    if (typeof window === 'undefined') return;
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = () => {
      if (theme === 'system') {
        applyTheme('system');
      }
    };

    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, [theme, applyTheme]);

  return {
    theme,
    setTheme,
    isDark: resolvedDark,
  };
}
