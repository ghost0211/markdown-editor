import React from 'react';
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import Markdown, { Components, ExtraProps } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeSlug from 'rehype-slug';
import { extractOutline } from '../src/lib/outline';
import { WELCOME_DOCUMENT } from '../src/lib/defaultDocument';

type HeadingTag = 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';

const createHeadingRenderer = (Tag: HeadingTag) => {
  const HeadingComponent: React.FC<
    React.ComponentPropsWithoutRef<HeadingTag> & ExtraProps
  > = ({ node, children, ...props }) => {
    const line = node?.position?.start?.line;
    return (
      <Tag data-line={line} {...props}>
        {children}
      </Tag>
    );
  };
  HeadingComponent.displayName = Tag;
  return HeadingComponent;
};

const components: Components = {
  h1: createHeadingRenderer('h1'),
  h2: createHeadingRenderer('h2'),
  h3: createHeadingRenderer('h3'),
  h4: createHeadingRenderer('h4'),
  h5: createHeadingRenderer('h5'),
  h6: createHeadingRenderer('h6'),
};

interface RenderedHeadingInfo {
  tag: string;
  id: string;
  dataLine: number;
}

function parseRenderedHeadings(html: string): RenderedHeadingInfo[] {
  const regex = /<(h[1-6])\s+([^>]*?)>/g;
  const results: RenderedHeadingInfo[] = [];
  let match: RegExpExecArray | null;

  while ((match = regex.exec(html)) !== null) {
    const tag = match[1];
    const attrsStr = match[2];
    const idMatch = /id="([^"]*)"/.exec(attrsStr);
    const lineMatch = /data-line="([^"]*)"/.exec(attrsStr);

    results.push({
      tag,
      id: idMatch ? idMatch[1] : '',
      dataLine: lineMatch ? parseInt(lineMatch[1], 10) : 0,
    });
  }

  return results;
}

function renderMarkdownPreview(markdown: string): string {
  return renderToStaticMarkup(
    <Markdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[rehypeSlug]}
      components={components}
    >
      {markdown}
    </Markdown>
  );
}

describe('Heading ID & Outline Slug Synchronization', () => {
  it('should match slugs and line numbers for the default WELCOME_DOCUMENT', () => {
    const outline = extractOutline(WELCOME_DOCUMENT);
    const html = renderMarkdownPreview(WELCOME_DOCUMENT);
    const renderedHeadings = parseRenderedHeadings(html);

    expect(outline.length).toBeGreaterThan(0);
    expect(outline.length).toBe(renderedHeadings.length);

    outline.forEach((heading, index) => {
      const rendered = renderedHeadings[index];
      expect(rendered).toBeDefined();
      expect(rendered.tag).toBe(`h${heading.level}`);
      expect(heading.slug).toBe(rendered.id);
      expect(heading.line).toBe(rendered.dataLine);
    });
  });

  it('should synchronize headings with emojis at start and end', () => {
    const md = `# 🚀 欢迎使用 Markdown 🚀
Some content

## 📑 核心功能特性
Details

### ⚡ 原生级体验 ⚡
More details`;

    const outline = extractOutline(md);
    const html = renderMarkdownPreview(md);
    const renderedHeadings = parseRenderedHeadings(html);

    expect(outline).toHaveLength(3);
    expect(renderedHeadings).toHaveLength(3);

    expect(outline[0].slug).toBe('-欢迎使用-markdown-');
    expect(renderedHeadings[0].id).toBe('-欢迎使用-markdown-');
    expect(outline[0].line).toBe(1);
    expect(renderedHeadings[0].dataLine).toBe(1);

    expect(outline[1].slug).toBe('-核心功能特性');
    expect(renderedHeadings[1].id).toBe('-核心功能特性');
    expect(outline[1].line).toBe(4);
    expect(renderedHeadings[1].dataLine).toBe(4);

    expect(outline[2].slug).toBe('-原生级体验-');
    expect(renderedHeadings[2].id).toBe('-原生级体验-');
    expect(outline[2].line).toBe(7);
    expect(renderedHeadings[2].dataLine).toBe(7);
  });

  it('should synchronize headings starting with digits and numbers', () => {
    const md = `# 123 Start with number
Content

## 2.1 Nested Subsection
More content

### 2024 Year in Review
Details`;

    const outline = extractOutline(md);
    const html = renderMarkdownPreview(md);
    const renderedHeadings = parseRenderedHeadings(html);

    expect(outline).toHaveLength(3);
    expect(renderedHeadings).toHaveLength(3);

    expect(outline[0].slug).toBe('123-start-with-number');
    expect(renderedHeadings[0].id).toBe('123-start-with-number');
    expect(outline[0].line).toBe(1);

    expect(outline[1].slug).toBe('21-nested-subsection');
    expect(renderedHeadings[1].id).toBe('21-nested-subsection');
    expect(outline[1].line).toBe(4);

    expect(outline[2].slug).toBe('2024-year-in-review');
    expect(renderedHeadings[2].id).toBe('2024-year-in-review');
    expect(outline[2].line).toBe(7);
  });

  it('should synchronize headings containing punctuation and symbols (C++, C#, etc.)', () => {
    const md = `# C++ & C# Programming Guide
Language guide

## Questions? (Yes/No!)
FAQ

### Price: $100 & 50% Off!
Discount`;

    const outline = extractOutline(md);
    const html = renderMarkdownPreview(md);
    const renderedHeadings = parseRenderedHeadings(html);

    expect(outline).toHaveLength(3);
    expect(renderedHeadings).toHaveLength(3);

    expect(outline[0].slug).toBe('c--c-programming-guide');
    expect(renderedHeadings[0].id).toBe('c--c-programming-guide');

    expect(outline[1].slug).toBe('questions-yesno');
    expect(renderedHeadings[1].id).toBe('questions-yesno');

    expect(outline[2].slug).toBe('price-100--50-off');
    expect(renderedHeadings[2].id).toBe('price-100--50-off');
  });

  it('should synchronize duplicate headings with matching incremental suffixes', () => {
    const md = `# Section
## Overview
# Section
## Overview
# Section`;

    const outline = extractOutline(md);
    const html = renderMarkdownPreview(md);
    const renderedHeadings = parseRenderedHeadings(html);

    expect(outline).toHaveLength(5);
    expect(renderedHeadings).toHaveLength(5);

    expect(outline[0].slug).toBe('section');
    expect(renderedHeadings[0].id).toBe('section');

    expect(outline[1].slug).toBe('overview');
    expect(renderedHeadings[1].id).toBe('overview');

    expect(outline[2].slug).toBe('section-1');
    expect(renderedHeadings[2].id).toBe('section-1');

    expect(outline[3].slug).toBe('overview-1');
    expect(renderedHeadings[3].id).toBe('overview-1');

    expect(outline[4].slug).toBe('section-2');
    expect(renderedHeadings[4].id).toBe('section-2');
  });

  it('should synchronize Setext headings with markdown rendering', () => {
    const md = `Main Setext Heading 🚀
=====================

Some body text

Sub Setext 123 & 456
--------------------`;

    const outline = extractOutline(md);
    const html = renderMarkdownPreview(md);
    const renderedHeadings = parseRenderedHeadings(html);

    expect(outline).toHaveLength(2);
    expect(renderedHeadings).toHaveLength(2);

    expect(outline[0].slug).toBe('main-setext-heading-');
    expect(renderedHeadings[0].id).toBe('main-setext-heading-');
    expect(outline[0].line).toBe(1);
    expect(renderedHeadings[0].dataLine).toBe(1);

    expect(outline[1].slug).toBe('sub-setext-123--456');
    expect(renderedHeadings[1].id).toBe('sub-setext-123--456');
    expect(outline[1].line).toBe(6);
    expect(renderedHeadings[1].dataLine).toBe(6);
  });

  it('should clean inline markdown formatting from heading text and match slugs', () => {
    const md = `# [Link Text](https://example.com) and **Bold** and *Italic* and \`Code\` and ~~Strike~~
Body text

## Trailing Hashes ###`;

    const outline = extractOutline(md);
    const html = renderMarkdownPreview(md);
    const renderedHeadings = parseRenderedHeadings(html);

    expect(outline).toHaveLength(2);
    expect(renderedHeadings).toHaveLength(2);

    expect(outline[0].text).toBe('Link Text and Bold and Italic and Code and Strike');
    expect(outline[0].slug).toBe('link-text-and-bold-and-italic-and-code-and-strike');
    expect(renderedHeadings[0].id).toBe('link-text-and-bold-and-italic-and-code-and-strike');

    expect(outline[1].text).toBe('Trailing Hashes');
    expect(outline[1].slug).toBe('trailing-hashes');
    expect(renderedHeadings[1].id).toBe('trailing-hashes');
  });
});
