import { describe, expect, it } from 'vitest';
import {
  DEFAULT_WORKSPACE_DOCUMENT_NAME,
  WORKSPACE_DOCUMENT_EXTENSIONS,
  buildWorkspaceTree,
  compareWorkspaceEntries,
  defaultExpandedWorkspacePaths,
  findWorkspaceEntry,
  getWorkspaceDocumentExtension,
  isSafeWorkspaceRelativePath,
  isSupportedWorkspaceDocument,
  isWorkspaceEntryActive,
  isWorkspaceDocumentEntry,
  joinWorkspacePath,
  normalizeWorkspaceDocumentName,
  normalizeWorkspaceRelativePath,
  summarizeWorkspaceEntries,
  validateWorkspaceEntryName,
  workspaceAncestorPaths,
  workspaceEntryAbsolutePath,
  workspaceEntryDepth,
  workspaceEntryName,
  workspaceParentPath,
  workspacePathSegments,
  workspaceRelativeFromAbsolute,
  workspaceTreeRowId,
  type WorkspaceEntry,
} from '../src/lib/workspace';

function entry(path: string, kind: 'directory' | 'document' = 'document'): WorkspaceEntry {
  return { path, name: path.split('/').pop() ?? path, kind };
}

describe('workspace relative path normalization', () => {
  it('normalizes separators, redundant slashes and leading ./', () => {
    expect(normalizeWorkspaceRelativePath('notes/todo.md')).toBe('notes/todo.md');
    expect(normalizeWorkspaceRelativePath('notes\\todo.md')).toBe('notes/todo.md');
    expect(normalizeWorkspaceRelativePath('  notes//deep\\todo.md  ')).toBe('notes/deep/todo.md');
    expect(normalizeWorkspaceRelativePath('./notes/todo.md')).toBe('notes/todo.md');
    expect(normalizeWorkspaceRelativePath('././notes/todo.md')).toBe('notes/todo.md');
  });

  it('rejects absolute, drive, UNC, dot-segment and empty paths', () => {
    for (const unsafe of [
      '',
      '   ',
      '.',
      '..',
      '../escape.md',
      'notes/../../escape.md',
      '/etc/passwd',
      'C:\\Windows\\system32',
      'C:/Windows/system32',
      '//server/share/file.md',
      'notes/\u0000evil.md',
      'notes//..//x.md',
    ]) {
      expect(normalizeWorkspaceRelativePath(unsafe), unsafe).toBeNull();
      expect(isSafeWorkspaceRelativePath(unsafe)).toBe(false);
    }
  });

  it('derives segments, parents, depths and names', () => {
    expect(workspacePathSegments('a/b/c.md')).toEqual(['a', 'b', 'c.md']);
    expect(workspaceEntryDepth('a/b/c.md')).toBe(3);
    expect(workspaceEntryDepth('root.md')).toBe(1);
    expect(workspaceParentPath('a/b/c.md')).toBe('a/b');
    expect(workspaceParentPath('root.md')).toBe('');
    expect(workspaceAncestorPaths('a/b/c.md')).toEqual(['a', 'a/b']);
    expect(workspaceAncestorPaths('root.md')).toEqual([]);
    expect(workspaceEntryName('a/b/c.md')).toBe('c.md');
  });

  it('joins parent and name only when both are safe', () => {
    expect(joinWorkspacePath('', 'notes.md')).toBe('notes.md');
    expect(joinWorkspacePath('notes', 'todo.md')).toBe('notes/todo.md');
    expect(joinWorkspacePath('notes/deep', 'todo.md')).toBe('notes/deep/todo.md');
    expect(joinWorkspacePath('notes', '../escape.md')).toBeNull();
    expect(joinWorkspacePath('notes', 'nested/todo.md')).toBeNull();
    expect(joinWorkspacePath('../outside', 'todo.md')).toBeNull();
    expect(joinWorkspacePath('notes', '   ')).toBeNull();
  });
});

describe('workspace entry name validation', () => {
  it('accepts ordinary documents, folders and unicode names', () => {
    for (const name of ['notes.md', 'todo.markdown', 'plain.txt', 'Notes', '中文 笔记', 'v1.2']) {
      expect(validateWorkspaceEntryName(name), name).toBeNull();
    }
  });

  it('rejects empty, whitespace-padded, traversal and separator names', () => {
    expect(validateWorkspaceEntryName('')).toBe('empty');
    expect(validateWorkspaceEntryName('   ')).toBe('empty');
    expect(validateWorkspaceEntryName(' notes.md ')).toBe('surroundingSpaces');
    expect(validateWorkspaceEntryName('.')).toBe('dotSegment');
    expect(validateWorkspaceEntryName('..')).toBe('dotSegment');
    expect(validateWorkspaceEntryName('../escape.md')).toBe('pathSeparator');
    expect(validateWorkspaceEntryName('notes/todo.md')).toBe('pathSeparator');
    expect(validateWorkspaceEntryName('notes\\todo.md')).toBe('pathSeparator');
    expect(validateWorkspaceEntryName('C:\\notes.md')).toBe('pathSeparator');
  });

  it('rejects Windows-invalid characters, trailing dots/spaces and reserved devices', () => {
    expect(validateWorkspaceEntryName('bad:name.md')).toBe('invalidChars');
    expect(validateWorkspaceEntryName('bad?name.md')).toBe('invalidChars');
    expect(validateWorkspaceEntryName('notes.')).toBe('trailingDotOrSpace');
    expect(validateWorkspaceEntryName('CON')).toBe('reserved');
    expect(validateWorkspaceEntryName('con.md')).toBe('reserved');
    expect(validateWorkspaceEntryName('LPT9.txt')).toBe('reserved');
    expect(validateWorkspaceEntryName('COM0.txt')).toBeNull();
    expect(validateWorkspaceEntryName('a'.repeat(256))).toBe('tooLong');
    expect(validateWorkspaceEntryName('a'.repeat(255))).toBeNull();
  });

  it('mirrors the native create-document extension rules', () => {
    expect(DEFAULT_WORKSPACE_DOCUMENT_NAME).toBe('default.md');
    expect(normalizeWorkspaceDocumentName('about')).toBe('about.md');
    expect(normalizeWorkspaceDocumentName('about.md')).toBe('about.md');
    expect(normalizeWorkspaceDocumentName('about.MARKDOWN')).toBe('about.MARKDOWN');
    expect(normalizeWorkspaceDocumentName('about.txt')).toBe('about.txt');
    expect(normalizeWorkspaceDocumentName('about.xmd')).toBeNull();
    expect(normalizeWorkspaceDocumentName('about.exe')).toBeNull();
    expect(normalizeWorkspaceDocumentName('../about')).toBeNull();
    expect(normalizeWorkspaceDocumentName('about.')).toBeNull();
  });

  it('recognizes supported workspace documents only', () => {
    for (const extension of WORKSPACE_DOCUMENT_EXTENSIONS) {
      expect(isSupportedWorkspaceDocument(`doc.${extension}`)).toBe(true);
      expect(isSupportedWorkspaceDocument(`doc.${extension.toUpperCase()}`)).toBe(true);
    }
    expect(isSupportedWorkspaceDocument('image.png')).toBe(false);
    expect(isSupportedWorkspaceDocument('notes')).toBe(false);
    expect(getWorkspaceDocumentExtension('notes.MD')).toBe('md');
    expect(isWorkspaceDocumentEntry(entry('a.md'))).toBe(true);
    expect(isWorkspaceDocumentEntry(entry('a', 'directory'))).toBe(false);
  });
});

describe('workspace tree building', () => {
  it('nests by parent path and sorts directories before documents', () => {
    const tree = buildWorkspaceTree([
      entry('notes/todo.md'),
      entry('notes', 'directory'),
      entry('about.md'),
      entry('archive/2024/old.md'),
      entry('archive', 'directory'),
      entry('archive/2024', 'directory'),
      entry('zeta.md'),
    ]);

    expect(tree.map((node) => node.entry.path)).toEqual(['archive', 'notes', 'about.md', 'zeta.md']);
    expect(tree[0].children.map((node) => node.entry.path)).toEqual(['archive/2024']);
    expect(tree[0].children[0].children.map((node) => node.entry.path)).toEqual([
      'archive/2024/old.md',
    ]);
    expect(tree[1].children.map((node) => node.entry.path)).toEqual(['notes/todo.md']);
  });

  it('synthesizes missing ancestor directories instead of dropping documents', () => {
    const tree = buildWorkspaceTree([entry('truncated/deep/kept.md')]);
    expect(tree).toHaveLength(1);
    expect(tree[0].entry).toMatchObject({ path: 'truncated', kind: 'directory' });
    expect(tree[0].children[0].entry.path).toBe('truncated/deep');
    expect(tree[0].children[0].children[0].entry.path).toBe('truncated/deep/kept.md');
  });

  it('ignores unsafe, duplicate and empty entry paths', () => {
    const tree = buildWorkspaceTree([
      entry('../escape.md'),
      entry('/absolute.md'),
      entry('ok.md'),
      entry('ok.md'),
      entry(''),
    ]);
    expect(tree).toHaveLength(1);
    expect(tree[0].entry.path).toBe('ok.md');
    expect(tree[0].entry.name).toBe('ok.md');
  });

  it('sorts names naturally (numeric segments) and case-insensitively', () => {
    const entries = [entry('chapter10.md'), entry('chapter2.md'), entry('Beta.md'), entry('alpha.md')];
    const sorted = [...entries].sort(compareWorkspaceEntries).map((item) => item.path);
    expect(sorted).toEqual(['alpha.md', 'Beta.md', 'chapter2.md', 'chapter10.md']);
  });

  it('finds entries by normalized relative path', () => {
    const entries = [entry('notes/todo.md'), entry('notes', 'directory')];
    expect(findWorkspaceEntry(entries, 'notes\\todo.md')?.path).toBe('notes/todo.md');
    expect(findWorkspaceEntry(entries, './notes')).toBe(entries[1]);
    expect(findWorkspaceEntry(entries, '../todo.md')).toBeNull();
  });

  it('summarizes counts for the header and cap warning', () => {
    expect(
      summarizeWorkspaceEntries([
        entry('notes', 'directory'),
        entry('notes/a.md'),
        entry('b.txt'),
      ])
    ).toEqual({ total: 3, directories: 1, documents: 2 });
    expect(summarizeWorkspaceEntries([])).toEqual({ total: 0, directories: 0, documents: 0 });
  });
});

describe('workspace expansion and absolute path mapping', () => {
  it('expands only the ancestors of the active document by default', () => {
    expect(defaultExpandedWorkspacePaths('notes/deep/todo.md')).toEqual(['notes', 'notes/deep']);
    expect(defaultExpandedWorkspacePaths('todo.md')).toEqual([]);
    expect(defaultExpandedWorkspacePaths(null)).toEqual([]);
  });

  it('maps an absolute active document inside the root to its ancestors', () => {
    expect(
      defaultExpandedWorkspacePaths('C:\\ws\\notes\\todo.md', 'C:\\ws')
    ).toEqual(['notes']);
    expect(
      defaultExpandedWorkspacePaths('C:\\other\\notes\\todo.md', 'C:\\ws')
    ).toEqual([]);
  });

  it('joins relative entries onto the selected root', () => {
    expect(workspaceEntryAbsolutePath('C:\\ws', 'notes/todo.md')).toBe('C:\\ws\\notes\\todo.md');
    expect(workspaceEntryAbsolutePath('C:\\ws\\', 'todo.md')).toBe('C:\\ws\\todo.md');
    expect(workspaceEntryAbsolutePath('/home/user/ws', 'a/b.md')).toBe('/home/user/ws/a/b.md');
    expect(workspaceEntryAbsolutePath('C:\\ws', '../escape.md')).toBeNull();
    expect(workspaceEntryAbsolutePath('', 'a.md')).toBeNull();
  });

  it('recovers root-relative paths from absolute document paths', () => {
    expect(workspaceRelativeFromAbsolute('C:\\ws', 'c:\\WS\\notes\\todo.md')).toBe(
      'notes/todo.md'
    );
    expect(workspaceRelativeFromAbsolute('C:\\ws', 'C:\\other\\todo.md')).toBeNull();
    expect(workspaceRelativeFromAbsolute('C:\\ws', 'C:\\ws')).toBeNull();
    expect(workspaceRelativeFromAbsolute('/home/user/ws', '/home/user/ws/a.md')).toBe('a.md');
  });

  it('detects the active entry for relative and absolute active paths', () => {
    expect(isWorkspaceEntryActive('notes/todo.md', 'notes/todo.md')).toBe(true);
    expect(isWorkspaceEntryActive('notes\\todo.md', 'C:\\ws\\notes\\todo.md', 'C:\\ws')).toBe(true);
    expect(isWorkspaceEntryActive('notes/other.md', 'C:\\ws\\notes\\todo.md', 'C:\\ws')).toBe(
      false
    );
    expect(isWorkspaceEntryActive('notes/todo.md', null)).toBe(false);
    expect(isWorkspaceEntryActive('notes/todo.md', 'C:\\outside\\todo.md', 'C:\\ws')).toBe(false);
  });

  it('builds DOM-safe row ids', () => {
    expect(workspaceTreeRowId('notes/todo.md')).toBe('workspace-row-notes-todo-md');
    expect(workspaceTreeRowId('中文 笔记.md')).toBe('workspace-row--md');
  });
});
