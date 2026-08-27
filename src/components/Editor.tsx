import {
  useCallback,
  useImperativeHandle,
  forwardRef,
  useMemo,
  useRef,
} from 'react';
import CodeMirror, { ReactCodeMirrorRef } from '@uiw/react-codemirror';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { oneDark } from '@codemirror/theme-one-dark';
import { EditorView } from '@codemirror/view';
import { MarkdownAction, executeCodeMirrorAction } from '@/lib/markdownCommands';

export interface EditorHandle {
  jumpToLine: (line: number) => void;
  applyAction: (action: MarkdownAction) => void;
  focus: () => void;
  getScrollTop: () => number;
  setScrollTop: (top: number) => void;
}

interface EditorProps {
  value: string;
  onChange: (value: string) => void;
  onCursorChange?: (line: number, col: number) => void;
  onScroll?: (scrollTop: number, scrollHeight: number, clientHeight: number) => void;
  isDark: boolean;
  className?: string;
}

export const Editor = forwardRef<EditorHandle, EditorProps>(
  ({ value, onChange, onCursorChange, onScroll, isDark, className }, ref) => {
    const cmRef = useRef<ReactCodeMirrorRef>(null);

    // CodeMirror extensions
    const extensions = useMemo(() => {
      const ext = [
        markdown({ base: markdownLanguage, codeLanguages: languages }),
        EditorView.lineWrapping,
        EditorView.domEventHandlers({
          scroll: (event) => {
            const target = event.target as HTMLElement;
            if (target && onScroll) {
              onScroll(target.scrollTop, target.scrollHeight, target.clientHeight);
            }
          },
        }),
      ];
      return ext;
    }, [onScroll]);

    // Handle cursor position updates
    const handleUpdate = useCallback(
      (viewUpdate: { state: { selection: { main: { head: number } }; doc: { lineAt: (pos: number) => { number: number; from: number } } } }) => {
        if (!onCursorChange) return;
        const pos = viewUpdate.state.selection.main.head;
        const line = viewUpdate.state.doc.lineAt(pos);
        const col = pos - line.from + 1;
        onCursorChange(line.number, col);
      },
      [onCursorChange]
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

          view.dispatch({
            selection: { anchor: line.from, head: line.from },
            scrollIntoView: true,
          });
          view.focus();
        },

        applyAction: (action: MarkdownAction) => {
          const view = cmRef.current?.view;
          if (!view) return;
          executeCodeMirrorAction(view, action);
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
      }),
      []
    );

    return (
      <div className={`h-full w-full overflow-hidden text-sm ${className || ''}`}>
        <CodeMirror
          ref={cmRef}
          value={value}
          height="100%"
          theme={isDark ? oneDark : 'light'}
          extensions={extensions}
          onChange={onChange}
          onUpdate={handleUpdate}
          basicSetup={{
            lineNumbers: true,
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
          }}
          className="h-full font-mono text-[13px] leading-relaxed"
        />
      </div>
    );
  }
);

Editor.displayName = 'Editor';
