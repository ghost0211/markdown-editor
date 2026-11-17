import { afterEach, describe, expect, it, vi } from 'vitest';
import JSZip from 'jszip';
import {
  createXmdExportCache,
  DEFAULT_XMD_EXPORT_CACHE_BYTES,
  type CachedXmdResource,
} from '../src/lib/export/xmdExportCache';
import {
  clearXmdExportCache,
  exportMarkdownToXmd,
  getXmdExportCacheStats,
  MAX_XMD_RESOURCE_BYTES,
  type XmdManifest,
} from '../src/lib/export/xmdExporter';

const native = vi.hoisted(() => ({
  isTauri: vi.fn(() => false),
  readXmdResource: vi.fn(),
  fetchXmdImage: vi.fn(),
}));
vi.mock('../src/lib/native', () => native);

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  native.isTauri.mockReturnValue(false);
});

const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const DATA_URL = `data:image/png;base64,${Buffer.from(PNG).toString('base64')}`;

async function unpack(bytes: Uint8Array) {
  const zip = await JSZip.loadAsync(bytes, { checkCRC32: true });
  const manifest = JSON.parse(await zip.file('manifest.json')!.async('string')) as XmdManifest;
  const document = await zip.file(manifest.entry)!.async('string');
  return { zip, manifest, document };
}

function resource(path: string, size: number): CachedXmdResource {
  return { path, mediaType: 'image/png', size };
}

describe('bounded XMD export cache', () => {
  it('evicts least-recently-used packages and stays inside its byte budget', () => {
    const cache = createXmdExportCache(500);
    const bytes = new Uint8Array(40);

    cache.set('a', bytes, [resource('assets/0001.png', 8)], 'doc');
    cache.set('b', bytes, [resource('assets/0001.png', 8)], 'doc');
    expect(cache.stats.entries).toBe(2);
    expect(cache.stats.bytes).toBeLessThanOrEqual(cache.maxBytes);

    // Touch `a`, making `b` the least recently used entry.
    expect(cache.get('a')).toBeDefined();
    cache.set('c', bytes, [resource('assets/0001.png', 8)], 'doc');

    expect(cache.get('a')).toBeDefined();
    expect(cache.get('b')).toBeUndefined();
    expect(cache.stats.bytes).toBeLessThanOrEqual(cache.maxBytes);
  });

  it('does not cache a package that alone exceeds the budget', () => {
    const cache = createXmdExportCache(100);
    cache.set('huge', new Uint8Array(200), [], 'doc');
    expect(cache.stats.entries).toBe(0);
    expect(cache.stats.bytes).toBe(0);
  });

  it('charges the full source key against the budget', () => {
    const cache = createXmdExportCache(150);
    // A small package with a very large data: URL key must still respect the
    // memory budget instead of being cached for free.
    cache.set('k'.repeat(200), new Uint8Array(1), [], 's');
    expect(cache.stats.entries).toBe(0);
  });

  it('releases entries per document scope', () => {
    const cache = createXmdExportCache();
    cache.set('one', new Uint8Array(4), [], 'doc-a');
    cache.set('two', new Uint8Array(4), [], 'doc-b');
    cache.deleteScope('doc-a');
    expect(cache.get('one')).toBeUndefined();
    expect(cache.get('two')).toBeDefined();
    cache.clear();
    expect(cache.stats.entries).toBe(0);
  });

  it('has a default budget below the maximum package size', () => {
    expect(DEFAULT_XMD_EXPORT_CACHE_BYTES).toBe(64 * 1024 * 1024);
    expect(DEFAULT_XMD_EXPORT_CACHE_BYTES).toBeLessThan(MAX_XMD_RESOURCE_BYTES * 4);
  });
});

describe('XMD exporter package cache', () => {
  it('reuses the cached ZIP when only the Markdown body changed', async () => {
    const cache = createXmdExportCache();
    const loadAsync = vi.spyOn(JSZip, 'loadAsync');
    const first = await exportMarkdownToXmd(`# One\n\n![a](${DATA_URL})`, 'Doc', {
      cache, cacheScope: 'doc',
    });
    expect(cache.stats).toMatchObject({ entries: 1, hits: 0 });
    expect(loadAsync).not.toHaveBeenCalled();

    loadAsync.mockClear();
    const second = await exportMarkdownToXmd(`# Two changed\n\n![a](${DATA_URL})`, 'Doc', {
      cache, cacheScope: 'doc',
    });
    expect(cache.stats.hits).toBe(1);
    expect(loadAsync).toHaveBeenCalledTimes(1);
    loadAsync.mockRestore();

    const unpacked = await unpack(second);
    expect(unpacked.document).toBe(`# Two changed\n\n![a](assets/0001.png)`);
    expect(unpacked.manifest.resources).toEqual([
      { path: 'assets/0001.png', mediaType: 'image/png', size: PNG.length },
    ]);
    expect(await unpacked.zip.file('assets/0001.png')!.async('uint8array')).toEqual(PNG);

    // The first package is still readable and independent of the second.
    expect((await unpack(first)).document).toBe(`# One\n\n![a](assets/0001.png)`);
  });

  it('produces the same archive layout and entry contents as an uncached export', async () => {
    const cache = createXmdExportCache();
    const markdown = `# Body\n\n![a](${DATA_URL}) ![b](${DATA_URL})`;
    const warm = await exportMarkdownToXmd(`# Warm\n\n![a](${DATA_URL}) ![b](${DATA_URL})`, 'Doc', {
      cache, cacheScope: 'layout',
    });
    expect((await unpack(warm)).manifest.resources).toHaveLength(1);

    const cached = await exportMarkdownToXmd(markdown, 'Doc', { cache, cacheScope: 'layout' });
    const fresh = await exportMarkdownToXmd(markdown, 'Doc', { cache: null });
    expect(cache.stats.hits).toBe(1);

    const cachedUnpacked = await unpack(cached);
    const freshUnpacked = await unpack(fresh);
    expect(Object.keys(cachedUnpacked.zip.files)).toEqual(Object.keys(freshUnpacked.zip.files));
    expect(cachedUnpacked.manifest).toEqual(freshUnpacked.manifest);
    expect(cachedUnpacked.document).toBe(freshUnpacked.document);
    for (const name of Object.keys(freshUnpacked.zip.files)) {
      if (name.endsWith('/')) continue;
      expect(await cachedUnpacked.zip.file(name)!.async('uint8array'))
        .toEqual(await freshUnpacked.zip.file(name)!.async('uint8array'));
    }
  });

  it('releases shared-cache packages for a closed document scope', async () => {
    clearXmdExportCache();
    const markdown = `![a](${DATA_URL})`;
    await exportMarkdownToXmd(markdown, 'Doc', { cacheScope: 'released-doc' });
    expect(getXmdExportCacheStats().entries).toBeGreaterThan(0);

    clearXmdExportCache('released-doc');
    expect(getXmdExportCacheStats().entries).toBe(0);

    await exportMarkdownToXmd(markdown, 'Doc', { cacheScope: 'released-doc' });
    expect(getXmdExportCacheStats().hits).toBe(0);
    clearXmdExportCache();
    expect(getXmdExportCacheStats()).toMatchObject({ entries: 0, bytes: 0 });
  });

  it('misses and rewrites the asset when the embedded data URL changes', async () => {
    const cache = createXmdExportCache();
    await exportMarkdownToXmd(`![a](${DATA_URL})`, 'Doc', { cache, cacheScope: 'doc' });
    const changed = new Uint8Array([1, 2, 3, 4]);
    const changedUrl = `data:image/png;base64,${Buffer.from(changed).toString('base64')}`;

    const output = await exportMarkdownToXmd(`![a](${changedUrl})`, 'Doc', {
      cache, cacheScope: 'doc',
    });
    expect(cache.stats.hits).toBe(0);
    const { zip } = await unpack(output);
    expect(await zip.file('assets/0001.png')!.async('uint8array')).toEqual(changed);
  });

  it('never caches packages that contain local or network resources', async () => {
    const cache = createXmdExportCache();
    native.isTauri.mockReturnValue(true);
    native.readXmdResource
      .mockResolvedValueOnce(new Uint8Array([1, 2, 3]))
      .mockResolvedValueOnce(new Uint8Array([9, 9]));
    const markdown = `![embedded](${DATA_URL}) ![local](assets/pic.png)`;
    await exportMarkdownToXmd(markdown, 'Doc', {
      cache, cacheScope: 'mixed', sourceFilePath: 'C:/docs/doc.md',
    });
    expect(cache.stats.entries).toBe(0);

    // A changed local file is read again, not served from the embedded image.
    const output = await exportMarkdownToXmd(markdown, 'Doc', {
      cache, cacheScope: 'mixed', sourceFilePath: 'C:/docs/doc.md',
    });
    expect(native.readXmdResource).toHaveBeenCalledTimes(2);
    const { zip } = await unpack(output);
    expect(await zip.file('assets/0001.png')!.async('uint8array')).toEqual(PNG);
    expect(await zip.file('assets/0002.png')!.async('uint8array')).toEqual(new Uint8Array([9, 9]));
  });

  it('re-fetches HTTP images on every export instead of caching them', async () => {
    const cache = createXmdExportCache();
    const fetchMock = vi.fn(async () => new Response(PNG, { headers: { 'Content-Type': 'image/png' } }));
    vi.stubGlobal('fetch', fetchMock);
    const markdown = '![a](https://example.com/a.png)';

    await exportMarkdownToXmd(markdown, 'Doc', { cache, cacheScope: 'web' });
    await exportMarkdownToXmd(markdown, 'Doc', { cache, cacheScope: 'web' });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(cache.stats.entries).toBe(0);
  });

  it('isolates cache entries by document scope', async () => {
    const cache = createXmdExportCache();
    const markdown = `![a](${DATA_URL})`;
    await exportMarkdownToXmd(markdown, 'Doc', { cache, cacheScope: 'doc-a' });
    await exportMarkdownToXmd(markdown, 'Doc', { cache, cacheScope: 'doc-b' });
    expect(cache.stats.hits).toBe(0);
    expect(cache.stats.entries).toBe(2);

    await exportMarkdownToXmd(markdown, 'Doc', { cache, cacheScope: 'doc-a' });
    expect(cache.stats.hits).toBe(1);
  });

  it('skips caching entirely when disabled or when a custom loader is injected', async () => {
    const cache = createXmdExportCache();
    await exportMarkdownToXmd(`![a](${DATA_URL})`, 'Doc', { cache: null });
    expect(cache.stats.entries).toBe(0);

    const loadResource = vi.fn(async () => ({ bytes: PNG, mediaType: 'image/png' }));
    await exportMarkdownToXmd(`![a](${DATA_URL})`, 'Doc', { cache, loadResource });
    expect(cache.stats.entries).toBe(0);
  });

  it('does not cache a failed export', async () => {
    const cache = createXmdExportCache();
    await expect(exportMarkdownToXmd('![a](https://example.com/missing.png)', 'Doc', {
      cache,
      cacheScope: 'fail',
      loadResource: async () => { throw new Error('ENOENT'); },
    })).rejects.toThrow('ENOENT');
    expect(cache.stats.entries).toBe(0);
  });
});
