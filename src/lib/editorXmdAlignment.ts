import { isolateHistory } from '@codemirror/commands';
import { syntaxTree } from '@codemirror/language';
import type { EditorState, TransactionSpec } from '@codemirror/state';
import type { SyntaxNode } from '@lezer/common';
import { visualSyntaxTreeUpTo } from './visualSelectionCore';
import { parseXmdAlignment, XMD_ALIGNMENT_PREFIX, type XmdAlignment } from './xmdAlignment';
import { parseXmdParagraphMarker, xmdParagraphMarker, XMD_PARAGRAPH_LIMIT, type XmdParagraphStyle } from './xmdParagraph';

export function isXmdAlignableBlock(node: SyntaxNode): boolean {
  return node.parent?.name === 'Document' &&
    (node.name === 'Paragraph' || /^(?:ATX|Setext)Heading[1-6]$/.test(node.name));
}

export function editorXmdAlignmentMarkers(state: EditorState, node: SyntaxNode): { from: number; to: number; alignment: XmdAlignment }[] {
  const markers = [];
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.name !== 'Comment' || child.to - child.from > XMD_ALIGNMENT_PREFIX.length + 'justify -->'.length) continue;
    const alignment = parseXmdAlignment(state.sliceDoc(child.from, child.to));
    if (alignment) {
      const from = state.sliceDoc(child.from - 1, child.from) === ' ' ? child.from - 1 : child.from;
      markers.push({ from, to: child.to, alignment });
    }
  }
  return markers;
}

export function editorXmdParagraphMarkers(state: EditorState, node: SyntaxNode) {
  const markers = [];
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.name !== 'Comment' || child.to - child.from > XMD_PARAGRAPH_LIMIT) continue;
    const style = parseXmdParagraphMarker(state.sliceDoc(child.from, child.to));
    if (style) {
      const from = state.sliceDoc(child.from - 1, child.from) === ' ' ? child.from - 1 : child.from;
      markers.push({ from, to: child.to, style });
    }
  }
  return markers;
}

function selectedTextBlocks(state: EditorState, ensure: boolean): SyntaxNode[] {
  // A caret in the indentation or trailing spaces still belongs to that line's block.
  const ranges = state.selection.ranges.map((range) => range.empty ? state.doc.lineAt(range.from) : range);
  const upto = ranges.reduce((end, range) => Math.max(end, range.to), 0);
  const tree = ensure ? visualSyntaxTreeUpTo(state, upto + 1) : syntaxTree(state);
  if (tree.length < upto) return [];
  const selected = new Map<number, SyntaxNode>();
  for (const range of ranges) {
    tree.iterate({ from: range.from, to: range.to, enter(ref) {
      if (!ref.node.parent) return;
      if (isXmdAlignableBlock(ref.node) && ref.from < range.to && ref.to > range.from) {
        selected.set(ref.from, ref.node);
      }
      return false;
    } });
  }
  return [...selected.values()];
}

export function getEditorXmdAlignment(state: EditorState): XmdAlignment | undefined {
  const alignments = selectedTextBlocks(state, false)
    .map((block) => editorXmdAlignmentMarkers(state, block).at(-1)?.alignment ?? 'left');
  return alignments.every((alignment) => alignment === alignments[0]) ? alignments[0] : undefined;
}

function markerInsertionPoint(state: EditorState, block: SyntaxNode): number {
  let at = block.to;
  const closing = block.lastChild;
  if (closing?.name === 'HeaderMark' && closing.from > block.from) {
    at = block.name.startsWith('Setext') ? state.doc.lineAt(closing.from).from - 1 : closing.from;
  }
  while (at > block.from && /^[ \t]$/.test(state.sliceDoc(at - 1, at))) at--;
  return at;
}

function planXmdAlignment(state: EditorState, alignment: XmdAlignment): { from: number; to: number; insert: string }[] {
  const changes: { from: number; to: number; insert: string }[] = [];
  const marker = XMD_ALIGNMENT_PREFIX + alignment + ' -->';
  for (const block of selectedTextBlocks(state, true)) {
    const markers = editorXmdAlignmentMarkers(state, block);
    if (alignment === 'left') {
      for (const { from, to } of markers) changes.push({ from, to, insert: '' });
      continue;
    }
    const old = markers.at(-1);
    if (old) {
      if (old.alignment !== alignment) {
        const padding = state.sliceDoc(old.from, old.from + 1) === ' ' ? ' ' : '';
        changes.push({ from: old.from, to: old.to, insert: padding + marker });
      }
      continue;
    }
    const at = markerInsertionPoint(state, block);
    changes.push({ from: at, to: at, insert: ' ' + marker });
  }
  return changes;
}

export function applyEditorXmdAlignment(
  view: { state: EditorState; dispatch: (spec: TransactionSpec) => void },
  alignment: XmdAlignment,
): boolean {
  return applyTextBlockChanges(view, planXmdAlignment(view.state, alignment), 'input.xmdAlignment');
}

export function getEditorXmdParagraphStyle(state: EditorState): XmdParagraphStyle | null {
  const blocks = selectedTextBlocks(state, true);
  if (!blocks.length) return null;
  const styles = blocks.map((block) => editorXmdParagraphMarkers(state, block).at(-1)?.style ?? {});
  const first = JSON.stringify(styles[0]);
  return styles.every((style) => JSON.stringify(style) === first) ? styles[0] : {};
}

export function applyEditorXmdParagraph(
  view: { state: EditorState; dispatch: (spec: TransactionSpec) => void },
  style: XmdParagraphStyle,
  alignment?: XmdAlignment,
): boolean {
  const { state } = view;
  const marker = xmdParagraphMarker(style);
  const changes = alignment ? planXmdAlignment(state, alignment) : [];
  for (const block of selectedTextBlocks(state, true)) {
    const markers = editorXmdParagraphMarkers(state, block);
    if (!markers.length && marker) {
      const at = markerInsertionPoint(state, block);
      changes.push({ from: at, to: at, insert: ' ' + marker });
    }
    for (const [index, old] of markers.entries()) {
      const insert = index === markers.length - 1 && marker ? ' ' + marker : '';
      if (state.sliceDoc(old.from, old.to) !== insert) changes.push({ from: old.from, to: old.to, insert });
    }
  }
  return applyTextBlockChanges(view, changes, 'input.xmdParagraph');
}

function applyTextBlockChanges(
  view: { state: EditorState; dispatch: (spec: TransactionSpec) => void },
  changes: { from: number; to: number; insert: string }[],
  userEvent: string,
): boolean {
  if (view.state.readOnly) return false;
  if (!changes.length) return false;
  const changeSet = view.state.changes(changes);
  view.dispatch({
    changes: changeSet,
    selection: view.state.selection.map(changeSet, -1),
    annotations: isolateHistory.of('full'),
    userEvent,
  });
  return true;
}
