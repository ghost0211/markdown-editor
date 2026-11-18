import { Facet, type EditorState, type Extension, StateField } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';
import { Decoration, type DecorationSet, EditorView } from '@codemirror/view';
import { collectVisualTables, type VisualTableInfo, type VisualTableLabels } from '@/lib/visualTableModel';
import { VisualTableWidget } from '@/lib/visualTableWidget';

export type {
  VisualTableAlignment,
  VisualTableCellRange,
  VisualTableInfo,
  VisualTableLabels,
} from '@/lib/visualTableModel';
export {
  collectVisualTables,
  findVisualTableAt,
  formatVisualTableLabel,
  serializeVisualTableCell,
  serializeVisualTableCellWithMap,
  serializeVisualTableRow,
  VISUAL_TABLE_MAX_BYTES,
  VISUAL_TABLE_MAX_COLUMNS,
  VISUAL_TABLE_MAX_ROWS,
  visualTableAlignmentCell,
  visualTableAlignmentOf,
  visualTableCellNeighbor,
  visualTableRowLine,
} from '@/lib/visualTableModel';
export {
  applyFocusedVisualTableAction,
  deleteVisualTableColumn,
  deleteVisualTableRow,
  insertVisualTableColumn,
  insertVisualTableRow,
  revealVisualTableSource,
  setVisualTableColumnAlignment,
  updateVisualTableCell,
} from '@/lib/visualTableCommands';

/** Absent in source mode; the caller loads this extension only for visual mode. */
export const visualTableLabels = Facet.define<VisualTableLabels, VisualTableLabels | null>({
  combine: (values) => values[0] ?? null,
});

const visualTableRenderHtml = Facet.define<boolean, boolean>({
  combine: (values) => values[0] ?? false,
});

export interface VisualTableRenderState {
  /** Tables currently replaced by a grid (selection-revealed tables are absent). */
  tables: readonly VisualTableInfo[];
  decorations: DecorationSet;
}

const EMPTY: VisualTableRenderState = { tables: [], decorations: Decoration.none };

/**
 * Any non-empty selection touching a table, and a caret strictly inside one,
 * reveal the source lines. This covers block selection, select-all and search
 * jumps (which all set the editor selection) without hiding a table just
 * because the caret sits at its boundary.
 */
function selectionRevealsTable(state: EditorState, from: number, to: number): boolean {
  return state.selection.ranges.some((range) => range.empty
    ? range.from > from && range.from < to
    : range.from < to && range.to > from);
}

function compute(state: EditorState): VisualTableRenderState {
  const labels = state.facet(visualTableLabels);
  if (!labels) return EMPTY;
  const renderHtml = state.facet(visualTableRenderHtml);
  const tables = collectVisualTables(state).filter((table) => !selectionRevealsTable(state, table.from, table.to));
  if (tables.length === 0) return EMPTY;
  const decorations = Decoration.set(tables.map((table) =>
    Decoration.replace({
      block: true,
      widget: new VisualTableWidget(table, labels, state.readOnly, renderHtml),
    }).range(table.from, table.to)
  ), true);
  return { tables, decorations };
}

/**
 * Direct block decorations from a state field: the replacement exists before
 * the view measures any line, and no ViewPlugin ever hides a line break.
 */
export const visualTableField = StateField.define<VisualTableRenderState>({
  create: compute,
  update(value, transaction) {
    if (!transaction.docChanged && !transaction.selection &&
        transaction.startState.readOnly === transaction.state.readOnly &&
        transaction.startState.facet(visualTableLabels) === transaction.state.facet(visualTableLabels) &&
        transaction.startState.facet(visualTableRenderHtml) === transaction.state.facet(visualTableRenderHtml) &&
        syntaxTree(transaction.startState) === syntaxTree(transaction.state)) {
      return value;
    }
    return compute(transaction.state);
  },
  provide: (field) => EditorView.decorations.from(field, (value) => value.decorations),
});

/**
 * True when `[from, to]` (for example an image URL range) falls inside a table
 * that is currently rendered as a grid. Callers use this to suppress
 * overlapping image-address decorations; everything else keeps its source.
 */
export function isVisualTableRendered(state: EditorState, from: number, to: number): boolean {
  const value = state.field(visualTableField, false);
  if (!value) return false;
  return value.tables.some((table) => from < table.to && to > table.from);
}

export function createVisualTableExtension(labels: VisualTableLabels, renderHtml = false): Extension {
  return [
    visualTableLabels.of(labels),
    visualTableRenderHtml.of(renderHtml),
    visualTableField,
    visualTableTheme,
  ];
}

const visualTableTheme = EditorView.baseTheme({
  // Include the space around the panel in the block widget's measured height.
  '.cm-visual-table': {
    display: 'block',
    paddingBlock: '0.6em',
  },
  '.cm-visual-table-panel': {
    boxSizing: 'border-box',
    padding: '4px 6px 6px',
    border: '1px solid #cbd5e1',
    borderRadius: '8px',
    color: '#0f172a',
    background: 'transparent',
  },
  '&dark .cm-visual-table-panel': { borderColor: '#475569', color: '#e2e8f0' },
  '.cm-visual-table-toolbar': {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '4px',
    alignItems: 'center',
    padding: '2px 0 6px',
  },
  '.cm-visual-table-tool': {
    font: 'inherit',
    fontSize: '12px',
    lineHeight: '1.5',
    padding: '1px 7px',
    color: 'inherit',
    background: 'transparent',
    border: '1px solid #cbd5e1',
    borderRadius: '4px',
    cursor: 'pointer',
  },
  '&dark .cm-visual-table-tool': { borderColor: '#475569' },
  '.cm-visual-table-tool:hover': { background: '#f1f5f9' },
  '&dark .cm-visual-table-tool:hover': { background: '#334155' },
  '.cm-visual-table-tool:focus-visible': { outline: '2px solid #3b82f6', outlineOffset: '1px' },
  '.cm-visual-table-tool[aria-pressed=true]': { background: '#dbeafe', borderColor: '#3b82f6', color: '#1d4ed8' },
  '&dark .cm-visual-table-tool[aria-pressed=true]': { background: '#1e3a8a', borderColor: '#60a5fa', color: '#dbeafe' },
  '.cm-visual-table-tool[aria-disabled=true]': { opacity: '0.45', cursor: 'default' },
  '.cm-visual-table-separator': { width: '1px', height: '16px', background: '#cbd5e1', margin: '0 2px' },
  '&dark .cm-visual-table-separator': { background: '#475569' },
  '.cm-visual-table-align': { display: 'flex', gap: '3px', alignItems: 'center' },
  '.cm-visual-table-grid': { overflowX: 'auto', maxWidth: '100%', paddingBottom: '2px' },
  '.cm-visual-table-element': { borderCollapse: 'collapse', width: '100%', fontSize: '0.92em' },
  '.cm-visual-table-element th, .cm-visual-table-element td': {
    border: '1px solid #cbd5e1',
    padding: '0',
    verticalAlign: 'top',
    minWidth: '5em',
  },
  '&dark .cm-visual-table-element th, &dark .cm-visual-table-element td': { borderColor: '#475569' },
  '.cm-visual-table-cell': {
    boxSizing: 'border-box',
    display: 'block',
    width: '100%',
    minWidth: '5em',
    padding: '4px 6px',
    font: 'inherit',
    color: 'inherit',
    background: 'transparent',
    border: '0',
    outline: '0',
  },
  '.cm-visual-table-cell:focus': { outline: '2px solid #3b82f6', outlineOffset: '-2px', background: '#eff6ff' },
  '&dark .cm-visual-table-cell:focus': { background: '#1e3a5f', outlineColor: '#60a5fa' },
  '.cm-visual-table-element th .cm-visual-table-cell': { fontWeight: '600', background: '#f8fafc' },
  '&dark .cm-visual-table-element th .cm-visual-table-cell': { background: '#1e293b' },
  '.cm-visual-table-cellbox': { position: 'relative' },
  '.cm-visual-table-cellbox .cm-visual-table-cell': { position: 'relative', zIndex: '1' },
  // Read-only rendering of the cell's Markdown while it is not being edited;
  // the transparent input above it keeps clicks, focus and the caret intact.
  '.cm-visual-table-cellbox[data-editing=false] .cm-visual-table-cell': { color: 'transparent', caretColor: 'transparent', background: 'transparent' },
  '.cm-visual-table-element th .cm-visual-table-cellbox': { background: '#f8fafc' },
  '&dark .cm-visual-table-element th .cm-visual-table-cellbox': { background: '#1e293b' },
  '.cm-visual-table-preview': {
    position: 'absolute',
    inset: '0',
    zIndex: '0',
    padding: '4px 6px',
    overflow: 'hidden',
    whiteSpace: 'pre-wrap',
    overflowWrap: 'anywhere',
    pointerEvents: 'none',
  },
  '.cm-visual-table-cellbox[data-editing=true] .cm-visual-table-preview': { display: 'none' },
  // A preview with explicit breaks sizes the cell while the input overlays it.
  '.cm-visual-table-cellbox:has(br)': { display: 'grid' },
  '.cm-visual-table-cellbox:has(br) > *': { gridArea: '1 / 1' },
  '.cm-visual-table-preview:has(br)': { position: 'relative', minWidth: '0' },
  '.cm-visual-table-cellbox[data-editing=true] .cm-visual-table-preview:has(br)': { display: 'block', visibility: 'hidden' },
  '.cm-visual-table-element th .cm-visual-table-preview': { fontWeight: '600' },
  '.cm-inline-strong': { fontWeight: '700' },
  '.cm-inline-emphasis': { fontStyle: 'italic' },
  '.cm-inline-strike': { textDecoration: 'line-through' },
  '.cm-inline-code': {
    padding: '0 2px',
    borderRadius: '3px',
    background: '#f1f5f9',
    color: '#be185d',
    fontFamily: 'Consolas, monospace',
  },
  '&dark .cm-inline-code': { background: '#334155', color: '#f9a8d4' },
  '.cm-inline-link': { color: '#2563eb', textDecoration: 'underline', textUnderlineOffset: '2px' },
  '&dark .cm-inline-link': { color: '#93c5fd' },
  '.cm-inline-math': { fontFamily: 'Consolas, monospace', color: '#475569' },
  '&dark .cm-inline-math': { color: '#cbd5e1' },
  '.cm-visual-table-hint, .cm-visual-table-status': {
    position: 'absolute',
    width: '1px',
    height: '1px',
    padding: '0',
    margin: '-1px',
    overflow: 'hidden',
    clip: 'rect(0 0 0 0)',
    whiteSpace: 'nowrap',
    border: '0',
  },
});
