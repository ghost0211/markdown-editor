import { EditorState, Extension } from '@codemirror/state';
import { EditorView, ViewPlugin, ViewUpdate } from '@codemirror/view';
import { SearchQuery, getSearchQuery, searchPanelOpen } from '@codemirror/search';

export const DEFAULT_MATCH_CAP = 5000;

export interface SearchMatchSummary {
  total: number;
  /** 1-based index of the currently selected match, or 0 when none is selected. */
  current: number;
  capped: boolean;
}

/**
 * Counts matches of `query` in `state.doc` (up to `cap`) and identifies whether
 * the primary selection sits on one of them. Returns null for an empty or
 * invalid query so callers hide the badge cleanly.
 */
export function computeSearchMatchSummary(
  state: EditorState,
  query: SearchQuery,
  cap = DEFAULT_MATCH_CAP
): SearchMatchSummary | null {
  if (!query.search || !query.valid) return null;

  let cursor: Iterator<{ from: number; to: number }>;
  try {
    cursor = query.getCursor(state.doc);
  } catch {
    return null;
  }

  const sel = state.selection.main;
  let total = 0;
  let current = 0;
  let capped = false;

  while (true) {
    const step = cursor.next();
    if (step.done) break;
    total++;
    if (total > cap) {
      total = cap;
      capped = true;
      break;
    }
    const { from, to } = step.value;
    if (current === 0 && sel.from === from && sel.to === to) {
      current = total;
    }
  }

  return { total, current, capped };
}

export function formatSearchMatchSummary(summary: SearchMatchSummary | null): string {
  if (!summary) return '';
  if (summary.total === 0) return '0 / 0';
  const totalText = summary.capped ? `${summary.total}+` : String(summary.total);
  const currentText = summary.current > 0 ? String(summary.current) : '–';
  return `${currentText} / ${totalText}`;
}

/**
 * Attaches a live `current / total` match counter next to the search input in
 * CodeMirror's built-in `Ctrl+F` search panel.
 */
export function createSearchMatchCountExtension(): Extension {
  const plugin = ViewPlugin.fromClass(
    class {
      constructor(view: EditorView) {
        this.syncBadge(view);
      }

      update(update: ViewUpdate) {
        this.syncBadge(update.view);
      }

      syncBadge(view: EditorView) {
        if (!searchPanelOpen(view.state)) return;
        const panel = view.dom.querySelector('.cm-panel.cm-search');
        if (!panel) return;
        const searchInput = panel.querySelector('input[name="search"]');
        if (!searchInput) return;

        let badge = panel.querySelector<HTMLSpanElement>('.cm-search-match-count');
        if (!badge) {
          badge = document.createElement('span');
          badge.className = 'cm-search-match-count';
          badge.setAttribute('aria-live', 'polite');
          searchInput.insertAdjacentElement('afterend', badge);
        }

        const summary = computeSearchMatchSummary(view.state, getSearchQuery(view.state));
        const text = formatSearchMatchSummary(summary);
        if (badge.textContent !== text) {
          badge.textContent = text;
        }
        badge.dataset.empty = summary && summary.total === 0 ? 'true' : 'false';
      }
    }
  );

  const theme = EditorView.baseTheme({
    '.cm-panel.cm-search .cm-search-match-count': {
      display: 'inline-block',
      minWidth: '3.6em',
      margin: '0 6px 0 2px',
      padding: '1px 6px',
      borderRadius: '4px',
      fontSize: '11px',
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
      textAlign: 'center',
      opacity: '0.8',
    },
    '.cm-panel.cm-search .cm-search-match-count:empty': {
      display: 'none',
    },
    '.cm-panel.cm-search .cm-search-match-count[data-empty="true"]': {
      color: '#ef4444',
      opacity: '1',
    },
  });

  return [plugin, theme];
}
