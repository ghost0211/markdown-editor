import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import JSZip from 'jszip';
import { Preview } from '../src/components/Preview';
import { I18nProvider } from '../src/i18n';
import { extractOutline } from '../src/lib/outline';
import { getFrontMatterEndLine } from '../src/lib/frontMatter';
import { CALLOUT_TYPES, getCalloutTitle } from '../src/lib/remarkCallouts';
import { buildStandaloneHtml } from '../src/lib/export/htmlExporter';
import { exportMarkdownToDocx } from '../src/lib/export/docxExporter';

const renderPreview = (content: string, language: 'en-US' | 'zh-CN' = 'en-US') =>
  renderToStaticMarkup(
    <I18nProvider language={language}>
      <Preview content={content} />
    </I18nProvider>
  );

describe('GitHub Callouts, Footnotes, and Front Matter', () => {
  describe('GitHub-style callouts (> [!NOTE] ...)', () => {
    it('renders all 5 callout types in Preview with localized titles', () => {
      const md = CALLOUT_TYPES.map((t) => `> [!${t.toUpperCase()}]\n> Body for *${t}*.`).join('\n\n');
      const enHtml = renderPreview(md, 'en-US');
      const zhHtml = renderPreview(md, 'zh-CN');

      for (const type of CALLOUT_TYPES) {
        expect(enHtml).toContain(`md-callout-${type}`);
        expect(enHtml).toContain(`<strong>${getCalloutTitle(type, 'en-US')}</strong>`);
        expect(zhHtml).toContain(`<strong>${getCalloutTitle(type, 'zh-CN')}</strong>`);
      }
      expect(enHtml).not.toContain('[!NOTE]');
    });

    it('leaves ordinary blockquotes untouched', () => {
      const html = renderPreview('> Just a regular quote.');
      expect(html).toContain('<blockquote');
      expect(html).not.toContain('md-callout');
    });

    it('preserves callout classes and footnote links in standalone HTML export', async () => {
      const md = [
        'Text with a note[^1].',
        '',
        '> [!WARNING]',
        '> Watch out!',
        '',
        '[^1]: Footnote explanation.',
      ].join('\n');

      const html = await buildStandaloneHtml(md, 'Test', { lang: 'zh-CN' });
      expect(html).toContain('md-callout-warning');
      expect(html).toContain('<strong>警告</strong>');
      // Footnote anchor and target IDs must match (not double-prefixed).
      expect(html).toContain('href="#user-content-fn-1"');
      expect(html).toContain('id="user-content-fn-1"');
      expect(html).not.toContain('user-content-user-content-');
    });

    it('transforms callouts and strips front matter in DOCX export', async () => {
      const md = [
        '---',
        'title: Secret Metadata',
        'author: Alice',
        '---',
        '',
        '# Real Title',
        '',
        '> [!TIP]',
        '> Helpful advice.',
      ].join('\n');

      const bytes = await exportMarkdownToDocx(md, 'Doc', 'zh-CN');
      const zip = await JSZip.loadAsync(bytes);
      const docXml = await zip.file('word/document.xml')!.async('string');

      expect(docXml).toContain('Real Title');
      expect(docXml).toContain('提示');
      expect(docXml).toContain('Helpful advice.');
      expect(docXml).not.toContain('Secret Metadata');
      expect(docXml).not.toContain('[!TIP]');
    });
  });

  describe('YAML and TOML Front Matter', () => {
    it('detects closing fence lines for YAML (--- / ...), BOM, and TOML (+++)', () => {
      expect(getFrontMatterEndLine('---\ntitle: Hi\n---\n# H1')).toBe(3);
      expect(getFrontMatterEndLine('\uFEFF---\ntitle: Hi\n...\n# H1')).toBe(3);
      expect(getFrontMatterEndLine('+++\ntitle = "Hi"\n+++\n# H1')).toBe(3);
      expect(getFrontMatterEndLine('---\nunclosed: true\n# H1')).toBe(0);
      expect(getFrontMatterEndLine('# Regular Heading\n---\n')).toBe(0);
    });

    it('excludes front matter comments and closing --- from document outline', () => {
      const md = [
        '---',
        'title: Post',
        '# yaml comment should not become H1',
        'tags: [a, b]',
        '---',
        '',
        '# Actual Heading',
        '## Sub Heading',
      ].join('\n');

      const headings = extractOutline(md);
      expect(headings.map((h) => ({ level: h.level, text: h.text, line: h.line }))).toEqual([
        { level: 1, text: 'Actual Heading', line: 7 },
        { level: 2, text: 'Sub Heading', line: 8 },
      ]);
    });

    it('renders front matter as a collapsible metadata block in Preview and drops it in HTML export', async () => {
      const md = ['---', 'title: Hello', 'draft: false', '---', '', '# Body'].join('\n');

      const previewHtml = renderPreview(md, 'en-US');
      expect(previewHtml).toContain('data-frontmatter="true"');
      expect(previewHtml).toContain('Front Matter · YAML');
      expect(previewHtml).toContain('Collapse metadata');

      const exportedHtml = await buildStandaloneHtml(md, 'Hello');
      expect(exportedHtml).not.toContain('draft: false');
      expect(exportedHtml).toContain('<h1>Body</h1>');
    });
  });
});
