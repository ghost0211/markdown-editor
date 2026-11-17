import { describe, it, expect, vi } from 'vitest';
import { Compartment, EditorSelection, EditorState, type TransactionSpec } from '@codemirror/state';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { ensureSyntaxTree } from '@codemirror/language';
import { history, undo, redo } from '@codemirror/commands';
import { type Decoration, type DecorationSet, type EditorView } from '@codemirror/view';
import { buildVisualDecorations, createVisualEditingExtension, isVisualSourceLine, toggleVisualTask } from '../src/lib/visualEditing';
import { createImageAddressExtension, imageAddresses, safeImageInsertionPosition } from '../src/lib/imageAddressExtension';
import { findVisualImageRanges, visualImageSource, VisualImageWidget } from '../src/lib/visualImageWidget';
import { editorMarkdownFallbacks } from '../src/lib/editorMarkdown';
import { exportMarkdownToXmd } from '../src/lib/export/xmdExporter';
import { importXmdPackage } from '../src/lib/xmd';

const options = { taskToggle: 'Toggle task', imageEdit: 'Edit image', imageLoading: 'Loading', imageFailed: 'Failed', sourcePath: 'C:/docs/note.md' };
const labels = { embedded: 'Embedded', address: 'Address', hint: 'Edit', edit: 'Edit', copy: 'Copy', copied: 'Copied', copyFailed: 'Failed', apply: 'Apply', close: 'Close', invalid: 'Invalid' };
function makeState(doc: string, at = doc.length) {
  const state = EditorState.create({ doc, selection: { anchor: at }, extensions: [EditorState.allowMultipleSelections.of(true), markdown({ base: markdownLanguage, extensions: editorMarkdownFallbacks }), history(), createImageAddressExtension(labels), createVisualEditingExtension(options)] });
  // EditorState's initial parser has a wall-clock budget. Under a heavily
  // parallel test run even this small fixture can stop after its first block.
  // Commit the ensured tree with a no-op transaction so assertions are
  // deterministic without changing the production viewport-based parser.
  if (doc.length < 100_000) {
    ensureSyntaxTree(state, doc.length, 1000);
    return state.update({}).state;
  }
  return state;
}
function entries(decorations: DecorationSet) {
  const result: { from: number; to: number; decoration: Decoration }[] = [];
  decorations.between(0, 100_000_000, (from, to, decoration) => { result.push({ from, to, decoration }); });
  return result;
}
function visual(state: EditorState) { return entries(buildVisualDecorations({ state, visibleRanges: [{ from: 0, to: state.doc.length }] })); }
const hidden = (state: EditorState) => visual(state).filter(({ from, to, decoration }) => from !== to && !decoration.spec.class && !decoration.spec.widget).map(({ from, to }) => state.sliceDoc(from, to));

// Both state-only tests and real browser coverage are intentional: node tests
// exercise source fidelity/history without relying on a synthetic DOM layout.
describe('source-preserving visual editing', () => {
  it('styles every heading level and hides heading/inline markers only off the selected line', () => {
    const doc = '# Heading\n\n**bold** *italic* ~~gone~~ `code`\n\nend';
    const state = makeState(doc);
    const classes = visual(state).map(({ decoration }) => decoration.spec.class).filter(Boolean);
    expect(classes).toEqual(expect.arrayContaining(['cm-visual-h1', 'cm-visual-strong', 'cm-visual-em', 'cm-visual-strike', 'cm-visual-code']));
    expect(hidden(state)).toEqual(expect.arrayContaining(['# ', '**', '*', '~~', '`']));
    const editing = state.update({ selection: { anchor: doc.indexOf('bold') } }).state;
    expect(hidden(editing)).toEqual(['# ']);
    expect(editing.doc).toBe(state.doc);
  });

  it('reveals all selection lines and secondary cursor lines', () => {
    const state = makeState('# One\n\n## Two\n\n### Three\n\nend');
    const selected = state.update({ selection: EditorSelection.create([EditorSelection.cursor(3), EditorSelection.cursor(12)]) }).state;
    // The helper accepts selections independently of editor focus.
    expect(isVisualSourceLine(selected, 0, 5)).toBe(true);
    const range = state.update({ selection: { anchor: 0, head: state.doc.length } }).state;
    expect(hidden(range)).toEqual([]);
    expect(range.doc.toString()).toBe(state.doc.toString());
  });

  it('uses parser boundaries to leave code blocks, tables, escaped syntax and HTML source alone', () => {
    const doc = ['```md', '# fake **bold**', '- [ ] fake', '```', '', '    ## fake *italic*', '', '| A | B |', '| - | - |', '| **cell** | text |', '', '<div>', '# not a heading', '</div>', '', '\\# escaped', '', 'end'].join('\n');
    expect(visual(makeState(doc))).toEqual([]);
  });

  it('keeps front matter and inline/display math opaque, including fake image syntax', () => {
    for (const block of [
      '---\n# metadata\ntitle: **literal**\npicture: ![fake](no.png)\n---',
      '+++\n# metadata\ntitle = "**literal**"\n+++',
      '$$\n# math\n**literal**\n![fake](no.png)\n$$',
      'math $x * y* + 1$ and $$z ** k**$$',
    ]) {
      const state = makeState(`${block}\n\nend`);
      expect(visual(state), block).toEqual([]);
      expect(state.field(imageAddresses).images, block).toEqual([]);
    }
  });

  it('keeps math in quotes, lists, nesting and indentation opaque without loading pseudo-images', () => {
    for (const block of [
      '> $$\n> a*b*c\n> ![fake](https://example.com/no.png)\n> $$',
      '- $$\n  a*b*c\n  ![fake](secret.png)\n  $$',
      '  $$\n  a*b*c\n  ![fake](secret.png)\n  $$',
      '> > $$\n> > a*b*c\n> > ![fake](secret.png)\n> > $$',
    ]) {
      const state = makeState(`${block}\n\n# real\n\nend`);
      expect(state.field(imageAddresses).images, block).toEqual([]);
      expect(state.field(imageAddresses).ranges, block).toEqual([]);
      const classes = visual(state).map(({ decoration }) => decoration.spec.class).filter(Boolean);
      expect(classes).not.toContain('cm-visual-em');
      expect(classes).toContain('cm-visual-h1');
      expect(hidden(state)).not.toContain('*');
    }
  });

  it('retains literal stars inside inline code', () => {
    const state = makeState('`**not bold**`\n\nend');
    expect(visual(state).filter(({ decoration }) => decoration.spec.class).map(({ decoration }) => decoration.spec.class)).toEqual(['cm-visual-code']);
    expect(hidden(state)).toEqual(['`', '`']);
  });

  it('renders lists, quote markers, links and clickable tasks', () => {
    const state = makeState('> quote\n\n- bullet\n- [ ] task\n- [X] done\n\n1. ordered\n\n[a **link**](https://example.com)\n\nend');
    const widgets = visual(state).filter(({ decoration }) => decoration.spec.widget);
    expect(widgets).toHaveLength(3); // 1 bullet, 2 tasks (no duplicate bullet beside a checkbox)
    expect(widgets.filter(({ decoration }) => 'checked' in decoration.spec.widget).map(({ decoration }) => decoration.spec.widget.checked)).toEqual([false, true]);
    expect(hidden(state)).toEqual(expect.arrayContaining(['> ', '[', '](https://example.com)']));
    expect(state.doc.toString()).toContain('- [X] done');
  });

  it('toggles one task character in a local undoable edit, preserving all unrelated source', () => {
    const source = '![large](data:image/png;base64,AAAA)\n\n> - [ ] task\n\nend';
    let state = makeState(source);
    const at = source.indexOf('[ ]');
    const dispatch = vi.fn((spec: TransactionSpec) => { state = state.update(spec).state; });
    expect(toggleVisualTask({ get state() { return state; }, dispatch } as unknown as EditorView, at)).toBe(true);
    expect(state.doc.toString()).toBe(source.replace('[ ]', '[x]'));
    expect(dispatch.mock.calls[0][0].changes).toEqual({ from: at + 1, to: at + 2, insert: 'x' });
    expect(undo({ state, dispatch: (tr) => { state = tr.state; } })).toBe(true);
    expect(state.doc.toString()).toBe(source);
    expect(redo({ state, dispatch: (tr) => { state = tr.state; } })).toBe(true);
    expect(state.doc.toString()).toContain('[x]');
  });

  it('rejects code-sample fake checkboxes, stale markers and readonly tasks', () => {
    const source = '`[ ]`\n\n- [ ] task\n\nend';
    const state = makeState(source);
    const dispatch = vi.fn();
    expect(toggleVisualTask({ state, dispatch } as unknown as EditorView, 1)).toBe(false);
    expect(toggleVisualTask({ state, dispatch } as unknown as EditorView, 0)).toBe(false);
    // Explicitly construct the read-only facet; no view is needed for the guard.
    const ro = EditorState.create({ doc: source, extensions: [markdown({ base: markdownLanguage }), EditorState.readOnly.of(true)] });
    expect(toggleVisualTask({ state: ro, dispatch } as unknown as EditorView, source.lastIndexOf('[ ]'))).toBe(false);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('deduplicates spanning nodes visited through disjoint visible ranges', () => {
    const state = makeState('**one\ntwo\nthree**\n\nend');
    const decorations = entries(buildVisualDecorations({ state, visibleRanges: [{ from: 0, to: 5 }, { from: 9, to: 17 }] }));
    const keys = decorations.map(({ from, to, decoration }) => `${from}:${to}:${decoration.spec.class || ''}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('limits work and decorations to visible source ranges', () => {
    const doc = '# title\n\n' + '*styled*\n\n'.repeat(5000);
    const state = makeState(doc, 0);
    const decorations = entries(buildVisualDecorations({ state, visibleRanges: [{ from: 0, to: 9 }] }));
    expect(decorations.every(({ from }) => from <= 9)).toBe(true);
  });
});

describe('visual images and presentation reconfiguration', () => {
  it('resolves inline and full/collapsed/shortcut references from syntax nodes, not regex', () => {
    const doc = '![inline](a.png) ![Full][id] ![collapsed][] ![shortcut]\n\n[id]: b.png\n[collapsed]: c.png\n[shortcut]: d.png\n\n`![fake](x.png)`\n\nend';
    const state = makeState(doc);
    expect(findVisualImageRanges(state).map((range) => state.sliceDoc(range.urlFrom, range.urlTo))).toEqual(['a.png', 'b.png', 'c.png', 'd.png']);
    expect(findVisualImageRanges(state).map((range) => range.alt)).toEqual(['inline', 'Full', 'collapsed', 'shortcut']);
  });

  it('replaces the whole inactive image, then shows the existing compact URL editor on its active line', () => {
    const doc = '![photo](<data:image/png;base64,AAAA>)\n\nend';
    const state = makeState(doc);
    const initial = entries(state.field(imageAddresses).decorations);
    expect(initial).toHaveLength(1);
    expect(initial[0].from).toBe(0);
    expect(initial[0].to).toBe(doc.indexOf('\n'));
    expect(initial[0].decoration.spec.widget).toBeInstanceOf(VisualImageWidget);
    expect(safeImageInsertionPosition(state, 1)).toBe(doc.indexOf('\n'));
    const editing = state.update({ selection: { anchor: 2 } }).state;
    const chip = entries(editing.field(imageAddresses).decorations);
    expect(chip[0].decoration.spec.widget.label).toBe('Embedded/photo.png');
    expect(editing.doc).toBe(state.doc);
  });

  it('supports multiline image replacements supplied before viewport measurement', () => {
    const doc = '![photo](\n <assets/photo.png>\n "title"\n)\n\nend';
    const state = makeState(doc);
    const decorated = entries(state.field(imageAddresses).decorations);
    expect(decorated).toHaveLength(1);
    expect(decorated[0].decoration.spec.widget).toBeInstanceOf(VisualImageWidget);
    expect(state.sliceDoc(decorated[0].from, decorated[0].to)).toContain('"title"');
  });

  it('never copies multi-megabyte payloads during cursor motion or unrelated edits', () => {
    const doc = '![big](data:image/png;base64,' + 'A'.repeat(2_000_000) + ')\n\nend';
    const state = makeState(doc);
    const previous = state.field(imageAddresses).images[0].source;
    expect(previous).toBeDefined();
    const spy = vi.spyOn(state, 'sliceDoc');
    const next = state.update({ changes: { from: doc.length, insert: 'more' } }).state;
    expect(next.field(imageAddresses).images[0].source).toBe(previous);
    expect(spy.mock.calls.every(([from = 0, to = state.doc.length]) => to - from < 500)).toBe(true);
    const moved = next.update({ selection: { anchor: 2 } }).state;
    expect(moved.field(imageAddresses).images[0].source).toBe(previous);
  });

  it('refreshes image source identity when its URL changes and maps images after preceding edits', () => {
    let state = makeState('![a](old.png)\n\nend');
    const original = state.field(imageAddresses).images[0].source;
    state = state.update({ changes: { from: 0, insert: 'prefix\n\n' } }).state;
    expect(state.field(imageAddresses).images[0].source).toBe(original);
    const image = state.field(imageAddresses).images[0];
    state = state.update({ changes: { from: image.urlFrom, to: image.urlTo, insert: 'new.png' } }).state;
    expect(state.field(imageAddresses).images[0].source).not.toBe(original);
  });

  it('switches source/visual without mutating text, cursor or undo/redo history', () => {
    const compartment = new Compartment();
    const doc = '# title\n\n![a](a.png)\n\nend';
    let state = EditorState.create({ doc, selection: { anchor: doc.length }, extensions: [history(), markdown({ base: markdownLanguage }), createImageAddressExtension(labels), compartment.of([])] });
    state = state.update({ changes: { from: state.doc.length, insert: '!' } }).state;
    const before = state.doc;
    const selection = state.selection;
    state = state.update({ effects: compartment.reconfigure(createVisualEditingExtension(options)) }).state;
    expect(state.doc).toBe(before);
    expect(state.selection.eq(selection)).toBe(true);
    expect(entries(state.field(imageAddresses).decorations)[0].decoration.spec.widget).toBeInstanceOf(VisualImageWidget);
    state = state.update({ effects: compartment.reconfigure([]) }).state;
    expect(state.doc).toBe(before);
    expect(entries(state.field(imageAddresses).decorations)[0].decoration.spec.widget).not.toBeInstanceOf(VisualImageWidget);
    expect(undo({ state, dispatch: (tr) => { state = tr.state; } })).toBe(true);
    expect(state.doc.toString()).toBe(doc);
    expect(redo({ state, dispatch: (tr) => { state = tr.state; } })).toBe(true);
    expect(state.doc.toString()).toBe(`${doc}!`);
  });

  it('reuses the rendered image DOM when equivalent options are recreated by font/theme changes', () => {
    const compartment = new Compartment();
    let state = EditorState.create({ doc: '![a](a.png)\n\nend', selection: { anchor: 16 }, extensions: [markdown({ base: markdownLanguage }),
      createImageAddressExtension(labels), compartment.of(createVisualEditingExtension(options))] });
    const before = entries(state.field(imageAddresses).decorations)[0].decoration.spec.widget as VisualImageWidget;
    state = state.update({ effects: compartment.reconfigure(createVisualEditingExtension({ ...options })) }).state;
    const after = entries(state.field(imageAddresses).decorations)[0].decoration.spec.widget as VisualImageWidget;
    expect(after.eq(before)).toBe(true);
    state = state.update({ effects: compartment.reconfigure(createVisualEditingExtension({ ...options, sourcePath: 'C:/other/a.md' })) }).state;
    expect((entries(state.field(imageAddresses).decorations)[0].decoration.spec.widget as VisualImageWidget).eq(before)).toBe(false);
  });

  it('follows background parsing progress for images beyond the initial parse window', () => {
    let state = makeState('paragraph\n\n'.repeat(2000) + '![tail](last.png)\n\nend');
    ensureSyntaxTree(state, state.doc.length, 1000);
    state = state.update({ selection: { anchor: state.doc.length - 1 } }).state;
    expect(state.field(imageAddresses).images.at(-1)?.alt).toBe('tail');
  });

  it('round-trips visually edited Markdown and bundled image/attachment through XMD', async () => {
    const source = '# title\n\n- [ ] task\n\n![image](data:image/png;base64,iVBORw0KGgo=)\n\n[file](data:text/plain;base64,aGVsbG8=)\n\nend';
    let state = makeState(source);
    const view = { get state() { return state; }, dispatch: (spec: TransactionSpec) => { state = state.update(spec).state; } } as unknown as EditorView;
    expect(toggleVisualTask(view, source.indexOf('[ ]'))).toBe(true);
    const edited = state.doc.toString();
    const imported = await importXmdPackage(await exportMarkdownToXmd(edited, 'Visual.xmd'));
    expect(imported.manifest.version).toBe(1);
    expect(imported.manifest.resources).toHaveLength(2);
    expect(imported.markdown).toContain('- [x] task');
    expect(imported.markdown).toContain('data:image/png;base64,iVBORw0KGgo=');
    expect(imported.markdown).toContain('data:text/plain;base64,aGVsbG8=');
    const reopened = makeState(imported.markdown);
    expect(reopened.field(imageAddresses).images).toHaveLength(1);
    expect(reopened.doc.toString()).toBe(imported.markdown);
  });

  it('decodes Markdown destinations but blocks executable schemes and non-image attachments', () => {
    expect(visualImageSource('<assets/a&amp;b\\(1\\).png>')).toBe('assets/a&b(1).png');
    expect(visualImageSource('https://example.com/a.png')).toBe('https://example.com/a.png');
    expect(visualImageSource('C:\\docs\\a.png')).toBe('C:\\docs\\a.png');
    expect(visualImageSource('data:image/png;base64,AAAA')).toBe('data:image/png;base64,AAAA');
    for (const source of ['javascript:alert(1)', 'jav&#x61;script:alert(1)', 'data:text/html;base64,AAAA', 'data:image/svg+xml,<svg/>', '//evil.example/a.png', 'asset://localhost/C:/secret', '#anchor']) {
      expect(visualImageSource(source), source).toBeNull();
    }
  });
});
