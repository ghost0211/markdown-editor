import { describe, expect, it, vi } from 'vitest';
import { createDocumentSaveController, type DocumentSaveHost } from '../src/lib/saveQueue';
import type { DocumentTab } from '../src/types';

function tab(overrides: Partial<DocumentTab> = {}): DocumentTab {
  return { id: 'history-doc', title: 'notes.md', filePath: 'C:\\docs\\notes.md', content: 'new', savedContent: 'old', isDirty: true, cursorLine: 1, cursorCol: 1, ...overrides };
}

function host(tabs: DocumentTab[] = [tab()]): DocumentSaveHost {
  const tabsRef = { current: tabs };
  return {
    tabsRef, setTabs: vi.fn(), saveSession: vi.fn(), rememberRecentFile: vi.fn(),
    showToast: vi.fn(), saveFileDialog: vi.fn(async () => 'C:\\docs\\saved.md'),
    writeFile: vi.fn(async () => {}), getFileMtime: vi.fn(async () => 1),
    translate: vi.fn((key: string) => key) as unknown as DocumentSaveHost['translate'],
    recordHistory: vi.fn(async () => true),
  };
}

describe('saved document history', () => {
  it('records every successful, distinct Markdown or XMD save', async () => {
    const current = host(); const save = createDocumentSaveController(() => current);
    await save.writeDocumentTab('history-doc');
    await save.writeDocumentTab('history-doc');
    expect(current.recordHistory).toHaveBeenNthCalledWith(1, 'C:\\docs\\notes.md', 'new', 'notes.md');
    expect(current.recordHistory).toHaveBeenNthCalledWith(2, 'C:\\docs\\notes.md', 'new', 'notes.md');
    current.tabsRef.current = [tab({ filePath: 'C:\\docs\\package.xmd', title: 'package.xmd', content: 'embedded' })];
    await save.writeDocumentTab('history-doc');
    expect(current.recordHistory).toHaveBeenLastCalledWith('C:\\docs\\package.xmd', 'embedded', 'package.xmd');
  });

  it('does not record browser, unsaved or diff documents', async () => {
    const current = host([tab({ filePath: null })]); const save = createDocumentSaveController(() => current);
    await save.writeDocumentTab('history-doc', false, true);
    expect(current.recordHistory).not.toHaveBeenCalled();
    current.tabsRef.current = [tab({ filePath: 'browser://notes.md' })];
    await save.writeDocumentTab('history-doc', false, true);
    expect(current.recordHistory).not.toHaveBeenCalled();
    current.tabsRef.current = [tab({ kind: 'diff', filePath: 'C:\\docs\\comparison.md' })];
    await save.writeDocumentTab('history-doc');
    expect(current.recordHistory).not.toHaveBeenCalled();
  });

  it('records the exact bytes that succeeded even when later typing happens', async () => {
    let finish!: () => void; const gate = new Promise<void>((resolve) => { finish = resolve; });
    const current = host(); current.writeFile = vi.fn(async () => { await gate; });
    const save = createDocumentSaveController(() => current);
    const pending = save.writeDocumentTab('history-doc');
    await vi.waitFor(() => expect(current.writeFile).toHaveBeenCalledOnce());
    current.tabsRef.current = [tab({ content: 'typed while saving' })];
    finish(); await pending;
    expect(current.recordHistory).toHaveBeenCalledWith('C:\\docs\\notes.md', 'new', 'notes.md');
    expect(current.tabsRef.current[0].isDirty).toBe(true);
  });

  it('does not delay saving on a history failure or mark failed content clean', async () => {
    const current = host(); current.writeFile = vi.fn(async () => { throw new Error('disk full'); });
    const save = createDocumentSaveController(() => current);
    expect(await save.writeDocumentTab('history-doc')).toBe(false);
    expect(current.recordHistory).not.toHaveBeenCalled();
    expect(current.tabsRef.current[0].isDirty).toBe(true);
    expect(current.showToast).toHaveBeenCalledWith('disk full', 'error');
  });

  it('keeps the history after a tab closes once the save completes', async () => {
    const current = host(); const save = createDocumentSaveController(() => current);
    await save.writeDocumentTab('history-doc'); save.forget('history-doc');
    expect(current.recordHistory).toHaveBeenCalledOnce();
  });

  it('does not snapshot superseded Save As content', async () => {
    let finish!: () => void; const gate = new Promise<void>((resolve) => { finish = resolve; });
    const current = host(); current.saveFileDialog = vi.fn(async () => 'C:\\docs\\old.md');
    let writes = 0;
    current.writeFile = vi.fn(async () => { if (++writes === 1) await gate; });
    const save = createDocumentSaveController(() => current);
    const first = save.writeDocumentTab('history-doc', true);
    await vi.waitFor(() => expect(current.writeFile).toHaveBeenCalledOnce());
    current.tabsRef.current = [tab({ filePath: 'C:\\docs\\new.md', savedContent: 'new' })];
    current.saveFileDialog = vi.fn(async () => 'C:\\docs\\new.md');
    await save.writeDocumentTab('history-doc', true);
    finish(); await first;
    expect(current.recordHistory).toHaveBeenCalledOnce();
    expect(current.recordHistory).toHaveBeenCalledWith('C:\\docs\\new.md', 'new', 'new.md');
  });
});
