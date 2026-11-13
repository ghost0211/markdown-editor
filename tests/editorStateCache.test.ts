import { describe, it, expect } from 'vitest';
import { EditorState } from '@codemirror/state';
import { history, undo } from '@codemirror/commands';
import {
  serializeEditorState,
  restoreEditorInitialState,
  isSnapshotValid,
} from '../src/lib/editorStateCache';

/**
 * Regression coverage for the cross-tab undo corruption fixed in 1.5.0:
 * switching tabs used to replace the whole document in a single shared undo
 * stack, so Ctrl+Z in tab B restored tab A's text into B.
 *
 * The editor now remounts per document from a cached EditorState. These tests
 * reproduce the exact round-trip that the editor performs.
 */
describe('editorStateCache: per-document undo isolation', () => {
  const extensions = [history()];

  /** Simulates what @uiw/react-codemirror does with `initialState`. */
  const restore = (snapshot: ReturnType<typeof serializeEditorState>) => {
    const initial = restoreEditorInitialState(snapshot, snapshot.doc)!;
    return EditorState.fromJSON(initial.json as never, { extensions }, initial.fields);
  };

  const typeInto = (state: EditorState, insert: string) => {
    const tr = state.update({
      changes: { from: state.doc.length, insert },
      userEvent: 'input.type',
    });
    return tr.state;
  };

  it('round-trips a document with its undo history', () => {
    const typed = typeInto(EditorState.create({ doc: 'A0', extensions }), ' typed-in-A');
    const restored = restore(serializeEditorState(typed));

    expect(restored.doc.toString()).toBe('A0 typed-in-A');

    // Undo still works after the round-trip...
    let undone = restored;
    undo({
      state: undone,
      dispatch: (tr) => {
        undone = tr.state;
      },
    });
    expect(undone.doc.toString()).toBe('A0');
  });

  it('never leaks one document undo history into another', () => {
    // Tab A: type, then leave (snapshot taken at unmount).
    const tabA = typeInto(EditorState.create({ doc: 'A0', extensions }), ' typed-in-A');
    const snapshotA = serializeEditorState(tabA);

    // Tab B: a completely separate state with its own (empty) history.
    const tabB = EditorState.create({ doc: 'B-content', extensions });

    // Ctrl+Z in tab B must be a no-op: it has nothing of its own to undo.
    let afterUndoInB = tabB;
    const handled = undo({
      state: afterUndoInB,
      dispatch: (tr) => {
        afterUndoInB = tr.state;
      },
    });

    expect(handled).toBe(false);
    expect(afterUndoInB.doc.toString()).toBe('B-content');
    // ...and A's typed text never appears in B.
    expect(afterUndoInB.doc.toString()).not.toContain('typed-in-A');
    // A's own snapshot is intact for when the user switches back.
    expect(restore(snapshotA).doc.toString()).toBe('A0 typed-in-A');
  });

  it('rejects a cached snapshot once the content drifted', () => {
    const snapshot = serializeEditorState(EditorState.create({ doc: 'old', extensions }));

    expect(isSnapshotValid(snapshot, 'old')).toBe(true);
    expect(isSnapshotValid(snapshot, 'reloaded from disk')).toBe(false);
    // A stale snapshot must not be restored: the editor starts from the new text.
    expect(restoreEditorInitialState(snapshot, 'reloaded from disk')).toBeUndefined();
  });

  it('returns undefined for a missing snapshot', () => {
    expect(restoreEditorInitialState(undefined, 'anything')).toBeUndefined();
  });

  it('keeps cached snapshot valid for CRLF files whose CodeMirror doc uses LF', () => {
    const state = EditorState.create({ doc: 'line 1\r\nline 2\r\n', extensions });
    const snapshot = serializeEditorState(state);
    expect(snapshot.doc).toBe('line 1\nline 2\n');
    expect(isSnapshotValid(snapshot, 'line 1\r\nline 2\r\n')).toBe(true);
  });
});
