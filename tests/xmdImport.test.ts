import { describe, expect, it, vi } from 'vitest';
import JSZip from 'jszip';
import {
  importXmd,
  importXmdPackage,
  isXmdFileName,
  MAX_XMD_ENTRIES,
  MAX_XMD_ENTRY_BYTES,
} from '../src/lib/xmd';
import { exportMarkdownToXmd, type XmdResourceData } from '../src/lib/export/xmdExporter';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const SVG = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>');
const PDF = new TextEncoder().encode('%PDF-1.4\n%%EOF\n');

interface Entry {
  path: string;
  data: Uint8Array | string;
  mediaType?: string;
}

const base64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64');
const documentEntry = (markdown: string): Entry => ({ path: 'document.md', data: markdown });
const pngUrl = `data:image/png;base64,${base64(PNG)}`;

const MIME_BY_PATH: Record<string, string> = {
  'assets/a.png': 'image/png',
  'assets/b.png': 'image/png',
  'assets/c.png': 'image/png',
  'assets/uppercase.png': 'image/png',
  'assets/my image.png': 'image/png',
  'assets/photo.png': 'image/png',
  'assets/logo.svg': 'image/svg+xml',
  'assets/report.pdf': 'application/pdf',
};

function mediaTypeOf(entry: Entry): string {
  return entry.mediaType ?? MIME_BY_PATH[entry.path] ?? 'application/octet-stream';
}

function bytesOf(entry: Entry): Uint8Array {
  return typeof entry.data === 'string' ? new TextEncoder().encode(entry.data) : entry.data;
}

function manifestFor(entries: Entry[], overrides: Record<string, unknown> = {}) {
  return {
    format: 'xmd',
    version: 1,
    entry: 'document.md',
    title: '示例.md',
    resources: entries
      .filter((entry) => entry.path.startsWith('assets/'))
      .map((entry) => ({ path: entry.path, mediaType: mediaTypeOf(entry), size: bytesOf(entry).byteLength })),
    ...overrides,
  };
}

async function pack(entries: Entry[], manifest: unknown = null): Promise<Uint8Array> {
  const zip = new JSZip();
  for (const entry of entries) zip.file(entry.path, entry.data);
  zip.file('manifest.json', JSON.stringify(manifest ?? manifestFor(entries)));
  return zip.generateAsync({ type: 'uint8array' });
}

async function packRaw(files: Entry[]): Promise<Uint8Array> {
  const zip = new JSZip();
  for (const entry of files) zip.file(entry.path, entry.data);
  return zip.generateAsync({ type: 'uint8array' });
}

/** Reads the end-of-central-directory offset so tests can patch ZIP headers. */
function findEocd(bytes: Uint8Array): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let offset = bytes.byteLength - 22; offset >= 0; offset--) {
    if (view.getUint32(offset, true) === 0x06054b50) return offset;
  }
  throw new Error('EOCD not found');
}

function centralDirectoryOffset(bytes: Uint8Array): number {
  const eocd = findEocd(bytes);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return view.getUint32(eocd + 16, true);
}

/** Patches the first central-directory record and returns the mutated copy. */
function patchFirstCentralEntry(bytes: Uint8Array, fieldOffset: number, value: number, width = 2): Uint8Array {
  const copy = bytes.slice();
  const view = new DataView(copy.buffer, copy.byteOffset, copy.byteLength);
  view.setUint16(centralDirectoryOffset(copy) + fieldOffset, value, true);
  if (width !== 2) throw new Error('unsupported patch width');
  return copy;
}

describe('XMD v1 import (strict, self-contained)', () => {
  describe('real export -> import -> export round trip', () => {
    const markdown = [
      '# 标题',
      '',
      '![中文](<assets/图 (1).png> "title")',
      '',
      '![片段](assets/icon.svg#glyph)',
      '',
      '`![code](assets/none.png)` 与 $![math](assets/none.png)$',
      '',
      '[附件](./assets/report.pdf#page=2) [外网](https://example.com/) [锚点](#标题)',
      '',
      '正文 **保留**。',
    ].join('\r\n');

    const loadResource = vi.fn(async (source: string): Promise<XmdResourceData> => ({
      bytes: source.endsWith('.pdf') ? PDF : source.endsWith('.svg') ? SVG : PNG,
      mediaType: source.endsWith('.pdf') ? 'application/pdf' : source.endsWith('.svg') ? 'image/svg+xml' : 'image/png',
    }));

    it('inlines every asset while preserving all other bytes', async () => {
      const exported = await exportMarkdownToXmd(markdown, '示例.md', { sourceFilePath: 'D:\\docs\\a.md', loadResource });
      const imported = await importXmdPackage(exported);

      expect(imported.manifest).toMatchObject({ format: 'xmd', version: 1, entry: 'document.md', title: '示例.md' });
      expect(imported.inlined).toEqual(['assets/0001.png', 'assets/0002.svg', 'assets/0003.pdf']);
      expect(imported.markdown).toBe(
        markdown
          .replace('assets/图 (1).png', pngUrl)
          .replace('assets/icon.svg#glyph', `data:image/svg+xml;base64,${base64(SVG)}#glyph`)
          .replace('./assets/report.pdf#page=2', `data:application/pdf;base64,${base64(PDF)}#page=2`)
      );
      // Code samples are not resource destinations and stay byte-identical.
      expect(imported.markdown).toContain('`![code](assets/none.png)`');
      expect(imported.markdown).toContain('$![math](assets/none.png)$');
    });

    it('re-exports byte-identical document, assets and manifest inventory', async () => {
      const first = await exportMarkdownToXmd(markdown, '示例.md', { sourceFilePath: 'D:\\docs\\a.md', loadResource });
      const imported = await importXmdPackage(first);
      const second = await exportMarkdownToXmd(imported.markdown, '示例.md');

      const before = await JSZip.loadAsync(first);
      const after = await JSZip.loadAsync(second);
      const beforeManifest = JSON.parse(await before.file('manifest.json')!.async('string'));
      const afterManifest = JSON.parse(await after.file('manifest.json')!.async('string'));

      expect(await after.file('document.md')!.async('string'))
        .toBe(await before.file('document.md')!.async('string'));
      expect(afterManifest.resources).toEqual(beforeManifest.resources);
      for (const resource of beforeManifest.resources) {
        expect(await after.file(resource.path)!.async('uint8array'))
          .toEqual(await before.file(resource.path)!.async('uint8array'));
      }
      // Attachment bytes survive the round trip intact.
      expect(await after.file('assets/0003.pdf')!.async('uint8array')).toEqual(PDF);
    });

    it('keeps normal web links as links and never turns them into attachments', async () => {
      const source = '[文档](https://example.com/docs) ![a](assets/a.png)';
      const first = await exportMarkdownToXmd(source, 'links.md', {
        sourceFilePath: '/docs/a.md',
        loadResource: async () => ({ bytes: PNG, mediaType: 'image/png' }),
      });
      const zip = await JSZip.loadAsync(first);
      const manifest = JSON.parse(await zip.file('manifest.json')!.async('string'));
      expect(manifest.resources).toHaveLength(1);
      expect(await zip.file('document.md')!.async('string'))
        .toBe('[文档](https://example.com/docs) ![a](assets/0001.png)');
    });
  });

  it('preserves a leading UTF-8 BOM byte-for-byte', async () => {
    const markdown = '\uFEFF# 标题\n\n![a](assets/a.png)';
    const { markdown: imported } = await importXmdPackage(await pack([
      documentEntry(markdown),
      { path: 'assets/a.png', data: PNG },
    ]));
    expect(imported).toBe(`\uFEFF# 标题\n\n![a](${pngUrl})`);
  });

  it('inlines plain, angle-bracket, reference-style and HTML src/srcset sources', async () => {
    const markdown = [
      '![a](assets/a.png)',
      '',
      '![b](<assets/b.png> "title")',
      '',
      '![c][ref]',
      '',
      '[ref]: assets/c.png',
      '',
      '<img alt="d" src="assets/a.png">',
      '',
      '<picture><source srcset="assets/b.png 1x, assets/c.png 2x"><img src="assets/a.png"></picture>',
    ].join('\n');
    const { markdown: imported } = await importXmdPackage(await pack([
      documentEntry(markdown),
      { path: 'assets/a.png', data: PNG },
      { path: 'assets/b.png', data: PNG },
      { path: 'assets/c.png', data: PNG },
    ]));

    expect(imported).toContain(`![a](${pngUrl})`);
    expect(imported).toContain(`![b](<${pngUrl}> "title")`);
    expect(imported).toContain('[ref]: ' + pngUrl);
    expect(imported).toContain(`<img alt="d" src="${pngUrl}">`);
    expect(imported).toContain(`<source srcset="${pngUrl} 1x, ${pngUrl} 2x">`);
  });

  it('resolves percent-encoded, ./ prefixed and case-different asset paths', async () => {
    const markdown = '![a](assets/my%20image.png) ![b](./assets/photo.png) ![c](assets/UPPERCASE.PNG)';
    const { markdown: imported, inlined } = await importXmdPackage(await pack([
      documentEntry(markdown),
      { path: 'assets/my image.png', data: PNG },
      { path: 'assets/photo.png', data: PNG },
      { path: 'assets/uppercase.png', data: PNG },
    ], manifestFor([
      { path: 'assets/my image.png', data: PNG },
      { path: 'assets/photo.png', data: PNG },
      { path: 'assets/uppercase.png', data: PNG },
    ])));
    expect(inlined).toEqual(['assets/my image.png', 'assets/photo.png', 'assets/uppercase.png']);
    expect(imported).not.toContain('assets/');
  });

  describe('package-integrity failures', () => {
    it('rejects non-ZIP input and an empty buffer', async () => {
      await expect(importXmd(new TextEncoder().encode('# plain markdown'))).rejects.toThrow('不是有效的 ZIP 归档');
      await expect(importXmd(new Uint8Array())).rejects.toThrow('不是有效的 XMD 文件');
    });

    it('requires document.md and manifest.json', async () => {
      await expect(importXmd(await pack([]))).rejects.toThrow('Missing document.md');
      await expect(importXmd(await packRaw([documentEntry('# ok')]))).rejects.toThrow('Missing manifest.json');
    });

    it('rejects damaged payloads through CRC validation', async () => {
      const zip = new JSZip();
      zip.file('document.md', 'AAAAABBBBBCCCCCDDDDDEEEEE');
      zip.file('manifest.json', JSON.stringify({ format: 'xmd', version: 1, entry: 'document.md', title: '', resources: [] }));
      const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'STORE' });
      const payloadOffset = Buffer.from(bytes).toString('latin1').indexOf('AAAAABBBBB');
      expect(payloadOffset).toBeGreaterThan(0);
      const corrupted = bytes.slice();
      corrupted[payloadOffset] ^= 0x01;
      await expect(importXmd(corrupted)).rejects.toThrow('XMD 压缩包损坏');
    });

    it('rejects encrypted and unsupported-compression entries', async () => {
      const bytes = await pack([documentEntry('# ok')]);
      await expect(importXmd(patchFirstCentralEntry(bytes, 8, 1))).rejects.toThrow('不支持加密的 XMD 归档');
      await expect(importXmd(patchFirstCentralEntry(bytes, 10, 99))).rejects.toThrow('不支持的压缩方式');
    });

    it('rejects local/central header name confusion instead of trusting either side', async () => {
      const zip = new JSZip();
      zip.file('document.md', '# ok');
      zip.file('manifest.json', JSON.stringify({ format: 'xmd', version: 1, entry: 'document.md', title: '', resources: [] }));
      const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'STORE' });
      const corrupted = bytes.slice();
      const localName = Buffer.from(corrupted).toString('latin1').indexOf('document.md');
      corrupted[localName] ^= 0x20; // 'd' -> 'D'
      await expect(importXmd(corrupted)).rejects.toThrow('归档结构与中央目录不一致');
    });

    it('rejects path traversal, absolute paths and unexpected entries before extraction', async () => {
      const unsafe = new JSZip();
      unsafe.file('document.md', '# ok');
      unsafe.file('/absolute.md', 'pwned');
      await expect(importXmd(await unsafe.generateAsync({ type: 'uint8array' })))
        .rejects.toThrow('归档包含不安全的路径');

      const traversal = new JSZip();
      traversal.file('document.md', '# ok');
      traversal.file('../evil.md', 'pwned');
      await expect(importXmd(await traversal.generateAsync({ type: 'uint8array' })))
        .rejects.toThrow('归档包含不安全的路径');

      await expect(importXmd(await pack([documentEntry('# ok'), { path: 'notes.txt', data: 'x' }])))
        .rejects.toThrow('归档包含未知文件');
    });

    it('rejects duplicate paths, including case-only differences', async () => {
      await expect(importXmd(await pack([
        documentEntry('# ok'),
        { path: 'assets/a.png', data: PNG },
        { path: 'assets/A.PNG', data: PNG },
      ]))).rejects.toThrow('归档包含重复路径');
    });

    it('rejects decompression bombs from the central directory before extracting', async () => {
      const zip = new JSZip();
      zip.file('document.md', '# ok');
      zip.file('manifest.json', JSON.stringify(manifestFor([])));
      zip.file('assets/huge.png', new Uint8Array(MAX_XMD_ENTRY_BYTES + 1));
      await expect(importXmd(await zip.generateAsync({ type: 'uint8array' }))).rejects.toThrow('资源超过 32 MiB');
    });

    it('stops inflating when an entry lies about its size (real zip-bomb defence)', async () => {
      const zip = new JSZip();
      // 2 MiB of highly compressible text whose central directory will claim 16 bytes.
      zip.file('document.md', 'A'.repeat(2 * 1024 * 1024));
      zip.file('manifest.json', JSON.stringify({ format: 'xmd', version: 1, entry: 'document.md', title: '', resources: [] }));
      const honest = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });

      const lying = honest.slice();
      const view = new DataView(lying.buffer, lying.byteOffset, lying.byteLength);
      const central = centralDirectoryOffset(lying);
      // document.md is the first file added, hence the first central record.
      expect(Buffer.from(lying).toString('latin1', central + 46, central + 57)).toBe('document.md');
      view.setUint32(central + 24, 16, true);
      await expect(importXmd(lying)).rejects.toThrow('资源超过声明大小');
    });

    it('enforces the entry-count limit', async () => {
      const zip = new JSZip();
      zip.file('document.md', '# ok');
      zip.file('manifest.json', JSON.stringify(manifestFor([])));
      for (let index = 0; index <= MAX_XMD_ENTRIES; index++) {
        zip.file(`assets/${String(index).padStart(4, '0')}.bin`, '');
      }
      await expect(importXmd(await zip.generateAsync({ type: 'uint8array' }))).rejects.toThrow('归档文件过多');
    });
  });

  describe('manifest inventory', () => {
    it('requires a well-formed manifest with a v1 entry and resource list', async () => {
      const invalidJson = new JSZip();
      invalidJson.file('document.md', '# ok');
      invalidJson.file('manifest.json', '{ not json');
      await expect(importXmd(await invalidJson.generateAsync({ type: 'uint8array' })))
        .rejects.toThrow('manifest.json 不是有效的 JSON');

      await expect(importXmd(await pack([documentEntry('# ok')], { format: 'other', version: 1 })))
        .rejects.toThrow('不是 XMD 文档');
      await expect(importXmd(await pack([documentEntry('# ok')], { format: 'xmd', version: 2 })))
        .rejects.toThrow('不支持的 XMD 版本');
      await expect(importXmd(await pack([documentEntry('# ok')], manifestFor([], { entry: 'other.md' }))))
        .rejects.toThrow('不支持的入口');
      await expect(importXmd(await pack([documentEntry('# ok')], manifestFor([], { resources: undefined }))))
        .rejects.toThrow('缺少资源清单');
    });

    it('rejects manifest resources with unsafe paths or missing metadata', async () => {
      for (const path of ['../secret.png', '/abs.png', 'C:/x.png', 'document.md']) {
        await expect(importXmd(await pack([documentEntry('# ok')], manifestFor([], {
          resources: [{ path, mediaType: 'image/png', size: 1 }],
        })))).rejects.toThrow(/资源路径无效/);
      }
      await expect(importXmd(await pack([documentEntry('# ok')], manifestFor([], {
        resources: [{ path: 'assets/a.png', mediaType: '', size: 1 }],
      })))).rejects.toThrow('缺少媒体类型');
      await expect(importXmd(await pack([documentEntry('# ok')], manifestFor([], {
        resources: [{ path: 'assets/a.png', mediaType: 'image/png', size: 1 }],
      })))).rejects.toThrow('声明的资源缺失');
    });

    it('rejects assets that are not declared in the manifest', async () => {
      const entries: Entry[] = [
        documentEntry('![a](assets/a.png)'),
        { path: 'assets/a.png', data: PNG },
        { path: 'assets/hidden.png', data: PNG },
      ];
      await expect(importXmd(await pack(entries, manifestFor([entries[0], entries[1]]))))
        .rejects.toThrow('归档包含未声明资源');
    });

    it('rejects manifest sizes that disagree with the archive', async () => {
      const entries: Entry[] = [
        documentEntry('![a](assets/a.png)'),
        { path: 'assets/a.png', data: PNG },
      ];
      const manifest = manifestFor(entries);
      manifest.resources[0].size = PNG.byteLength + 1;
      await expect(importXmd(await pack(entries, manifest))).rejects.toThrow('资源大小与清单不一致');
    });
  });

  describe('body references must stay inside the package', () => {
    it('fails instead of dropping an image whose asset is missing', async () => {
      await expect(importXmd(await pack([documentEntry('![a](assets/missing.png)')])))
        .rejects.toThrow('未在包内声明');
    });

    it('rejects remote, blob and out-of-package local image references', async () => {
      for (const source of [
        'https://example.com/a.png',
        'http://example.com/a.png',
        'blob:https://example.com/id',
        './assets/missing.png',
        'other/a.png',
        'file:///C:/Windows/win.ini',
      ]) {
        await expect(importXmd(await pack([documentEntry(`![a](${source})`)])))
          .rejects.toThrow(/Cannot open XMD/);
      }
    });

    it('never reaches outside the package for a local attachment', async () => {
      await expect(importXmd(await pack([documentEntry('[附件](./assets/report.pdf)')])))
        .rejects.toThrow('Cannot open XMD');
      // Absolute local paths are rejected even if a same-named asset exists.
      await expect(importXmd(await pack([
        documentEntry('[x](C:/Users/secret.pdf)'),
        { path: 'assets/secret.pdf', data: PDF },
      ], manifestFor([{ path: 'assets/secret.pdf', data: PDF }])))).rejects.toThrow('Cannot open XMD');
    });

    it('keeps web/mailto links and already-embedded data URLs', async () => {
      const markdown = '[mail](mailto:a@example.com) [web](https://example.com/) [anchor](#top) ![inline](data:image/png;base64,AAAA)';
      const { markdown: imported } = await importXmdPackage(await pack([documentEntry(markdown)]));
      expect(imported).toBe(markdown);
    });

    it('rejects empty image destinations and non-image assets used as images', async () => {
      await expect(importXmd(await pack([documentEntry('![a]()')])))
        .rejects.toThrow('图片地址为空 / Empty image destination');

      await expect(importXmd(await pack([
        documentEntry('![a](assets/report.pdf)'),
        { path: 'assets/report.pdf', data: PDF },
      ]))).rejects.toThrow('不是可识别的图片类型');
    });

    it('inlines SVG assets as inert base64 data URLs, never as executable markup', async () => {
      const hostile = new TextEncoder().encode(
        '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(document.cookie)</script></svg>'
      );
      const { markdown } = await importXmdPackage(await pack([
        documentEntry('![logo](assets/logo.svg)'),
        { path: 'assets/logo.svg', data: hostile },
      ]));
      expect(markdown).toBe(`![logo](data:image/svg+xml;base64,${base64(hostile)})`);
      expect(markdown).not.toContain('<script>');
      expect(markdown).not.toContain('<svg');
    });
  });

  it('re-embeds imported attachment data URLs when exporting again', async () => {
    const bytes = await pack([
      documentEntry('![a](assets/a.png) [pdf](assets/report.pdf)'),
      { path: 'assets/a.png', data: PNG },
      { path: 'assets/report.pdf', data: PDF },
    ]);
    const { markdown } = await importXmdPackage(bytes);
    const reExported = await exportMarkdownToXmd(markdown, '再次导出.xmd');
    const zip = await JSZip.loadAsync(reExported);
    const manifest = JSON.parse(await zip.file('manifest.json')!.async('string'));
    const document = await zip.file('document.md')!.async('string');

    expect(manifest.resources).toHaveLength(2);
    expect(document).toBe('![a](assets/0001.png) [pdf](assets/0002.pdf)');
    expect(await zip.file('assets/0002.pdf')!.async('uint8array')).toEqual(PDF);
  });

  it('round-trips an empty document', async () => {
    const exported = await exportMarkdownToXmd('', '空文档.md');
    const imported = await importXmdPackage(exported);
    expect(imported.markdown).toBe('');
    expect(imported.manifest.resources).toEqual([]);
    expect(imported.inlined).toEqual([]);
  });

  it('detects xmd file names case-insensitively', () => {
    expect(isXmdFileName('a.xmd')).toBe(true);
    expect(isXmdFileName('A.XMD')).toBe(true);
    expect(isXmdFileName(' a.xmd ')).toBe(true);
    expect(isXmdFileName('a.md')).toBe(false);
    expect(isXmdFileName(null)).toBe(false);
    expect(isXmdFileName(undefined)).toBe(false);
  });
});
