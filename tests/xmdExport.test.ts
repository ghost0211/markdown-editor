import { afterEach, describe, expect, it, vi } from 'vitest';
import JSZip from 'jszip';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import type { Nodes } from 'mdast';
import {
  exportMarkdownToXmd,
  MAX_XMD_RESOURCE_BYTES,
  MAX_XMD_TOTAL_BYTES,
  type XmdManifest,
  type XmdResourceData,
} from '../src/lib/export/xmdExporter';

const native = vi.hoisted(() => ({ isTauri: vi.fn(() => false), readXmdResource: vi.fn(), fetchXmdImage: vi.fn() }));
vi.mock('../src/lib/native', () => native);
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); native.isTauri.mockReturnValue(false); });

const IMAGE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const imageLoader = () => vi.fn(async (_source: string): Promise<XmdResourceData> => ({ bytes: IMAGE, mediaType: 'image/png' }));

async function unpack(bytes: Uint8Array) {
  const zip = await JSZip.loadAsync(bytes, { checkCRC32: true });
  const manifest = JSON.parse(await zip.file('manifest.json')!.async('string')) as XmdManifest;
  const document = await zip.file(manifest.entry)!.async('string');
  return { zip, manifest, document };
}

function urls(markdown: string): string[] {
  const result: string[] = [];
  const tree = unified().use(remarkParse).parse(markdown);
  function visit(node: Nodes) {
    if (node.type === 'image' || node.type === 'link' || node.type === 'definition') result.push(node.url);
    if ('children' in node) for (const child of node.children) visit(child);
  }
  visit(tree);
  return result;
}

describe('XMD v1 ZIP exporter', () => {
  it('packages an empty document and Unicode text as UTF-8 with a versioned manifest', async () => {
    for (const markdown of ['', '# 中文 🚀\r\n\r\n正文 **保留**\r\n']) {
      const bytes = await exportMarkdownToXmd(markdown, '中文.md');
      expect([...bytes.slice(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]);
      const { manifest, document, zip } = await unpack(bytes);
      expect(manifest).toEqual({ format: 'xmd', version: 1, entry: 'document.md', title: '中文.md', resources: [] });
      expect(document).toBe(markdown);
      expect(Object.keys(zip.files).sort()).toEqual(['document.md', 'manifest.json']);
    }
  });

  it('resolves relative/encoded/absolute/file paths, deduplicates and retains fragments', async () => {
    const loadResource = imageLoader();
    const markdown = [
      '![中文](<./assets/图 (1).png> "title")',
      '![重复](assets/%E5%9B%BE%20(1).png)',
      '![绝对](file:///C:/notes/assets/%E5%9B%BE%20(1).png#section)',
      '![同名](../other/图.png)',
    ].join('\r\n\r\n');
    const { manifest, document, zip } = await unpack(await exportMarkdownToXmd(markdown, 'Doc', {
      sourceFilePath: 'C:\\notes\\doc.md', loadResource,
    }));
    expect(loadResource.mock.calls.map(([path]) => path)).toEqual(['C:/notes/assets/图 (1).png', 'C:/other/图.png']);
    expect(manifest.resources).toEqual([
      { path: 'assets/0001.png', mediaType: 'image/png', size: IMAGE.length },
      { path: 'assets/0002.png', mediaType: 'image/png', size: IMAGE.length },
    ]);
    expect(document).toBe('![中文](<assets/0001.png> "title")\r\n\r\n![重复](assets/0001.png)\r\n\r\n![绝对](assets/0001.png#section)\r\n\r\n![同名](assets/0002.png)');
    expect(await zip.file('assets/0001.png')!.async('uint8array')).toEqual(IMAGE);
    expect(JSON.stringify(manifest)).not.toContain('C:/');
  });

  it('retains a leading UTF-8 BOM while correctly rewriting inline, reference and HTML images', async () => {
    for (const markdown of [
      '\uFEFF![a](a.png)',
      '\uFEFF![a][r]\r\n\r\n[r]: a.png',
      '\uFEFF<img src="a.png">',
      '\uFEFFtitle\r\n\r\n<img src="a.png">',
    ]) {
      const { document, manifest } = await unpack(await exportMarkdownToXmd(markdown, 'BOM', {
        sourceFilePath: '/docs/a.md', loadResource: imageLoader(),
      }));
      expect(document).toBe(markdown.replace('a.png', 'assets/0001.png'));
      expect(document.charCodeAt(0)).toBe(0xFEFF);
      expect(manifest.resources).toHaveLength(1);
    }
  });

  it('escapes decoded URL fragments when reinserting Markdown destinations', async () => {
    const markdown = '![a](https://example.com/a.png#a\\)b)\n\n![b](b.svg#a\\(b)\n\n![r][ref]\n\n[ref]: c.svg#a\\)b';
    const { document } = await unpack(await exportMarkdownToXmd(markdown, 'Doc', {
      sourceFilePath: '/docs/a.md', loadResource: imageLoader(),
    }));
    expect(urls(document)).toEqual(['assets/0001.png#a%29b', 'assets/0002.png#a%28b', 'assets/0003.png#a%29b']);
  });

  it('routes protocol-relative images through HTTPS and rejects UNC/file-host paths before reading', async () => {
    const loadResource = imageLoader();
    const { document } = await unpack(await exportMarkdownToXmd('![a](//cdn.example/a.png)', 'Doc', { loadResource }));
    expect(loadResource).toHaveBeenCalledWith('https://cdn.example/a.png');
    expect(document).toBe('![a](assets/0001.png)');
    loadResource.mockClear();
    for (const markdown of ['![a](file://attacker.example/share/a.png)', '<img src="file://attacker.example/share/a.png">']) {
      await expect(exportMarkdownToXmd(markdown, 'Doc', { loadResource })).rejects.toThrow('Network share');
    }
    expect(loadResource).not.toHaveBeenCalled();
  });

  it('accepts literal percent signs in local filenames', async () => {
    const loadResource = imageLoader();
    await exportMarkdownToXmd('![a](100%.png)', 'Doc', { sourceFilePath: '/docs/a.md', loadResource });
    expect(loadResource).toHaveBeenCalledWith('/docs/100%.png');
  });

  it('recognizes image types after decoding literal hash and question marks in local filenames', async () => {
    const loadResource = vi.fn(async (): Promise<XmdResourceData> => ({ bytes: IMAGE }));
    const { document, manifest } = await unpack(await exportMarkdownToXmd('![a](images/a%23b%3Fc.png)', 'Doc', {
      sourceFilePath: 'C:/notes%/doc.md', loadResource,
    }));
    expect(loadResource).toHaveBeenCalledWith('C:/notes%/images/a#b?c.png');
    expect(document).toBe('![a](assets/0001.png)');
    expect(manifest.resources[0].mediaType).toBe('image/png');
  });

  it('packages reference-style images and local attachments without changing labels or titles', async () => {
    const loadResource = vi.fn(async (source: string): Promise<XmdResourceData> => ({
      bytes: IMAGE, mediaType: source.endsWith('.pdf') ? 'application/pdf' : 'image/png',
    }));
    const markdown = [
      '![first][Photo] ![photo][] ![photo] [same][Photo]',
      '',
      '[Photo]: <assets/pic.png> "A title"',
      '',
      '[附件](./report.pdf#page=2) [外网](https://example.com/) [跳转](#title)',
      '',
      '[unused]: ./missing.png',
    ].join('\n');
    const { document, manifest } = await unpack(await exportMarkdownToXmd(markdown, 'Doc', { sourceFilePath: '/docs/a.md', loadResource }));
    expect(document).toContain('[Photo]: <assets/0001.png> "A title"');
    expect(document).toContain('[附件](assets/0002.pdf#page=2)');
    expect(document).toContain('[unused]: ./missing.png');
    expect(document).toContain('[外网](https://example.com/) [跳转](#title)');
    expect(manifest.resources).toHaveLength(2);
    expect(loadResource).toHaveBeenCalledTimes(2);
  });

  it('rewrites only the outer link destination when a linked image uses another resource', async () => {
    const { document } = await unpack(await exportMarkdownToXmd('[![alt](a.png)](b.png "outer")', 'Doc', {
      sourceFilePath: '/docs/a.md', loadResource: imageLoader(),
    }));
    expect(document).toBe('[![alt](assets/0001.png)](assets/0002.png "outer")');
    expect(urls(document)).toEqual(['assets/0002.png', 'assets/0001.png']);
  });

  it('does not touch inline/fenced/indented code, front matter, HTML comments or math', async () => {
    const markdown = [
      '---', 'cover: "![no](missing1.png)"', '---', '',
      '`![no](missing2.png)`', '',
      '```md', '![no](missing3.png)', '<img src="missing4.png">', '```', '',
      '    ![no](missing5.png)', '', '<!-- <img src="missing6.png"> -->', '',
      '$![no](missing7.png)$', '', '![real](a.png)',
    ].join('\n');
    const loadResource = imageLoader();
    const { document } = await unpack(await exportMarkdownToXmd(markdown, 'Doc', { sourceFilePath: '/a.md', loadResource }));
    expect(loadResource.mock.calls).toEqual([['/a.png']]);
    expect(document).toBe(markdown.replace('![real](a.png)', '![real](assets/0001.png)'));
  });

  it('supports multiline destinations, escapes, entities and nested parentheses', async () => {
    const markdown = '![a](\n  <./a&amp;b.png>\n  "title"\n)\n\n![b](a\\(b\\).png)\n\n![c](a(b(c)).png)';
    const loadResource = imageLoader();
    const { document } = await unpack(await exportMarkdownToXmd(markdown, 'Doc', { sourceFilePath: '/docs/a.md', loadResource }));
    expect(loadResource.mock.calls.map(([source]) => source)).toEqual(['/docs/a&b.png', '/docs/a(b).png', '/docs/a(b(c)).png']);
    expect(document).toBe('![a](\n  <assets/0001.png>\n  "title"\n)\n\n![b](assets/0002.png)\n\n![c](assets/0003.png)');
  });

  it('packages raw HTML img and picture/srcset references while preserving other attributes', async () => {
    const markdown = '<picture>\n<source srcset="a.png 1x, b.png 2x">\n<img width="20" src=\'a.png\' alt="A &amp; B" srcset="a.png 100w, b.png 200w">\n</picture>\n\n<img src="c&amp;d.png">';
    const loadResource = imageLoader();
    const { document, manifest } = await unpack(await exportMarkdownToXmd(markdown, 'Doc', { sourceFilePath: '/doc.md', loadResource }));
    expect(document).toContain('<source srcset="assets/0001.png 1x, assets/0002.png 2x">');
    expect(document).toContain('<img width="20" src="assets/0001.png" alt="A &amp; B" srcset="assets/0001.png 100w, assets/0002.png 200w">');
    expect(document).toContain('<img src="assets/0003.png">');
    expect(manifest.resources).toHaveLength(3);
    expect(loadResource.mock.calls.map(([source]) => source)).toEqual(['/a.png', '/b.png', '/c&d.png']);
  });

  it('extracts pasted base64 and percent-encoded image data URLs without network access', async () => {
    const markdown = '![paste](data:image/png;base64,iVBORw0KGgo=)\n\n![svg](<data:image/svg+xml,%3Csvg%3E%E4%B8%AD%3C/svg%3E>)';
    const { zip, manifest, document } = await unpack(await exportMarkdownToXmd(markdown, 'Draft'));
    expect(manifest.resources.map((resource) => resource.path)).toEqual(['assets/0001.png', 'assets/0002.svg']);
    expect(await zip.file('assets/0001.png')!.async('uint8array')).toEqual(IMAGE);
    expect(await zip.file('assets/0002.svg')!.async('string')).toBe('<svg>中</svg>');
    expect(document).toBe('![paste](assets/0001.png)\n\n![svg](<assets/0002.svg>)');
  });

  it('extracts data URL candidates inside srcset without splitting their payloads', async () => {
    const markdown = '<img srcset="data:image/png;base64,iVBORw0KGgo= 1x, data:image/png;base64,iVBORw0KGgo= 2x">';
    const { document, manifest } = await unpack(await exportMarkdownToXmd(markdown, 'Draft'));
    expect(document).toBe('<img srcset="assets/0001.png 1x, assets/0001.png 2x">');
    expect(manifest.resources).toHaveLength(1);
  });

  it('fetches and includes HTTP/blob images and never leaves remote image URLs in the document', async () => {
    const loadResource = imageLoader();
    const markdown = '![a](https://example.com/a.png?token=x#frag) ![b](https://example.com/a.png?token=x) ![c](blob:https://example.com/id)';
    const { document } = await unpack(await exportMarkdownToXmd(markdown, 'Doc', { loadResource }));
    expect(document).toBe('![a](assets/0001.png#frag) ![b](assets/0001.png) ![c](assets/0002.png)');
    expect(loadResource).toHaveBeenCalledTimes(2);
    expect(loadResource).toHaveBeenCalledWith('https://example.com/a.png?token=x');
  });

  it('uses the native remote loader on desktop rather than loosening webview CSP', async () => {
    native.isTauri.mockReturnValue(true);
    native.fetchXmdImage.mockResolvedValue({ data: IMAGE, contentType: 'image/png' });
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const { document } = await unpack(await exportMarkdownToXmd('![a](https://example.com/a.png)', 'Doc'));
    expect(native.fetchXmdImage).toHaveBeenCalledWith('https://example.com/a.png');
    expect(fetch).not.toHaveBeenCalled();
    expect(document).toBe('![a](assets/0001.png)');
  });

  it('reads local bytes on desktop and fails clearly on browser local file references', async () => {
    native.isTauri.mockReturnValue(true);
    native.readXmdResource.mockResolvedValue(IMAGE);
    const { zip } = await unpack(await exportMarkdownToXmd('![a](a.png)', 'Doc', { sourceFilePath: 'C:/docs/doc.md' }));
    expect(native.readXmdResource).toHaveBeenCalledWith('C:/docs/a.png');
    expect(await zip.file('assets/0001.png')!.async('uint8array')).toEqual(IMAGE);
    native.isTauri.mockReturnValue(false);
    await expect(exportMarkdownToXmd('![a](a.png)', 'Doc', { sourceFilePath: '/a.md' })).rejects.toThrow('desktop app');
  });

  it('uses browser fetch without credentials or referrer and keeps binary response bytes', async () => {
    const fetch = vi.fn(async () => new Response(IMAGE, { headers: { 'Content-Type': 'image/png' } }));
    vi.stubGlobal('fetch', fetch);
    const { zip } = await unpack(await exportMarkdownToXmd('![a](https://example.com/a.png)', 'Doc'));
    expect(fetch).toHaveBeenCalledWith('https://example.com/a.png', expect.objectContaining({ credentials: 'omit', referrerPolicy: 'no-referrer' }));
    expect(await zip.file('assets/0001.png')!.async('uint8array')).toEqual(IMAGE);
  });

  it('fails on missing resources, CORS/HTTP errors and unsupported schemes instead of exporting a broken pack', async () => {
    await expect(exportMarkdownToXmd('![a](./missing.png)', 'Doc', {
      sourceFilePath: '/docs/a.md', loadResource: async () => { throw new Error('ENOENT'); },
    })).rejects.toThrow(/missing.png.*ENOENT/);
    await expect(exportMarkdownToXmd('![a](relative.png)', 'Unsaved')).rejects.toThrow('Save this document');
    await expect(exportMarkdownToXmd('![a](javascript:alert)', 'Doc')).rejects.toThrow('Unsupported resource protocol');
    await expect(exportMarkdownToXmd('![a](https://user:pass@example.com/a.png)', 'Doc')).rejects.toThrow('credentials');
    vi.stubGlobal('fetch', vi.fn(async () => new Response('Not found', { status: 404 })));
    await expect(exportMarkdownToXmd('![a](https://example.com/a.png)', 'Doc')).rejects.toThrow('HTTP 404');
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    await expect(exportMarkdownToXmd('![a](https://example.com/a.png)', 'Doc')).rejects.toThrow('Failed to fetch');
  });

  it('rejects empty/anchor-only images and non-image response types', async () => {
    await expect(exportMarkdownToXmd('![a]()', 'Doc')).rejects.toThrow('Empty image destination');
    await expect(exportMarkdownToXmd('![a](#missing)', 'Doc')).rejects.toThrow('anchor-only');
    await expect(exportMarkdownToXmd('![a](data:text/html;base64,SGk=)', 'Doc')).rejects.toThrow('not a recognized image');
    await expect(exportMarkdownToXmd('![a](a.png)', 'Doc', {
      sourceFilePath: '/a.md', loadResource: async () => ({ bytes: IMAGE, mediaType: 'text/html' }),
    })).rejects.toThrow('not a recognized image');
  });

  it('enforces per-resource and total size limits', async () => {
    await expect(exportMarkdownToXmd('![a](a.png)', 'Doc', {
      sourceFilePath: '/a.md', loadResource: async () => ({ bytes: new Uint8Array(MAX_XMD_RESOURCE_BYTES + 1) }),
    })).rejects.toThrow('32 MiB');
    const bytes = new Uint8Array(MAX_XMD_RESOURCE_BYTES);
    expect(MAX_XMD_TOTAL_BYTES).toBe(MAX_XMD_RESOURCE_BYTES * 4);
    await expect(exportMarkdownToXmd('![1](1.png) ![2](2.png) ![3](3.png) ![4](4.png)', 'Doc', {
      sourceFilePath: '/a.md', loadResource: async () => ({ bytes }),
    })).rejects.toThrow('128 MiB');
  });

  it('never creates unsafe or absolute archive entry paths even with traversal inputs', async () => {
    const { manifest, zip } = await unpack(await exportMarkdownToXmd('![a](../../secret.png) [b](../secrets.env)', 'Doc', {
      sourceFilePath: '/docs/a.md', loadResource: imageLoader(),
    }));
    expect(manifest.resources.every((resource) => /^assets\/\d{4}\.[a-z\d]+$/.test(resource.path))).toBe(true);
    expect(Object.keys(zip.files).every((path) => !path.includes('..') && !path.startsWith('/'))).toBe(true);
  });
});
