import {
  useCallback,
  useEffect,
  useImperativeHandle,
  forwardRef,
  useMemo,
  useRef,
} from 'react';
import CodeMirror, { ReactCodeMirrorRef } from '@uiw/react-codemirror';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { oneDark } from '@codemirror/theme-one-dark';
import { EditorView, ViewUpdate } from '@codemirror/view';
import { EditorState, Text } from '@codemirror/state';
import { indentUnit } from '@codemirror/language';
import { MarkdownAction, executeCodeMirrorAction } from '@/lib/markdownCommands';
import { createMarkdownEditingKeymap } from '@/lib/editorKeymap';
import { createTypewriterExtension } from '@/lib/typewriterMode';
import { createFocusModeExtension } from '@/lib/focusMode';
import { createSearchMatchCountExtension } from '@/lib/searchMatchCount';
import {
  isSingleUrl,
  isTableRowLine,
  linkifySelection,
  parseHtmlTable,
  rowsToMarkdownTable,
} from '@/lib/markdownTable';
import { filterImageFiles } from '@/lib/imageAssets';
import {
  cachedEditorStateIds,
  dropCachedEditorState,
  getCachedEditorState,
  restoreEditorInitialState,
  serializeEditorState,
  setCachedEditorState,
} from '@/lib/editorStateCache';
import { useI18n } from '@/i18n';

export interface EditorHandle {
  jumpToLine: (line: number) => void;
  applyAction: (action: MarkdownAction) => void;
  focus: () => void;
  getScrollTop: () => number;
  setScrollTop: (top: number) => void;
  /** Inserts Markdown at a source position without replacing the whole undo stack. */
  insertText: (text: string, position?: number) => void;
  /** Scrolls so the given source line sits at the top of the viewport. */
  scrollToLine: (line: number, fraction?: number) => void;
  /** Returns the first visible source line and the scrolled fraction within it. */
  getTopVisibleLine: () => { line: number; fraction: number };
}

interface EditorProps {
  value: string;
  onChange: (value: string) => void;
  onCursorChange?: (line: number, col: number) => void;
  onScroll?: (scrollTop: number, scrollHeight: number, clientHeight: number) => void;
  isDark: boolean;
  className?: string;
  fontSize?: number;
  lineHeight?: number;
  tabSize?: number;
  wordWrap?: boolean;
  lineNumbers?: boolean;
  /** Browser spell checking of the text being edited. */
  spellcheck?: boolean;
  /** Keep the line being edited vertically centred. */
  typewriterMode?: boolean;
  /** Dim paragraphs other than the active block. */
  focusMode?: boolean;
  /** Identity of the document currently shown. Switching it restores that
   *  document's own undo history / selection instead of replacing the text. */
  docId?: string;
  /** Cursor position to restore the first time a document is opened. */
  initialCursorLine?: number;
  initialCursorCol?: number;
  /** Receives pasted/dropped image files and the source position to insert at. */
  onImageFiles?: (files: File[], position: number) => void;
}

export { cachedEditorStateIds, dropCachedEditorState };

/**
 * Hoisted to module scope (instead of an inline JSX object literal) so the
 * reference stays stable across renders. @uiw/react-codemirror dispatches a
 * full `StateEffect.reconfigure` whenever `basicSetup` or `onChange` changes
 * identity — with inline literals that happened on every single keystroke.
 */
const BASE_BASIC_SETUP = {
  highlightActiveLineGutter: true,
  highlightSpecialChars: true,
  history: true,
  foldGutter: true,
  drawSelection: true,
  dropCursor: true,
  allowMultipleSelections: true,
  indentOnInput: true,
  syntaxHighlighting: true,
  bracketMatching: true,
  closeBrackets: true,
  autocompletion: true,
  rectangularSelection: true,
  crosshairCursor: false,
  highlightActiveLine: true,
  highlightSelectionMatches: true,
  closeBracketsKeymap: true,
  defaultKeymap: true,
  searchKeymap: true,
  historyKeymap: true,
  foldKeymap: true,
  completionKeymap: true,
  lintKeymap: true,
};

export const Editor = forwardRef<EditorHandle, EditorProps>(
  (
    {
      value,
      onChange,
      onCursorChange,
      onScroll,
      isDark,
      className,
      fontSize = 14,
      lineHeight = 1.6,
      tabSize = 2,
      wordWrap = true,
      lineNumbers = true,
      spellcheck = false,
      typewriterMode = false,
      focusMode = false,
      docId,
      initialCursorLine = 1,
      initialCursorCol = 1,
      onImageFiles,
    },
    ref
  ) => {
    const cmRef = useRef<ReactCodeMirrorRef>(null);
    const { t, language } = useI18n();

    // Keeps the latest scroll handler reachable from the (stable) extension
    // list without making the extension list depend on its identity.
    const onScrollRef = useRef(onScroll);
    onScrollRef.current = onScroll;
    const onImageFilesRef = useRef(onImageFiles);
    onImageFilesRef.current = onImageFiles;

    // Stable for as long as the user's line-number preference is unchanged.
    const basicSetup = useMemo(() => ({ ...BASE_BASIC_SETUP, lineNumbers }), [lineNumbers]);

    // In-flight programmatic scroll target. CodeMirror measures line heights
    // lazily, so scrollToLine may take several frames to converge; while it is
    // settling, getTopVisibleLine reports this logical target instead of the
    // transient physical position (keeps rapid view-mode switches stable).
    const scrollSettleRef = useRef<{ from: number; line: number } | null>(null);

    // CodeMirror extensions
    const extensions = useMemo(() => {
      const ext = [
        createMarkdownEditingKeymap({ t, language }),
        createSearchMatchCountExtension(),
        markdown({ base: markdownLanguage, codeLanguages: languages }),
        EditorState.tabSize.of(tabSize),
        indentUnit.of(' '.repeat(tabSize)),
        EditorView.theme({
          '&': {
            fontSize: `${fontSize}px`,
          },
          '.cm-scroller': {
            fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', Consolas, monospace",
            lineHeight: `${lineHeight}`,
          },
        }),
        EditorView.domEventHandlers({
          scroll: (event) => {
            const target = event.target as HTMLElement;
            const handler = onScrollRef.current;
            if (target && handler) {
              handler(target.scrollTop, target.scrollHeight, target.clientHeight);
            }
          },
          paste: (event, view) => {
            const clipboard = event.clipboardData;
            if (!clipboard) return;

            const selection = view.state.selection.main;

            // A table copied from Excel / Word / a web page becomes a Markdown
            // table. Checked before images because Excel also puts a PNG
            // snapshot of the cells on the clipboard. Pasting into an existing
            // table row stays plain text.
            const html = clipboard.getData('text/html');
            const tableRows =
              html && !isTableRowLine(view.state.doc.lineAt(selection.from).text)
                ? parseHtmlTable(html)
                : null;
            const table = tableRows ? rowsToMarkdownTable(tableRows) : '';
            if (table) {
              event.preventDefault();
              const fromLine = view.state.doc.lineAt(selection.from);
              const toLine = view.state.doc.lineAt(selection.to);
              const prefix = selection.from > fromLine.from ? '\n\n' : '';
              const suffix = selection.to < toLine.to ? '\n\n' : '';
              const insert = `${prefix}${table}${suffix}`;
              view.dispatch({
                changes: { from: selection.from, to: selection.to, insert },
                selection: { anchor: selection.from + insert.length },
                scrollIntoView: true,
                userEvent: 'input.paste',
              });
              return;
            }

            const handler = onImageFilesRef.current;
            if (handler) {
              const images = filterImageFiles(clipboard.files || []);
              if (images.length > 0) {
                event.preventDefault();
                handler(images, selection.from);
                return;
              }
            }

            // A URL pasted over selected text becomes a Markdown link.
            const pastedText = clipboard.getData('text/plain');
            if (!selection.empty && isSingleUrl(pastedText)) {
              const selected = view.state.sliceDoc(selection.from, selection.to);
              if (!selected.includes('\n')) {
                event.preventDefault();
                const insert = linkifySelection(selected, pastedText);
                view.dispatch({
                  changes: { from: selection.from, to: selection.to, insert },
                  selection: { anchor: selection.from + insert.length },
                  scrollIntoView: true,
                  userEvent: 'input.paste',
                });
              }
            }
          },
          dragover: (event) => {
            if (event.dataTransfer?.types.includes('Files')) {
              event.preventDefault();
            }
          },
          drop: (event, view) => {
            const files = Array.from(event.dataTransfer?.files || []);
            if (files.length === 0) return false;
            const handler = onImageFilesRef.current;
            const images = handler ? filterImageFiles(files) : [];
            if (images.length > 0 && handler) {
              event.preventDefault();
              const position =
                view.posAtCoords({ x: event.clientX, y: event.clientY }) ??
                view.state.selection.main.from;
              handler(images, position);
              return true;
            }
            // Never let CodeMirror's built-in FileReader insert dropped OS files
            // (.md, .txt, binaries) directly into the active document buffer.
            return true;
          },
        }),
      ];

      if (wordWrap) {
        ext.push(EditorView.lineWrapping);
      }

      if (spellcheck) {
        ext.push(EditorView.contentAttributes.of({ spellcheck: 'true' }));
      }

      if (typewriterMode) {
        ext.push(createTypewriterExtension());
      }

      if (focusMode) {
        ext.push(createFocusModeExtension());
      }

      return ext;
    }, [fontSize, lineHeight, tabSize, wordWrap, spellcheck, typewriterMode, focusMode, t, language]);

    /**
     * Editor state to start this document from.
     *
     * - First visit to a document in this session: no snapshot, so the library
     *   builds the state from `value`.
     * - Revisit: rebuild the state captured when the document was last left
     *   behind, which carries its undo history and selection.
     * - Content drift (file reloaded from disk, edits made from the preview):
     *   the cache entry is stale and must be ignored.
     *
     * The dependency is `docId`, not `[]`: only the inner CodeMirror remounts
     * (via `key`), this component instance survives a tab switch.
     */
    const initialState = useMemo(
      () => (docId ? restoreEditorInitialState(getCachedEditorState(docId), value) : undefined),
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [docId]
    );

    // Cursor position to restore when this document has no cached state yet
    // (first visit in this session).
    const initialSelection = useMemo(() => {
      const doc = Text.of(value.split('\n'));
      const lineInfo = doc.line(Math.max(1, Math.min(initialCursorLine, doc.lines)));
      const anchor = Math.min(lineInfo.to, lineInfo.from + Math.max(0, initialCursorCol - 1));
      return { anchor, head: anchor };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [docId]);

    /**
     * Live state of every document seen in this editor instance, keyed by
     * document id. Updated on every CodeMirror update (an O(1) reference
     * assignment); serialization only happens when a document is left.
     *
     * Keyed by id rather than a single "latest" slot because the remount of the
     * inner CodeMirror may deliver the new document's first update before the
     * effect cleanup that snapshots the previous document runs.
     */
    const latestStatesRef = useRef(new Map<string, EditorState>());

    const rememberState = useCallback((ownerId: string | undefined, state: EditorState) => {
      if (!ownerId) return;
      latestStatesRef.current.set(ownerId, state);
    }, []);

    useEffect(() => {
      const leavingDocId = docId;
      const states = latestStatesRef.current;
      return () => {
        if (!leavingDocId) return;
        const snapshot = states.get(leavingDocId);
        states.delete(leavingDocId);
        if (snapshot) setCachedEditorState(leavingDocId, serializeEditorState(snapshot));
      };
    }, [docId]);

    // Handle cursor position updates
    const handleUpdate = useCallback(
      (viewUpdate: ViewUpdate) => {
        rememberState(docId, viewUpdate.state);
        if (!onCursorChange) return;
        const pos = viewUpdate.state.selection.main.head;
        const line = viewUpdate.state.doc.lineAt(pos);
        const col = pos - line.from + 1;
        onCursorChange(line.number, col);
      },
      [docId, onCursorChange, rememberState]
    );

    // Expose imperative actions to parent
    useImperativeHandle(
      ref,
      () => ({
        jumpToLine: (lineNum: number) => {
          const view = cmRef.current?.view;
          if (!view) return;

          const doc = view.state.doc;
          const safeLineNum = Math.max(1, Math.min(lineNum, doc.lines));
          const line = doc.line(safeLineNum);

          // Align the target line to the top of the viewport (matching the
          // preview's outline-jump behavior) instead of minimal scrolling.
          view.dispatch({
            selection: { anchor: line.from, head: line.from },
            effects: EditorView.scrollIntoView(line.from, { y: 'start', yMargin: 16 }),
          });
          view.focus();
        },

        applyAction: (action: MarkdownAction) => {
          const view = cmRef.current?.view;
          if (!view) return;
          executeCodeMirrorAction(view, action, { t, language });
        },

        insertText: (text: string, position?: number) => {
          const view = cmRef.current?.view;
          if (!view || !text) return;
          const at = Math.max(0, Math.min(position ?? view.state.selection.main.from, view.state.doc.length));
          view.dispatch({
            changes: { from: at, to: at, insert: text },
            selection: { anchor: at + text.length },
            scrollIntoView: true,
            userEvent: 'input',
          });
          view.focus();
        },

        focus: () => {
          cmRef.current?.view?.focus();
        },

        getScrollTop: () => {
          const scroller = cmRef.current?.view?.scrollDOM;
          return scroller ? scroller.scrollTop : 0;
        },

        setScrollTop: (top: number) => {
          const scroller = cmRef.current?.view?.scrollDOM;
          if (scroller) {
            scroller.scrollTop = top;
          }
        },

        scrollToLine: (lineNum: number, fraction = 0) => {
          const view = cmRef.current?.view;
          if (!view) return;
          const doc = view.state.doc;
          const safeLineNum = Math.max(1, Math.min(lineNum, doc.lines));
          const from = doc.line(safeLineNum).from;
          const frac = Math.min(1, Math.max(0, fraction));
          // Token identity marks the latest request; older settle loops stop.
          const token = { from, line: safeLineNum };
          scrollSettleRef.current = token;

          // Positions of far lines are height *estimates* right after mount or
          // a width change (e.g. entering split mode re-wraps lines). Re-apply
          // the target over the next few frames so the scroll converges to the
          // line's real position as CodeMirror's measurements arrive, instead
          // of drifting by the accumulated estimation error.
          let frames = 0;
          const applyTarget = () => {
            if (cmRef.current?.view !== view || !view.dom.isConnected) return;
            if (scrollSettleRef.current !== token) return; // superseded
            if (from > view.state.doc.length) {
              scrollSettleRef.current = null;
              return;
            }
            const block = view.lineBlockAt(from);
            const top = block.top + frac * block.height;
            if (Math.abs(view.scrollDOM.scrollTop - top) > 1) {
              view.scrollDOM.scrollTop = top;
            }
            if (++frames < 6) {
              requestAnimationFrame(applyTarget);
            } else {
              scrollSettleRef.current = null;
            }
          };
          applyTarget();
        },

        getTopVisibleLine: () => {
          const view = cmRef.current?.view;
          if (!view) return { line: 1, fraction: 0 };
          // While a programmatic scroll is still settling, report its logical
          // target so rapid view-mode switches don't capture a transient
          // mid-scroll position (which would compound into visible jumps).
          const settling = scrollSettleRef.current;
          if (settling) return { line: settling.line, fraction: 0 };
          const scrollTop = Math.max(0, view.scrollDOM.scrollTop);
          const block = view.lineBlockAtHeight(scrollTop);
          const line = view.state.doc.lineAt(block.from).number;
          const fraction =
            block.height > 0
              ? Math.min(1, Math.max(0, (scrollTop - block.top) / block.height))
              : 0;
          return { line, fraction };
        },
      }),
      [t, language]
    );

    return (
      <div className={`h-full w-full overflow-hidden ${className || ''}`}>
        <CodeMirror
          // Remount per document so each tab starts from its own cached state
          // (undo history + selection) instead of having its text replaced in
          // a shared undo stack. See src/lib/editorStateCache.ts.
          key={docId || 'document'}
          ref={cmRef}
          value={value}
          initialState={initialState}
          selection={initialSelection}
          height="100%"
          theme={isDark ? oneDark : 'light'}
          extensions={extensions}
          onChange={onChange}
          onUpdate={handleUpdate}
          onCreateEditor={(_view, state) => rememberState(docId, state)}
          basicSetup={basicSetup}
          className="h-full font-mono"
        />
      </div>
    );
  }
);

Editor.displayName = 'Editor';
