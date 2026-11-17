import {
  type EditorState,
  Facet,
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
import {
  executeCodeMirrorAction,
  type MarkdownAction,
  type MarkdownLocaleInput,
} from '@/lib/markdownCommands';
import { getActiveMarkdownFormats } from '@/lib/markdownFormatting';
import {
  isVisualOpaqueRange,
  visualEditorFocus,
  visualEditorFocusExtension,
  visualViewWindow,
} from '@/lib/visualSelectionCore';

/** Inline formats offered by the selection toolbar, in display order. */
export type VisualToolbarAction = Extract<
  MarkdownAction,
  'bold' | 'italic' | 'strike' | 'inline-code' | 'link'
>;

export const VISUAL_TOOLBAR_ACTIONS: readonly VisualToolbarAction[] = Object.freeze([
  'bold',
  'italic',
  'strike',
  'inline-code',
  'link',
]);

/** UI strings, supplied by the host from the `visualTools` locale root. */
export interface VisualSelectionToolbarLabels {
  /** Accessible name of the toolbar (role="toolbar"). */
  label: string;
  bold: string;
  italic: string;
  strike: string;
  inlineCode: string;
  link: string;
  /** Keyboard hint shown to assistive tech (Alt+F10 / Tab / Escape). */
  hint: string;
}

export const DEFAULT_VISUAL_SELECTION_TOOLBAR_LABELS: VisualSelectionToolbarLabels = {
  label: '选区格式栏',
  bold: '加粗',
  italic: '斜体',
  strike: '删除线',
  inlineCode: '行内代码',
  link: '链接',
  hint: 'Alt+F10 打开格式栏，Tab 在按钮间移动，Esc 关闭',
};

/**
 * Decorative button glyphs. Text glyphs match the app's type-driven chrome;
 * the link button uses a fixed inline SVG (Lucide "link" geometry) instead of
 * an emoji so it renders identically on every platform.
 */
export type VisualToolbarGlyph =
  | { readonly text: string }
  | { readonly svg: readonly string[] };

export const VISUAL_TOOLBAR_GLYPHS: Record<VisualToolbarAction, VisualToolbarGlyph> = {
  bold: { text: 'B' },
  italic: { text: 'I' },
  strike: { text: 'S' },
  'inline-code': { text: '</>' },
  link: {
    svg: [
      'M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71',
      'M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71',
    ],
  },
};

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';

/** Fills a button with its decorative glyph (text or fixed SVG paths only). */
export function renderVisualToolbarGlyph(
  document: Document,
  element: HTMLElement,
  glyph: VisualToolbarGlyph
): void {
  if ('text' in glyph) {
    element.textContent = glyph.text;
    return;
  }
  const svg = document.createElementNS(SVG_NAMESPACE, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '14');
  svg.setAttribute('height', '14');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  for (const d of glyph.svg) {
    const path = document.createElementNS(SVG_NAMESPACE, 'path');
    path.setAttribute('d', d);
    svg.append(path);
  }
  element.append(svg);
}

const ACTION_LABEL_KEYS: Record<VisualToolbarAction, keyof VisualSelectionToolbarLabels> = {
  bold: 'bold',
  italic: 'italic',
  strike: 'strike',
  'inline-code': 'inlineCode',
  link: 'link',
};

/**
 * Selections larger than this are never offered formatting. Combined with the
 * opaque-range guard this keeps clicks away from hidden data payloads (an
 * inline image data URL is a single, otherwise ordinary, selection).
 */
export const VISUAL_TOOLBAR_MAX_SELECTION = 1000;

export type VisualToolbarBlockReason =
  | 'empty-selection'
  | 'multiple-selections'
  | 'readonly'
  | 'large-selection'
  | 'protected-syntax';

export interface VisualToolbarEligibility {
  eligible: boolean;
  from: number;
  to: number;
  reason: VisualToolbarBlockReason | null;
}

/**
 * Decides whether the floating toolbar may operate on the current selection.
 * Pure: derived only from the editor state (selection + Markdown syntax tree).
 */
export function getVisualToolbarEligibility(state: EditorState): VisualToolbarEligibility {
  const selection = state.selection;
  const main = selection.main;
  const from = main.from;
  const to = main.to;

  if (state.readOnly) return { eligible: false, from, to, reason: 'readonly' };
  if (selection.ranges.length > 1) {
    return { eligible: false, from, to, reason: 'multiple-selections' };
  }
  if (main.empty) return { eligible: false, from, to, reason: 'empty-selection' };
  if (to - from > VISUAL_TOOLBAR_MAX_SELECTION) {
    return { eligible: false, from, to, reason: 'large-selection' };
  }
  if (isVisualOpaqueRange(state, from, to)) {
    return { eligible: false, from, to, reason: 'protected-syntax' };
  }
  return { eligible: true, from, to, reason: null };
}

/** Active inline formats of the selection, in toolbar order. */
export function getVisualSelectionToolbarFormats(state: EditorState): VisualToolbarAction[] {
  const active = new Set<string>(getActiveMarkdownFormats(state));
  return VISUAL_TOOLBAR_ACTIONS.filter((action) => active.has(action));
}

interface VisualSelectionToolbarConfig {
  labels: VisualSelectionToolbarLabels;
  localeInput?: MarkdownLocaleInput;
}

const visualSelectionToolbarConfig = Facet.define<
  VisualSelectionToolbarConfig,
  VisualSelectionToolbarConfig | null
>({ combine: (values) => values[0] ?? null });

/** Toolbar DOM focus, mirrored into state so `showTooltip` can stay mounted. */
export const visualSelectionToolbarFocusEffect = StateEffect.define<boolean>();

/**
 * Escape dismissal for one selection range. Positions are cleared whenever the
 * selection or the document changes, so the toolbar comes back for new work.
 */
export const visualSelectionToolbarDismissEffect = StateEffect.define<{
  from: number;
  to: number;
}>();

interface VisualSelectionToolbarFieldState {
  focusWithin: boolean;
  dismissedFrom: number;
  dismissedTo: number;
}

export const visualSelectionToolbarState = StateField.define<VisualSelectionToolbarFieldState>({
  create: () => ({ focusWithin: false, dismissedFrom: -1, dismissedTo: -1 }),
  update(value, transaction) {
    const selectionChanged = !transaction.startState.selection.eq(transaction.state.selection);
    let focusWithin = value.focusWithin;
    let dismissedFrom = selectionChanged || transaction.docChanged ? -1 : value.dismissedFrom;
    let dismissedTo = selectionChanged || transaction.docChanged ? -1 : value.dismissedTo;
    for (const effect of transaction.effects) {
      if (effect.is(visualSelectionToolbarFocusEffect)) {
        focusWithin = effect.value;
      } else if (effect.is(visualSelectionToolbarDismissEffect)) {
        dismissedFrom = effect.value.from;
        dismissedTo = effect.value.to;
      }
    }
    if (
      !transaction.docChanged &&
      !selectionChanged &&
      focusWithin === value.focusWithin &&
      dismissedFrom === value.dismissedFrom &&
      dismissedTo === value.dismissedTo
    ) {
      return value;
    }
    // A different selection range must produce a new field value: the
    // `showTooltip` facet recomputes only when its dependency changes, and the
    // tooltip position must follow the new selection.
    return { focusWithin, dismissedFrom, dismissedTo };
  },
});

export interface VisualSelectionToolbarViewState {
  visible: boolean;
  from: number;
  to: number;
  formats: VisualToolbarAction[];
  reason: VisualToolbarBlockReason | null;
  dismissed: boolean;
  focused: boolean;
}

/**
 * Full toolbar view state. Returns `null` when the extension is not installed,
 * so callers (and tests) can probe a state without it.
 */
export function getVisualSelectionToolbarViewState(
  state: EditorState
): VisualSelectionToolbarViewState | null {
  const field = state.field(visualSelectionToolbarState, false);
  if (!field) return null;
  const eligibility = getVisualToolbarEligibility(state);
  const focused = state.field(visualEditorFocus, false) === true || field.focusWithin;
  const dismissed =
    eligibility.eligible &&
    field.dismissedFrom === eligibility.from &&
    field.dismissedTo === eligibility.to;
  return {
    visible: eligibility.eligible && focused && !dismissed,
    from: eligibility.from,
    to: eligibility.to,
    formats: eligibility.eligible ? getVisualSelectionToolbarFormats(state) : [],
    reason: eligibility.reason,
    dismissed,
    focused,
  };
}

/** Escape: close the toolbar for the current selection and take focus back. */
export function dismissVisualSelectionToolbar(view: EditorView): boolean {
  const toolbar = getVisualSelectionToolbarViewState(view.state);
  if (!toolbar || !toolbar.visible) return false;
  view.dispatch({
    effects: visualSelectionToolbarDismissEffect.of({ from: toolbar.from, to: toolbar.to }),
  });
  view.focus();
  return true;
}

function toolbarButtons(view: EditorView): HTMLElement[] {
  const toolbar = view.dom.querySelector('.cm-visual-toolbar');
  if (!toolbar) return [];
  return Array.from(toolbar.querySelectorAll<HTMLElement>('button.cm-visual-toolbar-button'));
}

/** Tab: move keyboard focus onto the first toolbar button. */
export function focusVisualSelectionToolbar(view: EditorView): boolean {
  const toolbar = getVisualSelectionToolbarViewState(view.state);
  if (!toolbar || !toolbar.visible) return false;
  const buttons = toolbarButtons(view);
  if (buttons.length === 0) return false;
  buttons[0].focus();
  return true;
}

/**
 * Alt+F10: reopen a dismissed toolbar and focus its first button. The tooltip
 * DOM may be created during the same dispatch; the deferred retry covers the
 * measurement frame in which the button does not exist yet.
 */
export function openVisualSelectionToolbar(view: EditorView): boolean {
  if (!getVisualToolbarEligibility(view.state).eligible) return false;
  const toolbar = getVisualSelectionToolbarViewState(view.state);
  if (toolbar?.dismissed) {
    view.dispatch({
      effects: visualSelectionToolbarDismissEffect.of({ from: -1, to: -1 }),
    });
  }
  if (focusVisualSelectionToolbar(view)) return true;
  visualViewWindow(view)?.setTimeout(() => {
    focusVisualSelectionToolbar(view);
  }, 0);
  return true;
}

function createVisualSelectionToolbarView(view: EditorView): TooltipView {
  const document = view.dom.ownerDocument;
  const dom = document.createElement('div');
  dom.className = 'cm-visual-toolbar';
  dom.setAttribute('role', 'toolbar');
  dom.setAttribute('aria-orientation', 'horizontal');
  dom.setAttribute('aria-keyshortcuts', 'Alt+F10');

  const hint = document.createElement('span');
  hint.className = 'cm-visual-toolbar-hint';

  const buttons: Array<{ action: VisualToolbarAction; element: HTMLButtonElement }> = [];
  for (const action of VISUAL_TOOLBAR_ACTIONS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'cm-visual-toolbar-button';
    button.dataset.action = action;
    renderVisualToolbarGlyph(document, button, VISUAL_TOOLBAR_GLYPHS[action]);
    // Keep the editor selection and focus: a toolbar click must never move the
    // caret or collapse the range the format applies to.
    button.addEventListener('mousedown', (event) => event.preventDefault());
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const config = view.state.facet(visualSelectionToolbarConfig);
      executeCodeMirrorAction(view, action, config?.localeInput);
    });
    buttons.push({ action, element: button });
    dom.append(button);
  }
  dom.append(hint);

  const refresh = (state: EditorState): void => {
    const config = state.facet(visualSelectionToolbarConfig);
    const labels = config?.labels ?? DEFAULT_VISUAL_SELECTION_TOOLBAR_LABELS;
    dom.setAttribute('aria-label', labels.label);
    hint.textContent = labels.hint;
    const pressed = new Set<string>(getVisualSelectionToolbarFormats(state));
    for (const { action, element } of buttons) {
      const label = labels[ACTION_LABEL_KEYS[action]];
      element.setAttribute('aria-label', label);
      element.title = label;
      element.setAttribute('aria-pressed', pressed.has(action) ? 'true' : 'false');
    }
  };

  // Window-level shortcut handlers must never see keys typed into the toolbar.
  dom.addEventListener('keydown', (event) => {
    event.stopPropagation();
    if (event.key === 'Escape') {
      event.preventDefault();
      dismissVisualSelectionToolbar(view);
    }
  });
  dom.addEventListener('mousedown', (event) => event.preventDefault());

  // Focus changes are mirrored into state, but never synchronously: removing
  // the focused tooltip (Escape, selection change, reconfigure) fires
  // `focusout` from inside CodeMirror's own update, and dispatching there
  // throws "Calls to EditorView.update are not allowed while an update is in
  // progress". The deferred task also re-checks that the widget is still
  // mounted and attached.
  const win = visualViewWindow(view);
  let destroyed = false;
  let focusTimer: number | null = null;

  const applyFocusWithin = (focusWithin: boolean): void => {
    if (destroyed || !dom.isConnected) return;
    if (view.state.field(visualSelectionToolbarState, false)?.focusWithin === focusWithin) return;
    view.dispatch({ effects: visualSelectionToolbarFocusEffect.of(focusWithin) });
  };

  const scheduleFocusWithin = (focusWithin: boolean): void => {
    if (destroyed) return;
    if (!win) {
      applyFocusWithin(focusWithin);
      return;
    }
    if (focusTimer !== null) win.clearTimeout(focusTimer);
    focusTimer = win.setTimeout(() => {
      focusTimer = null;
      applyFocusWithin(focusWithin);
    }, 0);
  };

  dom.addEventListener('focusin', () => scheduleFocusWithin(true));
  dom.addEventListener('focusout', (event) => {
    const next = event.relatedTarget as Node | null;
    if (next && dom.contains(next)) return;
    scheduleFocusWithin(false);
  });

  refresh(view.state);
  return {
    dom,
    update(update) {
      refresh(update.state);
    },
    destroy() {
      destroyed = true;
      if (focusTimer !== null) win?.clearTimeout(focusTimer);
      focusTimer = null;
    },
  };
}

/**
 * Keyboard entry points. `Tab`/`Escape` only claim the key while the toolbar is
 * actually visible, so indentation, table Tab navigation and multi-selection
 * Escape keep working everywhere else.
 */
export const visualSelectionToolbarKeyBindings: readonly KeyBinding[] = [
  { key: 'Alt-F10', run: (view) => openVisualSelectionToolbar(view) },
  { key: 'Tab', run: (view) => focusVisualSelectionToolbar(view) },
  { key: 'Escape', run: (view) => dismissVisualSelectionToolbar(view) },
];

const visualSelectionToolbarTheme = EditorView.baseTheme({
  '.cm-visual-toolbar': {
    display: 'flex',
    alignItems: 'center',
    gap: '2px',
    padding: '3px',
    borderRadius: '8px',
    backgroundColor: '#ffffff',
    border: '1px solid #e2e8f0',
    boxShadow: '0 6px 20px rgba(15, 23, 42, 0.16)',
  },
  '&dark .cm-visual-toolbar': {
    backgroundColor: '#1e293b',
    borderColor: '#334155',
    boxShadow: '0 6px 20px rgba(0, 0, 0, 0.45)',
  },
  '.cm-visual-toolbar-button': {
    minWidth: '28px',
    height: '26px',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '0 6px',
    border: '0',
    borderRadius: '6px',
    backgroundColor: 'transparent',
    color: '#334155',
    font: 'inherit',
    fontSize: '13px',
    lineHeight: '1',
    cursor: 'pointer',
  },
  '&dark .cm-visual-toolbar-button': { color: '#e2e8f0' },
  '.cm-visual-toolbar-button:hover': { backgroundColor: '#f1f5f9' },
  '&dark .cm-visual-toolbar-button:hover': { backgroundColor: '#334155' },
  '.cm-visual-toolbar-button[aria-pressed=true]': {
    backgroundColor: '#dbeafe',
    color: '#1d4ed8',
  },
  '&dark .cm-visual-toolbar-button[aria-pressed=true]': {
    backgroundColor: '#1e3a8a',
    color: '#bfdbfe',
  },
  '.cm-visual-toolbar-button:focus-visible': {
    outline: '2px solid #3b82f6',
    outlineOffset: '1px',
  },
  '.cm-visual-toolbar-hint': {
    position: 'absolute',
    width: '1px',
    height: '1px',
    margin: '-1px',
    padding: '0',
    overflow: 'hidden',
    clip: 'rect(0 0 0 0)',
    whiteSpace: 'nowrap',
    border: '0',
  },
});

/**
 * Floating inline-format toolbar over the current selection (visual mode only).
 *
 * Shown through the `showTooltip` state field while the editor (or the toolbar
 * itself) has focus and the selection is a plain, single, small Markdown range.
 * Buttons execute the existing `executeCodeMirrorAction`; `aria-pressed`
 * mirrors `getActiveMarkdownFormats`.
 */
export function createVisualSelectionToolbar(
  labels: VisualSelectionToolbarLabels,
  localeInput?: MarkdownLocaleInput
): Extension {
  return [
    visualSelectionToolbarConfig.of({ labels, localeInput }),
    visualEditorFocusExtension,
    visualSelectionToolbarState,
    visualSelectionToolbarTheme,
    showTooltip.compute([visualSelectionToolbarState, visualEditorFocus], (state) => {
      const toolbar = getVisualSelectionToolbarViewState(state);
      if (!toolbar || !toolbar.visible) return null;
      return {
        pos: toolbar.from,
        end: toolbar.to,
        above: true,
        create: createVisualSelectionToolbarView,
      };
    }),
    Prec.highest(keymap.of(visualSelectionToolbarKeyBindings)),
  ];
}
