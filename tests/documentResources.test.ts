import { describe, expect, it } from 'vitest';
import { embeddedByteLength, formatResourceSize, replaceResourcePaths, scanDocumentResources } from '../src/lib/documentResources';

const png = 'data:image/png;base64,iVBORw0KGgo=';

describe('document resource inventory', () => {
  it('groups repeated local references and records actual source lines', () => {
    const markdown = '# Doc\r\n\r\n![a](assets/pic.png)\r\n\r\n![b](<./assets/pic.png> "title")\r\n[PDF](./manual.pdf)';
    const resources = scanDocumentResources(markdown, 'C:\\docs\\note.md');
    expect(resources).toHaveLength(2);
    expect(resources[0]).toMatchObject({ kind: 'image', location: 'local', localPath: 'C:/docs/assets/pic.png', referenceCount: 2, status: 'loading', mimeType: 'image/png' });
    expect(resources[0].references.map((ref) => ref.line)).toEqual([3, 5]);
    expect(resources[1]).toMatchObject({ kind: 'attachment', name: 'manual.pdf', referenceCount: 1 });
  });

  it('recognizes embedded/remote/transient images and ignores ordinary web links', () => {
    const resources = scanDocumentResources(`![embedded](<${png}>)\n![remote](https://example.com/a.png)\n![temp](blob:https://example.com/id)\n[web](https://example.com/) [mail](mailto:a@example.com)`);
    expect(resources.map((resource) => resource.location)).toEqual(['embedded', 'remote', 'transient']);
    expect(resources[0]).toMatchObject({ kind: 'image', byteLength: 8, status: 'ready' });
    expect(resources[0].displayAddress).toBe('data:image/png;base64,…');
    expect(resources[1].status).toBe('unknown');
    expect(resources[2].status).toBe('unknown');
  });

  it('does not mistake code, comments, math or front matter for resources', () => {
    const markdown = ['---', 'image: "![a](a.png)"', '---', '', '`![b](b.png)`', '', '```md', '![c](c.png)', '```', '', '<!-- <img src="d.png"> -->', '', '$![e](e.png)$', '', '![real](real.png)'].join('\n');
    const resources = scanDocumentResources(markdown, '/docs/doc.md');
    expect(resources.map((resource) => resource.name)).toEqual(['real.png']);
    expect(resources[0].references[0].line).toBe(15);
  });

  it('handles HTML src/srcset, references and unsaved relative paths', () => {
    const markdown = '![photo][ref]\n\n[ref]: <assets/pic.png>\n\n<picture><source srcset="assets/pic.png 1x, assets/two.png 2x"><img src="assets/pic.png"></picture>';
    const resources = scanDocumentResources(markdown, '/docs/doc.md');
    expect(resources[0].referenceCount).toBe(3);
    expect(resources[1].name).toBe('two.png');
    expect(scanDocumentResources('![missing](a.png)')[0].status).toBe('missing');
  });

  it('resolves literal percent paths, keeps decoded filename characters and normalizes protocol-relative images', () => {
    const resources = scanDocumentResources('![percent](assets/100%.png)\n![hash](assets/a%23b.png)\n![escaped](assets/a%2520b.png)\n![cdn](//cdn.example.com/a.png)', 'C:/docs/doc.md');
    expect(resources.map((resource) => resource.name)).toEqual(['100%.png', 'a#b.png', 'a%20b.png', 'a.png']);
    expect(resources[0].localPath).toBe('C:/docs/assets/100%.png');
    expect(resources[3]).toMatchObject({ location: 'remote', source: 'https://cdn.example.com/a.png', status: 'unknown' });
    expect(embeddedByteLength('data:image/svg+xml,%41%42%E4%B8%AD')).toBe(5);
    expect(embeddedByteLength('data:image/png;base64,QQ%3D%3D')).toBe(1);
  });

  it('counts reference-style uses at their actual body lines', () => {
    const resource = scanDocumentResources('![one][pic]\n\n![two][pic]\n\n[pic]: a.png', 'C:/docs/doc.md')[0];
    expect(resource.referenceCount).toBe(2);
    expect(resource.references.map((reference) => reference.line)).toEqual([1, 3]);
  });

  it('has stable identifiers, embedded byte lengths and readable size labels', () => {
    const before = scanDocumentResources(`![a](<${png}>)`)[0];
    const after = scanDocumentResources(`# Prefix\n\n![a](<${png}>)`)[0];
    expect(before.id).toBe(after.id);
    expect(embeddedByteLength(`${png}#fragment`)).toBe(8);
    expect(formatResourceSize(512)).toBe('512 B');
    expect(formatResourceSize(2048)).toBe('2.0 KiB');
  });

  it('rewrites only the selected embedded resource and preserves Markdown titles', () => {
    const markdown = `![a](<${png}> "title") ![other](data:image/jpeg;base64,AAAA)`;
    const resources = scanDocumentResources(markdown);
    const result = replaceResourcePaths(markdown, resources, new Map([[resources[0].id, 'assets/new image.png']]));
    expect(result).toBe('![a](<assets/new image.png> "title") ![other](data:image/jpeg;base64,AAAA)');
  });

  it('keeps HTML attributes, srcset descriptors and untouched code intact during conversion', () => {
    const markdown = `<img alt="A &amp; B" src="${png}" srcset="${png} 1x, ${png} 2x">\n\n\`![x](a.png)\``;
    const resources = scanDocumentResources(markdown);
    const result = replaceResourcePaths(markdown, resources, new Map([[resources[0].id, 'assets/new.png']]));
    expect(result).toContain('<img alt="A &amp; B" src="assets/new.png" srcset="assets/new.png 1x, assets/new.png 2x">');
    expect(result).toContain('`![x](a.png)`');
  });
});
