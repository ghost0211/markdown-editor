import { describe, it, expect } from 'vitest';
import { extractOutline, slugify } from '../src/lib/outline';

describe('Outline extraction', () => {
  it('should slugify texts correctly following GitHub slug rules', () => {
    expect(slugify('Hello World')).toBe('hello-world');
    expect(slugify('### 欢迎使用 Tauri 2')).toBe('欢迎使用-tauri-2');
    expect(slugify('Special [Link](https://test.com) **Bold**')).toBe('special-link-bold');
    expect(slugify('📑 核心功能特性')).toBe('-核心功能特性');
    expect(slugify('欢迎使用 Markdown Editor 🚀')).toBe('欢迎使用-markdown-editor-');
    expect(slugify('123 Start with number')).toBe('123-start-with-number');
    expect(slugify('C++ & C#')).toBe('c--c');
  });

  it('should extract ATX headings with line numbers and levels', () => {
    const md = `# Title
Some paragraph text

## Section 1
Content here

### Subsection 1.1
More content

## Section 2
Final content`;

    const outline = extractOutline(md);
    expect(outline).toHaveLength(4);
    expect(outline[0]).toMatchObject({
      level: 1,
      text: 'Title',
      line: 1,
    });
    expect(outline[1]).toMatchObject({
      level: 2,
      text: 'Section 1',
      line: 4,
    });
    expect(outline[2]).toMatchObject({
      level: 3,
      text: 'Subsection 1.1',
      line: 7,
    });
    expect(outline[3]).toMatchObject({
      level: 2,
      text: 'Section 2',
      line: 10,
    });
  });

  it('should ignore headings inside code blocks', () => {
    const md = `# Real Heading 1

\`\`\`markdown
# Fake Heading in Code Block
## Fake Heading 2
\`\`\`

## Real Heading 2
`;
    const outline = extractOutline(md);
    expect(outline).toHaveLength(2);
    expect(outline[0].text).toBe('Real Heading 1');
    expect(outline[1].text).toBe('Real Heading 2');
  });

  it('should support Setext headings', () => {
    const md = `Main Heading
============

Sub Heading
-----------

Regular paragraph`;

    const outline = extractOutline(md);
    expect(outline).toHaveLength(2);
    expect(outline[0]).toMatchObject({
      level: 1,
      text: 'Main Heading',
      line: 1,
    });
    expect(outline[1]).toMatchObject({
      level: 2,
      text: 'Sub Heading',
      line: 4,
    });
  });

  it('should handle duplicate headings with unique slugs', () => {
    const md = `# Section
## Introduction
# Section
## Introduction`;

    const outline = extractOutline(md);
    expect(outline).toHaveLength(4);
    expect(outline[0].slug).toBe('section');
    expect(outline[2].slug).toBe('section-1');
    expect(outline[1].slug).toBe('introduction');
    expect(outline[3].slug).toBe('introduction-1');
  });

  it('should return empty array for empty markdown text', () => {
    expect(extractOutline('')).toEqual([]);
    expect(extractOutline('Just normal paragraph without headings')).toEqual([]);
  });
});
