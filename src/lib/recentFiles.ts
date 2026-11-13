import { getFileNameFromPath, normalizePathKey } from '@/lib/documentUtils';

export const RECENT_FILES_STORAGE_KEY = 'markdown_editor_recent_files_v1';
export const MAX_RECENT_FILES = 10;
export const MAX_CLOSED_FILES = 20;

export interface RecentFile {
  path: string;
  name: string;
  /** Epoch ms of the last time the file was opened or saved. */
  openedAt: number;
}

/** Only real files on disk are worth remembering (not unsaved / browser tabs). */
export function isRecordablePath(path?: string | null): path is string {
  if (!path) return false;
  const trimmed = path.trim();
  return Boolean(trimmed) && !trimmed.startsWith('browser://');
}

/** Moves (or inserts) `path` to the front of the list, deduplicating by normalized path. */
export function addRecentFile(
  list: RecentFile[],
  path: string,
  now = Date.now(),
  max = MAX_RECENT_FILES
): RecentFile[] {
  if (!isRecordablePath(path)) return list;
  const trimmed = path.trim();
  const key = normalizePathKey(trimmed);
  const rest = list.filter((item) => normalizePathKey(item.path) !== key);
  return [{ path: trimmed, name: getFileNameFromPath(trimmed), openedAt: now }, ...rest].slice(0, max);
}

export function removeRecentFile(list: RecentFile[], path: string): RecentFile[] {
  const key = normalizePathKey(path);
  const next = list.filter((item) => normalizePathKey(item.path) !== key);
  return next.length === list.length ? list : next;
}

/** Defensively parses persisted data; anything malformed is dropped. */
export function sanitizeRecentFiles(raw: unknown, max = MAX_RECENT_FILES): RecentFile[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const result: RecentFile[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const { path, openedAt } = item as Partial<RecentFile>;
    if (typeof path !== 'string' || !isRecordablePath(path)) continue;
    const key = normalizePathKey(path);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({
      path: path.trim(),
      name: getFileNameFromPath(path.trim()),
      openedAt: typeof openedAt === 'number' && Number.isFinite(openedAt) ? openedAt : 0,
    });
    if (result.length >= max) break;
  }
  return result;
}

export function loadRecentFiles(): RecentFile[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(RECENT_FILES_STORAGE_KEY);
    return raw ? sanitizeRecentFiles(JSON.parse(raw)) : [];
  } catch {
    return [];
  }
}

export function saveRecentFiles(list: RecentFile[]): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(RECENT_FILES_STORAGE_KEY, JSON.stringify(list));
  } catch {
    // Recent files are a convenience; ignore storage failures.
  }
}

/** Remembers a just-closed file path (newest last), skipping duplicates. */
export function pushClosedFile(stack: string[], path?: string | null, max = MAX_CLOSED_FILES): string[] {
  if (!isRecordablePath(path)) return stack;
  const key = normalizePathKey(path);
  const next = stack.filter((item) => normalizePathKey(item) !== key);
  next.push(path.trim());
  return next.length > max ? next.slice(next.length - max) : next;
}
