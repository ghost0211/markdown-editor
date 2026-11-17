import type { EditorState } from '@codemirror/state';
import { ensureSyntaxTree, syntaxTree, syntaxTreeAvailable } from '@codemirror/language';
import type { SyntaxNode } from '@lezer/common';
import type { MarkdownAction } from './markdownCommands';

/** Stable order used by the toolbar to render and read active formats. */
const ACTION_ORDER: readonly MarkdownAction[] = [
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'bold',
  'italic',
  'strike',
  'inline-code',
  'code-block',
  'quote',
  'ul',
  'ol',
  'task',
  'link',
];

const HEADING_LEVELS: Record<string, number> = {
  ATXHeading1: 1,
  ATXHeading2: 2,
  ATXHeading3: 3,
  ATXHeading4: 4,
  ATXHeading5: 5,
  ATXHeading6: 6,
  SetextHeading1: 1,
  SetextHeading2: 2,
};

/**
 * Leaf formats are only reported when a single syntax node covers the whole
 * selection, so a mixed selection (half bold, half plain) does not claim bold.
 */
const INLINE_FORMATS: Record<string, MarkdownAction> = {
  StrongEmphasis: 'bold',
  Emphasis: 'italic',
  Strikethrough: 'strike',
  InlineCode: 'inline-code',
  Link: 'link',
};

/** Syntax node that wraps an inline format whose delimiters can be removed. */
const MARK_NODE_ACTIONS: Record<string, MarkdownAction> = {
  StrongEmphasis: 'bold',
  Emphasis: 'italic',
  Strikethrough: 'strike',
  InlineCode: 'inline-code',
};

/** Delimiter nodes produced by the Lezer Markdown grammar. */
const MARK_CHILD_NAMES: ReadonlySet<string> = new Set([
  'EmphasisMark',
  'StrikethroughMark',
  'CodeMark',
]);

const MARK_ACTIONS: ReadonlySet<MarkdownAction> = new Set(Object.values(MARK_NODE_ACTIONS));

export interface MarkdownMarkerRange {
  from: number;
  to: number;
}

interface SelectedLine {
  from: number;
  to: number;
}

type SyntaxTree = ReturnType<typeof syntaxTree>;

/**
 * Returns the syntax tree for the requested position without reparsing what is
 * already available. Repeated calls for the same editor state (for example on
 * scroll updates) therefore do no parse work.
 */
function syntaxTreeUpTo(state: EditorState, upto: number): SyntaxTree {
  const limit = Math.max(0, Math.min(state.doc.length, upto));
  if (syntaxTreeAvailable(state, limit)) return syntaxTree(state);
  return ensureSyntaxTree(state, limit, 50) ?? syntaxTree(state);
}

function selectLines(state: EditorState, from: number, to: number): SelectedLine[] {
  const startLine = state.doc.lineAt(from);
  let endLine = state.doc.lineAt(to);
  // A selection ending right after a newline does not include the next line.
  if (to > from && endLine.from === to && endLine.number > startLine.number) {
    endLine = state.doc.line(endLine.number - 1);
  }
  const lines: SelectedLine[] = [];
  for (let lineNumber = startLine.number; lineNumber <= endLine.number; lineNumber++) {
    const line = state.doc.line(lineNumber);
    lines.push({ from: line.from, to: line.to });
  }
  return lines;
}

function blockFormatsAt(tree: SyntaxTree, line: SelectedLine): Set<MarkdownAction> {
  const formats = new Set<MarkdownAction>();
  if (tree.length === 0) return formats;
  // Sample both ends of the line: the left edge can sit inside a block marker
  // (quote/list) while the right edge reaches nested blocks such as a heading
  // inside a blockquote or list item.
  const samples: Array<{ position: number; bias: 1 | -1 }> = [
    { position: line.from, bias: 1 },
    { position: line.to, bias: -1 },
  ];
  for (const sample of samples) {
    const position = Math.min(Math.max(sample.position, 0), tree.length);
    let node: SyntaxNode | null = tree.resolveInner(position, sample.bias);
    for (; node; node = node.parent) {
      const headingLevel = HEADING_LEVELS[node.name];
      if (headingLevel) {
        formats.add(`h${headingLevel}` as MarkdownAction);
      }
      switch (node.name) {
        case 'Blockquote':
          formats.add('quote');
          break;
        case 'FencedCode':
        case 'CodeBlock':
          formats.add('code-block');
          break;
        case 'BulletList':
          formats.add('ul');
          break;
        case 'OrderedList':
          formats.add('ol');
          break;
        case 'Task':
          formats.add('task');
          break;
        default:
          break;
      }
    }
  }
  return formats;
}

/** Cached per EditorState: scroll updates reuse the same state object. */
const activeFormatsCache = new WeakMap<EditorState, MarkdownAction[]>();

function computeActiveFormats(state: EditorState): MarkdownAction[] {
  const selection = state.selection.main;
  const from = selection.from;
  const to = selection.to;
  const tree = syntaxTreeUpTo(state, to + 2000);
  if (tree.length === 0) return [];
  // Parse budget exhausted before the selection: formats are unknown.
  if (tree.length < to) return [];

  const active = new Set<MarkdownAction>();

  tree.iterate({
    from,
    to,
    enter: (node) => {
      if (node.from > from || node.to < to) return;
      const format = INLINE_FORMATS[node.name];
      if (format) active.add(format);
    },
  });

  let sharedBlocks: Set<MarkdownAction> | null = null;
  for (const line of selectLines(state, from, to)) {
    const blocks = blockFormatsAt(tree, line);
    if (!sharedBlocks) {
      sharedBlocks = blocks;
      continue;
    }
    for (const action of [...sharedBlocks]) {
      if (!blocks.has(action)) sharedBlocks.delete(action);
    }
  }
  if (sharedBlocks) {
    for (const action of sharedBlocks) active.add(action);
  }

  return ACTION_ORDER.filter((action) => active.has(action));
}

/**
 * Returns the Markdown formats that currently apply to the main selection.
 *
 * The result is derived from the Markdown syntax tree, so syntax that only
 * looks like formatting inside code blocks/spans (for example `**not bold**`
 * inside fences) is ignored. Nested formats are combined (a bold heading
 * reports both `hN` and `bold`), while formats that cover only part of a mixed
 * selection are not reported. Block formats (heading, quote, list, code block)
 * must apply to every line touched by the selection.
 */
export function getActiveMarkdownFormats(state: EditorState): MarkdownAction[] {
  const cached = activeFormatsCache.get(state);
  if (cached) return cached;
  const result = computeActiveFormats(state);
  activeFormatsCache.set(state, result);
  return result;
}

/**
 * Returns the delimiter ranges of the inline format that wraps the given range
 * according to the Markdown syntax tree. An empty result means the range is not
 * inside that format, which also filters out Markdown look-alikes inside code.
 *
 * Only the delimiters are returned, so toggling a format off never has to copy
 * the wrapped content (important for multi-megabyte data URLs).
 */
export function findInlineFormatMarkers(
  state: EditorState,
  from: number,
  to: number,
  action: MarkdownAction
): MarkdownMarkerRange[] {
  if (!MARK_ACTIONS.has(action)) return [];
  // The closing delimiter lives at the end of the format node, which may be far
  // past the caret (a wrapped data URL), so parse to the end of the document.
  const tree = syntaxTreeUpTo(state, state.doc.length);
  if (tree.length === 0) return [];

  const selectionFrom = Math.max(0, Math.min(from, tree.length));
  const selectionTo = Math.max(selectionFrom, Math.min(to, tree.length));
  const candidates: SyntaxNode[] = [];
  tree.iterate({
    from: selectionFrom,
    to: selectionTo,
    enter: (node) => {
      if (node.from > selectionFrom || node.to < selectionTo) return;
      if (MARK_NODE_ACTIONS[node.name] !== action) return;
      candidates.push(node.node);
    },
  });
  if (candidates.length === 0) return [];

  const target = candidates.reduce((smallest, node) =>
    node.to - node.from < smallest.to - smallest.from ? node : smallest
  );
  const markers: MarkdownMarkerRange[] = [];
  for (let child = target.firstChild; child; child = child.nextSibling) {
    if (MARK_CHILD_NAMES.has(child.name)) {
      markers.push({ from: child.from, to: child.to });
    }
  }
  return markers.length >= 2 ? markers : [];
}
