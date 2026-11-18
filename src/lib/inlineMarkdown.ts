import type { SyntaxNode } from '@lezer/common';
import type { MarkdownParser } from '@lezer/markdown';
import { markdownLanguage } from '@codemirror/lang-markdown';
import { editorMarkdownFallbacks, isHtmlLineBreak } from '@/lib/editorMarkdown';

/**
 * Display-only inline Markdown for surfaces that cannot run the full editor
 * decorations (visual table cells). Runs are produced by the same Lezer parser
 * the editor uses, including its CJK-friendly emphasis rules, so a cell renders
 * exactly like the surrounding prose. Nothing here rewrites the source.
 */

export type InlineRunType = 'text' | 'strong' | 'emphasis' | 'strike' | 'code' | 'link' | 'math' | 'break';

export interface InlineRun {
  type: InlineRunType;
  text?: string;
  children?: InlineRun[];
}

/** Cells above this size stay raw text; parsing them is not worth the lag. */
export const MAX_INLINE_RENDER_BYTES = 4000;

const inlineParser = (markdownLanguage.parser as MarkdownParser).configure(editorMarkdownFallbacks);

function textRun(text: string): InlineRun[] {
  return text ? [{ type: 'text', text }] : [];
}

function codeTextOf(source: string, node: SyntaxNode): string {
  const marks: SyntaxNode[] = [];
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.name === 'CodeMark') marks.push(child);
  }
  if (marks.length >= 2) {
    return source.slice(marks[0].to, marks[marks.length - 1].from);
  }
  return source.slice(node.from, node.to);
}

function convert(source: string, node: SyntaxNode, renderHtml: boolean): InlineRun[] {
  switch (node.name) {
    case 'Text':
      return textRun(source.slice(node.from, node.to));
    case 'Escape':
      return textRun(source.slice(node.from + 1, node.to));
    case 'HardBreak':
    case 'SoftBreak':
      return textRun(' ');
    case 'HTMLTag':
    case 'HTMLBlock': {
      const text = source.slice(node.from, node.to);
      return renderHtml && isHtmlLineBreak(text) ? [{ type: 'break' }] : textRun(text);
    }
    case 'StrongEmphasis':
      return [{ type: 'strong', children: walk(source, node, renderHtml) }];
    case 'Emphasis':
      return [{ type: 'emphasis', children: walk(source, node, renderHtml) }];
    case 'Strikethrough':
      return [{ type: 'strike', children: walk(source, node, renderHtml) }];
    case 'InlineCode':
      return [{ type: 'code', text: codeTextOf(source, node) }];
    case 'InlineMath':
      return [{ type: 'math', text: source.slice(node.from, node.to) }];
    case 'Image':
      // Images never reach a rendered table (the table falls back to source),
      // so only their description is ever displayed here.
      return textRun(source.slice(node.from + 2, Math.min(node.to, node.from + 162)));
    case 'Link':
      return [{ type: 'link', children: walk(source, node, renderHtml) }];
    case 'EmphasisMark':
    case 'StrikethroughMark':
    case 'CodeMark':
    case 'LinkMark':
    case 'URL':
    case 'LinkTitle':
      return [];
    default:
      return node.firstChild ? walk(source, node, renderHtml) : textRun(source.slice(node.from, node.to));
  }
}

function walk(source: string, parent: SyntaxNode, renderHtml: boolean): InlineRun[] {
  const runs: InlineRun[] = [];
  let position = parent.from;
  for (let child = parent.firstChild; child; child = child.nextSibling) {
    if (child.from > position) runs.push(...textRun(source.slice(position, child.from)));
    runs.push(...convert(source, child, renderHtml));
    position = Math.max(position, child.to);
  }
  if (position < parent.to) runs.push(...textRun(source.slice(position, parent.to)));
  return runs;
}

function mergeText(runs: InlineRun[]): InlineRun[] {
  const merged: InlineRun[] = [];
  for (const run of runs) {
    const previous = merged[merged.length - 1];
    if (run.type === 'text' && previous?.type === 'text') {
      merged[merged.length - 1] = { type: 'text', text: `${previous.text ?? ''}${run.text ?? ''}` };
    } else if (run.type === 'text' && !run.text) {
      continue;
    } else {
      merged.push(run);
    }
  }
  return merged;
}

/** Pure inline runs for one cell/paragraph; never returns raw HTML. */
export function parseInlineMarkdown(source: string, renderHtml = false): InlineRun[] {
  if (!source.trim()) return [];
  if (source.length > MAX_INLINE_RENDER_BYTES) return [{ type: 'text', text: source }];
  const tree = inlineParser.parse(source);
  return mergeText(walk(source, tree.topNode, renderHtml));
}

const RUN_ELEMENTS: Record<Exclude<InlineRunType, 'text' | 'break'>, [string, string]> = {
  strong: ['strong', 'cm-inline-strong'],
  emphasis: ['em', 'cm-inline-emphasis'],
  strike: ['del', 'cm-inline-strike'],
  code: ['code', 'cm-inline-code'],
  link: ['span', 'cm-inline-link'],
  math: ['span', 'cm-inline-math'],
};

/** Builds safe DOM (textContent only) from runs; no innerHTML anywhere. */
export function renderInlineRuns(document: Document, runs: readonly InlineRun[]): DocumentFragment {
  const fragment = document.createDocumentFragment();
  for (const run of runs) {
    if (run.type === 'text') {
      if (run.text) fragment.append(document.createTextNode(run.text));
      continue;
    }
    if (run.type === 'break') {
      fragment.append(document.createElement('br'));
      continue;
    }
    const [tag, className] = RUN_ELEMENTS[run.type];
    const element = document.createElement(tag);
    element.className = className;
    if (run.children) element.append(renderInlineRuns(document, run.children));
    else element.textContent = run.text ?? '';
    fragment.append(element);
  }
  return fragment;
}

/** Convenience wrapper for widgets that already own the cell element. */
export function renderInlineMarkdownInto(element: HTMLElement, source: string, renderHtml = false): void {
  element.replaceChildren(renderInlineRuns(element.ownerDocument, parseInlineMarkdown(source, renderHtml)));
}
