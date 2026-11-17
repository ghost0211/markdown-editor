/**
 * Export style theme model.
 *
 * The style is deliberately small and closed: fonts, colors, and a few page
 * elements are selected from fixed whitelists. Callers must never accept or
 * store arbitrary CSS here, because the same values are reused by the HTML,
 * PDF, and Word exporters (including `file://` standalone documents).
 */

export type ExportFontFamily = 'system' | 'serif' | 'mono';
export type ExportColorScheme = 'light' | 'sepia' | 'dark';

export interface ExportStyle {
  fontFamily: ExportFontFamily;
  /** Body font size in CSS px. Bounds are 10..20. */
  fontSize: number;
  colorScheme: ExportColorScheme;
  cover: boolean;
  toc: boolean;
  /** Plain-text running header, sanitized to at most 100 characters. */
  headerText: string;
  pageNumbers: boolean;
}

export interface ExportColorPalette {
  readonly background: string;
  readonly text: string;
  readonly heading: string;
  readonly muted: string;
  readonly border: string;
  readonly link: string;
  readonly panel: string;
}

export const EXPORT_FONT_FAMILIES = ['system', 'serif', 'mono'] as const;
export const EXPORT_COLOR_SCHEMES = ['light', 'sepia', 'dark'] as const;

export const EXPORT_FONT_SIZE_MIN = 10;
export const EXPORT_FONT_SIZE_MAX = 20;
export const EXPORT_HEADER_TEXT_MAX_LENGTH = 100;

export const EXPORT_PRESETS_STORAGE_KEY = 'markdown_editor_export_presets_v1';
export const MAX_EXPORT_PRESETS = 10;
export const EXPORT_PRESET_NAME_MAX_LENGTH = 80;

/**
 * Defaults intentionally reproduce today's exporter look:
 * - the HTML/PDF body used a 15px system sans-serif on a white background;
 * - no cover page, TOC, header, or print page-number chrome was emitted.
 * Word keeps its legacy footer while no style is supplied; `pageNumbers`
 * only changes that behavior when a style is explicitly passed in.
 */
export const DEFAULT_EXPORT_STYLE: ExportStyle = {
  fontFamily: 'system',
  fontSize: 15,
  colorScheme: 'light',
  cover: false,
  toc: false,
  headerText: '',
  pageNumbers: false,
};

/** Fixed font stacks shared by HTML and PDF. No user-provided CSS is allowed. */
export const EXPORT_FONT_STACKS: Record<ExportFontFamily, string> = {
  system:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "WenQuanYi Micro Hei", "Helvetica Neue", Arial, sans-serif',
  serif:
    'Georgia, "Times New Roman", "Songti SC", SimSun, "Noto Serif CJK SC", "Source Han Serif SC", serif',
  mono:
    'Consolas, "Cascadia Code", "Fira Code", Monaco, "Courier New", "Noto Sans Mono CJK SC", monospace',
};

/** Fixed color palettes. Every value is a literal whitelist entry. */
export const EXPORT_COLOR_PALETTES: Record<ExportColorScheme, ExportColorPalette> = {
  light: {
    background: '#ffffff',
    text: '#1e293b',
    heading: '#0f172a',
    muted: '#64748b',
    border: '#e2e8f0',
    link: '#2563eb',
    panel: '#f8fafc',
  },
  sepia: {
    background: '#f4ecd8',
    text: '#3b2f2f',
    heading: '#2b2118',
    muted: '#7a6a55',
    border: '#d9c9a3',
    link: '#8b5e34',
    panel: '#efe3c8',
  },
  dark: {
    background: '#111827',
    text: '#e2e8f0',
    heading: '#f8fafc',
    muted: '#94a3b8',
    border: '#334155',
    link: '#60a5fa',
    panel: '#1e293b',
  },
};

export function isExportFontFamily(value: unknown): value is ExportFontFamily {
  return typeof value === 'string' && (EXPORT_FONT_FAMILIES as readonly string[]).includes(value);
}

export function isExportColorScheme(value: unknown): value is ExportColorScheme {
  return typeof value === 'string' && (EXPORT_COLOR_SCHEMES as readonly string[]).includes(value);
}

export function getExportFontStack(family: ExportFontFamily): string {
  return EXPORT_FONT_STACKS[isExportFontFamily(family) ? family : DEFAULT_EXPORT_STYLE.fontFamily];
}

export function getExportColorPalette(scheme: ExportColorScheme): ExportColorPalette {
  return EXPORT_COLOR_PALETTES[
    isExportColorScheme(scheme) ? scheme : DEFAULT_EXPORT_STYLE.colorScheme
  ];
}

/** Clamp a font size into the supported 10..20 px range, rounding to whole px. */
export function clampExportFontSize(value: unknown, fallback = DEFAULT_EXPORT_STYLE.fontSize): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(EXPORT_FONT_SIZE_MAX, Math.max(EXPORT_FONT_SIZE_MIN, Math.round(value)));
}

/**
 * Sanitizes a plain-text running header:
 * - rejects non-strings;
 * - removes C0/C1 controls, zero-width characters, and bidi overrides;
 * - collapses whitespace to single spaces and trims;
 * - caps the result at 100 UTF-16 code units.
 *
 * HTML escaping is intentionally left to the HTML renderer, so a literal
 * `<b>` stays visible text instead of being silently dropped here.
 */
export function sanitizeHeaderText(value: unknown): string {
  if (typeof value !== 'string') {
    return '';
  }
  const cleaned = value
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.slice(0, EXPORT_HEADER_TEXT_MAX_LENGTH);
}

function hasOwn(obj: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

/**
 * Defensively validate an untrusted export style and always return a fresh
 * object containing only known keys. Invalid or missing fields fall back to
 * `DEFAULT_EXPORT_STYLE`; out-of-range sizes are clamped; header text is
 * sanitized. Never throws, including for `null`, arrays, or primitives.
 */
export function validateExportStyle(raw: unknown): ExportStyle {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ...DEFAULT_EXPORT_STYLE };
  }

  const obj = raw as Record<string, unknown>;

  const fontFamily: ExportFontFamily =
    hasOwn(obj, 'fontFamily') && isExportFontFamily(obj.fontFamily)
      ? obj.fontFamily
      : DEFAULT_EXPORT_STYLE.fontFamily;

  const fontSize = hasOwn(obj, 'fontSize')
    ? clampExportFontSize(obj.fontSize)
    : DEFAULT_EXPORT_STYLE.fontSize;

  const colorScheme: ExportColorScheme =
    hasOwn(obj, 'colorScheme') && isExportColorScheme(obj.colorScheme)
      ? obj.colorScheme
      : DEFAULT_EXPORT_STYLE.colorScheme;

  const cover =
    hasOwn(obj, 'cover') && typeof obj.cover === 'boolean'
      ? obj.cover
      : DEFAULT_EXPORT_STYLE.cover;

  const toc =
    hasOwn(obj, 'toc') && typeof obj.toc === 'boolean' ? obj.toc : DEFAULT_EXPORT_STYLE.toc;

  const headerText = hasOwn(obj, 'headerText') ? sanitizeHeaderText(obj.headerText) : '';

  const pageNumbers =
    hasOwn(obj, 'pageNumbers') && typeof obj.pageNumbers === 'boolean'
      ? obj.pageNumbers
      : DEFAULT_EXPORT_STYLE.pageNumbers;

  return {
    fontFamily,
    fontSize,
    colorScheme,
    cover,
    toc,
    headerText,
    pageNumbers,
  };
}

/** Compares only the known style fields, ignoring extra runtime keys. */
export function areExportStylesEqual(a: ExportStyle, b: ExportStyle): boolean {
  return (
    a.fontFamily === b.fontFamily &&
    a.fontSize === b.fontSize &&
    a.colorScheme === b.colorScheme &&
    a.cover === b.cover &&
    a.toc === b.toc &&
    a.headerText === b.headerText &&
    a.pageNumbers === b.pageNumbers
  );
}

export function isDefaultExportStyle(style: ExportStyle): boolean {
  return areExportStylesEqual(style, DEFAULT_EXPORT_STYLE);
}

export interface ExportStylePreset {
  id: string;
  name: string;
  style: ExportStyle;
}

function resolveStorage(storage?: Storage | null): Storage | null {
  if (storage !== undefined) {
    return storage;
  }
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

/** Normalizes a user-entered preset name to a safe, bounded single line. */
export function sanitizePresetName(value: unknown): string {
  if (typeof value !== 'string') {
    return '';
  }
  return value
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, EXPORT_PRESET_NAME_MAX_LENGTH);
}

function createPresetId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {
    // Fall through to the timestamp-based id below.
  }
  return `exp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function normalizePresetId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 128) return null;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001F\u007F]/.test(trimmed)) return null;
  return trimmed;
}

function normalizePreset(raw: unknown, index: number): ExportStylePreset | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return null;
  }
  const obj = raw as Record<string, unknown>;
  const name = sanitizePresetName(obj.name);
  if (!name) {
    return null;
  }
  if (!obj.style || typeof obj.style !== 'object' || Array.isArray(obj.style)) {
    return null;
  }
  const id = normalizePresetId(obj.id) || `preset-${index + 1}`;
  return {
    id,
    name,
    style: validateExportStyle(obj.style),
  };
}

function normalizePresetList(raw: unknown): ExportStylePreset[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const result: ExportStylePreset[] = [];
  const seenIds = new Set<string>();
  const seenNames = new Set<string>();
  for (let index = 0; index < raw.length && result.length < MAX_EXPORT_PRESETS; index += 1) {
    const preset = normalizePreset(raw[index], index);
    if (!preset || seenIds.has(preset.id) || seenNames.has(preset.name)) {
      continue;
    }
    seenIds.add(preset.id);
    seenNames.add(preset.name);
    result.push(preset);
  }
  return result;
}

/**
 * Loads local export presets. The storage payload is untrusted: malformed
 * JSON, wrong shapes, duplicates, and over-limit arrays are ignored safely.
 */
export function loadExportPresets(storage?: Storage | null): ExportStylePreset[] {
  const target = resolveStorage(storage);
  if (!target) {
    return [];
  }
  try {
    const raw = target.getItem(EXPORT_PRESETS_STORAGE_KEY);
    if (!raw) {
      return [];
    }
    return normalizePresetList(JSON.parse(raw));
  } catch {
    return [];
  }
}

/** Persists (and returns) a normalized, deduplicated list capped at 10. */
export function saveExportPresets(
  presets: unknown,
  storage?: Storage | null
): ExportStylePreset[] {
  const normalized = normalizePresetList(presets);
  const target = resolveStorage(storage);
  if (!target) {
    return normalized;
  }
  try {
    target.setItem(EXPORT_PRESETS_STORAGE_KEY, JSON.stringify(normalized));
  } catch {
    // Quota / privacy-mode failures must not break the export dialog.
  }
  return normalized;
}

/**
 * Creates or replaces a preset by trimmed name and puts it first.
 * Returns the persisted list; an empty name leaves the list unchanged.
 */
export function upsertExportPreset(
  name: string,
  style: ExportStyle,
  storage?: Storage | null
): ExportStylePreset[] {
  const cleanName = sanitizePresetName(name);
  const current = loadExportPresets(storage);
  if (!cleanName) {
    return current;
  }

  const normalizedStyle = validateExportStyle(style);
  const existingIndex = current.findIndex((preset) => preset.name === cleanName);

  let next: ExportStylePreset[];
  if (existingIndex >= 0) {
    const existing = current[existingIndex];
    next = [
      { ...existing, style: normalizedStyle },
      ...current.slice(0, existingIndex),
      ...current.slice(existingIndex + 1),
    ];
  } else {
    next = [
      { id: createPresetId(), name: cleanName, style: normalizedStyle },
      ...current,
    ].slice(0, MAX_EXPORT_PRESETS);
  }

  return saveExportPresets(next, storage);
}

export function deleteExportPreset(
  id: string,
  storage?: Storage | null
): ExportStylePreset[] {
  const current = loadExportPresets(storage);
  if (!id) {
    return current;
  }
  return saveExportPresets(
    current.filter((preset) => preset.id !== id),
    storage
  );
}
