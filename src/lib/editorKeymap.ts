import { Extension, Prec } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import {
  executeCodeMirrorAction,
  MarkdownAction,
  MarkdownLocaleInput,
} from '@/lib/markdownCommands';
import { continueListOnEnter } from '@/lib/listContinuation';

/** Keyboard-only Markdown formatting, independent of the toolbar buttons. */
const FORMAT_SHORTCUTS: ReadonlyArray<{ key: string; action: MarkdownAction }> = [
  { key: 'Mod-b', action: 'bold' },
  { key: 'Mod-i', action: 'italic' },
  { key: 'Mod-k', action: 'link' },
];

export function getMarkdownShortcutAction(key: string): MarkdownAction | undefined {
  const normalized = key.toLowerCase();
  return FORMAT_SHORTCUTS.find((binding) => binding.key.toLowerCase() === normalized)?.action;
}

/**
 * High precedence is required for Mod-k: CodeMirror's default keymap otherwise
 * uses Ctrl+K for "delete to line end". Enter continues Markdown lists and
 * falls through to the default handler outside a list item.
 */
export function createMarkdownEditingKeymap(localeInput?: MarkdownLocaleInput): Extension {
  const formatting = FORMAT_SHORTCUTS.map(({ key, action }) => ({
    key,
    run: (view: EditorView) => {
      executeCodeMirrorAction(view, action, localeInput);
      return true;
    },
  }));

  return Prec.high(
    keymap.of([
      ...formatting,
      {
        key: 'Enter',
        run: continueListOnEnter,
      },
    ])
  );
}
