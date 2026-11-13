import { Extension, Prec } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import {
  executeCodeMirrorAction,
  MarkdownAction,
  MarkdownLocaleInput,
} from '@/lib/markdownCommands';
import { continueListOnEnter } from '@/lib/listContinuation';
import { isDelimiterRow, isTableRowLine, navigateTable, splitTableRow } from '@/lib/markdownTable';

/**
 * Tab / Shift+Tab inside a GFM table: re-aligns the table and moves to the
 * next / previous cell (Tab at the very end appends a row). Outside a table it
 * returns false so the key keeps its normal behaviour.
 */
export function navigateTableCell(direction: 1 | -1) {
  return (view: EditorView): boolean => {
    const { state } = view;
    const selection = state.selection.main;
    const head = state.doc.lineAt(selection.head);
    if (!selection.empty && state.doc.lineAt(selection.anchor).number !== head.number) {
      return false;
    }
    if (!isTableRowLine(head.text)) return false;

    let startNumber = head.number;
    while (startNumber > 1 && isTableRowLine(state.doc.line(startNumber - 1).text)) startNumber--;
    let endNumber = head.number;
    while (endNumber < state.doc.lines && isTableRowLine(state.doc.line(endNumber + 1).text)) {
      endNumber++;
    }

    const tableLines: string[] = [];
    for (let n = startNumber; n <= endNumber; n++) tableLines.push(state.doc.line(n).text);
    if (tableLines.length < 2 || !isDelimiterRow(splitTableRow(tableLines[1]))) return false;

    const result = navigateTable(
      tableLines,
      head.number - startNumber,
      selection.head - head.from,
      direction
    );
    if (!result) return false;

    const blockFrom = state.doc.line(startNumber).from;
    const blockTo = state.doc.line(endNumber).to;
    let rowOffset = 0;
    for (let i = 0; i < result.row; i++) rowOffset += result.lines[i].length + 1;

    view.dispatch({
      changes: { from: blockFrom, to: blockTo, insert: result.lines.join('\n') },
      selection: {
        anchor: blockFrom + rowOffset + result.from,
        head: blockFrom + rowOffset + result.to,
      },
      scrollIntoView: true,
      userEvent: 'input.format',
    });
    return true;
  };
}

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
      { key: 'Tab', run: navigateTableCell(1) },
      { key: 'Shift-Tab', run: navigateTableCell(-1) },
    ])
  );
}
