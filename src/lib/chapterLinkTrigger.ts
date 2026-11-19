import { insertBracket } from '@codemirror/autocomplete';
import { syntaxTree } from '@codemirror/language';
import { Prec, type Text } from '@codemirror/state';
import { keymap } from '@codemirror/view';

export interface ChapterLinkInsertion {
  from: number;
  to: number;
  snapshot: Text;
}

const OPAQUE = new Set(['FencedCode', 'CodeBlock', 'InlineCode', 'HTMLBlock', 'HTMLTag', 'InlineMath', 'MathBlock', 'FrontMatter', 'Table', 'URL', 'Link', 'Image']);

export function chapterLinkTrigger(open: (request: ChapterLinkInsertion) => void) {
  return Prec.highest(keymap.of([{ key: '[', run: (view) => {
    const { state } = view;
    const { from, empty } = state.selection.main;
    if (!empty || from < 1 || view.compositionStarted || state.readOnly ||
        state.selection.ranges.length !== 1 || state.sliceDoc(from - 1, from) !== '[') return false;
    let escaping = 0;
    for (let index = from - 2; index >= 0 && state.sliceDoc(index, index + 1) === '\\'; index--) escaping++;
    if (escaping % 2 || (from > 1 && state.sliceDoc(from - 2, from - 1) === '!')) return false;
    for (let node = syntaxTree(state).resolveInner(from - 1, 1); node.parent; node = node.parent) {
      // Markdown can classify the automatically inserted [] as an empty link.
      if (node.name === 'Link' && node.from === from - 1 && node.to === from + 1) continue;
      if (OPAQUE.has(node.name)) return false;
    }
    // Only consume a matching bracket that CodeMirror inserted itself.
    const autoClose = state.sliceDoc(from, from + 1) === ']' && insertBracket(state, ']')?.newSelection.main.head === from + 1;
    view.dispatch({
      changes: { from, to: autoClose ? from + 1 : from, insert: '[' },
      selection: { anchor: from + 1 },
      userEvent: 'input.type',
    });
    const request = { from: from - 1, to: from + 1, snapshot: view.state.doc };
    queueMicrotask(() => {
      if (view.dom.isConnected && view.state.doc === request.snapshot) open(request);
    });
    return true;
  } }]));
}
