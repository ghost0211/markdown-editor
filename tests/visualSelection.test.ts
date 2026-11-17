import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { EditorSelection, EditorState, type TransactionSpec } from '@codemirror/state';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { showTooltip, type EditorView, type Tooltip } from '@codemirror/view';
import { editorMarkdownFallbacks } from '../src/lib/editorMarkdown';
import {
  DEFAULT_VISUAL_SELECTION_TOOLBAR_LABELS,
  VISUAL_TOOLBAR_ACTIONS,
  VISUAL_TOOLBAR_GLYPHS,
  VISUAL_TOOLBAR_MAX_SELECTION,
  createVisualSelectionToolbar,
  getVisualSelectionToolbarFormats,
  getVisualSelectionToolbarViewState,
  getVisualToolbarEligibility,
  visualSelectionToolbarDismissEffect,
  visualSelectionToolbarFocusEffect,
  visualSelectionToolbarKeyBindings,
  type VisualSelectionToolbarLabels,
} from '../src/lib/visualSelectionToolbar';
import { isVisualOpaqueRange, visualEditorFocusEffect } from '../src/lib/visualSelectionCore';

const labels: VisualSelectionToolbarLabels = {
  ...DEFAULT_VISUAL_SELECTION_TOOLBAR_LABELS,
  label: 'Selection format',
  hint: 'Alt+F10 opens the toolbar',
};

function createState(doc: string, from = doc.length, to = from) {
  return EditorState.create({
    doc,
    selection: { anchor: from, head: to },
    extensions: [
      EditorState.allowMultipleSelections.of(true),
      markdown({ base: markdownLanguage, extensions: editorMarkdownFallbacks }),
      createVisualSelectionToolbar(labels),
    ],
  });
}

const focus = (state: EditorState, focused = true) =>
  state.update({ effects: visualEditorFocusEffect.of(focused) }).state;

const tooltips = (state: EditorState): Tooltip[] =>
  state.facet(showTooltip).filter((tooltip): tooltip is Tooltip => tooltip !== null);

/** Minimal view stand-in: state + dispatch is all the toolbar helpers need. */
function fakeView(initial: EditorState) {
  let state = initial;
  const specs: TransactionSpec[] = [];
  const view = {
    get state() {
      return state;
    },
    dispatch(spec: TransactionSpec) {
      specs.push(spec);
      state = state.update(spec).state;
    },
    focus: vi.fn(),
    dom: { querySelector: () => null, ownerDocument: { defaultView: null } },
  } as unknown as EditorView;
  return { view, specs, getState: () => state };
}

describe('visual selection toolbar eligibility', () => {
  it('requires a single, non-empty, small selection', () => {
    expect(getVisualToolbarEligibility(createState('hello', 2)).reason).toBe('empty-selection');

    const multiple = createState('one two three', 0, 3).update({
      selection: EditorSelection.create([EditorSelection.range(0, 3), EditorSelection.cursor(8)]),
    }).state;
    expect(getVisualToolbarEligibility(multiple).reason).toBe('multiple-selections');

    const large = createState('a'.repeat(1500), 0, VISUAL_TOOLBAR_MAX_SELECTION + 1);
    expect(getVisualToolbarEligibility(large).reason).toBe('large-selection');

    const readOnly = EditorState.create({
      doc: 'hello',
      selection: { anchor: 0, head: 5 },
      extensions: [EditorState.readOnly.of(true), createVisualSelectionToolbar(labels)],
    });
    expect(getVisualToolbarEligibility(readOnly).reason).toBe('readonly');

    expect(getVisualToolbarEligibility(createState('hello', 0, 5))).toMatchObject({
      eligible: true,
      from: 0,
      to: 5,
      reason: null,
    });
  });

  it('never floats over code, math, front matter, tables, HTML and image destinations', () => {
    const samples: Array<[string, string, string]> = [
      ['```md\ntitle **fake**\n```', 'title **fake**', 'fenced code'],
      ['    const x = 1', 'const x', 'indented code'],
      ['`inline **code**`', 'inline **code**', 'inline code'],
      ['$$\na * b\n$$', 'a * b', 'math block'],
      ['text $x * y$ end', 'x * y', 'inline math'],
      ['---\ntitle: **literal**\n---', 'title: **literal**', 'front matter'],
      ['| A | B |\n| - | - |\n| **cell** | text |', '**cell**', 'table'],
      ['<div>\n**literal**\n</div>', '**literal**', 'html block'],
      ['![a](https://example.com/a.png)', 'https://example.com/a.png', 'image destination'],
    ];
    for (const [doc, target, label] of samples) {
      const from = doc.indexOf(target);
      const state = createState(doc, from, from + target.length);
      expect(getVisualToolbarEligibility(state).reason, label).toBe('protected-syntax');
      expect(isVisualOpaqueRange(state, from, from + target.length), label).toBe(true);
    }
    // The same text outside those constructs stays eligible.
    expect(getVisualToolbarEligibility(createState('plain **bold** text', 6, 14)).eligible).toBe(
      true
    );
  });
});

describe('visual selection toolbar state', () => {
  it('shows only while focused and reports the active inline formats', () => {
    const doc = '**bold** and *italic*';
    const bold = doc.indexOf('bold');
    const italic = doc.indexOf('italic');

    const unfocused = createState(doc, bold, bold + 4);
    expect(getVisualSelectionToolbarViewState(unfocused)?.visible).toBe(false);
    expect(getVisualSelectionToolbarViewState(unfocused)?.focused).toBe(false);
    expect(tooltips(unfocused)).toHaveLength(0);

    const focused = focus(unfocused);
    const view = getVisualSelectionToolbarViewState(focused);
    expect(view?.visible).toBe(true);
    expect(view?.formats).toEqual(['bold']);
    expect(getVisualSelectionToolbarFormats(createState(doc, italic, italic + 6))).toEqual([
      'italic',
    ]);
    expect(tooltips(focused)).toHaveLength(1);
  });

  it('moves the tooltip to a different selection and hides it when eligibility drops', () => {
    const doc = 'alpha beta gamma';
    let state = focus(createState(doc, 0, 5));
    expect(getVisualSelectionToolbarViewState(state)?.visible).toBe(true);
    expect(tooltips(state)[0]).toMatchObject({ pos: 0, end: 5 });

    state = state.update({ selection: { anchor: 6, head: 11 } }).state;
    const moved = getVisualSelectionToolbarViewState(state);
    expect(moved?.visible).toBe(true);
    expect(moved?.from).toBe(6);
    expect(tooltips(state)[0]).toMatchObject({ pos: 6, end: 11 });

    // A second range blocks the toolbar even though the main selection is fine.
    state = state.update({
      selection: EditorSelection.create([
        EditorSelection.range(6, 11),
        EditorSelection.cursor(0),
      ]),
    }).state;
    expect(getVisualSelectionToolbarViewState(state)?.visible).toBe(false);
    expect(tooltips(state)).toHaveLength(0);

    state = state.update({ selection: { anchor: 0, head: 5 } }).state;
    expect(getVisualSelectionToolbarViewState(state)?.visible).toBe(true);
    expect(tooltips(state)[0]).toMatchObject({ pos: 0, end: 5 });
  });

  it('keeps showing while the toolbar itself holds keyboard focus', () => {
    let state = focus(createState('hello world', 0, 5));
    state = state.update({ effects: visualEditorFocusEffect.of(false) }).state;
    expect(getVisualSelectionToolbarViewState(state)?.visible).toBe(false);

    state = state.update({ effects: visualSelectionToolbarFocusEffect.of(true) }).state;
    const view = getVisualSelectionToolbarViewState(state);
    expect(view?.visible).toBe(true);
    expect(view?.focused).toBe(true);

    state = state.update({ effects: visualSelectionToolbarFocusEffect.of(false) }).state;
    expect(getVisualSelectionToolbarViewState(state)?.visible).toBe(false);
  });

  it('dismisses for the selection only and reopens for a new selection or document change', () => {
    const doc = 'hello world';
    let state = focus(createState(doc, 0, 5));
    state = state.update({ effects: visualSelectionToolbarDismissEffect.of({ from: 0, to: 5 }) })
      .state;
    expect(getVisualSelectionToolbarViewState(state)?.visible).toBe(false);
    expect(state.doc.toString()).toBe(doc);

    // Same selection with an unrelated state update stays dismissed.
    state = state.update({ effects: visualSelectionToolbarFocusEffect.of(false) }).state;
    state = state.update({ effects: visualSelectionToolbarFocusEffect.of(true) }).state;
    expect(getVisualSelectionToolbarViewState(state)?.visible).toBe(false);

    // A new selection range reopens it.
    state = state.update({ selection: { anchor: 6, head: 11 } }).state;
    expect(getVisualSelectionToolbarViewState(state)?.visible).toBe(true);
  });

  it('exposes the documented actions and a non-emoji glyph set', () => {
    expect(VISUAL_TOOLBAR_ACTIONS).toEqual(['bold', 'italic', 'strike', 'inline-code', 'link']);
    expect('svg' in VISUAL_TOOLBAR_GLYPHS.link).toBe(true);
    expect('text' in VISUAL_TOOLBAR_GLYPHS.bold && VISUAL_TOOLBAR_GLYPHS.bold.text).toBe('B');
    expect(JSON.stringify(VISUAL_TOOLBAR_GLYPHS)).not.toMatch(/[\u{1f300}-\u{1faff}]/u);
    expect(Object.keys(VISUAL_TOOLBAR_GLYPHS).sort()).toEqual([...VISUAL_TOOLBAR_ACTIONS].sort());
  });

  it('dismisses on Escape without editing text and leaves the key alone when hidden', () => {
    const escape = visualSelectionToolbarKeyBindings.find((binding) => binding.key === 'Escape');
    expect(escape?.run).toBeTypeOf('function');

    const hidden = fakeView(focus(createState('hello world', 6)));
    expect(escape?.run?.(hidden.view)).toBe(false);

    const shown = fakeView(focus(createState('hello world', 0, 5)));
    expect(escape?.run?.(shown.view)).toBe(true);
    expect(getVisualSelectionToolbarViewState(shown.getState())?.visible).toBe(false);
    expect(shown.getState().doc.toString()).toBe('hello world');
    expect(shown.view.focus).toHaveBeenCalled();
  });

  it('keeps Tab/Alt+F10 inert when no toolbar DOM exists yet', () => {
    const { view, getState } = fakeView(focus(createState('hello world', 0, 5)));
    for (const key of ['Tab', 'Alt-F10']) {
      const binding = visualSelectionToolbarKeyBindings.find((entry) => entry.key === key);
      expect(binding?.run?.(view), key).toBe(key === 'Alt-F10');
    }
    expect(getState().doc.toString()).toBe('hello world');
  });
});

describe('visual selection toolbar DOM contract', () => {
  const source = readFileSync(
    new URL('../src/lib/visualSelectionToolbar.ts', import.meta.url),
    'utf8'
  );
  const coreSource = readFileSync(
    new URL('../src/lib/visualSelectionCore.ts', import.meta.url),
    'utf8'
  );

  it('keeps the editor-focus mirror fresh across widget-island focus moves', () => {
    // Focus moving into a table cell / image chip (inside view.dom, outside
    // contentDOM) and back is not always reported as a CodeMirror focus
    // change; DOM focusin/focusout must reschedule a read of view.hasFocus.
    expect(coreSource).toContain("addEventListener('focusin', this.onDomFocusChange, true)");
    expect(coreSource).toContain("addEventListener('focusout', this.onDomFocusChange, true)");
    expect(coreSource).toContain('update.focusChanged');
    expect(coreSource).toContain('dom.isConnected');
    expect(coreSource).toContain('visualEditorFocusEffect.of(view.hasFocus)');
    const plugin = coreSource.slice(
      coreSource.indexOf('const focusSyncPlugin'),
      coreSource.indexOf('Shared focus plumbing')
    );
    expect(plugin).toContain('setTimeout');
    expect(plugin).toContain('clearTimeout');
    expect(plugin).not.toContain('view.dispatch');
  });

  it('renders an accessible toolbar that keeps the selection on click', () => {
    expect(source).toContain("setAttribute('role', 'toolbar')");
    expect(source).toContain('aria-pressed');
    expect(source).toContain("setAttribute('aria-keyshortcuts', 'Alt+F10')");
    expect(source).toContain('aria-orientation');
    expect(source).toContain('event.preventDefault()');
    expect(source).toContain('executeCodeMirrorAction');
  });

  it('isolates widget events from window shortcuts and CodeMirror key handling', () => {
    expect(source).toContain('stopPropagation');
    expect(source).toContain("addEventListener('keydown'");
    expect(source).toContain("addEventListener('mousedown'");
    expect(source).toContain("addEventListener('focusin'");
    expect(source).toContain("addEventListener('focusout'");
  });

  it('defers focus mirroring so tooltip removal never dispatches mid-update', () => {
    // Removing the focused tooltip (Escape, selection change) fires focusout
    // from inside CodeMirror's update; the handler must never dispatch there.
    expect(source).toContain('isConnected');
    expect(source).toContain('clearTimeout');
    expect(source).toContain('scheduleFocusWithin(false)');
    const focusHandlers = source.slice(
      source.indexOf("addEventListener('focusin'"),
      source.indexOf('refresh(view.state);')
    );
    expect(focusHandlers.length).toBeGreaterThan(0);
    expect(focusHandlers).not.toContain('view.dispatch');
    expect(source).toContain('destroy()');
  });

  it('builds fixed DOM without HTML injection or network access', () => {
    expect(source).toContain('createElementNS');
    expect(source).toContain('textContent');
    expect(source).not.toContain('innerHTML');
    expect(source).not.toMatch(/\bfetch\(|XMLHttpRequest|WebSocket|\.src\s*=/);
  });
});
