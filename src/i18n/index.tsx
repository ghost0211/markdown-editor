import React, { createContext, useContext, useMemo, ReactNode, useCallback } from 'react';
import { Language, Leaves, TranslationParams } from './types';
import { zhCN, TranslationsSchema } from './locales/zh-CN';
import { enUS } from './locales/en-US';

export type { Language, TranslationParams } from './types';
export type TranslationKey = Leaves<TranslationsSchema>;

export const translations: Record<Language, TranslationsSchema> = {
  'zh-CN': zhCN,
  'en-US': enUS,
};

/**
 * Replaces `{paramName}` placeholders with corresponding values from `params`.
 * Uses a callback replacer to safely handle `$` and special regex patterns in values.
 */
export function interpolate(template: string, params?: TranslationParams): string {
  if (!params || !template) {
    return template;
  }
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, paramKey) => {
    if (Object.prototype.hasOwnProperty.call(params, paramKey)) {
      const val = params[paramKey];
      return val !== undefined && val !== null ? String(val) : '';
    }
    return match;
  });
}

/**
 * Traverses a nested object by a dot-delimited path.
 */
function lookupPath(obj: unknown, path: string): unknown {
  if (!obj || typeof obj !== 'object') return undefined;
  const segments = path.split('.');
  let current: unknown = obj;
  for (const segment of segments) {
    if (current && typeof current === 'object' && segment in current) {
      current = (current as Record<string, unknown>)[segment];
    } else {
      return undefined;
    }
  }
  return current;
}

const SETTINGS_STORAGE_KEY = 'markdown_editor_settings_v1';

/**
 * Pure helper to read persisted current language from localStorage at invocation time.
 * Returns 'zh-CN' by default if not set or on parse failure.
 */
export function getCurrentLanguage(): Language {
  try {
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && (parsed.language === 'en-US' || parsed.language === 'zh-CN')) {
          return parsed.language;
        }
      }
    }
  } catch {
    // Ignore storage parse error
  }
  return 'zh-CN';
}

/**
 * Internal translation resolver with Chinese fallback for missing or empty keys.
 */
function resolveTranslation(
  language: Language,
  key: string,
  params?: TranslationParams
): string {
  const currentDict = translations[language] || translations['zh-CN'];
  let val = lookupPath(currentDict, key);

  // Fallback to zh-CN if missing in target language
  if (typeof val !== 'string' || val.length === 0) {
    val = lookupPath(translations['zh-CN'], key);
  }

  // If still missing, return the raw key name
  if (typeof val !== 'string') {
    return key;
  }

  return interpolate(val, params);
}

/**
 * Strictly typed translation resolver.
 */
export function t(
  language: Language,
  key: TranslationKey,
  params?: TranslationParams
): string {
  return resolveTranslation(language, key, params);
}

/**
 * Unsafe / dynamic translation resolver for testing or fallback handling.
 */
export function tUnsafe(
  language: Language,
  key: string,
  params?: TranslationParams
): string {
  return resolveTranslation(language, key, params);
}

export interface I18nContextValue {
  language: Language;
  t: (key: TranslationKey, params?: TranslationParams) => string;
}

const I18nContext = createContext<I18nContextValue>({
  language: 'zh-CN',
  t: (key, params) => t('zh-CN', key, params),
});

export interface I18nProviderProps {
  language: Language;
  children: ReactNode;
}

export const I18nProvider: React.FC<I18nProviderProps> = ({ language, children }) => {
  const safeLang: Language = language === 'en-US' ? 'en-US' : 'zh-CN';

  const translate = useCallback(
    (key: TranslationKey, params?: TranslationParams) => {
      return t(safeLang, key, params);
    },
    [safeLang]
  );

  const value = useMemo<I18nContextValue>(
    () => ({
      language: safeLang,
      t: translate,
    }),
    [safeLang, translate]
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
};

export function useI18n(): I18nContextValue {
  return useContext(I18nContext);
}

// Alias for convenience
export const useTranslation = useI18n;
