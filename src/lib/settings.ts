import { ThemeMode, StartupViewMode, TabSizeOption, EditorSettings } from '@/types';

export type { EditorSettings, StartupViewMode, TabSizeOption };

export const SETTINGS_STORAGE_KEY = 'markdown_editor_settings_v1';
export const LEGACY_THEME_KEY = 'markdown_editor_theme';

export const SETTINGS_BOUNDS = {
  fontSize: { min: 11, max: 28, step: 1, default: 14 },
  lineHeight: { min: 1.2, max: 2.4, step: 0.1, default: 1.6 },
  tabSizeOptions: [2, 4, 8] as const,
  supportedExtensions: ['.md', '.markdown', '.mdown', '.mkd', '.txt'] as const,
} as const;

export const DEFAULT_SETTINGS: EditorSettings = {
  version: 1,
  theme: 'system',
  fontSize: 14,
  lineHeight: 1.6,
  tabSize: 2,
  wordWrap: true,
  lineNumbers: true,
  restoreSession: true,
  startupView: 'remember-last',
};

/**
 * Defensively validate and normalize settings payload.
 * Fallbacks to sensible defaults and bounds on invalid or corrupted fields.
 */
export function validateSettings(raw: unknown): EditorSettings {
  if (!raw || typeof raw !== 'object') {
    return { ...DEFAULT_SETTINGS };
  }

  const obj = raw as Partial<EditorSettings>;

  // 1. Theme: 'light' | 'dark' | 'system'
  let theme: ThemeMode = DEFAULT_SETTINGS.theme;
  if (obj.theme === 'light' || obj.theme === 'dark' || obj.theme === 'system') {
    theme = obj.theme;
  }

  // 2. Font Size: bounded integer between min and max
  let fontSize = DEFAULT_SETTINGS.fontSize;
  if (typeof obj.fontSize === 'number' && !Number.isNaN(obj.fontSize)) {
    fontSize = Math.min(
      SETTINGS_BOUNDS.fontSize.max,
      Math.max(SETTINGS_BOUNDS.fontSize.min, Math.round(obj.fontSize))
    );
  }

  // 3. Line Height: bounded number between min and max (rounded to 1 decimal place)
  let lineHeight = DEFAULT_SETTINGS.lineHeight;
  if (typeof obj.lineHeight === 'number' && !Number.isNaN(obj.lineHeight)) {
    const clamped = Math.min(
      SETTINGS_BOUNDS.lineHeight.max,
      Math.max(SETTINGS_BOUNDS.lineHeight.min, obj.lineHeight)
    );
    lineHeight = Math.round(clamped * 10) / 10;
  }

  // 4. Tab Size: 2 | 4 | 8
  let tabSize: TabSizeOption = DEFAULT_SETTINGS.tabSize;
  if (obj.tabSize === 2 || obj.tabSize === 4 || obj.tabSize === 8) {
    tabSize = obj.tabSize;
  }

  // 5. Word Wrap: boolean
  const wordWrap =
    typeof obj.wordWrap === 'boolean' ? obj.wordWrap : DEFAULT_SETTINGS.wordWrap;

  // 6. Line Numbers: boolean
  const lineNumbers =
    typeof obj.lineNumbers === 'boolean' ? obj.lineNumbers : DEFAULT_SETTINGS.lineNumbers;

  // 7. Restore Session: boolean
  const restoreSession =
    typeof obj.restoreSession === 'boolean'
      ? obj.restoreSession
      : DEFAULT_SETTINGS.restoreSession;

  // 8. Startup View: 'remember-last' | 'edit' | 'split' | 'read'
  let startupView: StartupViewMode = DEFAULT_SETTINGS.startupView;
  if (
    obj.startupView === 'remember-last' ||
    obj.startupView === 'edit' ||
    obj.startupView === 'split' ||
    obj.startupView === 'read'
  ) {
    startupView = obj.startupView;
  }

  return {
    version: 1,
    theme,
    fontSize,
    lineHeight,
    tabSize,
    wordWrap,
    lineNumbers,
    restoreSession,
    startupView,
  };
}

/**
 * Load settings from localStorage with defensive parsing, defaults, and legacy migration.
 */
export function loadSettings(): EditorSettings {
  if (typeof localStorage === 'undefined') {
    return { ...DEFAULT_SETTINGS };
  }

  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return validateSettings(parsed);
    }
  } catch (e) {
    console.warn('读取设置失败，回退到默认设置:', e);
  }

  // Fallback / migration: check legacy theme key if versioned settings not yet created
  try {
    const legacyTheme = localStorage.getItem(LEGACY_THEME_KEY);
    if (legacyTheme === 'light' || legacyTheme === 'dark' || legacyTheme === 'system') {
      return {
        ...DEFAULT_SETTINGS,
        theme: legacyTheme,
      };
    }
  } catch {
    // ignore
  }

  return { ...DEFAULT_SETTINGS };
}

/**
 * Save settings to localStorage and keep legacy keys synchronized.
 */
export function saveSettings(settings: EditorSettings): void {
  if (typeof localStorage === 'undefined') {
    return;
  }

  const validated = validateSettings(settings);
  try {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(validated));
    // Synchronize legacy theme key
    localStorage.setItem(LEGACY_THEME_KEY, validated.theme);
  } catch (e) {
    console.warn('保存设置到 localStorage 失败:', e);
  }
}
