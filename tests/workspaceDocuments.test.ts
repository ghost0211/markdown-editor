import { describe, expect, it } from 'vitest';
import { movedWorkspacePath, relativeWorkspaceResource, renameWorkspaceDocuments } from '../src/lib/workspaceDocuments';
import type { DocumentTab } from '../src/types';

const tab = (overrides: Partial<DocumentTab> = {}): DocumentTab => ({
  id: 'doc', title: 'note.md', filePath: 'C:\\docs\\note.md', content: '', savedContent: '', isDirty: false, cursorLine: 1, cursorCol: 1, ...overrides,
});

describe('workspace document rename', () => {
  it('moves a file or an entire directory without changing unrelated paths', () => {
    expect(movedWorkspacePath('C:\\Docs\\Notes\\a.md', 'c:/docs/notes', 'C:/docs/archive')).toBe('C:/docs/archive/a.md');
    expect(movedWorkspacePath('C:/docs/notes-old/a.md', 'C:/docs/notes', 'C:/docs/archive')).toBeNull();
    expect(movedWorkspacePath('', 'C:/docs/notes', 'C:/docs/archive')).toBeNull();
    expect(movedWorkspacePath('C:/docs/note.md', 'C:/docs/note.md', 'C:/docs/NOTE.md')).toBe('C:/docs/NOTE.md');
  });

  it('encodes literal Unicode, spaces, hashes and percent characters in relative paths', () => {
    expect(relativeWorkspaceResource('C:/文档/图片 #100%.png', 'C:/docs/note.md')).toBe('../%E6%96%87%E6%A1%A3/%E5%9B%BE%E7%89%87%20%23100%25.png');
    expect(relativeWorkspaceResource('C:/docs/assets/pic.png', 'C:/docs/note.md')).toBe('assets/pic.png');
  });

  it('updates local document links and images when a directory is renamed', () => {
    const original = '[章节](guide/chapter.md)\n\n![图片](guide/assets/a%20b.png "标题")\n\n`[示例](guide/code.md)`';
    const result = renameWorkspaceDocuments([tab({ content: original, savedContent: original })], 'C:/docs/guide', 'C:/docs/handbook');
    expect(result.tabs[0].content).toContain('[章节](<handbook/chapter.md>)');
    expect(result.tabs[0].content).toContain('![图片](<handbook/assets/a%20b.png> "标题")');
    expect(result.tabs[0].content).toContain('`[示例](guide/code.md)`');
    expect(result.tabs[0].isDirty).toBe(true);
    expect(result.changes).toHaveLength(1);
  });

  it('keeps references within a moved folder relative and preserves saved bytes', () => {
    const original = '[章节](chapter.md)\n\n![图片](assets/pic.png)';
    const result = renameWorkspaceDocuments([tab({ filePath: 'C:/docs/guide/note.md', content: original, savedContent: original })], 'C:/docs/guide', 'C:/docs/handbook');
    expect(result.tabs[0].filePath).toBe('C:/docs/handbook/note.md');
    expect(result.tabs[0].title).toBe('note.md');
    expect(result.tabs[0].content).toBe(original);
    expect(result.tabs[0].savedContent).toBe(original);
    expect(result.tabs[0].isDirty).toBe(false);
    expect(result.changes).toHaveLength(0);
  });

  it('updates HTML src/srcset and reference definitions without remote/data changes', () => {
    const original = '<img src="guide/a.png" srcset="guide/a.png 1x, guide/b.png 2x">\n\n![x][p]\n\n[p]: guide/c.png\n\n![remote](https://example.com/a.png)';
    const result = renameWorkspaceDocuments([tab({ content: original, savedContent: original })], 'C:/docs/guide', 'C:/docs/handbook');
    expect(result.tabs[0].content).toContain('src="handbook/a.png"');
    expect(result.tabs[0].content).toContain('srcset="handbook/a.png 1x, handbook/b.png 2x"');
    expect(result.tabs[0].content).toContain('[p]: <handbook/c.png>');
    expect(result.tabs[0].content).toContain('https://example.com/a.png');
  });

  it('does not change diff tabs or unrelated document buffers', () => {
    const original = '[其他](elsewhere/a.md)';
    const result = renameWorkspaceDocuments([tab({ kind: 'diff', content: original, savedContent: original })], 'C:/docs/guide', 'C:/docs/handbook');
    expect(result.tabs[0]).toEqual(tab({ kind: 'diff', content: original, savedContent: original }));
    expect(result.changes).toHaveLength(0);
  });
});
