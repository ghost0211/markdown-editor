import { describe, it, expect } from 'vitest';
import { EditorState, type ChangeSpec } from '@codemirror/state';
import { history, undo, redo } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import { buildVisualImageEdit, visualImageTargetAt, escapeVisualImageAlt } from '../src/lib/visualImageCommands';
import { editorMarkdownFallbacks } from '../src/lib/editorMarkdown';

const stateFor = (doc: string) => EditorState.create({ doc, extensions: [history(), markdown({ base: markdownLanguage, extensions: editorMarkdownFallbacks })] });
function target(doc: string) { const state = stateFor(doc); const image = visualImageTargetAt(state, doc.indexOf('![') + 2); expect(image).not.toBeNull(); return { state, image: image! }; }
function apply(state: EditorState, changes: ChangeSpec[] | null) { expect(changes).not.toBeNull(); return state.update({ changes: changes!, userEvent: 'input.image' }).state; }

describe('visual image contextual editing', () => {
  it('finds image and alt/URL/title positions without copying payloads', () => {
    const doc = '[![a](<data:image/png;base64,AAAA> "title")](https://example.com)';
    const { state, image } = target(doc);
    expect(state.sliceDoc(image.altFrom, image.altTo)).toBe('a');
    expect(state.sliceDoc(image.urlFrom, image.urlTo)).toBe('<data:image/png;base64,AAAA>');
    expect(state.sliceDoc(image.title!.from, image.title!.to)).toBe('"title"');
    expect(state.sliceDoc(image.from, image.to)).toBe('![a](<data:image/png;base64,AAAA> "title")');
  });
  it('preserves exact untouched Markdown including escapes/title/destination delimiters', () => {
    const doc = '![a\\[b\\]](old&amp;image.png "keep title")';
    const { state, image } = target(doc);
    expect(buildVisualImageEdit(state, image, { alt: 'a[b]', address: 'old&image.png' })).toEqual([]);
    expect(state.doc.toString()).toBe(doc);
    const reference = target('![a][ref]\n\n[ref]: old&amp;image.png');
    expect(buildVisualImageEdit(reference.state, reference.image, { alt: 'a', address: 'old&image.png' })).toEqual([]);
  });
  it('changes only alt text for a 2MB embedded image and keeps its bytes and title exact', () => {
    const doc = 'before\n\n![old](<data:image/png;base64,' + 'A'.repeat(2_000_000) + '> "title")\n\nafter';
    const { state, image } = target(doc);
    const changes = buildVisualImageEdit(state, image, { alt: 'new [caption] \\ end' });
    expect(changes).toEqual([{ from: image.altFrom, to: image.altTo, insert: 'new \\[caption\\] \\\\ end' }]);
    const next = apply(state, changes);
    expect(next.doc.toString()).toBe(doc.replace('![old]', '![new \\[caption\\] \\\\ end]'));
  });
  it('applies alt and address as one undoable transaction', () => {
    const doc = 'before ![old](old.png "keep") after';
    const { state, image } = target(doc);
    let current = apply(state, buildVisualImageEdit(state, image, { alt: 'new', address: 'assets/new (1).png' }));
    expect(current.doc.toString()).toBe('before ![new](<assets/new (1).png> "keep") after');
    expect(undo({ state: current, dispatch: tr => { current = tr.state; } })).toBe(true);
    expect(current.doc.toString()).toBe(doc);
    expect(redo({ state: current, dispatch: tr => { current = tr.state; } })).toBe(true);
    expect(current.doc.toString()).toContain('new (1).png');
  });
  it('keeps explicit/collapsed/shortcut references valid when alt text changes', () => {
    for (const [source, expected] of [
      ['![old][ref]', '![new][ref]'], ['![old][]', '![new][old]'], ['![old]', '![new][old]'],
    ]) {
      const doc = `${source}\n\n[${source.includes('ref') ? 'ref' : 'old'}]: image.png "title"`;
      const { state, image } = target(doc);
      const next = apply(state, buildVisualImageEdit(state, image, { alt: 'new' }));
      expect(next.doc.toString()).toBe(doc.replace(source, expected));
      expect(visualImageTargetAt(next, 2)).not.toBeNull();
    }
  });
  it('replaces a reference image only at the selected use; shared definition and other use stay unchanged', () => {
    const doc = '![first][ref] ![second][ref]\n\n[ref]: old.png "title"';
    const { state, image } = target(doc);
    const next = apply(state, buildVisualImageEdit(state, image, { alt: 'new', address: 'new.png' }));
    expect(next.doc.toString()).toBe('![new](<new.png> "title") ![second][ref]\n\n[ref]: old.png "title"');
  });
  it('does not mistake code/HTML/math/frontmatter lookalikes for editable images', () => {
    for (const doc of ['`![fake](a.png)`', '```md\n![fake](a.png)\n```', '$$\n![fake](a.png)\n$$', '---\n![fake](a.png)\n---', '> $$\n> ![fake](a.png)\n> $$']) {
      expect(visualImageTargetAt(stateFor(doc), doc.indexOf('![') + 2)).toBeNull();
    }
    expect(visualImageTargetAt(stateFor('<img src="a.png">'), 5)).toBeNull();
  });
  it('escapes alt input as plain text and flattens newlines', () => {
    const escaped = escapeVisualImageAlt('a[b]\\c\nnext');
    expect(escaped).toBe('a\\[b\\]\\\\c next');
    const ast = unified().use(remarkParse).parse(`![${escaped}](image.png)`);
    expect(ast.children[0]).toMatchObject({ type: 'paragraph', children: [{ type: 'image', alt: 'a[b]\\c next' }] });
  });
  it('rejects invalid, executable and non-image replacement URLs and oversized alt', () => {
    const { state, image } = target('![a](old.png)');
    for (const address of ['', 'a\nb.png', 'javascript:alert(1)', '#anchor', '//server/a.png', 'data:text/html;base64,AAAA']) {
      expect(buildVisualImageEdit(state, image, { alt: 'a', address }), address).toBeNull();
    }
    expect(buildVisualImageEdit(state, image, { alt: 'a'.repeat(4097) })).toBeNull();
  });
});
