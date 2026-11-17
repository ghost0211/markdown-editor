import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createXmdExportCache,
} from '../src/lib/export/xmdExportCache';
import {
  exportMarkdownToXmd,
} from '../src/lib/export/xmdExporter';

/**
 * JSZip compresses through the CommonJS `pako` instance loaded by
 * `jszip/lib/flate.js`. Vitest externalizes that dependency, so replacing the
 * constructor on the same `require` cache entry lets this test count real
 * DEFLATE passes (a module mock would only replace the ESM wrapper).
 */
interface PakoModule {
  Deflate: new (options?: unknown) => object;
}

let pakoModule: PakoModule;
let originalDeflate: PakoModule['Deflate'];
let deflateCount = 0;

beforeAll(async () => {
  const { createRequire } = await import('node:module');
  const require = createRequire(import.meta.url);
  pakoModule = require('pako') as PakoModule;
  originalDeflate = pakoModule.Deflate;
  class CountingDeflate extends originalDeflate {
    constructor(options?: unknown) {
      super(options);
      deflateCount++;
    }
  }
  pakoModule.Deflate = CountingDeflate;
});

afterAll(() => {
  if (pakoModule) pakoModule.Deflate = originalDeflate;
});

const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const DATA_URL = `data:image/png;base64,${Buffer.from(PNG).toString('base64')}`;

describe('XMD cache compressed-entry reuse', () => {
  it('does not recompress an unchanged embedded asset on the next save', async () => {
    const cache = createXmdExportCache();
    await exportMarkdownToXmd(`# One\n\n![a](${DATA_URL})`, 'Doc', {
      cache, cacheScope: 'compress',
    });
    expect(deflateCount).toBeGreaterThanOrEqual(1);

    deflateCount = 0;
    const second = await exportMarkdownToXmd(`# Two\n\n![a](${DATA_URL})`, 'Doc', {
      cache, cacheScope: 'compress',
    });

    expect(cache.stats.hits).toBe(1);
    // Only the new document.md and manifest.json need a DEFLATE pass. The
    // unchanged asset entry is copied from the cached ZIP as a compressed
    // stream instead of being inflated and compressed again.
    expect(deflateCount).toBe(2);
    expect(second.slice(0, 4)).toEqual(new Uint8Array([0x50, 0x4b, 0x03, 0x04]));
  });
});
