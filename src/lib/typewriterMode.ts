import { Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';

/**
 * Typewriter mode: keeps the line being edited vertically centred. Scrolling is
 * deferred to a timer because CodeMirror forbids dispatching from inside an
 * update listener, and extra bottom padding lets the last lines reach the
 * centre of the viewport too.
 */
export function createTypewriterExtension(): Extension {
  return [
    EditorView.updateListener.of((update) => {
      if (!(update.docChanged || update.selectionSet) || !update.view.hasFocus) return;
      const view = update.view;
      const head = update.state.selection.main.head;
      window.setTimeout(() => {
        if (!view.dom.isConnected || head > view.state.doc.length) return;
        view.dispatch({ effects: EditorView.scrollIntoView(head, { y: 'center' }) });
      }, 0);
    }),
    EditorView.theme({
      '.cm-content': { paddingBottom: '45vh' },
    }),
  ];
}
