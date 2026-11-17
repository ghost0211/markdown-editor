import {
  type EditorState,
  Prec,
  StateEffect,
  StateField,
  type Extension,
} from '@codemirror/state';
import {
  EditorView,
  keymap,
  showTooltip,
  type KeyBinding,
  type TooltipView,
} from '@codemirror/view';
import type { MarkdownLocaleInput } from '@/lib/markdownCommands';
import {
  DEFAULT_SLASH_COMMAND_LABELS,
  applySlashCommand,
  buildSlashCommandItems,
  filterSlashCommandItems,
  findSlashQuery,
  slashCommandConfig,
  type SlashCommandEditor,
  type SlashCommandItem,
  type SlashCommandLabels,
  type SlashCommandConfig,
} from '@/lib/slashCommandsCore';
import {
  visualEditorFocus,
  visualEditorFocusExtension,
} from '@/lib/visualSelectionCore';

/** Move the highlighted row (wraps around both ends). */
export const slashMenuActiveEffect = StateEffect.define<number>();
/** Escape: hide the menu for the slash at this position without editing text. */
export const slashMenuDismissEffect = StateEffect.define<number>();

interface SlashMenuSnapshot {
  from: number;
  to: number;
  query: string;
  items: SlashCommandItem[];
}

interface SlashMenuRuntimeState {
  snapshot: SlashMenuSnapshot | null;
  activeIndex: number;
  dismissedFrom: number;
  config: SlashCommandConfig | null;
}

function snapshotKey(snapshot: SlashMenuSnapshot | null): string {
  return snapshot ? `${snapshot.from}:${snapshot.to}:${snapshot.query}` : '';
}

function deriveSnapshot(state: EditorState): SlashMenuSnapshot | null {
  const config = state.facet(slashCommandConfig);
  if (!config) return null;
  const query = findSlashQuery(state);
  if (!query) return null;
  const items = filterSlashCommandItems(buildSlashCommandItems(config.labels), query.query);
  if (items.length === 0) return null;
  return { from: query.from, to: query.to, query: query.query, items };
}

/**
 * Menu state derived from the editor state on every transaction. The query,
 * the filtered rows and the highlighted index live in one field so the
 * `showTooltip` facet never has to rescan the document and the menu DOM can be
 * updated in place.
 */
export const slashMenuState = StateField.define<SlashMenuRuntimeState>({
  create: (state) => {
    const config = state.facet(slashCommandConfig);
    return { snapshot: deriveSnapshot(state), activeIndex: 0, dismissedFrom: -1, config };
  },
  update(value, transaction) {
    const config = transaction.state.facet(slashCommandConfig);
    const derived = deriveSnapshot(transaction.state);
    const configChanged = config !== value.config;
    const keyChanged = configChanged || snapshotKey(derived) !== snapshotKey(value.snapshot);
    let activeIndex = value.activeIndex;
    let dismissedFrom = value.dismissedFrom;
    if (keyChanged) {
      // A new query (or a new label set) starts fresh: Escape only cancels the
      // menu that was open, it never silences later queries.
      activeIndex = 0;
      dismissedFrom = -1;
    } else if (dismissedFrom >= 0 && transaction.docChanged) {
      dismissedFrom = transaction.changes.mapPos(dismissedFrom, 1);
    }
    const snapshot = keyChanged ? derived : value.snapshot;
    for (const effect of transaction.effects) {
      if (effect.is(slashMenuActiveEffect)) {
        activeIndex = effect.value;
      } else if (effect.is(slashMenuDismissEffect)) {
        dismissedFrom = effect.value;
      }
    }
    if (snapshot && snapshot.items.length > 0) {
      activeIndex = Math.max(0, Math.min(activeIndex, snapshot.items.length - 1));
    } else {
      activeIndex = 0;
    }
    if (
      snapshot === value.snapshot &&
      activeIndex === value.activeIndex &&
      dismissedFrom === value.dismissedFrom &&
      config === value.config
    ) {
      return value;
    }
    return { snapshot, activeIndex, dismissedFrom, config };
  },
});

export interface SlashMenuViewSnapshot extends SlashMenuSnapshot {
  activeIndex: number;
}

/**
 * Pure snapshot of the open menu (current query, filtered rows and highlighted
 * index) or `null` when the caret is not on a slash trigger or the user
 * dismissed this trigger.
 */
export function getSlashMenuSnapshot(state: EditorState): SlashMenuViewSnapshot | null {
  const runtime = state.field(slashMenuState, false);
  if (!runtime || !runtime.snapshot) return null;
  if (runtime.snapshot.from === runtime.dismissedFrom) return null;
  const items = runtime.snapshot.items;
  const activeIndex = Math.max(0, Math.min(runtime.activeIndex, items.length - 1));
  return { from: runtime.snapshot.from, to: runtime.snapshot.to, query: runtime.snapshot.query, items, activeIndex };
}

/** The menu is only shown while the editor itself has focus. */
export function isSlashMenuOpen(state: EditorState): boolean {
  if (state.field(visualEditorFocus, false) !== true) return false;
  return getSlashMenuSnapshot(state) !== null;
}

/** ArrowUp/ArrowDown. */
export function moveSlashMenuActive(view: SlashCommandEditor, delta: number): boolean {
  const snapshot = getSlashMenuSnapshot(view.state);
  if (!snapshot) return false;
  const count = snapshot.items.length;
  const next = (((snapshot.activeIndex + delta) % count) + count) % count;
  view.dispatch({ effects: slashMenuActiveEffect.of(next) });
  return true;
}

/** Escape: cancel the menu without touching the document. */
export function dismissSlashMenu(view: SlashCommandEditor): boolean {
  const snapshot = getSlashMenuSnapshot(view.state);
  if (!snapshot) return false;
  view.dispatch({ effects: slashMenuDismissEffect.of(snapshot.from) });
  view.focus?.();
  return true;
}

/** Enter/Tab/click: insert the highlighted command. */
export function commitSlashMenu(view: SlashCommandEditor): boolean {
  if (view.composing === true) return false;
  const snapshot = getSlashMenuSnapshot(view.state);
  if (!snapshot) return false;
  const item = snapshot.items[snapshot.activeIndex];
  return item ? applySlashCommand(view, item.id) : false;
}

/** True while an IME owns the keyboard (Enter must commit the composition). */
export function isImeComposingEvent(
  event: Pick<KeyboardEvent, 'isComposing' | 'keyCode'>
): boolean {
  return event.isComposing === true || event.keyCode === 229;
}

/**
 * Editor key bindings. Highest precedence but inactive unless the menu is open;
 * every binding bails out while an IME composition is in progress so Enter,
 * Tab and the arrow keys keep driving the candidate window.
 */
export const slashMenuKeyBindings: readonly KeyBinding[] = [
  { key: 'ArrowDown', run: (view) => !view.composing && moveSlashMenuActive(view, 1) },
  { key: 'ArrowUp', run: (view) => !view.composing && moveSlashMenuActive(view, -1) },
  { key: 'Enter', run: (view) => !view.composing && commitSlashMenu(view) },
  { key: 'Tab', run: (view) => !view.composing && commitSlashMenu(view) },
  { key: 'Escape', run: (view) => !view.composing && dismissSlashMenu(view) },
];

let menuSequence = 0;

function createSlashMenuTooltipView(view: EditorView): TooltipView {
  const document = view.dom.ownerDocument;
  const id = `cm-slash-menu-${++menuSequence}`;
  const dom = document.createElement('div');
  dom.className = 'cm-slash-menu';
  dom.id = id;
  dom.tabIndex = -1;
  dom.setAttribute('role', 'listbox');
  dom.setAttribute('aria-orientation', 'vertical');

  let renderedKey = '';
  let renderedConfig: unknown = null;
  let renderedItems: SlashCommandItem[] = [];
  let optionElements: HTMLElement[] = [];
  const win = view.dom.ownerDocument.defaultView;
  let revealFrame: number | null = null;
  let activeOption: HTMLElement | null = null;
  let destroyed = false;

  /**
   * Scrolls only the menu's own scroll container and only after the update
   * finished: reading offsetTop/clientHeight during a CodeMirror update would
   * force a synchronous layout, and `scrollIntoView` could also scroll the page.
   */
  const revealActive = (): void => {
    const option = activeOption;
    if (!option || destroyed) return;
    const top = option.offsetTop;
    const bottom = top + option.offsetHeight;
    if (top < dom.scrollTop) dom.scrollTop = top;
    else if (bottom > dom.scrollTop + dom.clientHeight) dom.scrollTop = bottom - dom.clientHeight;
  };

  const scheduleReveal = (option: HTMLElement | null): void => {
    activeOption = option;
    if (destroyed || !win || revealFrame !== null) return;
    revealFrame = win.requestAnimationFrame(() => {
      revealFrame = null;
      revealActive();
    });
  };

  /** Rebuilds rows with `textContent` only: no HTML and no network access. */
  const render = (state: EditorState): void => {
    const config = state.facet(slashCommandConfig);
    const labels = config?.labels ?? DEFAULT_SLASH_COMMAND_LABELS;
    dom.setAttribute('aria-label', labels.menuLabel);
    const snapshot = getSlashMenuSnapshot(state);
    const key = snapshot ? `${snapshot.from}:${snapshot.to}:${snapshot.query}` : '';
    if (key !== renderedKey || config !== renderedConfig) {
      renderedKey = key;
      renderedConfig = config;
      renderedItems = snapshot ? [...snapshot.items] : [];
      optionElements = [];
      dom.replaceChildren();
      renderedItems.forEach((item, index) => {
        const option = document.createElement('div');
        option.className = 'cm-slash-option';
        option.id = `${id}-option-${index}`;
        option.setAttribute('role', 'option');
        option.setAttribute('aria-selected', 'false');
        option.dataset.command = item.id;
        const label = document.createElement('span');
        label.className = 'cm-slash-option-label';
        label.textContent = item.label;
        const detail = document.createElement('span');
        detail.className = 'cm-slash-option-detail';
        detail.textContent = item.detail;
        detail.setAttribute('aria-hidden', 'true');
        option.append(label, detail);
        option.addEventListener('mousedown', (event) => {
          // Keep the caret (and the query) in the editor for the click.
          event.preventDefault();
          event.stopPropagation();
        });
        option.addEventListener('click', (event) => {
          event.preventDefault();
          event.stopPropagation();
          applySlashCommand(view, item.id);
        });
        dom.append(option);
        optionElements.push(option);
      });
    }

    const activeIndex = snapshot ? snapshot.activeIndex : -1;
    optionElements.forEach((element, index) => {
      const selected = index === activeIndex;
      element.setAttribute('aria-selected', selected ? 'true' : 'false');
      element.classList.toggle('cm-slash-option-active', selected);
    });
    const active = activeIndex >= 0 ? optionElements[activeIndex] : undefined;
    if (active) {
      dom.setAttribute('aria-activedescendant', active.id);
      scheduleReveal(active);
    } else {
      dom.removeAttribute('aria-activedescendant');
      scheduleReveal(null);
    }
  };

  // Defensive DOM handlers: even if focus ever lands inside the menu, keys must
  // not reach window-level shortcuts or CodeMirror's own Enter handling.
  dom.addEventListener('keydown', (event) => {
    event.stopPropagation();
    if (isImeComposingEvent(event)) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      dismissSlashMenu(view);
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      moveSlashMenuActive(view, 1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      moveSlashMenuActive(view, -1);
    } else if (event.key === 'Enter' || event.key === 'Tab') {
      event.preventDefault();
      commitSlashMenu(view);
    }
  });
  dom.addEventListener('mousedown', (event) => {
    event.preventDefault();
    event.stopPropagation();
  });

  render(view.state);
  return {
    dom,
    update(update) {
      render(update.state);
    },
    destroy() {
      destroyed = true;
      if (revealFrame !== null) win?.cancelAnimationFrame(revealFrame);
      revealFrame = null;
      activeOption = null;
    },
  };
}

const slashMenuTheme = EditorView.baseTheme({
  '.cm-slash-menu': {
    minWidth: '220px',
    maxWidth: '320px',
    maxHeight: '264px',
    overflowY: 'auto',
    overscrollBehavior: 'contain',
    padding: '4px',
    borderRadius: '8px',
    backgroundColor: '#ffffff',
    border: '1px solid #e2e8f0',
    boxShadow: '0 10px 30px rgba(15, 23, 42, 0.18)',
  },
  '&dark .cm-slash-menu': {
    backgroundColor: '#1e293b',
    borderColor: '#334155',
    boxShadow: '0 10px 30px rgba(0, 0, 0, 0.5)',
  },
  '.cm-slash-option': {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '12px',
    padding: '6px 8px',
    borderRadius: '6px',
    color: '#334155',
    fontSize: '13px',
    lineHeight: '1.4',
    cursor: 'pointer',
  },
  '&dark .cm-slash-option': { color: '#e2e8f0' },
  '.cm-slash-option:hover': { backgroundColor: '#f1f5f9' },
  '&dark .cm-slash-option:hover': { backgroundColor: '#334155' },
  '.cm-slash-option-active, .cm-slash-option-active:hover': {
    backgroundColor: '#dbeafe',
    color: '#1d4ed8',
  },
  '&dark .cm-slash-option-active, &dark .cm-slash-option-active:hover': {
    backgroundColor: '#1e3a8a',
    color: '#bfdbfe',
  },
  '.cm-slash-option-label': {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  '.cm-slash-option-detail': {
    fontFamily: 'Consolas, monospace',
    fontSize: '0.85em',
    color: '#94a3b8',
  },
});

/**
 * `/` slash-command menu for visual mode.
 *
 * A tooltip listbox driven by a state field: `/` at the start of a normal line
 * opens it, ArrowUp/Down move the active row, Enter/Tab insert, Escape cancels
 * without touching text. Insertion removes the query and inserts the Markdown
 * in one line-scoped transaction, so it undoes as a single step.
 */
export function createSlashCommandExtension(
  labels: SlashCommandLabels,
  localeInput?: MarkdownLocaleInput
): Extension {
  return [
    slashCommandConfig.of({ labels, localeInput }),
    visualEditorFocusExtension,
    slashMenuState,
    slashMenuTheme,
    showTooltip.compute([slashMenuState, visualEditorFocus], (state) => {
      if (!isSlashMenuOpen(state)) return null;
      const snapshot = getSlashMenuSnapshot(state);
      if (!snapshot) return null;
      return {
        pos: snapshot.from,
        end: snapshot.to,
        above: false,
        create: createSlashMenuTooltipView,
      };
    }),
    Prec.highest(keymap.of(slashMenuKeyBindings)),
  ];
}
