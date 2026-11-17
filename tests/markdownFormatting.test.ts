import { describe, it, expect } from 'vitest';
import { EditorState } from '@codemirror/state';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import {
  findInlineFormatMarkers,
  getActiveMarkdownFormats,
} from '../src/lib/markdownFormatting';

function createState(doc: string, from = 0, to = from): EditorState {
  return EditorState.create({
    doc,
    selection: { anchor: from, head: to },
    extensions: [markdown({ base: markdownLanguage })],
  });
}

describe('getActiveMarkdownFormats', () => {
  it('reports ATX heading levels for a caret', () => {
    expect(getActiveMarkdownFormats(createState('# One', 3))).toEqual(['h1']);
    expect(getActiveMarkdownFormats(createState('### Three', 5))).toEqual(['h3']);
    expect(getActiveMarkdownFormats(createState('###### Six', 8))).toEqual(['h6']);
  });

  it('reports Setext headings', () => {
    expect(getActiveMarkdownFormats(createState('Title\n=====', 2))).toEqual(['h1']);
    expect(getActiveMarkdownFormats(createState('Title\n-----', 2))).toEqual(['h2']);
  });

  it('reports inline emphasis, inline code and links', () => {
    expect(getActiveMarkdownFormats(createState('a **bold** b', 6))).toEqual(['bold']);
    expect(getActiveMarkdownFormats(createState('a *italic* b', 5))).toEqual(['italic']);
    expect(getActiveMarkdownFormats(createState('a ~~strike~~ b', 6))).toEqual(['strike']);
    expect(getActiveMarkdownFormats(createState('a `code` b', 5))).toEqual(['inline-code']);
    expect(getActiveMarkdownFormats(createState('see [link](https://example.com)', 6))).toEqual([
      'link',
    ]);
  });

  it('combines nested formats such as bold inside a heading', () => {
    const doc = '## Title **bold**';
    expect(getActiveMarkdownFormats(createState(doc, doc.indexOf('bold') + 1))).toEqual([
      'h2',
      'bold',
    ]);
  });

  it('ignores formatting lookalikes inside inline code and fenced code', () => {
    const inline = 'use `**fake** and [link](https://x.y)` here';
    expect(getActiveMarkdownFormats(createState(inline, inline.indexOf('fake')))).toEqual([
      'inline-code',
    ]);

    const fenced = '```js\nconst x = "**fake** [link](https://x.y)";\n```';
    expect(getActiveMarkdownFormats(createState(fenced, fenced.indexOf('fake')))).toEqual([
      'code-block',
    ]);
  });

  it('reports blockquotes and blocks nested inside them', () => {
    expect(getActiveMarkdownFormats(createState('> quoted', 4))).toEqual(['quote']);
    expect(getActiveMarkdownFormats(createState('> # heading', 5))).toEqual(['h1', 'quote']);
    expect(getActiveMarkdownFormats(createState('> - item', 5))).toEqual(['quote', 'ul']);
  });

  it('reports headings nested inside quotes and list items', () => {
    const quotedHeading = '> ## heading in quote';
    expect(getActiveMarkdownFormats(createState(quotedHeading, 8))).toEqual(['h2', 'quote']);

    const listHeading = '- ### heading in list';
    expect(getActiveMarkdownFormats(createState(listHeading, 8))).toEqual(['h3', 'ul']);

    const quoteInList = '- > nested quote';
    expect(getActiveMarkdownFormats(createState(quoteInList, 10))).toEqual(['quote', 'ul']);
  });

  it('reports lists and distinguishes task list items', () => {
    expect(getActiveMarkdownFormats(createState('- item', 3))).toEqual(['ul']);
    expect(getActiveMarkdownFormats(createState('1. item', 4))).toEqual(['ol']);
    expect(getActiveMarkdownFormats(createState('- [ ] task', 8))).toEqual(['ul', 'task']);
    expect(getActiveMarkdownFormats(createState('- parent\n  - child', 15))).toEqual(['ul']);
  });

  it('applies block formats to every line touched by the selection', () => {
    expect(getActiveMarkdownFormats(createState('- one\n- two', 2, 10))).toEqual(['ul']);
    const headingAndParagraph = '# Title\n\nplain';
    expect(getActiveMarkdownFormats(createState(headingAndParagraph, 1, 14))).toEqual([]);
  });

  it('does not claim a format for a mixed inline selection', () => {
    const mixed = 'a **bold** and plain';
    expect(getActiveMarkdownFormats(createState(mixed, 4, 15))).not.toContain('bold');

    const twoRuns = '**a** and **b**';
    expect(getActiveMarkdownFormats(createState(twoRuns, 1, 13))).not.toContain('bold');
  });

  it('keeps a format active when the whole selection sits inside one node', () => {
    expect(getActiveMarkdownFormats(createState('a **bold** b', 4, 7))).toEqual(['bold']);
  });

  it('returns nothing for plain text, images and empty documents', () => {
    expect(getActiveMarkdownFormats(createState('just text', 4))).toEqual([]);
    expect(getActiveMarkdownFormats(createState('![alt](https://x.y/image.png)', 6))).toEqual([]);
    expect(getActiveMarkdownFormats(createState('', 0))).toEqual([]);
  });

  it('handles a caret at the end of the document', () => {
    expect(getActiveMarkdownFormats(createState('# Title', 7))).toEqual(['h1']);
    expect(getActiveMarkdownFormats(createState('text\n', 5))).toEqual([]);
  });

  it('reuses the result for the same editor state', () => {
    const state = createState('a **bold** b', 6);
    const first = getActiveMarkdownFormats(state);
    expect(getActiveMarkdownFormats(state)).toBe(first);
  });

  it('does not treat list markers inside fenced code as lists', () => {
    const doc = '```\n- [ ] not a task\n```';
    expect(getActiveMarkdownFormats(createState(doc, doc.indexOf('not')))).toEqual(['code-block']);
  });
});

describe('findInlineFormatMarkers', () => {
  it('returns only the delimiters of the enclosing format', () => {
    expect(findInlineFormatMarkers(createState('**bold**', 3), 3, 3, 'bold')).toEqual([
      { from: 0, to: 2 },
      { from: 6, to: 8 },
    ]);
    expect(findInlineFormatMarkers(createState('__bold__', 3), 3, 3, 'bold')).toEqual([
      { from: 0, to: 2 },
      { from: 6, to: 8 },
    ]);
    expect(findInlineFormatMarkers(createState('_italic_', 3), 3, 3, 'italic')).toEqual([
      { from: 0, to: 1 },
      { from: 7, to: 8 },
    ]);
    expect(findInlineFormatMarkers(createState('~~strike~~', 4), 4, 4, 'strike')).toEqual([
      { from: 0, to: 2 },
      { from: 8, to: 10 },
    ]);
  });

  it('separates nested bold and italic delimiters', () => {
    const both = createState('***both***', 4);
    expect(findInlineFormatMarkers(both, 4, 4, 'bold')).toEqual([
      { from: 1, to: 3 },
      { from: 7, to: 9 },
    ]);
    expect(findInlineFormatMarkers(both, 4, 4, 'italic')).toEqual([
      { from: 0, to: 1 },
      { from: 9, to: 10 },
    ]);

    const nested = createState('a **bold _italic_** b', 12);
    expect(findInlineFormatMarkers(nested, 12, 12, 'bold')).toEqual([
      { from: 2, to: 4 },
      { from: 17, to: 19 },
    ]);
    expect(findInlineFormatMarkers(nested, 12, 12, 'italic')).toEqual([
      { from: 9, to: 10 },
      { from: 16, to: 17 },
    ]);
  });

  it('handles variable-length backtick delimiters', () => {
    const state = createState('``a ` b``', 4);
    expect(findInlineFormatMarkers(state, 4, 4, 'inline-code')).toEqual([
      { from: 0, to: 2 },
      { from: 7, to: 9 },
    ]);
  });

  it('supports selections that only partially cover the formatted text', () => {
    expect(findInlineFormatMarkers(createState('**bold text**', 2, 6), 2, 6, 'bold')).toEqual([
      { from: 0, to: 2 },
      { from: 11, to: 13 },
    ]);
  });

  it('never reports markdown lookalikes inside code', () => {
    expect(findInlineFormatMarkers(createState('`**fake**`', 4), 4, 4, 'bold')).toEqual([]);
    const fenced = '```\n**fake**\n```';
    expect(findInlineFormatMarkers(createState(fenced, 8), 8, 8, 'bold')).toEqual([]);
    expect(findInlineFormatMarkers(createState('plain ** text', 8), 8, 8, 'bold')).toEqual([]);
  });
});
