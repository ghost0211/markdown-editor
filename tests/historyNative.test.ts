import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn() }));
import { invoke } from '@tauri-apps/api/core';
import { readDocumentHistory, readDocumentSnapshot, recordSavedDocumentHistory } from '../src/lib/native';

beforeEach(() => {
  vi.clearAllMocks();
  delete (globalThis as { window?: unknown }).window;
});

describe('document history native bridge', () => {
  it('returns no snapshots in browser mode without native calls', async () => {
    expect(await readDocumentHistory('browser://notes.md')).toEqual([]);
    expect(await readDocumentSnapshot('browser://notes.md', 'safe-id')).toBe('');
    expect(await recordSavedDocumentHistory('browser://notes.md', 'text', 'notes.md')).toBe(false);
    expect(invoke).not.toHaveBeenCalled();
  });

  it('lists metadata and reads the selected snapshot by source path and id', async () => {
    (globalThis as { window?: unknown }).window = { __TAURI_INTERNALS__: {} };
    const entry = { id: 'snapshot-1', createdAt: 1700000000000, originalPath: 'C:\\docs\\笔记.md', title: '笔记.md', bytes: 12, sha256: 'hash' };
    vi.mocked(invoke).mockResolvedValueOnce([entry]).mockResolvedValueOnce('# 中文\r\n内容');
    expect(await readDocumentHistory('C:\\docs\\笔记.md')).toEqual([entry]);
    expect(invoke).toHaveBeenNthCalledWith(1, 'list_document_history', { path: 'C:\\docs\\笔记.md' });
    expect(await readDocumentSnapshot('C:\\docs\\笔记.md', 'snapshot-1')).toBe('# 中文\r\n内容');
    expect(invoke).toHaveBeenNthCalledWith(2, 'read_document_snapshot', { path: 'C:\\docs\\笔记.md', id: 'snapshot-1' });
  });

  it('records exact saved content, including XMD inline Markdown and line endings', async () => {
    (globalThis as { window?: unknown }).window = { __TAURI_INTERNALS__: {} };
    const content = '# Bundle\r\n![a](<data:image/png;base64,AAAA>)';
    vi.mocked(invoke).mockResolvedValueOnce(true);
    expect(await recordSavedDocumentHistory('C:\\docs\\bundle.xmd', content, 'bundle.xmd')).toBe(true);
    expect(invoke).toHaveBeenCalledWith('record_document_history', { path: 'C:\\docs\\bundle.xmd', content, title: 'bundle.xmd' });
  });

  it('keeps history failure non-fatal and returns false', async () => {
    (globalThis as { window?: unknown }).window = { __TAURI_INTERNALS__: {} };
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.mocked(invoke).mockRejectedValueOnce('Disk full');
    expect(await recordSavedDocumentHistory('C:\\docs\\notes.md', 'text', 'notes.md')).toBe(false);
    warning.mockRestore();
  });
});
