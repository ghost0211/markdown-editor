import { describe, it, expect } from 'vitest';
import { EditorState } from '@codemirror/state';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { ensureSyntaxTree, syntaxTree } from '@codemirror/language';
import { history, undo } from '@codemirror/commands';
import { Decoration, type DecorationSet } from '@codemirror/view';
import { editorMarkdownFallbacks } from '../src/lib/editorMarkdown';
import { collectVisualCodeBlocks, createVisualCodeBlockExtension, visualCodeBlockField } from '../src/lib/visualCodeBlocks';
import { parseInlineMarkdown } from '../src/lib/inlineMarkdown';
import { buildVisualDecorations, createVisualEditingExtension } from '../src/lib/visualEditing';

const labels = {
  label: 'Code block', copy: 'Copy', copied: 'Copied', copyFailed: 'Copy failed',
  mermaidRendering: 'Rendering', mermaidError: 'Syntax error',
};

function makeState(doc: string, at = doc.length) {
  const state = EditorState.create({
    doc,
    selection: { anchor: at },
    extensions: [
      history(),
      markdown({ base: markdownLanguage, extensions: editorMarkdownFallbacks }),
      createVisualCodeBlockExtension(labels),
      createVisualEditingExtension({
        taskToggle: 'Toggle', imageEdit: 'Edit', imageLoading: 'Loading', imageFailed: 'Failed',
      }),
    ],
  });
  ensureSyntaxTree(state, doc.length, 1000);
  return state.update({}).state;
}

function names(state: EditorState): string[] {
  const out: string[] = [];
  syntaxTree(state).iterate({ enter: (node) => { out.push(node.name); } });
  return out;
}

function ranges(decorations: DecorationSet) {
  const result: Array<{ from: number; to: number; spec: Decoration['spec'] }> = [];
  decorations.between(0, 1_000_000, (from, to, decoration) => { result.push({ from, to, spec: decoration.spec }); });
  return result;
}

describe('CJK-friendly emphasis parsing', () => {
  it('parses emphasis wrapped in Chinese quotation marks', () => {
    const state = makeState('采用**“双下拉字典级联选择”**的极简架构：');
    expect(names(state)).toContain('StrongEmphasis');
    const tree = syntaxTree(state);
    let bold: { from: number; to: number } | null = null;
    tree.iterate({ enter: (node) => { if (node.name === 'StrongEmphasis') bold = { from: node.from, to: node.to }; } });
    expect(bold).toEqual({ from: 2, to: 17 });
  });

  it('renders CJK-quoted bold through the visual decorations', () => {
    const state = makeState('前文**“标题”**后文');
    const decorations: Array<{ from: number; to: number; className?: string }> = [];
    buildVisualDecorations({ state, visibleRanges: [{ from: 0, to: state.doc.length }] }).between(0, 999, (from, to, decoration) => {
      decorations.push({ from, to, className: decoration.spec.class });
    });
    expect(decorations.some((item) => item.className === 'cm-visual-strong')).toBe(true);
  });

  it('leaves ordinary, escaped, code-span and long-run emphasis untouched', () => {
    for (const [doc, expected] of [
      ['**粗体**、*斜体*', ['StrongEmphasis', 'Emphasis']],
      ['\\*非粗体*', []],
      ['`**code**`', []],
      ['***both***', ['Emphasis', 'StrongEmphasis']],
      ['**a*b**c*', ['StrongEmphasis']],
    ] as const) {
      const found = names(makeState(doc)).filter((name) => name === 'StrongEmphasis' || name === 'Emphasis');
      expect(found.sort()).toEqual([...expected].sort());
    }
    expect(names(makeState('中文**加粗**后文'))).toContain('StrongEmphasis');
  });

  it('pairs bracket-closing emphasis before following text on the same line', () => {
    for (const doc of ['**重点（备注）**后文', '**零手输编码（字典级联驱动）**X', '**“独立引号”**']) {
      expect(names(makeState(doc)), doc).toContain('StrongEmphasis');
    }
  });

  it('does not change the document text', () => {
    const doc = '采用**“双下拉”**的极简架构：';
    expect(makeState(doc).doc.toString()).toBe(doc);
  });
});

describe('visual code blocks', () => {
  it('replaces top-level fences with a code box while the cursor is elsewhere', () => {
    const doc = '```js\nconst a = 1\n```\n\nend';
    const state = makeState(doc, doc.length);
    const rendered = ranges(state.field(visualCodeBlockField).decorations);
    expect(rendered).toHaveLength(1);
    expect(rendered[0].from).toBe(0);
    expect(rendered[0].to).toBe(doc.indexOf('\n\n'));
    expect(rendered[0].spec.block).toBe(true);
    expect(state.doc.toString()).toBe(doc);
  });

  it('reveals the exact source as soon as the cursor enters the block', () => {
    const doc = '```js\nconst a = 1\n```\n\nend';
    const state = makeState(doc).update({ selection: { anchor: doc.indexOf('const') } }).state;
    expect(ranges(state.field(visualCodeBlockField).decorations)).toEqual([]);
    expect(state.doc.toString()).toBe(doc);
  });

  it('captures fenced language and mermaid; indented code stays source', () => {
    const doc = '```mermaid\nflowchart TD\n A-->B\n```\n\n    indented\n\nend';
    const blocks = collectVisualCodeBlocks(makeState(doc));
    // Indented code starts mid-line, so it keeps its source instead of a box
    // that would displace the four-space marker.
    expect(blocks.map((block) => block.language)).toEqual(['mermaid']);
    expect(blocks).toHaveLength(1);
    expect(makeState(doc).doc.toString()).toBe(doc);
  });

  it('keeps blocks inside lists and quotes as source', () => {
    for (const doc of ['> ```js\n> a\n> ```\n\nend', '- ```js\n  a\n  ```\n\nend']) {
      expect(collectVisualCodeBlocks(makeState(doc))).toEqual([]);
    }
  });

  it('falls back for oversized blocks', () => {
    const doc = '```text\n' + 'x'.repeat(200_001) + '\n```\n\nend';
    expect(collectVisualCodeBlocks(makeState(doc))).toEqual([]);
  });

  it('does not decorate unparsed or front-matter content', () => {
    const doc = '---\ncode: ```\n---\n\nend';
    expect(collectVisualCodeBlocks(makeState(doc))).toEqual([]);
  });

  it('is undo-safe: toggling selection and undo never changes the source', () => {
    const doc = '```js\nconst a = 1\n```\n\nend';
    let state = makeState(doc).update({ changes: { from: doc.length, insert: '!' } }).state;
    state = state.update({ selection: { anchor: 2 } }).state;
    expect(ranges(state.field(visualCodeBlockField).decorations)).toEqual([]);
    undo({ state, dispatch: (transaction) => { state = transaction.state; } });
    expect(state.doc.toString()).toBe(doc);
  });
});

describe('inline Markdown runs for table cells', () => {
  type Flat = { type: string; text?: string };
  function flatten(runs: ReturnType<typeof parseInlineMarkdown>): Flat[] {
    return runs.flatMap((run) => run.children
      ? [{ type: run.type }, ...flatten(run.children)]
      : [{ type: run.type, text: run.text }]);
  }

  it('renders bold, italic, strike, code and link children as runs', () => {
    const runs = flatten(parseInlineMarkdown('**加粗** *斜体* ~~删除~~ `code` [链接](https://example.com)'));
    expect(runs.filter((run) => run.type !== 'text').map((run) => run.type)).toEqual(
      ['strong', 'emphasis', 'strike', 'code', 'link']
    );
    expect(runs.some((run) => run.text === '加粗')).toBe(true);
    expect(runs.some((run) => run.text === '链接')).toBe(true);
    expect(JSON.stringify(runs)).not.toContain('https://example.com');
  });

  it('renders CJK-quoted emphasis inside a cell', () => {
    const runs = flatten(parseInlineMarkdown('**零手输编码（字典级联驱动）**'));
    expect(runs[0].type).toBe('strong');
  });

  it('keeps escaped markers and code spans literal', () => {
    const runs = flatten(parseInlineMarkdown('\\*不是斜体* 与 `**不是粗体**`'));
    expect(runs.some((run) => run.type === 'emphasis')).toBe(false);
    expect(runs.some((run) => run.type === 'strong')).toBe(false);
    expect(runs.some((run) => run.type === 'code' && run.text === '**不是粗体**')).toBe(true);
  });

  it('returns plain text for empty and oversized input without throwing', () => {
    expect(parseInlineMarkdown('')).toEqual([]);
    const huge = 'x'.repeat(4001);
    expect(parseInlineMarkdown(huge)).toEqual([{ type: 'text', text: huge }]);
  });
});
