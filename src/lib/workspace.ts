/**
 * Pure path and tree helpers for the folder workspace panel.
 *
 * This module deliberately contains **no Tauri/native dependency**: it can be
 * imported (and unit tested) in Node, SSR and browser environments. Native
 * calls live in the root-owned wrappers around the `workspace` Rust commands;
 * `WorkspacePanel` only receives data and callbacks through props.
 *
 * Every path that crosses the IPC boundary is *root-relative* and uses forward
 * slashes, because that representation is stable on Windows and POSIX and can
 * be rendered directly in the tree. Paths coming back from the UI are treated
 * as untrusted and re-validated here before they are handed to a callback.
 */

export type WorkspaceEntryKind = 'directory' | 'document';

export interface WorkspaceEntry {
  /** Root-relative path, forward-slash separated (e.g. `notes/todo.md`). */
  path: string;
  /** Display name (last path segment), already UTF-8 lossy on the native side. */
  name: string;
  kind: WorkspaceEntryKind;
}

export interface WorkspaceListing {
  /** Canonical workspace root chosen by the native folder picker. */
  root: string;
  entries: WorkspaceEntry[];
  /** True when the native walk stopped at its entry/depth cap. */
  truncated: boolean;
}

export interface WorkspaceRenameResult {
  oldPath: string;
  newPath: string;
}

export interface WorkspaceTreeNode {
  entry: WorkspaceEntry;
  children: WorkspaceTreeNode[];
}

/** Keep in sync with `WORKSPACE_DOCUMENT_EXTENSIONS` in `workspace.rs`. */
export const WORKSPACE_DOCUMENT_EXTENSIONS = [
  'md',
  'markdown',
  'mdown',
  'mkd',
  'txt',
  'xmd',
] as const;

/** Keep in sync with `WORKSPACE_CREATABLE_DOCUMENT_EXTENSIONS` in `workspace.rs`. */
export const WORKSPACE_CREATABLE_DOCUMENT_EXTENSIONS = ['md', 'markdown', 'txt'] as const;

export const WORKSPACE_MAX_ENTRIES = 5000;
export const WORKSPACE_MAX_DEPTH = 12;
export const DEFAULT_WORKSPACE_DOCUMENT_NAME = 'default.md';

export type WorkspaceNameError =
  | 'empty'
  | 'surroundingSpaces'
  | 'pathSeparator'
  | 'dotSegment'
  | 'trailingDotOrSpace'
  | 'controlChars'
  | 'invalidChars'
  | 'reserved'
  | 'tooLong';

const WINDOWS_RESERVED_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
const WINDOWS_INVALID_CHARS = /[<>:"|?*]/;
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001F\u007F]/;

function isWindowsStylePath(path: string): boolean {
  return /^[a-zA-Z]:/.test(path) || path.startsWith('//');
}

function trimTrailingSeparators(path: string): string {
  return path.length > 1 ? path.replace(/[/\\]+$/, '') : path;
}

/** Case-insensitive key for Windows-style absolute paths, normalized otherwise. */
function pathComparisonKey(path: string): string {
  const normalized = trimTrailingSeparators(path.trim().replace(/\\/g, '/'));
  return isWindowsStylePath(normalized) ? normalized.toLowerCase() : normalized;
}

/**
 * Normalizes an untrusted root-relative path.
 *
 * Returns `null` for absolute paths, drive/UNC paths, `.`/`..` segments, empty
 * segments, control characters or empty input — the panel simply ignores those
 * instead of passing them to a native command.
 */
export function normalizeWorkspaceRelativePath(input: string): string | null {
  if (typeof input !== 'string') return null;
  let value = input.trim();
  if (!value || CONTROL_CHARS.test(value)) return null;
  value = value.replace(/\\/g, '/');
  if (value.startsWith('/') || /^[a-zA-Z]:/.test(value)) return null;

  while (value.startsWith('./')) value = value.slice(2);
  if (value === '.' || value === '') return null;

  const segments = value.split('/').filter((segment) => segment.length > 0);
  if (segments.length === 0) return null;
  if (segments.some((segment) => segment === '.' || segment === '..')) return null;

  return segments.join('/');
}

export function isSafeWorkspaceRelativePath(input: string): boolean {
  return normalizeWorkspaceRelativePath(input) !== null;
}

/** Segments of a normalized relative path. */
export function workspacePathSegments(relativePath: string): string[] {
  const normalized = normalizeWorkspaceRelativePath(relativePath);
  return normalized ? normalized.split('/') : [];
}

/** Depth of a path (a top-level entry has depth 1). */
export function workspaceEntryDepth(relativePath: string): number {
  return workspacePathSegments(relativePath).length;
}

/** Parent path, or `''` for an entry directly under the root. */
export function workspaceParentPath(relativePath: string): string {
  const segments = workspacePathSegments(relativePath);
  return segments.slice(0, -1).join('/');
}

/** Ancestor directory paths, outermost first, excluding the path itself. */
export function workspaceAncestorPaths(relativePath: string): string[] {
  const segments = workspacePathSegments(relativePath);
  const ancestors: string[] = [];
  for (let index = 1; index < segments.length; index += 1) {
    ancestors.push(segments.slice(0, index).join('/'));
  }
  return ancestors;
}

export function workspaceEntryName(relativePath: string): string {
  const segments = workspacePathSegments(relativePath);
  return segments.length > 0 ? segments[segments.length - 1] : '';
}

/**
 * Joins a validated parent path and a new entry name.
 * Returns `null` if either part is unsafe (path separators, `..`, ...).
 */
export function joinWorkspacePath(parent: string, name: string): string | null {
  const trimmedParent = parent.trim();
  const normalizedParent = trimmedParent === '' ? '' : normalizeWorkspaceRelativePath(trimmedParent);
  if (normalizedParent === null) return null;
  if (validateWorkspaceEntryName(name) !== null) return null;
  return normalizedParent ? `${normalizedParent}/${name.trim()}` : name.trim();
}

/** Returns the first validation error, or `null` for a usable name. */
export function validateWorkspaceEntryName(name: string): WorkspaceNameError | null {
  const trimmed = typeof name === 'string' ? name.trim() : '';
  if (!trimmed) return 'empty';
  if (name !== trimmed) return 'surroundingSpaces';
  if (trimmed === '.' || trimmed === '..') return 'dotSegment';
  if (trimmed.includes('/') || trimmed.includes('\\')) return 'pathSeparator';
  if (CONTROL_CHARS.test(trimmed)) return 'controlChars';
  if (WINDOWS_INVALID_CHARS.test(trimmed)) return 'invalidChars';
  if (trimmed.endsWith('.') || trimmed.endsWith(' ')) return 'trailingDotOrSpace';
  if (trimmed.length > 255) return 'tooLong';
  if (WINDOWS_RESERVED_NAMES.test(trimmed.split('.')[0])) return 'reserved';
  return null;
}

/** Mirrors the native rule: `.md` is appended when no extension is typed. */
export function normalizeWorkspaceDocumentName(name: string): string | null {
  if (validateWorkspaceEntryName(name) !== null) return null;
  const trimmed = name.trim();
  const dotIndex = trimmed.lastIndexOf('.');
  const extension = dotIndex > 0 ? trimmed.slice(dotIndex + 1).toLowerCase() : '';
  if (!extension) return `${trimmed}.md`;
  return (WORKSPACE_CREATABLE_DOCUMENT_EXTENSIONS as readonly string[]).includes(extension)
    ? trimmed
    : null;
}

export function getWorkspaceDocumentExtension(name: string): string {
  const trimmed = name.trim().toLowerCase();
  const dotIndex = trimmed.lastIndexOf('.');
  return dotIndex > 0 ? trimmed.slice(dotIndex + 1) : '';
}

export function isSupportedWorkspaceDocument(name: string): boolean {
  return (WORKSPACE_DOCUMENT_EXTENSIONS as readonly string[]).includes(
    getWorkspaceDocumentExtension(name)
  );
}

export function isWorkspaceDocumentEntry(entry: WorkspaceEntry): boolean {
  return entry.kind === 'document';
}

export function findWorkspaceEntry(
  entries: readonly WorkspaceEntry[],
  relativePath: string
): WorkspaceEntry | null {
  const normalized = normalizeWorkspaceRelativePath(relativePath);
  if (!normalized) return null;
  return entries.find((entry) => normalizeWorkspaceRelativePath(entry.path) === normalized) ?? null;
}

function entrySortKey(entry: WorkspaceEntry): string {
  return entry.name || workspaceEntryName(entry.path);
}

/** Directories first, then case-insensitive natural name order. */
export function compareWorkspaceEntries(left: WorkspaceEntry, right: WorkspaceEntry): number {
  if (left.kind !== right.kind) return left.kind === 'directory' ? -1 : 1;
  return entrySortKey(left).localeCompare(entrySortKey(right), undefined, {
    numeric: true,
    sensitivity: 'base',
  });
}

/**
 * Builds a sorted tree from the flat native listing.
 *
 * Missing ancestor directories (possible when the native walk was truncated
 * mid-level) are synthesized as directory nodes so a document is never lost
 * from the tree. Duplicate paths keep the first occurrence.
 */
export function buildWorkspaceTree(entries: readonly WorkspaceEntry[]): WorkspaceTreeNode[] {
  const nodes = new Map<string, WorkspaceTreeNode>();

  for (const entry of entries) {
    const path = normalizeWorkspaceRelativePath(entry.path);
    if (!path || nodes.has(path)) continue;
    const name = entry.name?.trim() || workspaceEntryName(path);
    const kind: WorkspaceEntryKind = entry.kind === 'directory' ? 'directory' : 'document';
    nodes.set(path, { entry: { path, name, kind }, children: [] });
  }

  for (const path of [...nodes.keys()]) {
    for (const ancestor of workspaceAncestorPaths(path)) {
      if (nodes.has(ancestor)) continue;
      nodes.set(ancestor, {
        entry: {
          path: ancestor,
          name: workspaceEntryName(ancestor),
          kind: 'directory',
        },
        children: [],
      });
    }
  }

  const roots: WorkspaceTreeNode[] = [];
  for (const [path, node] of nodes) {
    const parent = workspaceParentPath(path);
    if (!parent) {
      roots.push(node);
      continue;
    }
    nodes.get(parent)?.children.push(node);
  }

  const sortLevel = (level: WorkspaceTreeNode[]) => {
    level.sort((left, right) => compareWorkspaceEntries(left.entry, right.entry));
    for (const node of level) sortLevel(node.children);
  };
  sortLevel(roots);
  return roots;
}

/** Default expansion: ancestors of the active document, nothing else. */
export function defaultExpandedWorkspacePaths(
  activePath: string | null | undefined,
  rootPath?: string | null
): string[] {
  const relative = activePath
    ? normalizeWorkspaceRelativePath(activePath) ??
      (rootPath ? workspaceRelativeFromAbsolute(rootPath, activePath) : null)
    : null;
  return relative ? workspaceAncestorPaths(relative) : [];
}

/** Absolute join used when the panel hands a document path to `onOpen`. */
export function workspaceEntryAbsolutePath(
  rootPath: string,
  relativePath: string
): string | null {
  const root = rootPath.trim();
  const normalized = normalizeWorkspaceRelativePath(relativePath);
  if (!root || !normalized) return null;
  const separator = root.includes('\\') ? '\\' : '/';
  const base = trimTrailingSeparators(root);
  return `${base}${separator}${normalized.replace(/\//g, separator)}`;
}

/** Converts an absolute document path back to a root-relative workspace path. */
export function workspaceRelativeFromAbsolute(
  rootPath: string,
  absolutePath: string
): string | null {
  const rootKey = pathComparisonKey(rootPath);
  const absoluteKey = pathComparisonKey(absolutePath);
  if (!rootKey || !absoluteKey) return null;
  if (absoluteKey === rootKey) return null;
  const prefix = rootKey.endsWith('/') ? rootKey : `${rootKey}/`;
  if (!absoluteKey.startsWith(prefix)) return null;
  return normalizeWorkspaceRelativePath(absoluteKey.slice(prefix.length));
}

/** True when a tree entry is the active document, relative or absolute input. */
export function isWorkspaceEntryActive(
  entryPath: string,
  activePath: string | null | undefined,
  rootPath?: string | null
): boolean {
  const entry = normalizeWorkspaceRelativePath(entryPath);
  if (!entry || !activePath) return false;
  const activeRelative =
    normalizeWorkspaceRelativePath(activePath) ??
    (rootPath ? workspaceRelativeFromAbsolute(rootPath, activePath) : null);
  if (!activeRelative) return false;
  return pathComparisonKey(entry) === pathComparisonKey(activeRelative);
}

/** Counts used by the panel header / cap warning. */
export function summarizeWorkspaceEntries(entries: readonly WorkspaceEntry[]): {
  total: number;
  directories: number;
  documents: number;
} {
  let directories = 0;
  let documents = 0;
  for (const entry of entries) {
    if (entry.kind === 'directory') directories += 1;
    else documents += 1;
  }
  return { total: entries.length, directories, documents };
}

/** Relative path for a collapsed/expanded tree row (accessible toggle label). */
export function workspaceTreeRowId(relativePath: string): string {
  return `workspace-row-${relativePath.replace(/[^a-zA-Z0-9_-]+/g, '-')}`;
}
