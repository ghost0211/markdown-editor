import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  validateSettings,
  loadSettings,
  saveSettings,
  DEFAULT_SETTINGS,
  SETTINGS_STORAGE_KEY,
  LEGACY_THEME_KEY,
  SETTINGS_BOUNDS,
} from '../src/lib/settings';

describe('Settings Validation and Persistence (settings.ts)', () => {
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

  describe('validateSettings', () => {
    it('should return default settings for null or non-object input', () => {
      expect(validateSettings(null)).toEqual(DEFAULT_SETTINGS);
      expect(validateSettings(undefined)).toEqual(DEFAULT_SETTINGS);
      expect(validateSettings('')).toEqual(DEFAULT_SETTINGS);
      expect(validateSettings(123)).toEqual(DEFAULT_SETTINGS);
      expect(validateSettings([])).toEqual(DEFAULT_SETTINGS);
    });

    it('should validate and preserve valid settings object', () => {
      const valid = {
        version: 1 as const,
        language: 'en-US' as const,
        theme: 'dark' as const,
        fontSize: 16,
        lineHeight: 1.8,
        tabSize: 4 as const,
        wordWrap: false,
        lineNumbers: false,
        restoreSession: false,
        startupView: 'edit' as const,
      };
      expect(validateSettings(valid)).toEqual(valid);
    });

    it('should validate language to allowed options (zh-CN, en-US) and default to zh-CN', () => {
      expect(validateSettings({ language: 'zh-CN' }).language).toBe('zh-CN');
      expect(validateSettings({ language: 'en-US' }).language).toBe('en-US');
      expect(validateSettings({ language: 'fr-FR' as unknown as 'zh-CN' }).language).toBe('zh-CN');
      expect(validateSettings({ language: 123 as unknown as 'zh-CN' }).language).toBe('zh-CN');
      expect(validateSettings({ language: null as unknown as 'zh-CN' }).language).toBe('zh-CN');
      expect(validateSettings({}).language).toBe('zh-CN');
    });

    it('should clamp out-of-bounds fontSize to [11, 28]', () => {
      expect(validateSettings({ fontSize: 5 }).fontSize).toBe(SETTINGS_BOUNDS.fontSize.min);
      expect(validateSettings({ fontSize: 100 }).fontSize).toBe(SETTINGS_BOUNDS.fontSize.max);
      expect(validateSettings({ fontSize: 15.6 }).fontSize).toBe(16);
      expect(validateSettings({ fontSize: 'invalid' as unknown as number }).fontSize).toBe(14);
      expect(validateSettings({ fontSize: NaN }).fontSize).toBe(14);
    });

    it('should clamp and round lineHeight to [1.2, 2.4]', () => {
      expect(validateSettings({ lineHeight: 0.5 }).lineHeight).toBe(SETTINGS_BOUNDS.lineHeight.min);
      expect(validateSettings({ lineHeight: 4.0 }).lineHeight).toBe(SETTINGS_BOUNDS.lineHeight.max);
      expect(validateSettings({ lineHeight: 1.666 }).lineHeight).toBe(1.7);
      expect(validateSettings({ lineHeight: 'invalid' as unknown as number }).lineHeight).toBe(1.6);
      expect(validateSettings({ lineHeight: NaN }).lineHeight).toBe(1.6);
    });

    it('should validate tabSize to allowed options (2, 4, 8)', () => {
      expect(validateSettings({ tabSize: 2 }).tabSize).toBe(2);
      expect(validateSettings({ tabSize: 4 }).tabSize).toBe(4);
      expect(validateSettings({ tabSize: 8 }).tabSize).toBe(8);
      expect(validateSettings({ tabSize: 3 as unknown as 2 }).tabSize).toBe(DEFAULT_SETTINGS.tabSize);
      expect(validateSettings({ tabSize: '4' as unknown as 2 }).tabSize).toBe(DEFAULT_SETTINGS.tabSize);
    });

    it('should validate theme to allowed options (light, dark, system)', () => {
      expect(validateSettings({ theme: 'light' }).theme).toBe('light');
      expect(validateSettings({ theme: 'dark' }).theme).toBe('dark');
      expect(validateSettings({ theme: 'system' }).theme).toBe('system');
      expect(validateSettings({ theme: 'solarized' as unknown as 'dark' }).theme).toBe('system');
    });

    it('should validate startupView to allowed options (remember-last, edit, split, read)', () => {
      expect(validateSettings({ startupView: 'remember-last' }).startupView).toBe('remember-last');
      expect(validateSettings({ startupView: 'edit' }).startupView).toBe('edit');
      expect(validateSettings({ startupView: 'split' }).startupView).toBe('split');
      expect(validateSettings({ startupView: 'read' }).startupView).toBe('read');
      expect(validateSettings({ startupView: 'unknown' as unknown as 'split' }).startupView).toBe('remember-last');
    });

    it('should validate boolean fields (wordWrap, lineNumbers, restoreSession)', () => {
      expect(validateSettings({ wordWrap: false }).wordWrap).toBe(false);
      expect(validateSettings({ wordWrap: true }).wordWrap).toBe(true);
      expect(validateSettings({ wordWrap: 'yes' as unknown as boolean }).wordWrap).toBe(true);

      expect(validateSettings({ lineNumbers: false }).lineNumbers).toBe(false);
      expect(validateSettings({ lineNumbers: true }).lineNumbers).toBe(true);

      expect(validateSettings({ restoreSession: false }).restoreSession).toBe(false);
      expect(validateSettings({ restoreSession: true }).restoreSession).toBe(true);
    });
  });

  describe('loadSettings and saveSettings', () => {
    it('should load default settings when localStorage is empty', () => {
      const loaded = loadSettings();
      expect(loaded).toEqual(DEFAULT_SETTINGS);
      expect(loaded.language).toBe('zh-CN');
    });

    it('should migrate legacy settings without language field to default language zh-CN', () => {
      localStorageMock[SETTINGS_STORAGE_KEY] = JSON.stringify({
        version: 1,
        theme: 'dark',
        fontSize: 16,
        lineHeight: 1.8,
        tabSize: 4,
        wordWrap: false,
        lineNumbers: false,
        restoreSession: false,
        startupView: 'edit',
      });
      const loaded = loadSettings();
      expect(loaded.language).toBe('zh-CN');
      expect(loaded.theme).toBe('dark');
      expect(loaded.fontSize).toBe(16);
    });

    it('should migrate legacy theme key when versioned settings key does not exist', () => {
      localStorageMock[LEGACY_THEME_KEY] = 'dark';
      const loaded = loadSettings();
      expect(loaded.theme).toBe('dark');
      expect(loaded.language).toBe('zh-CN');
      expect(loaded.fontSize).toBe(DEFAULT_SETTINGS.fontSize);
    });

    it('should prefer versioned settings over legacy theme key if present', () => {
      localStorageMock[LEGACY_THEME_KEY] = 'light';
      localStorageMock[SETTINGS_STORAGE_KEY] = JSON.stringify({
        version: 1,
        language: 'en-US',
        theme: 'dark',
        fontSize: 18,
        lineHeight: 1.8,
        tabSize: 4,
        wordWrap: false,
        lineNumbers: true,
        restoreSession: false,
        startupView: 'read',
      });

      const loaded = loadSettings();
      expect(loaded.language).toBe('en-US');
      expect(loaded.theme).toBe('dark');
      expect(loaded.fontSize).toBe(18);
      expect(loaded.startupView).toBe('read');
    });

    it('should gracefully handle corrupted JSON in localStorage', () => {
      localStorageMock[SETTINGS_STORAGE_KEY] = 'NOT_VALID_JSON{:::';
      const loaded = loadSettings();
      expect(loaded).toEqual(DEFAULT_SETTINGS);
    });

    it('should save settings and synchronize legacy theme key', () => {
      const newSettings = {
        ...DEFAULT_SETTINGS,
        language: 'en-US' as const,
        theme: 'dark' as const,
        fontSize: 20,
        tabSize: 4 as const,
      };

      saveSettings(newSettings);

      expect(localStorageMock[SETTINGS_STORAGE_KEY]).toBeDefined();
      const parsed = JSON.parse(localStorageMock[SETTINGS_STORAGE_KEY]);
      expect(parsed.language).toBe('en-US');
      expect(parsed.fontSize).toBe(20);
      expect(parsed.theme).toBe('dark');
      expect(localStorageMock[LEGACY_THEME_KEY]).toBe('dark');
    });
  });
});
