import { renderToStaticMarkup } from 'react-dom/server';
import { describe, it, expect } from 'vitest';
import {
  getAdaptivePreviewDebounceMs,
  hasPotentialMathSyntax,
  isLargeMarkdownDocument,
  splitLargeMarkdownIntoChunks,
} from '../src/lib/largeDocument';
import { Preview } from '../src/components/Preview';
import { I18nProvider } from '../src/i18n';

describe('largeDocument utilities & chunked Preview rendering', () => {
  it('detects potential math syntax accurately in O(n)', () => {
    expect(hasPotentialMathSyntax('')).toBe(false);
    expect(hasPotentialMathSyntax('# Heading\n\nPlain text and `code` without math.')).toBe(false);
    expect(hasPotentialMathSyntax('Inline $E = mc^2$ formula')).toBe(true);
    expect(hasPotentialMathSyntax('Display\n$$\na + b\n$$')).toBe(true);
    expect(hasPotentialMathSyntax('LaTeX \\(x^2\\) inline')).toBe(true);
    expect(hasPotentialMathSyntax('LaTeX \\[y^2\\] block')).toBe(true);
    expect(hasPotentialMathSyntax('```math\n\\int_0^1 x dx\n```')).toBe(true);
  });

  it('computes large-document detection and adaptive debounce tiers', () => {
    expect(isLargeMarkdownDocument('# Short doc\n\nHello')).toBe(false);
    expect(getAdaptivePreviewDebounceMs(1_000)).toBe(0);
    expect(getAdaptivePreviewDebounceMs(80_000)).toBe(160);
    expect(getAdaptivePreviewDebounceMs(300_000)).toBe(280);
    expect(getAdaptivePreviewDebounceMs(800_000)).toBe(420);

    const manyLines = Array.from({ length: 1_250 }, (_, i) => `Line ${i + 1}`).join('\n');
    expect(isLargeMarkdownDocument(manyLines)).toBe(true);
  });

  it('never splits inside fenced code blocks, math blocks, or front matter', () => {
    const frontMatter = ['---', 'title: Large Spec', '', 'author: Team', '---', ''];
    const giantCodeBlock = [
      '```ts',
      ...Array.from({ length: 80 }, (_, i) => (i % 10 === 0 ? '' : `const x${i} = ${i};`)),
      '```',
      '',
    ];
    const giantMathBlock = [
      '$$',
      'x = 1',
      '',
      'y = 2',
      '$$',
      '',
    ];
    const prose = Array.from({ length: 40 }, (_, i) => `Paragraph ${i + 1}\n`).join('\n');

    const doc = [...frontMatter, ...giantCodeBlock, ...giantMathBlock, prose].join('\n');
    const chunks = splitLargeMarkdownIntoChunks(doc, {
      forceChunking: true,
      targetLines: 20,
      targetChars: 300,
    });

    expect(chunks.length).toBeGreaterThan(2);

    // Every chunk startLine must align contiguously with previous startLine + lineCount
    let expectedLine = 1;
    for (const chunk of chunks) {
      expect(chunk.startLine).toBe(expectedLine);
      expectedLine += chunk.lineCount;
    }
    expect(expectedLine - 1).toBe(doc.split('\n').length);

    // The 80-line fenced code block must remain intact inside a single chunk
    const codeChunk = chunks.find((c) => c.text.includes('```ts'));
    expect(codeChunk).toBeDefined();
    expect(codeChunk!.text).toContain('const x79 = 79;\n```');

    // Rejoining chunks with '\n' reproduces the exact source document
    expect(chunks.map((c) => c.text).join('\n')).toBe(doc);
  });

  it('preserves exact source data-line numbers across chunks and renders mid-document --- as <hr>', () => {
    const sections: string[] = [];
    for (let i = 1; i <= 350; i++) {
      sections.push(`## Section ${i}`);
      sections.push('');
      sections.push(`Body paragraph for section ${i} with enough padding text to cross the threshold.`);
      sections.push('');
    }
    // Append a horizontal rule and final heading well past line 1,400
    sections.push('---');
    sections.push('');
    sections.push('# Final Milestone Heading');

    const fullDoc = sections.join('\n');
    const allLines = fullDoc.split('\n');
    const finalHeadingLine = allLines.indexOf('# Final Milestone Heading') + 1;
    expect(finalHeadingLine).toBeGreaterThan(1_400);

    const chunks = splitLargeMarkdownIntoChunks(fullDoc);
    expect(chunks.length).toBeGreaterThan(3);

    const html = renderToStaticMarkup(
      <I18nProvider language="en-US">
        <Preview content={fullDoc} />
      </I18nProvider>
    );

    expect(html).toContain(`data-line="${finalHeadingLine}"`);
    expect(html).toContain('Final Milestone Heading');
    expect(html).toContain('<hr');
    expect(html).not.toContain('data-frontmatter="true"');
  });
});
