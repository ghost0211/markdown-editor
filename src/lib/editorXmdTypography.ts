import { isolateHistory } from '@codemirror/commands';
import { EditorSelection, type EditorState, type Text, type TransactionSpec } from '@codemirror/state';
import type { SyntaxNode, Tree } from '@lezer/common';
import { isVisualOpaqueRange, visualSyntaxTreeUpTo } from './visualSelectionCore';
import {
  hasXmdTypography, pairXmdTypography, xmdTypographyOpen, XMD_TYPOGRAPHY_CLOSE, type XmdTypography,
} from './xmdTypography';

interface TypographySpan {
  open: SyntaxNode;
  close: SyntaxNode;
  style: XmdTypography;
}

export function editorTypographySpans(state: EditorState, tree: Tree, from: number, to: number): TypographySpan[] {
  const byParent = new Map<string, SyntaxNode[]>();
  tree.iterate({
    from,
    to,
    enter(ref) {
      if (ref.name !== 'HTMLTag' || !/^<\/?xmd-style[\s>]/i.test(state.sliceDoc(ref.from, Math.min(ref.to, ref.from + 12)))) return;
      const parent = ref.node.parent;
      if (!parent) return;
      const key = parent.name + ':' + parent.from + ':' + parent.to;
      const siblings = byParent.get(key);
      if (siblings) siblings.push(ref.node);
      else byParent.set(key, [ref.node]);
    },
  });
  const result: TypographySpan[] = [];
  for (const tags of byParent.values()) {
    for (const { open, close, style } of pairXmdTypography(tags, (tag) => state.sliceDoc(tag.from, Math.min(tag.to, tag.from + 400)))) {
      if (state.doc.lineAt(tags[open].from).number !== state.doc.lineAt(tags[close].to).number) continue;
      result.push({ open: tags[open], close: tags[close], style });
    }
  }
  return result;
}

export interface XmdTypographyEdit {
  document: Text;
  from: number;
  to: number;
  existing: boolean;
  innerFrom: number;
  innerTo: number;
  style: XmdTypography;
}

const INLINE_CONTAINERS = new Set(['Link', 'StrongEmphasis', 'Emphasis', 'Strikethrough']);
const INLINE_MARKERS = new Set(['LinkMark', 'EmphasisMark', 'StrikethroughMark']);
const BLOCK_MARKERS = new Set(['HeaderMark', 'ListMark', 'TaskMarker', 'QuoteMark', 'HorizontalRule', 'Escape']);

export function getXmdTypographyEdit(state: EditorState): XmdTypographyEdit | null {
  if (state.readOnly || state.selection.ranges.length !== 1) return null;
  let { from, to } = state.selection.main;
  const line = state.doc.lineAt(from);
  if (to > line.to || isVisualOpaqueRange(state, from, to)) return null;
  const tree = visualSyntaxTreeUpTo(state, line.to);
  if (tree.length < line.to) return null;
  const spans = editorTypographySpans(state, tree, line.from, line.to);
  const existing = spans.find((span) => (from === span.open.from && to === span.close.to) ||
    (from === span.open.to && to === span.close.from) ||
    (from === to && from >= span.open.to && to <= span.close.from));
  if (existing) {
    return {
      document: state.doc, existing: true, style: existing.style,
      from: existing.open.from, to: existing.close.to, innerFrom: existing.open.to, innerTo: existing.close.from,
    };
  }

  const text = state.sliceDoc(from, to);
  if (!text.trim()) return null;
  from += text.length - text.trimStart().length;
  to -= text.length - text.trimEnd().length;
  // A partial overlap can cut markup or change the nesting of existing Markdown.
  if (spans.some((span) => from < span.close.to && to > span.open.from &&
    (from < span.open.to || to > span.close.from))) return null;
  let unsafe = false;
  tree.iterate({
    from,
    to,
    enter(node) {
      if (unsafe || node.from >= to || node.to <= from) return false;
      if (BLOCK_MARKERS.has(node.name) || node.name === 'HTMLTag' || node.name === 'HTMLBlock') {
        unsafe = true;
      } else if (INLINE_CONTAINERS.has(node.name)) {
        if (from <= node.from && to >= node.to) return false;
        unsafe = from < node.from || to > node.to;
      } else if (INLINE_MARKERS.has(node.name)) {
        unsafe = true;
      }
    },
  });
  if (unsafe) return null;
  const context = spans.find((span) => from >= span.open.to && to <= span.close.from);
  return { document: state.doc, from, to, innerFrom: from, innerTo: to, existing: false, style: context?.style ?? {} };
}

export function applyXmdTypographyEdit(
  view: { state: EditorState; dispatch: (spec: TransactionSpec) => void },
  edit: XmdTypographyEdit,
  style: XmdTypography
): boolean {
  const { state } = view;
  if (state.readOnly || !state.doc.eq(edit.document)) return false;
  const open = xmdTypographyOpen(style);
  if (!open && (!edit.existing || hasXmdTypography(style))) return false;
  const text = state.sliceDoc(edit.innerFrom, edit.innerTo);
  const insert = open ? open + text + XMD_TYPOGRAPHY_CLOSE : text;
  if (state.sliceDoc(edit.from, edit.to) === insert) return true;
  const anchor = edit.from + open.length;
  view.dispatch({
    changes: { from: edit.from, to: edit.to, insert },
    selection: EditorSelection.single(anchor, anchor + text.length),
    annotations: isolateHistory.of('full'),
    userEvent: 'input.xmdTypography',
    scrollIntoView: true,
  });
  return true;
}
