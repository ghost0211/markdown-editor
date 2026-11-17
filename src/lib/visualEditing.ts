import { type Extension, Facet, type EditorState, type Range } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate, WidgetType } from '@codemirror/view';

export interface VisualEditingOptions {
  sourcePath?: string | null;
  taskToggle: string;
  imageEdit: string;
  imageLoading: string;
  imageFailed: string;
}

/** Absent in source mode. Reconfiguration changes presentation, not document/history. */
export const visualEditingOptions = Facet.define<VisualEditingOptions, VisualEditingOptions | null>({
  combine: (values) => values[0] || null,
});

/** Reveal source on all selected lines, including secondary cursors and search results. */
export function isVisualSourceLine(state: EditorState, from: number, to: number): boolean {
  return state.selection.ranges.some((range) => {
    const first = state.doc.lineAt(range.from).from;
    const last = state.doc.lineAt(range.to).to;
    return first <= to && last >= from;
  });
}

/** One character, one undoable transaction; never reconstructs the whole document. */
export function toggleVisualTask(view: Pick<EditorView, 'state' | 'dispatch'>, from: number): boolean {
  if (view.state.readOnly || from < 0 || from + 3 > view.state.doc.length) return false;
  const marker = view.state.sliceDoc(from, from + 3);
  if (!/^\[[ xX]\]$/.test(marker)) return false;
  const node = syntaxTree(view.state).resolveInner(from + 1, 1);
  if (node.name !== 'TaskMarker' && node.parent?.name !== 'TaskMarker') return false;
  view.dispatch({ changes: { from: from + 1, to: from + 2, insert: marker[1] === ' ' ? 'x' : ' ' }, userEvent: 'input.task' });
  return true;
}

class TaskWidget extends WidgetType {
  constructor(readonly checked: boolean, readonly label: string) { super(); }
  eq(other: TaskWidget): boolean { return this.checked === other.checked && this.label === other.label; }
  toDOM(view: EditorView): HTMLElement {
    const input = view.dom.ownerDocument.createElement('input');
    input.type = 'checkbox';
    input.className = 'cm-visual-task';
    input.checked = this.checked;
    input.disabled = view.state.readOnly;
    input.setAttribute('aria-label', this.label);
    input.addEventListener('mousedown', (event) => event.preventDefault());
    input.addEventListener('click', (event) => {
      event.stopPropagation();
      const at = view.posAtDOM(input);
      if (!toggleVisualTask(view, at)) input.checked = this.checked;
    });
    return input;
  }
  ignoreEvent(): boolean { return true; }
}

class BulletWidget extends WidgetType {
  eq(): boolean { return true; }
  toDOM(view: EditorView): HTMLElement {
    const span = view.dom.ownerDocument.createElement('span');
    span.className = 'cm-visual-bullet';
    span.textContent = '•';
    span.setAttribute('aria-hidden', 'true');
    return span;
  }
}

const INLINE_CLASSES: Record<string, string> = {
  StrongEmphasis: 'cm-visual-strong', Emphasis: 'cm-visual-em',
  Strikethrough: 'cm-visual-strike', InlineCode: 'cm-visual-code', Link: 'cm-visual-link',
};
const INLINE_MARKERS = new Set(['EmphasisMark', 'StrikethroughMark', 'CodeMark']);
const OPAQUE_BLOCKS = new Set(['FencedCode', 'CodeBlock', 'HTMLBlock', 'HTMLTag', 'Table', 'LinkReference', 'FrontMatter', 'MathBlock', 'InlineMath']);

/** Viewport-only decorations: no HTML round trip and no second Markdown parse. */
export function buildVisualDecorations(view: Pick<EditorView, 'state' | 'visibleRanges'>): DecorationSet {
  const { state } = view;
  const options = state.facet(visualEditingOptions);
  if (!options) return Decoration.none;
  const decorations: Range<Decoration>[] = [];
  const seenNodes = new Set<string>();
  const lineClasses = new Map<number, Set<string>>();
  const addLine = (at: number, name: string) => {
    const start = state.doc.lineAt(at).from;
    const classes = lineClasses.get(start) || new Set<string>();
    classes.add(name); lineClasses.set(start, classes);
  };
  const hide = (from: number, to: number) => {
    // ViewPlugin replacements must never hide line breaks.
    if (from < to && state.doc.lineAt(from).number === state.doc.lineAt(to).number && !isVisualSourceLine(state, from, to)) {
      decorations.push(Decoration.replace({}).range(from, to));
    }
  };
  for (const visible of view.visibleRanges) {
    syntaxTree(state).iterate({ from: visible.from, to: visible.to,
      enter(node) {
        if (OPAQUE_BLOCKS.has(node.name) || node.name === 'Image') return false;
        const key = `${node.name}:${node.from}:${node.to}`;
        if (seenNodes.has(key)) return;
        seenNodes.add(key);
        if (/^(?:ATX|Setext)Heading[1-6]$/.test(node.name)) {
          addLine(node.from, `cm-visual-h${node.name.slice(-1)}`);
        } else if (node.name === 'HeaderMark') {
          const line = state.doc.lineAt(node.from);
          let end = node.to;
          if (node.from === line.from && state.sliceDoc(end, end + 1) === ' ') end++;
          hide(node.from, end);
        } else if (node.name === 'QuoteMark') {
          addLine(node.from, 'cm-visual-quote');
          hide(node.from, node.to + (state.sliceDoc(node.to, node.to + 1) === ' ' ? 1 : 0));
        } else if (node.name === 'ListMark') {
          addLine(node.from, 'cm-visual-list');
          if (!isVisualSourceLine(state, node.from, node.to)) {
            const mark = state.sliceDoc(node.from, node.to);
            const task = node.node.parent?.getChild('Task');
            decorations.push((task ? Decoration.replace({}) : /^[-+*]$/.test(mark)
              ? Decoration.replace({ widget: new BulletWidget() })
              : Decoration.mark({ class: 'cm-visual-list-number' })).range(node.from, node.to));
          }
        } else if (node.name === 'TaskMarker') {
          const overlaps = state.selection.ranges.some((range) => range.empty
            ? range.from > node.from && range.from < node.to
            : range.from < node.to && range.to > node.from);
          if (!overlaps) decorations.push(Decoration.replace({ widget: new TaskWidget(state.sliceDoc(node.from + 1, node.from + 2) !== ' ', options.taskToggle) }).range(node.from, node.to));
        } else if (INLINE_CLASSES[node.name]) {
          // Marks may span lines, replacements below may not. Inline code's
          // children are opaque, so literal stars inside remain literal.
          decorations.push(Decoration.mark({ class: INLINE_CLASSES[node.name] }).range(node.from, node.to));
          if (node.name === 'Link') {
            const marks = node.node.getChildren('LinkMark');
            const open = marks.find((mark) => state.sliceDoc(mark.from, mark.to) === '[');
            const close = marks.find((mark) => state.sliceDoc(mark.from, mark.to) === ']');
            if (open && close && !isVisualSourceLine(state, node.from, node.to)) {
              hide(open.from, open.to);
              hide(close.from, node.to);
            }
          }
        } else if (INLINE_MARKERS.has(node.name)) {
          hide(node.from, node.to);
        }
      },
    });
  }
  for (const [from, classes] of lineClasses) decorations.push(Decoration.line({ class: [...classes].join(' ') }).range(from));
  return Decoration.set(decorations, true);
}

export function createVisualEditingExtension(options: VisualEditingOptions): Extension {
  return [
    visualEditingOptions.of(options),
    EditorView.editorAttributes.of({ 'data-editor-presentation': 'visual' }),
    ViewPlugin.fromClass(class {
      decorations: DecorationSet;
      constructor(view: EditorView) { this.decorations = buildVisualDecorations(view); }
      update(update: ViewUpdate) {
        if (update.docChanged || update.selectionSet || update.viewportChanged ||
            syntaxTree(update.startState) !== syntaxTree(update.state) ||
            update.startState.facet(visualEditingOptions) !== update.state.facet(visualEditingOptions)) {
          this.decorations = buildVisualDecorations(update.view);
        }
      }
    }, { decorations: (plugin) => plugin.decorations }),
    visualTheme,
  ];
}

const visualTheme = EditorView.baseTheme({
  '&[data-editor-presentation=visual] .cm-scroller': { fontFamily: "'Segoe UI', 'Microsoft YaHei', system-ui, sans-serif" },
  '.cm-visual-h1': { fontSize: '1.85em', fontWeight: '700', paddingTop: '0.35em', paddingBottom: '0.2em' },
  '.cm-visual-h2': { fontSize: '1.5em', fontWeight: '700', paddingTop: '0.3em', paddingBottom: '0.15em' },
  '.cm-visual-h3': { fontSize: '1.3em', fontWeight: '650', paddingTop: '0.2em' },
  '.cm-visual-h4': { fontSize: '1.15em', fontWeight: '650' },
  '.cm-visual-h5, .cm-visual-h6': { fontSize: '1em', fontWeight: '650' },
  '&[data-editor-presentation=visual] .cm-visual-h1 *, &[data-editor-presentation=visual] .cm-visual-h2 *, &[data-editor-presentation=visual] .cm-visual-h3 *, &[data-editor-presentation=visual] .cm-visual-h4 *, &[data-editor-presentation=visual] .cm-visual-h5 *, &[data-editor-presentation=visual] .cm-visual-h6 *': { textDecoration: 'none', color: 'inherit' },
  '.cm-visual-strong': { fontWeight: '700' },
  '.cm-visual-em': { fontStyle: 'italic' },
  '.cm-visual-strike': { textDecoration: 'line-through' },
  '.cm-visual-code': { fontFamily: 'Consolas, monospace', backgroundColor: '#f1f5f9', color: '#be185d', borderRadius: '3px', padding: '1px 2px' },
  '&dark .cm-visual-code': { backgroundColor: '#334155', color: '#f9a8d4' },
  '.cm-visual-link': { color: '#2563eb', textDecoration: 'underline', textUnderlineOffset: '3px' },
  '&dark .cm-visual-link': { color: '#93c5fd' },
  '.cm-visual-quote': { borderLeft: '3px solid #94a3b8', paddingLeft: '12px', color: '#64748b' },
  '&dark .cm-visual-quote': { color: '#cbd5e1', borderLeftColor: '#64748b' },
  '.cm-visual-bullet': { display: 'inline-block', minWidth: '0.6em', color: '#64748b', textAlign: 'center' },
  '.cm-visual-list-number': { color: '#64748b', fontVariantNumeric: 'tabular-nums' },
  '.cm-visual-task': { margin: '0 3px 0 0', width: '1em', height: '1em', verticalAlign: 'middle', accentColor: '#2563eb', cursor: 'pointer' },
  '.cm-visual-task:focus-visible': { outline: '2px solid #3b82f6', outlineOffset: '2px' },
});
