import { redo, undo } from '@codemirror/commands';
import { EditorView, WidgetType } from '@codemirror/view';
import {
  deleteVisualTableColumn,
  deleteVisualTableRow,
  forgetVisualTableCellFocus,
  insertVisualTableColumn,
  insertVisualTableRow,
  rememberVisualTableCellFocus,
  revealVisualTableSource,
  setVisualTableColumnAlignment,
  updateVisualTableCell,
} from '@/lib/visualTableCommands';
import { renderInlineMarkdownInto } from '@/lib/inlineMarkdown';
import {
  collectVisualTables,
  findVisualTableAt,
  formatVisualTableLabel,
  serializeVisualTableCell,
  VISUAL_TABLE_MAX_COLUMNS,
  VISUAL_TABLE_MAX_ROWS,
  visualTableCellNeighbor,
  type VisualTableAlignment,
  type VisualTableInfo,
  type VisualTableLabels,
} from '@/lib/visualTableModel';

let tableInstance = 0;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function alignmentCss(alignment: VisualTableAlignment): 'left' | 'center' | 'right' {
  return alignment === 'center' || alignment === 'right' ? alignment : 'left';
}

export function syncVisualTableCellInputs(container: HTMLElement, model: VisualTableInfo): void {
  const active = container.ownerDocument.activeElement;
  for (const input of container.querySelectorAll<HTMLInputElement>('input[data-row]')) {
    const row = Number(input.dataset.row);
    const column = Number(input.dataset.col);
    const source = model.cells[row]?.[column];
    if (source === undefined) continue;
    if (active !== input) {
      if (input.value !== source) input.value = source;
      input.dataset.source = source;
      // The read-only preview mirrors the committed source whenever the cell is
      // not being edited, so formatting stays rendered between keystrokes.
      const preview = input.parentElement?.querySelector<HTMLElement>('.cm-visual-table-preview');
      // Re-parsing every cell on each keystroke would be quadratic; only cells
      // whose committed source actually changed are re-rendered.
      if (preview && preview.dataset.source !== source) {
        preview.dataset.source = source;
        renderInlineMarkdownInto(preview, source);
      }
      const box = input.parentElement;
      if (box?.dataset.editing === 'true') box.dataset.editing = 'false';
    }
    input.readOnly = container.dataset.readOnly === 'true';
    const align = alignmentCss(model.alignments[column] ?? 'none');
    input.style.textAlign = align;
    const preview = input.parentElement?.querySelector<HTMLElement>('.cm-visual-table-preview');
    if (preview) preview.style.textAlign = align;
  }
}

function activeCoordinates(container: HTMLElement, model: VisualTableInfo): { row: number; column: number } {
  return {
    row: clamp(Number(container.dataset.activeRow ?? (model.rows > 1 ? 1 : 0)), 0, model.rows - 1),
    column: clamp(Number(container.dataset.activeCol ?? 0), 0, model.columns - 1),
  };
}

function refreshToolbar(container: HTMLElement, model: VisualTableInfo, _row: number, column: number): void {
  const readOnly = container.dataset.readOnly === 'true';
  const labels = (container as HTMLElement & { readonly visualTableLabels?: VisualTableLabels }).visualTableLabels;
  const alignment = model.alignments[column] ?? 'none';
  for (const button of container.querySelectorAll<HTMLButtonElement>('button[data-action]')) {
    const action = button.dataset.action ?? '';
    let disabled = readOnly;
    if (action === 'addRow') disabled ||= model.rows >= VISUAL_TABLE_MAX_ROWS;
    else if (action === 'deleteRow') disabled ||= model.rows <= 1;
    else if (action === 'addColumn') disabled ||= model.columns >= VISUAL_TABLE_MAX_COLUMNS;
    else if (action === 'deleteColumn') disabled ||= model.columns <= 1;
    button.setAttribute('aria-disabled', String(disabled));
    button.title = button.textContent ?? '';
    if (action.startsWith('align-')) {
      button.setAttribute('aria-pressed', String(alignment === action.slice('align-'.length)));
    }
    if (disabled && labels) {
      if (action === 'addRow' && model.rows >= VISUAL_TABLE_MAX_ROWS) {
        button.title = formatVisualTableLabel(labels.rowLimit, { rows: VISUAL_TABLE_MAX_ROWS });
      } else if (action === 'addColumn' && model.columns >= VISUAL_TABLE_MAX_COLUMNS) {
        button.title = formatVisualTableLabel(labels.columnLimit, { columns: VISUAL_TABLE_MAX_COLUMNS });
      }
    }
  }
  const grid = container.querySelector('[role=grid]');
  grid?.setAttribute('aria-rowcount', String(model.rows));
  grid?.setAttribute('aria-colcount', String(model.columns));
}

/**
 * A block widget that replaces a whole table with an editable grid. Inputs are
 * real `<input>` elements; the Markdown source stays the single source of
 * truth and every input event is a local transaction.
 */
export class VisualTableWidget extends WidgetType {
  constructor(
    readonly model: VisualTableInfo,
    readonly labels: VisualTableLabels,
    readonly readOnly: boolean
  ) {
    super();
  }

  eq(other: VisualTableWidget): boolean {
    return other instanceof VisualTableWidget &&
      other.model.from === this.model.from &&
      other.model.source === this.model.source &&
      other.labels === this.labels &&
      other.readOnly === this.readOnly;
  }

  get estimatedHeight(): number {
    return Math.min(560, 72 + this.model.rows * 34);
  }

  toDOM(view: EditorView): HTMLElement {
    return buildVisualTableDom(this, view);
  }

  updateDOM(dom: HTMLElement, _view: EditorView, old: WidgetType): boolean {
    if (!(old instanceof VisualTableWidget)) return false;
    // Structure and labels need a fresh grid; a pure value/position/read-only
    // change keeps the focused input (and the IME composition) alive.
    if (old.model.rows !== this.model.rows || old.model.columns !== this.model.columns || old.labels !== this.labels) {
      return false;
    }
    const container = dom;
    container.dataset.tableFrom = String(this.model.from);
    container.dataset.tableSource = this.model.source;
    container.dataset.readOnly = String(this.readOnly);
    (container as HTMLElement & { visualTableLabels?: VisualTableLabels }).visualTableLabels = this.labels;
    syncVisualTableCellInputs(container, this.model);
    const active = activeCoordinates(container, this.model);
    refreshToolbar(container, this.model, active.row, active.column);
    return true;
  }

  ignoreEvent(_event: Event): boolean {
    return true;
  }

  destroy(dom: HTMLElement): void {
    // A blur fired while CodeMirror tears the widget down must not dispatch a
    // nested transaction; every input event is already synced to the document.
    dom.dataset.destroyed = 'true';
  }
}

function buildVisualTableDom(widget: VisualTableWidget, view: EditorView): HTMLElement {
  const { model, labels } = widget;
  const doc = view.dom.ownerDocument;
  const instance = `cm-visual-table-${++tableInstance}`;
  const container = doc.createElement('div');
  container.className = 'cm-visual-table';
  container.dataset.tableFrom = String(model.from);
  container.dataset.tableSource = model.source;
  container.dataset.readOnly = String(widget.readOnly);
  container.dataset.activeRow = String(model.rows > 1 ? 1 : 0);
  container.dataset.activeCol = '0';
  container.contentEditable = 'false';
  (container as HTMLElement & { visualTableLabels?: VisualTableLabels }).visualTableLabels = labels;

  const resolve = (): VisualTableInfo | null => {
    try {
      const position = view.posAtDOM(container);
      return findVisualTableAt(collectVisualTables(view.state), position);
    } catch {
      return null;
    }
  };

  const toolbar = doc.createElement('div');
  toolbar.className = 'cm-visual-table-toolbar';
  toolbar.setAttribute('role', 'toolbar');
  toolbar.setAttribute('aria-label', labels.toolbar);
  toolbar.setAttribute('aria-orientation', 'horizontal');

  const status = doc.createElement('span');
  status.className = 'cm-visual-table-status';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  status.setAttribute('aria-atomic', 'true');

  const announce = (message: string) => {
    status.textContent = message;
  };

  const addButton = (action: string, label: string, parent: HTMLElement = toolbar): HTMLButtonElement => {
    const button = doc.createElement('button');
    button.type = 'button';
    button.className = 'cm-visual-table-tool';
    button.dataset.action = action;
    button.textContent = label;
    button.title = label;
    button.setAttribute('aria-label', label);
    parent.appendChild(button);
    return button;
  };

  const separator = (parent: HTMLElement = toolbar) => {
    const span = doc.createElement('span');
    span.className = 'cm-visual-table-separator';
    span.setAttribute('role', 'separator');
    span.setAttribute('aria-orientation', 'vertical');
    parent.appendChild(span);
  };

  addButton('addRow', labels.addRow);
  addButton('deleteRow', labels.deleteRow);
  separator();
  addButton('addColumn', labels.addColumn);
  addButton('deleteColumn', labels.deleteColumn);
  separator();
  const alignGroup = doc.createElement('div');
  alignGroup.className = 'cm-visual-table-align';
  alignGroup.setAttribute('role', 'group');
  alignGroup.setAttribute('aria-label', labels.alignGroup);
  toolbar.appendChild(alignGroup);
  addButton('align-left', labels.alignLeft, alignGroup);
  addButton('align-center', labels.alignCenter, alignGroup);
  addButton('align-right', labels.alignRight, alignGroup);
  addButton('align-none', labels.alignDefault, alignGroup);
  separator();
  addButton('source', labels.editSource);

  const grid = doc.createElement('div');
  grid.className = 'cm-visual-table-grid';
  const table = doc.createElement('table');
  table.className = 'cm-visual-table-element';
  table.setAttribute('role', 'grid');
  table.setAttribute('aria-label', labels.label);
  table.setAttribute('aria-describedby', `${instance}-hint`);
  table.setAttribute('aria-rowcount', String(model.rows));
  table.setAttribute('aria-colcount', String(model.columns));

  const composing = new Map<HTMLInputElement, boolean>();

  const focusCell = (row: number, column: number, select: boolean): boolean => {
    const input = container.querySelector<HTMLInputElement>(
      `input[data-row="${row}"][data-col="${column}"]`
    );
    if (!input) return false;
    input.focus();
    if (select) input.select();
    else {
      const end = input.value.length;
      input.setSelectionRange(end, end);
    }
    return true;
  };

  const focusCellAfterUpdate = (tableFrom: number, row: number, column: number) => {
    const attempt = (): boolean => {
      const input = view.dom.querySelector<HTMLInputElement>(
        `.cm-visual-table[data-table-from="${tableFrom}"] input[data-row="${row}"][data-col="${column}"]`
      );
      if (!input) return false;
      input.focus();
      input.select();
      return true;
    };
    if (attempt()) return;
    requestAnimationFrame(() => {
      if (!attempt()) view.focus();
    });
  };

  const syncFocusedCell = (input: HTMLInputElement, table: VisualTableInfo, row: number, column: number) => {
    const source = table.cells[row]?.[column];
    if (source === undefined) return;
    const caret = input.selectionStart ?? source.length;
    input.value = source;
    input.dataset.source = source;
    const position = Math.min(caret, source.length);
    try {
      input.setSelectionRange(position, position);
    } catch {
      // The input was detached by a structural update.
    }
    container.dataset.tableSource = table.source;
    refreshToolbar(container, table, row, column);
  };

  const commitCell = (input: HTMLInputElement, row: number, column: number) => {
    if (view.state.readOnly) return;
    // Never dispatch while the widget is being destroyed (mode switch, undo
    // that falls back to source, reconfiguration): CodeMirror is mid-update.
    if (container.dataset.destroyed === 'true' || !container.isConnected) return;
    const table = resolve();
    if (!table) return;
    const source = table.cells[row]?.[column];
    if (source === undefined) return;
    if (input.dataset.source !== source) {
      // The document changed underneath this cell; never overwrite it with
      // text that was typed against an older source.
      syncFocusedCell(input, table, row, column);
      announce(labels.stale);
      return;
    }
    const serialized = serializeVisualTableCell(input.value);
    if (serialized === source) {
      input.dataset.source = serialized;
      return;
    }
    if (updateVisualTableCell(view, table.from, row, column, input.value, source)) {
      input.dataset.source = serialized;
      const updated = resolve();
      if (updated) container.dataset.tableSource = updated.source;
      refreshToolbar(container, updated ?? table, row, column);
    } else {
      const updated = resolve();
      if (updated) syncFocusedCell(input, updated, row, column);
    }
  };

  const applyHistory = (redoAction: boolean, input: HTMLInputElement, row: number, column: number) => {
    if (redoAction) redo(view);
    else undo(view);
    const table = resolve();
    if (!table) {
      view.focus();
      return;
    }
    const nextRow = Math.min(row, table.rows - 1);
    const nextColumn = Math.min(column, table.columns - 1);
    if (nextRow === row && nextColumn === column) syncFocusedCell(input, table, row, column);
    else focusCellAfterUpdate(table.from, nextRow, nextColumn);
  };

  const moveCell = (direction: 1 | -1, row: number, column: number) => {
    const table = resolve();
    if (!table) return;
    const next = visualTableCellNeighbor(table.rows, table.columns, row, column, direction);
    focusCell(next.row, next.column, true);
  };

  const moveRow = (direction: 1 | -1, row: number, column: number) => {
    const table = resolve();
    if (!table) return;
    focusCell(clamp(row + direction, 0, table.rows - 1), column, false);
  };

  const handleAction = (action: string) => {
    if (view.state.readOnly && action !== 'source') return;
    const table = resolve();
    if (!table) {
      announce(labels.stale);
      return;
    }
    const active = activeCoordinates(container, table);
    let ok: boolean;
    let message: string;
    let targetRow = active.row;
    let targetColumn = active.column;
    switch (action) {
      case 'addRow':
        ok = insertVisualTableRow(view, table.from, active.row, table.source);
        targetRow = Math.min(active.row + 1, table.rows);
        message = labels.rowAdded;
        break;
      case 'deleteRow':
        ok = deleteVisualTableRow(view, table.from, active.row, table.source);
        targetRow = Math.max(0, Math.min(active.row, table.rows - 2));
        message = labels.rowDeleted;
        break;
      case 'addColumn':
        ok = insertVisualTableColumn(view, table.from, active.column, table.source);
        targetColumn = Math.min(active.column + 1, table.columns);
        message = labels.columnAdded;
        break;
      case 'deleteColumn':
        ok = deleteVisualTableColumn(view, table.from, active.column, table.source);
        targetColumn = Math.max(0, Math.min(active.column, table.columns - 2));
        message = labels.columnDeleted;
        break;
      case 'align-left':
      case 'align-center':
      case 'align-right':
      case 'align-none': {
        const alignment = action.slice('align-'.length) as VisualTableAlignment;
        ok = setVisualTableColumnAlignment(view, table.from, active.column, alignment, table.source);
        message = labels.alignmentChanged;
        break;
      }
      case 'source':
        if (revealVisualTableSource(view, table.from, active.row, active.column)) view.focus();
        return;
      default:
        return;
    }
    if (!ok) {
      if (action === 'addRow' && table.rows >= VISUAL_TABLE_MAX_ROWS) {
        announce(formatVisualTableLabel(labels.rowLimit, { rows: VISUAL_TABLE_MAX_ROWS }));
      } else if (action === 'addColumn' && table.columns >= VISUAL_TABLE_MAX_COLUMNS) {
        announce(formatVisualTableLabel(labels.columnLimit, { columns: VISUAL_TABLE_MAX_COLUMNS }));
      } else {
        announce(labels.stale);
      }
      return;
    }
    announce(message);
    const updated = resolve();
    if (updated) {
      container.dataset.tableSource = updated.source;
      container.dataset.activeRow = String(clamp(targetRow, 0, updated.rows - 1));
      container.dataset.activeCol = String(clamp(targetColumn, 0, updated.columns - 1));
    }
    focusCellAfterUpdate(table.from, targetRow, targetColumn);
  };

  toolbar.addEventListener('click', (event) => {
    const target = event.target as HTMLElement | null;
    const button = target?.closest<HTMLButtonElement>('button[data-action]');
    if (!button) return;
    event.preventDefault();
    if (button.getAttribute('aria-disabled') === 'true') return;
    handleAction(button.dataset.action ?? '');
  });

  toolbar.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      const table = resolve();
      if (!table) return;
      const active = activeCoordinates(container, table);
      focusCell(active.row, active.column, false);
      return;
    }
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft' && event.key !== 'Home' && event.key !== 'End') {
      return;
    }
    const buttons = Array.from(toolbar.querySelectorAll<HTMLButtonElement>('button[data-action]'));
    const current = buttons.indexOf(doc.activeElement as HTMLButtonElement);
    if (current < 0) return;
    event.preventDefault();
    let next: number;
    if (event.key === 'ArrowRight') next = (current + 1) % buttons.length;
    else if (event.key === 'ArrowLeft') next = (current - 1 + buttons.length) % buttons.length;
    else if (event.key === 'Home') next = 0;
    else next = buttons.length - 1;
    buttons[next].focus();
  });

  // Inputs and the toolbar are an editing island inside the contenteditable
  // editor. Keep their DOM events away from application-level shortcuts
  // (Ctrl+N/W/H, paste-image handlers, document drop handlers, ...), except
  // saving: every input event is already in the document, so Ctrl/Cmd+S is
  // allowed to reach the app.
  const isSaveShortcut = (event: KeyboardEvent) =>
    (event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 's';
  for (const type of [
    'keydown', 'keypress', 'keyup', 'input', 'beforeinput',
    'compositionstart', 'compositionupdate', 'compositionend',
    'paste', 'copy', 'cut', 'drop', 'dragover',
  ] as const) {
    container.addEventListener(type, (event) => {
      if ((type === 'keydown' || type === 'keypress' || type === 'keyup') &&
          isSaveShortcut(event as KeyboardEvent)) return;
      event.stopPropagation();
    });
  }

  const createInput = (row: number, column: number, template: string): HTMLInputElement => {
    const input = doc.createElement('input');
    input.type = 'text';
    input.className = 'cm-visual-table-cell';
    input.dataset.row = String(row);
    input.dataset.col = String(column);
    input.value = model.cells[row][column];
    input.dataset.source = model.cells[row][column];
    input.readOnly = widget.readOnly;
    input.spellcheck = false;
    input.autocomplete = 'off';
    input.setAttribute('autocapitalize', 'off');
    input.setAttribute('autocorrect', 'off');
    input.setAttribute('aria-label', formatVisualTableLabel(template, { row: row + 1, column: column + 1 }));
    input.setAttribute('aria-describedby', `${instance}-hint`);
    input.style.textAlign = alignmentCss(model.alignments[column] ?? 'none');
    composing.set(input, false);

    input.addEventListener('focus', () => {
      container.dataset.activeRow = String(row);
      container.dataset.activeCol = String(column);
      rememberVisualTableCellFocus(view, container, input);
      const table = resolve();
      if (table) refreshToolbar(container, table, row, column);
    });
    input.addEventListener('compositionstart', () => composing.set(input, true));
    input.addEventListener('compositionend', () => {
      composing.set(input, false);
      commitCell(input, row, column);
    });
    input.addEventListener('input', () => {
      // Sync the document on every input, even while an IME composition is
      // active. The focused input is never rewritten by updateDOM, so the
      // composition keeps going; a save or mode switch can no longer drop text
      // that only existed inside the input element.
      rememberVisualTableCellFocus(view, container, input);
      commitCell(input, row, column);
    });
    input.addEventListener('blur', (event) => {
      composing.set(input, false);
      // Keep the cell target when focus moves to a toolbar outside the editor
      // (format buttons call applyFocusedVisualTableAction); drop it when focus
      // moves into the editor body.
      const next = event.relatedTarget as Node | null;
      if (next && view.dom.contains(next) && !container.contains(next)) {
        forgetVisualTableCellFocus(view);
      }
      // CodeMirror may destroy the widget while the browser fires blur; do not
      // dispatch a nested transaction in that window.
      if (container.dataset.destroyed === 'true' || !container.isConnected) return;
      commitCell(input, row, column);
    });
    input.addEventListener('keydown', (event) => {
      if (event.isComposing || composing.get(input)) return;
      const mod = event.ctrlKey || event.metaKey;
      if (mod && !event.altKey && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        event.stopPropagation();
        applyHistory(event.shiftKey, input, row, column);
        return;
      }
      if (mod && !event.altKey && event.key.toLowerCase() === 'y') {
        event.preventDefault();
        event.stopPropagation();
        applyHistory(true, input, row, column);
        return;
      }
      if (mod && event.key.toLowerCase() === 'a') {
        event.preventDefault();
        event.stopPropagation();
        input.select();
        return;
      }
      if (event.altKey && event.key === 'F10') {
        event.preventDefault();
        event.stopPropagation();
        toolbar.querySelector<HTMLButtonElement>('button[data-action]')?.focus();
        return;
      }
      switch (event.key) {
        case 'Tab':
          event.preventDefault();
          event.stopPropagation();
          commitCell(input, row, column);
          moveCell(event.shiftKey ? -1 : 1, row, column);
          break;
        case 'Enter':
          event.preventDefault();
          event.stopPropagation();
          commitCell(input, row, column);
          moveRow(event.shiftKey ? -1 : 1, row, column);
          break;
        case 'Escape': {
          event.preventDefault();
          event.stopPropagation();
          commitCell(input, row, column);
          const table = resolve();
          if (table && revealVisualTableSource(view, table.from, row, column)) view.focus();
          break;
        }
        default:
          break;
      }
    });
    return input;
  };

  const createCellBox = (row: number, column: number, template: string): HTMLElement => {
    const box = doc.createElement('div');
    box.className = 'cm-visual-table-cellbox';
    box.dataset.editing = 'false';
    const preview = doc.createElement('div');
    preview.className = 'cm-visual-table-preview';
    preview.setAttribute('aria-hidden', 'true');
    preview.style.textAlign = alignmentCss(model.alignments[column] ?? 'none');
    renderInlineMarkdownInto(preview, model.cells[row][column]);
    preview.dataset.source = model.cells[row][column];
    const input = createInput(row, column, template);
    input.addEventListener('focus', () => { box.dataset.editing = 'true'; });
    input.addEventListener('blur', () => {
      box.dataset.editing = 'false';
      const committed = serializeVisualTableCell(input.value);
      preview.dataset.source = committed;
      renderInlineMarkdownInto(preview, committed);
    });
    box.append(preview, input);
    return box;
  };

  const head = doc.createElement('thead');
  const headRow = doc.createElement('tr');
  headRow.setAttribute('role', 'row');
  headRow.setAttribute('aria-rowindex', '1');
  for (let column = 0; column < model.columns; column++) {
    const cell = doc.createElement('th');
    cell.setAttribute('role', 'columnheader');
    cell.setAttribute('scope', 'col');
    cell.setAttribute('aria-colindex', String(column + 1));
    cell.appendChild(createCellBox(0, column, labels.headerLabel));
    headRow.appendChild(cell);
  }
  head.appendChild(headRow);

  const body = doc.createElement('tbody');
  for (let row = 1; row < model.rows; row++) {
    const tr = doc.createElement('tr');
    tr.setAttribute('role', 'row');
    tr.setAttribute('aria-rowindex', String(row + 1));
    for (let column = 0; column < model.columns; column++) {
      const cell = doc.createElement('td');
      cell.setAttribute('role', 'gridcell');
      cell.setAttribute('aria-colindex', String(column + 1));
      const cellBox = createCellBox(row, column, labels.cellLabel);
      const input = cellBox.querySelector<HTMLInputElement>('input');
      cell.addEventListener('mousedown', (event) => {
        if (event.target !== cellBox && event.target !== input) {
          event.preventDefault();
          input?.focus();
        }
      });
      cell.appendChild(cellBox);
      tr.appendChild(cell);
    }
    body.appendChild(tr);
  }
  table.append(head, body);
  grid.appendChild(table);

  const hint = doc.createElement('span');
  hint.className = 'cm-visual-table-hint';
  hint.id = `${instance}-hint`;
  hint.textContent = labels.hint;

  container.append(toolbar, grid, hint, status);
  refreshToolbar(container, model, model.rows > 1 ? 1 : 0, 0);
  return container;
}
