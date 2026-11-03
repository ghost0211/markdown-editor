import { EditorState } from '@codemirror/state';
import { historyField } from '@codemirror/commands';

/**
 * Per-tab editor state cache.
 *
 * Why this exists: the app keeps a single CodeMirror instance and previously
 * swapped the whole document through the `value` prop when the user switched
 * tabs. `@uiw/react-codemirror` performs that swap with a full-document
 * `dispatch` that carries no `addToHistory: false`, so the replacement was
 * recorded in the (shared) undo stack. The consequence was data corruption:
 * typing in tab A, switching to tab B and pressing Ctrl+Z restored A's text
 * into B.
 *
 * Instead of remounting a fresh editor per tab (which would throw away the
 * undo history on every switch), we keep the serialized `EditorState` of each
 * tab keyed by tab id and rebuild the state when the tab is shown again. Each
 * tab therefore keeps its own undo stack, selection and scroll anchor.
 *
 * `historyField` is the field the history extension serializes to, so undo /
 * redo survive the round-trip through JSON.
 */
const HISTORY_FIELDS = { history: historyField };

/** Shape accepted by @uiw/react-codemirror's `initialState` prop. */
export interface EditorInitialState {
  json: unknown;
  fields?: typeof HISTORY_FIELDS;
}

export interface SerializedEditorState {
  /** Document text at snapshot time; used to detect content drift. */
  doc: string;
  /** JSON produced by `EditorState.toJSON({ history: historyField })`. */
  json: unknown;
}

/** Drop cached state that no longer matches the tab's current content. */
export function isSnapshotValid(
  snapshot: SerializedEditorState | undefined,
  value: string
): snapshot is SerializedEditorState {
  return Boolean(snapshot) && snapshot!.doc === value;
}

export function serializeEditorState(state: EditorState): SerializedEditorState {
  return {
    doc: state.doc.toString(),
    json: state.toJSON(HISTORY_FIELDS),
  };
}

/**
 * Rebuilds an editor state from a cache entry. Returns `undefined` when the
 * entry is missing or its document no longer matches `value` (e.g. the file
 * was reloaded from disk), in which case the caller should start fresh.
 */
export function restoreEditorInitialState(
  snapshot: SerializedEditorState | undefined,
  value: string
): EditorInitialState | undefined {
  if (!isSnapshotValid(snapshot, value)) return undefined;
  return { json: snapshot!.json, fields: HISTORY_FIELDS };
}
