import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';

/**
 * Markdown list continuation for the Enter key.
 *
 * Supports unordered lists, ordered lists (incrementing the number), task
 * lists (the next item is always unchecked), indentation and blockquotes.
 * Pressing Enter on an empty item terminates the list instead of creating an
 * endless run of empty bullets.
 */
export interface ListContinuation {
  /** Prefix to put at the beginning of the next line. */
  nextPrefix: string;
  /** True when the current item has no content and the list should end. */
  emptyItem: boolean;
}

const LIST_ITEM = /^(\s*(?:>\s*)*)([-*+]|\d+[.)])([ \t]+)(?:\[([ xX])\][ \t]+)?(.*)$/;

export function getListContinuation(lineText: string): ListContinuation | null {
  const match = LIST_ITEM.exec(lineText);
  if (!match) return null;

  const [, leading, marker, spacing, _taskState, content] = match;
  if (content.trim().length === 0) {
    return { nextPrefix: '', emptyItem: true };
  }

  let nextMarker = marker;
  const ordered = /^(\d+)([.)])$/.exec(marker);
  if (ordered) {
    const number = Number.parseInt(ordered[1], 10);
    if (!Number.isSafeInteger(number)) return null;
    nextMarker = `${number + 1}${ordered[2]}`;
  }

  const task = match[4] !== undefined ? '[ ] ' : '';
  return { nextPrefix: `${leading}${nextMarker}${spacing}${task}`, emptyItem: false };
}

export interface ListEnterResult {
  text: string;
  cursor: number;
}

/** Pure form of the Enter behavior, convenient to test without a DOM. */
export function continueListAt(
  text: string,
  cursor: number
): ListEnterResult | null {
  if (cursor < 0 || cursor > text.length) return null;
  const lineStart = text.lastIndexOf('\n', Math.max(0, cursor - 1)) + 1;
  let lineEnd = text.indexOf('\n', cursor);
  if (lineEnd === -1) lineEnd = text.length;

  const line = text.slice(lineStart, lineEnd);
  const continuation = getListContinuation(line);
  if (!continuation) return null;

  if (continuation.emptyItem) {
    const leading = /^(\s*(?:>\s*)*)/.exec(line)?.[1] || '';
    return {
      text: text.slice(0, lineStart) + leading + '\n' + text.slice(lineEnd),
      cursor: lineStart + leading.length + 1,
    };
  }

  const insertion = `\n${continuation.nextPrefix}`;
  return {
    text: text.slice(0, cursor) + insertion + text.slice(cursor),
    cursor: cursor + insertion.length,
  };
}

/** CodeMirror command bound to Enter with high precedence. */
export function continueListOnEnter(view: EditorView): boolean {
  const { state } = view;
  if (state.selection.ranges.length !== 1 || !state.selection.main.empty) return false;

  const result = continueListAt(state.doc.toString(), state.selection.main.head);
  if (!result) return false;

  view.dispatch({
    changes: { from: 0, to: state.doc.length, insert: result.text },
    selection: { anchor: result.cursor },
    scrollIntoView: true,
    userEvent: 'input',
  });
  return true;
}

/** Shared pure helper retained for callers that already hold an EditorState. */
export function listEnterState(state: EditorState): ListEnterResult | null {
  if (state.selection.ranges.length !== 1 || !state.selection.main.empty) return null;
  return continueListAt(state.doc.toString(), state.selection.main.head);
}
