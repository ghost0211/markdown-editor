import { EditorState, StateEffect, StateField, type Extension } from '@codemirror/state';
import { ensureSyntaxTree, syntaxTree } from '@codemirror/language';
import type { SyntaxNode } from '@lezer/common';
import { EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view';

type SyntaxTree = ReturnType<typeof syntaxTree>;

/**
 * Syntax the visual presentation hides, rewrites or treats as an opaque payload
 * (fences, math, front matter, tables, images and their destinations).
 *
 * Floating UI must never offer formatting inside these ranges: the source is
 * either hidden from the reader (multi-megabyte data URLs) or inserting markers
 * would corrupt a block whose content is not Markdown text.
 */
export const VISUAL_OPAQUE_NODES: ReadonlySet<string> = new Set([
  'FrontMatter',
  'MathBlock',
  'InlineMath',
  'FencedCode',
  'CodeBlock',
  'InlineCode',
  'HTMLBlock',
  'Table',
  'Image',
  'URL',
  'LinkTitle',
  'LinkReference',
]);

/** Parse budget for interaction-driven syntax queries (milliseconds). */
const INTERACTION_PARSE_BUDGET = 20;

/**
 * Returns the syntax tree for the requested position without reparsing what is
 * already available. Repeated calls for the same editor state (selection moves,
 * focus changes) therefore do no parse work.
 *
 * `ensureSyntaxTree` returns a tree that can be newer than the one committed to
 * the state (CodeMirror only publishes it after an update), so the parsed tree
 * itself is returned instead of re-reading `syntaxTree(state)`.
 */
export function visualSyntaxTreeUpTo(state: EditorState, upto: number): SyntaxTree {
  const limit = Math.max(0, Math.min(state.doc.length, upto));
  // Careful: `syntaxTree(state)` is the tree committed to the state, which can
  // lag behind the parser (CodeMirror publishes new trees with an update). The
  // ensured tree is the freshest one and costs nothing once parsing is done.
  return ensureSyntaxTree(state, limit, INTERACTION_PARSE_BUDGET) ?? syntaxTree(state);
}

function hasOpaqueAncestor(node: SyntaxNode | null): boolean {
  for (let current = node; current; current = current.parent) {
    if (VISUAL_OPAQUE_NODES.has(current.name)) return true;
  }
  return false;
}

/**
 * True when the position sits inside syntax the visual mode hides or rewrites.
 *
 * Unparsed source is treated as opaque: offering a command inside a fence that
 * has not been read yet would be worse than showing no menu at all.
 */
export function isVisualOpaquePosition(state: EditorState, position: number): boolean {
  const safe = Math.max(0, Math.min(position, state.doc.length));
  const tree = visualSyntaxTreeUpTo(state, safe + 1);
  if (tree.length === 0) return state.doc.length > 0;
  if (tree.length < safe) return true;
  return hasOpaqueAncestor(tree.resolveInner(safe, 1));
}

/**
 * True when any part of the range touches opaque syntax. Both edges are
 * resolved with inward bias so a selection that ends exactly on the opening
 * delimiter of an opaque node is still reported (and one that merely stops
 * beside it is not).
 */
export function isVisualOpaqueRange(state: EditorState, from: number, to: number): boolean {
  const start = Math.max(0, Math.min(from, state.doc.length));
  const end = Math.max(start, Math.min(to, state.doc.length));
  const tree = visualSyntaxTreeUpTo(state, end + 1);
  if (tree.length === 0) return state.doc.length > 0;
  if (tree.length < end) return true;
  if (hasOpaqueAncestor(tree.resolveInner(start, 1))) return true;
  if (hasOpaqueAncestor(tree.resolveInner(end, -1))) return true;
  if (start === end) return false;
  let opaque = false;
  tree.iterate({
    from: start,
    to: end,
    enter(node) {
      if (VISUAL_OPAQUE_NODES.has(node.name)) {
        opaque = true;
        return false;
      }
      return undefined;
    },
  });
  return opaque;
}

/**
 * Mirrors "the editor content element has focus" into editor state so that
 * state-only facets (`showTooltip`) can react to focus changes. CodeMirror
 * dispatches its own focus-change transactions; the mount sync covers the case
 * where the extension is installed (source → visual) while already focused.
 */
export const visualEditorFocusEffect = StateEffect.define<boolean>();

export const visualEditorFocus = StateField.define<boolean>({
  create: () => false,
  update(value, transaction) {
    let next = value;
    for (const effect of transaction.effects) {
      if (effect.is(visualEditorFocusEffect)) next = effect.value;
    }
    return next === value ? value : next;
  },
});

function syncEditorFocus(view: EditorView): void {
  if (!view.dom.isConnected) return;
  if (view.state.field(visualEditorFocus, false) === view.hasFocus) return;
  view.dispatch({ effects: visualEditorFocusEffect.of(view.hasFocus) });
}

/** The window that owns the editor DOM (null when the view is detached). */
export function visualViewWindow(view: EditorView): Window | null {
  return view.dom.ownerDocument.defaultView;
}

/**
 * Keeps `visualEditorFocus` in sync with `view.hasFocus`.
 *
 * CodeMirror's `focusChangeEffect` misses transitions it does not classify as a
 * change - most importantly focus moving into a widget island inside the editor
 * DOM (visual table cell inputs, image chips, tooltip buttons) and back. While
 * such an island owns focus, `view.hasFocus` is false but no focus-change
 * notification arrives; returning to the content therefore left the mirrored
 * value stale (and the slash menu stayed closed although the caret was in the
 * editor again).
 *
 * DOM `focusin`/`focusout` on the editor element plus `update.focusChanged`
 * schedule a read of `view.hasFocus` one task later. Never dispatch from inside
 * the update: CodeMirror forbids nested updates.
 */
const focusSyncPlugin = ViewPlugin.fromClass(
  class {
    private timer: number | null = null;
    private destroyed = false;
    private readonly window: Window | null;
    private readonly onDomFocusChange = () => this.schedule();

    constructor(private readonly view: EditorView) {
      this.window = visualViewWindow(view);
      view.dom.addEventListener('focusin', this.onDomFocusChange, true);
      view.dom.addEventListener('focusout', this.onDomFocusChange, true);
      this.schedule();
    }

    update(update: ViewUpdate): void {
      if (update.focusChanged) this.schedule();
    }

    destroy(): void {
      this.destroyed = true;
      this.view.dom.removeEventListener('focusin', this.onDomFocusChange, true);
      this.view.dom.removeEventListener('focusout', this.onDomFocusChange, true);
      if (this.timer !== null) this.window?.clearTimeout(this.timer);
      this.timer = null;
    }

    private schedule(): void {
      if (this.destroyed) return;
      if (!this.window) {
        syncEditorFocus(this.view);
        return;
      }
      if (this.timer !== null) this.window.clearTimeout(this.timer);
      this.timer = this.window.setTimeout(() => {
        this.timer = null;
        if (!this.destroyed) syncEditorFocus(this.view);
      }, 0);
    }
  }
);

/**
 * Shared focus plumbing for the visual-mode floating UI. Included by both the
 * selection toolbar and the slash menu; CodeMirror dedupes the identical
 * extension instances, so installing both does not double-dispatch effects.
 */
export const visualEditorFocusExtension: Extension = [
  visualEditorFocus,
  EditorView.focusChangeEffect.of((_state, focusing) => visualEditorFocusEffect.of(focusing)),
  focusSyncPlugin,
];
