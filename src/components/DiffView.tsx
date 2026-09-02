import React, { useEffect, useRef } from 'react';
import { MergeView } from '@codemirror/merge';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { oneDark } from '@codemirror/theme-one-dark';
import { EditorView, lineNumbers as cmLineNumbers, drawSelection, keymap } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { defaultHighlightStyle, indentUnit, syntaxHighlighting } from '@codemirror/language';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { useI18n } from '@/i18n';

export interface DiffViewProps {
  leftTitle: string;
  rightTitle: string;
  leftDoc: string;
  rightDoc: string;
  /** When a source tab was closed, its side freezes to a read-only snapshot. */
  leftReadOnly?: boolean;
  rightReadOnly?: boolean;
  onChangeLeft?: (value: string) => void;
  onChangeRight?: (value: string) => void;
  isDark: boolean;
  fontSize?: number;
  lineHeight?: number;
  tabSize?: number;
  wordWrap?: boolean;
  lineNumbers?: boolean;
}

/**
 * Side-by-side editable diff view based on @codemirror/merge.
 * The view is built once per mount (keyed by tab id in the parent); edits are
 * streamed back to the owning document tabs via the onChange callbacks.
 */
export const DiffView: React.FC<DiffViewProps> = ({
  leftTitle,
  rightTitle,
  leftDoc,
  rightDoc,
  leftReadOnly = false,
  rightReadOnly = false,
  onChangeLeft,
  onChangeRight,
  isDark,
  fontSize = 14,
  lineHeight = 1.6,
  tabSize = 2,
  wordWrap = true,
  lineNumbers = true,
}) => {
  const { t } = useI18n();
  const containerRef = useRef<HTMLDivElement>(null);
  const mergeViewRef = useRef<MergeView | null>(null);

  // Always call the latest callbacks without rebuilding the editor view
  const callbacksRef = useRef({ onChangeLeft, onChangeRight });
  callbacksRef.current = { onChangeLeft, onChangeRight };

  useEffect(() => {
    if (!containerRef.current) return;

    const makeExtensions = (side: 'left' | 'right', readOnly: boolean) => {
      const extensions = [
        markdown({ base: markdownLanguage, codeLanguages: languages }),
        EditorState.tabSize.of(tabSize),
        indentUnit.of(' '.repeat(tabSize)),
        history(),
        drawSelection(),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        EditorView.theme({
          '&': {
            fontSize: `${fontSize}px`,
          },
          '.cm-scroller': {
            fontFamily:
              "'JetBrains Mono', 'Fira Code', 'Cascadia Code', Consolas, monospace",
            lineHeight: `${lineHeight}`,
          },
        }),
        EditorView.updateListener.of((vu) => {
          if (vu.docChanged) {
            const cb =
              side === 'left'
                ? callbacksRef.current.onChangeLeft
                : callbacksRef.current.onChangeRight;
            cb?.(vu.state.doc.toString());
          }
        }),
      ];

      if (lineNumbers) {
        extensions.push(cmLineNumbers());
      }
      if (wordWrap) {
        extensions.push(EditorView.lineWrapping);
      }
      if (isDark) {
        extensions.push(oneDark);
      }
      if (readOnly) {
        extensions.push(EditorState.readOnly.of(true));
        extensions.push(EditorView.editable.of(false));
      }
      return extensions;
    };

    const view = new MergeView({
      a: {
        doc: leftDoc,
        extensions: makeExtensions('left', leftReadOnly),
      },
      b: {
        doc: rightDoc,
        extensions: makeExtensions('right', rightReadOnly),
      },
      parent: containerRef.current,
      highlightChanges: true,
      gutter: true,
      collapseUnchanged: { margin: 3, minSize: 4 },
    });

    mergeViewRef.current = view;

    return () => {
      view.destroy();
      mergeViewRef.current = null;
    };
    // Rebuild only when presentation settings change; document updates flow
    // one way (editor -> owning tab) for the lifetime of this view.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDark, fontSize, lineHeight, tabSize, wordWrap, lineNumbers, leftReadOnly, rightReadOnly]);

  const renderSideHeader = (title: string, readOnly: boolean) => (
    <div className="flex-1 flex items-center justify-center space-x-1.5 px-3 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 truncate">
      <span className="truncate">{title}</span>
      {readOnly && (
        <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-400">
          {t('diff.snapshotBadge')}
        </span>
      )}
    </div>
  );

  return (
    <div className="h-full w-full flex flex-col overflow-hidden bg-white dark:bg-[#0f172a]">
      <div className="flex shrink-0 border-b border-slate-200 dark:border-slate-800 divide-x divide-slate-200 dark:divide-slate-800">
        {renderSideHeader(leftTitle, leftReadOnly)}
        {renderSideHeader(rightTitle, rightReadOnly)}
      </div>
      <div ref={containerRef} className="flex-1 overflow-hidden diff-merge-container" />
    </div>
  );
};

DiffView.displayName = 'DiffView';
