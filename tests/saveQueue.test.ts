import { describe, expect, it, vi } from 'vitest';
import type { DocumentTab } from '../src/types';
import { applyContentUpdatesToTabs } from '../src/hooks/useDocuments';
import {
  createDocumentSaveController,
  createKeyedAsyncQueue,
  type DocumentSaveHost,
} from '../src/lib/saveQueue';

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

async function waitUntil(check: () => void): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      check();
      return;
    } catch (error) {
      lastError = error;
      await flush();
    }
  }
  throw lastError;
}

function createTab(overrides: Partial<DocumentTab> = {}): DocumentTab {
  return {
    id: 'tab-1',
    title: 'notes.md',
    filePath: 'C:/docs/notes.md',
    content: 'v1',
    savedContent: 'v0',
    isDirty: true,
    cursorLine: 1,
    cursorCol: 1,
    fileMtime: 10,
    ...overrides,
  };
}

function createHost(
  tabs: DocumentTab[],
  overrides: Partial<DocumentSaveHost> = {}
): DocumentSaveHost {
  const tabsRef = { current: tabs };
  return {
    tabsRef,
    setTabs: vi.fn((next: DocumentTab[]) => {
      tabsRef.current = next;
    }),
    saveSession: vi.fn(),
    rememberRecentFile: vi.fn(),
    showToast: vi.fn(),
    saveFileDialog: vi.fn(async () => 'C:/docs/saved.xmd'),
    writeFile: vi.fn(async () => undefined),
    getFileMtime: vi.fn(async () => 10),
    translate: vi.fn((key: string) => key) as unknown as DocumentSaveHost['translate'],
    ...overrides,
  };
}

describe('createKeyedAsyncQueue', () => {
  it('serializes one key while allowing different keys to run concurrently', async () => {
    const queue = createKeyedAsyncQueue();
    const gate = deferred<void>();
    const order: string[] = [];

    const first = queue.run('a', async () => {
      order.push('a1-start');
      await gate.promise;
      order.push('a1-end');
      return 1;
    });
    const second = queue.run('a', async () => {
      order.push('a2-start');
      return 2;
    });
    const other = queue.run('b', async () => {
      order.push('b-start');
      return 3;
    });

    await flush();
    expect(order).toContain('a1-start');
    expect(order).toContain('b-start');
    expect(order).not.toContain('a2-start');
    expect(queue.isBusy('a')).toBe(true);

    gate.resolve();
    await Promise.all([first, second, other]);
    expect(order.indexOf('a1-end')).toBeLessThan(order.indexOf('a2-start'));
    expect(queue.isBusy('a')).toBe(false);
  });

  it('keeps the chain usable after a rejected task', async () => {
    const queue = createKeyedAsyncQueue();
    await expect(queue.run('same', async () => {
      throw new Error('disk full');
    })).rejects.toThrow('disk full');
    await expect(queue.run('same', async () => 'retried')).resolves.toBe('retried');
    await queue.whenIdle();
  });
});

describe('createDocumentSaveController', () => {
  const styled = '重要 <xmd-style font="宋体" size="18" color="#b91c1c">条款</xmd-style>。';
  const bundled = '[附件](data:application/pdf;base64,AA==)';

  it.each([
    { filePath: null, content: styled, saveAs: false },
    { filePath: 'C:/docs/notes.md', content: styled, saveAs: false },
    { filePath: 'C:/docs/notes.md', content: bundled, saveAs: true },
  ])('defaults to XMD when saving $filePath with an XMD feature', async ({ filePath, content, saveAs }) => {
    const host = createHost([createTab({ filePath, content })]);
    const controller = createDocumentSaveController(() => host);

    await expect(controller.writeDocumentTab('tab-1', saveAs)).resolves.toBe(true);
    expect(host.saveFileDialog).toHaveBeenCalledWith('notes.xmd');
    expect(host.writeFile).toHaveBeenCalledExactlyOnceWith('C:/docs/saved.xmd', content, filePath);
    expect(host.tabsRef.current[0]).toMatchObject({ filePath: 'C:/docs/saved.xmd', savedContent: content, isDirty: false });
  });

  it('leaves the Markdown tab dirty on cancel or when the chosen extension cannot store XMD features', async () => {
    const dialog = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce('C:/docs/notes.md');
    const host = createHost([createTab({ content: styled })], { saveFileDialog: dialog });
    const controller = createDocumentSaveController(() => host);
    await expect(controller.writeDocumentTab('tab-1')).resolves.toBe(false);
    expect(host.showToast).not.toHaveBeenCalled();
    await expect(controller.writeDocumentTab('tab-1')).resolves.toBe(false);
    expect(host.showToast).toHaveBeenCalledWith('toasts.xmdSaveRequired', 'warning');
    expect(host.writeFile).not.toHaveBeenCalled();
    expect(host.tabsRef.current[0]).toMatchObject({ filePath: 'C:/docs/notes.md', isDirty: true });
  });

  it('waits for a manual conversion before autosaving XMD content', async () => {
    const host = createHost([createTab({ content: styled })]);
    const controller = createDocumentSaveController(() => host);
    await expect(controller.writeDocumentTab('tab-1', false, true)).resolves.toBe(false);
    expect(host.saveFileDialog).not.toHaveBeenCalled();
    expect(host.writeFile).not.toHaveBeenCalled();
    expect(host.tabsRef.current[0].isDirty).toBe(true);

    await controller.writeDocumentTab('tab-1');
    const content = styled + '\n\n后续编辑';
    host.tabsRef.current = [{ ...host.tabsRef.current[0], content, isDirty: true }];
    await expect(controller.writeDocumentTab('tab-1', false, true)).resolves.toBe(true);
    expect(host.saveFileDialog).toHaveBeenCalledOnce();
    expect(host.writeFile).toHaveBeenLastCalledWith('C:/docs/saved.xmd', content, 'C:/docs/saved.xmd');
  });

  it('preserves relative resource resolution when converting to XMD in another directory', async () => {
    const content = styled + '\n\n![diagram](assets/diagram.png)';
    const path = 'C:/output/notes.xmd';
    const host = createHost([createTab({ content })], { saveFileDialog: vi.fn(async () => path) });
    const controller = createDocumentSaveController(() => host);
    await expect(controller.writeDocumentTab('tab-1')).resolves.toBe(true);
    expect(host.writeFile).toHaveBeenCalledExactlyOnceWith(path, content, 'C:/docs/notes.md');
    const rebased = styled + '\n\n![diagram](<../docs/assets/diagram.png>)';
    expect(host.tabsRef.current[0]).toMatchObject({ content: rebased, savedContent: rebased, filePath: path, isDirty: false });
    await expect(controller.writeDocumentTab('tab-1')).resolves.toBe(true);
    expect(host.writeFile).toHaveBeenLastCalledWith(path, rebased, path);
  });

  it('reopens the dialog in XMD format if XMD content arrives while a Markdown save is queued', async () => {
    const queue = createKeyedAsyncQueue();
    const gate = deferred<void>();
    const blocked = queue.run('c:/docs/notes.md', () => gate.promise);
    const host = createHost([createTab()]);
    const controller = createDocumentSaveController(() => host, { queue });
    const save = controller.writeDocumentTab('tab-1');
    host.tabsRef.current = [createTab({ content: styled })];
    gate.resolve();

    await blocked;
    await expect(save).resolves.toBe(true);
    expect(host.saveFileDialog).toHaveBeenCalledWith('notes.xmd');
    expect(host.writeFile).toHaveBeenCalledExactlyOnceWith('C:/docs/saved.xmd', styled, 'C:/docs/notes.md');
  });

  it('keeps ordinary Markdown images, links and literal XMD examples in Markdown', async () => {
    const fence = String.fromCharCode(96).repeat(3);
    const content = fence + '\n' + styled + '\n' + bundled + '\n' + fence +
      '\n\n![image](data:image/png;base64,AAAA)\n\n[a local document](./other.md)';
    const host = createHost([createTab({ content })]);
    const controller = createDocumentSaveController(() => host);
    await expect(controller.writeDocumentTab('tab-1')).resolves.toBe(true);
    expect(host.saveFileDialog).not.toHaveBeenCalled();
    expect(host.writeFile).toHaveBeenCalledExactlyOnceWith('C:/docs/notes.md', content, 'C:/docs/notes.md');
  });

  it('does not write after a newer Save-As completed while an older dialog was pending', async () => {
    const firstDialog = deferred<string | null>();
    const dialog = vi.fn().mockReturnValueOnce(firstDialog.promise).mockResolvedValueOnce('C:/new/saved.xmd');
    const host = createHost([createTab()], { saveFileDialog: dialog });
    const controller = createDocumentSaveController(() => host);
    const older = controller.writeDocumentTab('tab-1', true);
    await controller.writeDocumentTab('tab-1', true);
    expect(host.writeFile).toHaveBeenCalledWith('C:/new/saved.xmd', 'v1', 'C:/docs/notes.md');
    firstDialog.resolve('C:/new/saved.xmd');
    expect(await older).toBe(false);
    expect(host.writeFile).toHaveBeenCalledOnce();
  });
  it('serializes saves of the same path and snapshots content only when the turn starts', async () => {
    const gate = deferred<void>();
    let writes = 0;
    const writeFile = vi.fn(async (_path: string, _content: string) => {
      writes++;
      if (writes === 1) await gate.promise;
    });
    const host = createHost([createTab()], { writeFile });
    const controller = createDocumentSaveController(() => host);

    const first = controller.writeDocumentTab('tab-1');
    await waitUntil(() => expect(writeFile).toHaveBeenCalledTimes(1));
    expect(writeFile.mock.calls[0][1]).toBe('v1');

    // Edit while the first (slow) save is still packing.
    host.tabsRef.current = host.tabsRef.current.map((tab) => ({
      ...tab,
      content: 'v2',
      isDirty: true,
    }));
    const second = controller.writeDocumentTab('tab-1');

    await flush();
    // The second save must wait for the first one to finish; otherwise the
    // older snapshot could reach the disk last.
    expect(writeFile).toHaveBeenCalledTimes(1);

    gate.resolve();
    await first;
    await waitUntil(() => expect(writeFile).toHaveBeenCalledTimes(2));
    expect(writeFile.mock.calls.map((call) => call[1])).toEqual(['v1', 'v2']);

    await second;
    expect(host.tabsRef.current[0].savedContent).toBe('v2');
    expect(host.tabsRef.current[0].isDirty).toBe(false);
    expect(host.rememberRecentFile).toHaveBeenCalledWith('C:/docs/notes.md');
  });

  it('does not let an older Save-As completion roll back a newer destination/state', async () => {
    const one = deferred<void>();
    const two = deferred<void>();
    const writeFile = vi.fn(async (path: string) => {
      await (path.includes('one.xmd') ? one.promise : two.promise);
    });
    const saveFileDialog = vi.fn()
      .mockResolvedValueOnce('C:/docs/one.xmd')
      .mockResolvedValueOnce('C:/docs/two.xmd');
    const host = createHost([createTab({ filePath: null, content: 'v1' })], {
      writeFile,
      saveFileDialog,
    });
    const controller = createDocumentSaveController(() => host);

    const first = controller.writeDocumentTab('tab-1', true);
    await waitUntil(() => expect(writeFile).toHaveBeenCalledWith(
      'C:/docs/one.xmd', 'v1', null
    ));

    host.tabsRef.current = host.tabsRef.current.map((tab) => ({ ...tab, content: 'v2' }));
    const second = controller.writeDocumentTab('tab-1', true);
    await waitUntil(() => expect(writeFile).toHaveBeenCalledWith(
      'C:/docs/two.xmd', 'v2', null
    ));

    // The newer Save-As finishes first and commits the tab to two.xmd/v2.
    two.resolve();
    await second;
    expect(host.tabsRef.current[0].filePath).toBe('C:/docs/two.xmd');
    expect(host.tabsRef.current[0].savedContent).toBe('v2');

    // The older Save-As then finishes; it must not retarget the tab or replace
    // savedContent with the older snapshot.
    one.resolve();
    await first;
    expect(host.tabsRef.current[0].filePath).toBe('C:/docs/two.xmd');
    expect(host.tabsRef.current[0].savedContent).toBe('v2');
    expect(host.tabsRef.current[0].isDirty).toBe(false);
  });

  it('re-checks the mtime inside the queue so auto save cannot overwrite an external edit', async () => {
    const gate = deferred<void>();
    let writes = 0;
    const writeFile = vi.fn(async () => {
      writes++;
      if (writes === 1) await gate.promise;
    });
    // First read belongs to the manual save finishing; the silent save then
    // observes a changed file on disk.
    let mtimeReads = 0;
    const getFileMtime = vi.fn(async () => (mtimeReads++ === 0 ? 10 : 20));
    const host = createHost([createTab()], { writeFile, getFileMtime });
    const controller = createDocumentSaveController(() => host);

    const manual = controller.writeDocumentTab('tab-1');
    await waitUntil(() => expect(writeFile).toHaveBeenCalledTimes(1));
    host.tabsRef.current = host.tabsRef.current.map((tab) => ({
      ...tab,
      content: 'v2',
      isDirty: true,
    }));

    const silent = controller.writeDocumentTab('tab-1', false, true);
    await flush();
    expect(writeFile).toHaveBeenCalledTimes(1);

    gate.resolve();
    await manual;
    await expect(silent).resolves.toBe(false);

    expect(writeFile).toHaveBeenCalledTimes(1);
    expect(host.tabsRef.current[0].content).toBe('v2');
    expect(host.tabsRef.current[0].savedContent).toBe('v1');
    expect(host.tabsRef.current[0].isDirty).toBe(true);
    expect(host.showToast).not.toHaveBeenCalledWith(expect.anything(), 'error');
  });

  it('never resurrects a tab closed while its save was queued', async () => {
    const gate = deferred<void>();
    const writeFile = vi.fn(async () => {
      await gate.promise;
    });
    const host = createHost([createTab()], { writeFile });
    const controller = createDocumentSaveController(() => host);

    const save = controller.writeDocumentTab('tab-1');
    await waitUntil(() => expect(writeFile).toHaveBeenCalledTimes(1));

    // Discard and close while the pack/write is still running.
    host.tabsRef.current = [];
    controller.forget('tab-1');
    gate.resolve();

    await expect(save).resolves.toBe(true);
    expect(host.tabsRef.current).toEqual([]);
    expect(host.setTabs).not.toHaveBeenCalled();
    expect(host.saveSession).not.toHaveBeenCalled();
  });

  it('keeps the tab dirty after a failed write and lets a retry succeed', async () => {
    const writeFile = vi.fn()
      .mockRejectedValueOnce(new Error('disk full'))
      .mockResolvedValueOnce(undefined);
    const host = createHost([createTab()], { writeFile });
    const controller = createDocumentSaveController(() => host);

    await expect(controller.writeDocumentTab('tab-1')).resolves.toBe(false);
    expect(host.tabsRef.current[0].content).toBe('v1');
    expect(host.tabsRef.current[0].savedContent).toBe('v0');
    expect(host.tabsRef.current[0].isDirty).toBe(true);
    expect(host.showToast).toHaveBeenCalledWith('disk full', 'error');

    await expect(controller.writeDocumentTab('tab-1')).resolves.toBe(true);
    expect(host.tabsRef.current[0].savedContent).toBe('v1');
    expect(host.tabsRef.current[0].isDirty).toBe(false);
  });

  it('keeps a silently failing auto save dirty and warns only once', async () => {
    const writeFile = vi.fn(async () => {
      throw new Error('permission denied');
    });
    const showToast = vi.fn();
    const host = createHost([createTab()], { writeFile, showToast });
    const controller = createDocumentSaveController(() => host);

    await expect(controller.writeDocumentTab('tab-1', false, true)).resolves.toBe(false);
    await expect(controller.writeDocumentTab('tab-1', false, true)).resolves.toBe(false);

    expect(host.tabsRef.current[0].savedContent).toBe('v0');
    expect(host.tabsRef.current[0].isDirty).toBe(true);
    const autoSaveErrors = showToast.mock.calls.filter(
      (call: unknown[]) => call[1] === 'error' && call[0] === 'toasts.autoSaveFailed'
    );
    expect(autoSaveErrors).toHaveLength(1);
  });
});

describe('applyContentUpdatesToTabs', () => {
  const tabs: DocumentTab[] = [
    createTab({ id: 'a', content: 'alpha', savedContent: 'base', isDirty: true }),
    createTab({ id: 'b', filePath: null, content: 'beta', savedContent: 'beta', isDirty: false }),
  ];

  it('applies every valid update in one pass and recomputes dirty state', () => {
    const next = applyContentUpdatesToTabs(tabs, [
      { id: 'a', original: 'alpha', content: 'base' },
      { id: 'b', original: 'beta', content: 'beta edited' },
    ]);
    expect(next).not.toBeNull();
    expect(next![0]).toMatchObject({ content: 'base', savedContent: 'base', isDirty: false });
    expect(next![1]).toMatchObject({ content: 'beta edited', isDirty: true });
  });

  it('refuses the whole batch for duplicates, stale originals, diff or missing tabs', () => {
    const diff: DocumentTab[] = [...tabs, createTab({ id: 'diff', kind: 'diff' })];
    expect(applyContentUpdatesToTabs(tabs, [
      { id: 'a', original: 'alpha', content: 'one' },
      { id: 'a', original: 'alpha', content: 'two' },
    ])).toBeNull();
    expect(applyContentUpdatesToTabs(tabs, [
      { id: 'a', original: 'stale', content: 'one' },
    ])).toBeNull();
    expect(applyContentUpdatesToTabs(diff, [
      { id: 'diff', original: 'alpha', content: 'one' },
    ])).toBeNull();
    expect(applyContentUpdatesToTabs(tabs, [
      { id: 'missing', original: 'x', content: 'y' },
    ])).toBeNull();
  });

  it('treats an empty batch as a valid no-op', () => {
    expect(applyContentUpdatesToTabs(tabs, [])).toBe(tabs);
  });
});
