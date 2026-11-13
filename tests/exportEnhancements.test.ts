import { describe, it, expect } from 'vitest';
import { mimeTypeForPath, toDataUrl } from '../src/lib/export/embedImages';
import { buildStandaloneHtml } from '../src/lib/export/htmlExporter';
import { buildRichTextHtml } from '../src/lib/export/richText';
import {
  normalizeSvgForExport,
  parseSvgDimensions,
  prepareSvgForRaster,
} from '../src/lib/export/mermaidExporter';

describe('Export enhancements (embedded images, rich text, Mermaid SVG/PNG)', () => {
  describe('embedImages + buildStandaloneHtml', () => {
    it('maps image extensions to MIME types and builds base64 data URLs', () => {
      expect(mimeTypeForPath('C:\\docs\\assets\\pic.png')).toBe('image/png');
      expect(mimeTypeForPath('./diagram.svg?v=1')).toBe('image/svg+xml');
      expect(toDataUrl(new Uint8Array([72, 105]), 'image/png')).toBe('data:image/png;base64,SGk=');
    });

    it('inlines relative images when resolveImage is provided and leaves remote URLs intact', async () => {
      const md = '![local](./assets/a.png)\n\n![remote](https://example.com/b.png)';
      const html = await buildStandaloneHtml(md, 'Doc', {
        resolveImage: async (src) =>
          src === './assets/a.png' ? 'data:image/png;base64,AAAA' : null,
      });

      expect(html).toContain('src="data:image/png;base64,AAAA"');
      expect(html).toContain('src="https://example.com/b.png"');
    });

    it('keeps original image path if resolver throws or returns null', async () => {
      const html = await buildStandaloneHtml('![missing](./nope.png)', 'Doc', {
        resolveImage: async () => {
          throw new Error('ENOENT');
        },
      });
      expect(html).toContain('src="./nope.png"');
    });
  });

  describe('buildRichTextHtml', () => {
    it('inlines styles on headings, tables, code blocks, and callouts while stripping XSS and front matter', async () => {
      const md = [
        '---',
        'title: Hidden',
        '---',
        '# Title',
        '',
        'Inline `code` and <script>alert(1)</script>',
        '',
        '```ts',
        'const x = 1;',
        '```',
        '',
        '> [!CAUTION]',
        '> Danger zone.',
      ].join('\n');

      const html = await buildRichTextHtml(md, 'en-US');
      expect(html).not.toContain('Hidden');
      expect(html).not.toContain('<script');
      expect(html).toMatch(/<h1[^>]*style="[^"]*font-size:1\.8em/);
      // Code inside <pre> must have transparent background, unlike inline <code>.
      expect(html).toContain('background:transparent;padding:0;');
      // Caution callout gets red border inline so rich-text targets keep its look.
      expect(html).toContain('border-left:4px solid #cf222e');
    });
  });

  describe('mermaidExporter helpers', () => {
    it('adds xmlns and xmlns:xlink once without duplicating existing attributes', () => {
      const raw = '<svg viewBox="0 0 200 100"><g></g></svg>';
      const normalized = normalizeSvgForExport(raw);
      expect(normalized).toContain('xmlns="http://www.w3.org/2000/svg"');
      expect(normalized).toContain('xmlns:xlink="http://www.w3.org/1999/xlink"');
      expect(normalizeSvgForExport(normalized)).toBe(normalized);
    });

    it('parses dimensions from viewBox even when width="100%" and prepares explicit pixel attributes', () => {
      const svg = '<svg width="100%" style="max-width: 420px" viewBox="0 0 420.4 180.2"><rect/></svg>';
      const dims = parseSvgDimensions(svg);
      expect(dims).toEqual({ width: 421, height: 181 });

      const raster = prepareSvgForRaster(svg, dims.width, dims.height);
      expect(raster).toContain('width="421" height="181"');
      expect(raster).not.toContain('width="100%"');
    });
  });
});
