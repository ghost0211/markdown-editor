import { describe, it, expect } from 'vitest';
import { EditorState } from '@codemirror/state';
import type { TransactionSpec } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import {
  buildMarkdownEdit,
  executeCodeMirrorAction,
} from '../src/lib/markdownCommands';

interface FakeEditor {
  view: EditorView;
  specs: TransactionSpec[];
  getDoc: () => string;
  getSelection: () => { from: number; to: number };
}

function createEditor(doc: string, from: number, to = from): FakeEditor {
  let state = EditorState.create({
    doc,
    selection: { anchor: from, head: to },
    extensions: [markdown({ base: markdownLanguage })],
  });
  const specs: TransactionSpec[] = [];
  const view = {
    get state() {
      return state;
    },
    dispatch: (spec: TransactionSpec) => {
      specs.push(spec);
      state = state.update(spec).state;
    },
    focus: () => {},
  } as unknown as EditorView;

  return {
    view,
    specs,
    getDoc: () => state.doc.toString(),
    getSelection: () => ({ from: state.selection.main.from, to: state.selection.main.to }),
  };
}

function applyAction(editor: FakeEditor, action: Parameters<typeof executeCodeMirrorAction>[1]) {
  executeCodeMirrorAction(editor.view, action, 'zh-CN');
}

describe('buildMarkdownEdit', () => {
  it('wraps and unwraps inline markers without touching the rest of the document', () => {
    expect(buildMarkdownEdit('hello', 0, 5, 'bold')).toMatchObject({
      from: 0,
      to: 5,
      insert: '**hello**',
    });

    const unwrap = buildMarkdownEdit('say **hello** now', 6, 11, 'bold');
    expect(unwrap.from).toBe(4);
    expect(unwrap.to).toBe(13);
    expect(unwrap.insert).toBe('hello');
  });

  it('maps the selection to the shortened text when the whole wrapped span is selected', () => {
    const edit = buildMarkdownEdit('**bold**', 0, 8, 'bold');
    expect(edit).toMatchObject({ from: 0, to: 8, insert: 'bold' });
    expect(edit.selectionStart).toBe(0);
    expect(edit.selectionEnd).toBe(4);
  });

  it('can disable raw-text inline toggling for tree-driven execution', () => {
    const edit = buildMarkdownEdit('**bold**', 0, 8, 'bold', undefined, {
      allowInlineToggle: false,
    });
    expect(edit).toMatchObject({ from: 0, to: 8, insert: '****bold****' });
  });

  it('replaces a heading level instead of nesting another marker', () => {
    const edit = buildMarkdownEdit('## Title', 3, 3, 'h4');
    expect(edit).toMatchObject({ from: 0, to: 8, insert: '#### Title' });

    const restore = buildMarkdownEdit('#### Title', 5, 5, 'paragraph');
    expect(restore.insert).toBe('Title');
  });

  it('converts and restores Setext headings', () => {
    const edit = buildMarkdownEdit('Title\n=====', 2, 2, 'h3');
    expect(edit.insert).toBe('### Title');
    expect(edit.to).toBe('Title\n====='.length);
  });
});

describe('executeCodeMirrorAction toggling', () => {
  it('bold wraps the selection and a second run removes the markers', () => {
    const editor = createEditor('hello world', 6, 11);
    applyAction(editor, 'bold');
    expect(editor.getDoc()).toBe('hello **world**');

    applyAction(editor, 'bold');
    expect(editor.getDoc()).toBe('hello world');
  });

  it('keeps the legacy empty-selection insertion behaviour', () => {
    const editor = createEditor('hello ', 6);
    applyAction(editor, 'bold');
    expect(editor.getDoc()).toBe('hello ****');
    expect(editor.getSelection()).toEqual({ from: 8, to: 8 });
  });

  it('replaces heading levels and restores body text', () => {
    const editor = createEditor('## Title', 4);
    applyAction(editor, 'h4');
    expect(editor.getDoc()).toBe('#### Title');

    applyAction(editor, 'paragraph');
    expect(editor.getDoc()).toBe('Title');
  });

  it('applies a heading to plain selected lines and supports H5/H6', () => {
    const selected = createEditor('Text', 0, 4);
    applyAction(selected, 'h2');
    expect(selected.getDoc()).toBe('## Text');

    const multiLine = createEditor('## A\n### B', 0, 10);
    applyAction(multiLine, 'h2');
    expect(multiLine.getDoc()).toBe('## A\n## B');

    const h5 = createEditor('', 0);
    applyAction(h5, 'h5');
    expect(h5.getDoc()).toBe('##### 标题内容');
  });

  it('turns the caret line into a heading and restores body text', () => {
    const editor = createEditor('plain line', 3);
    applyAction(editor, 'h2');
    expect(editor.getDoc()).toBe('## plain line');

    applyAction(editor, 'paragraph');
    expect(editor.getDoc()).toBe('plain line');
  });

  it('converts a Setext heading to ATX and back to body text', () => {
    const editor = createEditor('Title\n=====', 2);
    applyAction(editor, 'h3');
    expect(editor.getDoc()).toBe('### Title');

    applyAction(editor, 'paragraph');
    expect(editor.getDoc()).toBe('Title');
  });

  it('keeps container prefixes when switching heading levels', () => {
    const quoted = createEditor('> ## heading in quote', 8);
    applyAction(quoted, 'h3');
    expect(quoted.getDoc()).toBe('> ### heading in quote');

    applyAction(quoted, 'paragraph');
    expect(quoted.getDoc()).toBe('> heading in quote');

    const listed = createEditor('- ### heading in list', 8);
    applyAction(listed, 'h2');
    expect(listed.getDoc()).toBe('- ## heading in list');

    applyAction(listed, 'paragraph');
    expect(listed.getDoc()).toBe('- heading in list');

    const ordered = createEditor('1. ## item', 7);
    applyAction(ordered, 'h3');
    expect(ordered.getDoc()).toBe('1. ### item');

    const nested = createEditor('- > ## nested', 9);
    applyAction(nested, 'h4');
    expect(nested.getDoc()).toBe('- > #### nested');
  });

  it('adds a heading inside a container for plain container text', () => {
    const quoted = createEditor('> plain text', 4);
    applyAction(quoted, 'h2');
    expect(quoted.getDoc()).toBe('> ## plain text');

    const listed = createEditor('- plain item', 4);
    applyAction(listed, 'h3');
    expect(listed.getDoc()).toBe('- ### plain item');
  });

  it('does not swallow a horizontal rule that follows an ATX heading', () => {
    const editor = createEditor('## Title\n---', 4);
    applyAction(editor, 'h3');
    expect(editor.getDoc()).toBe('### Title\n---');
  });

  it('toggles inline code and strikethrough instead of nesting', () => {
    const code = createEditor('a `code` b', 3, 7);
    applyAction(code, 'inline-code');
    expect(code.getDoc()).toBe('a code b');

    const strike = createEditor('a ~~old~~ b', 4, 7);
    applyAction(strike, 'strike');
    expect(strike.getDoc()).toBe('a old b');
  });

  it('toggles list types without stacking markers', () => {
    const bullet = createEditor('- item', 3);
    applyAction(bullet, 'ul');
    expect(bullet.getDoc()).toBe('item');
    applyAction(bullet, 'ul');
    expect(bullet.getDoc()).toBe('- item');

    const ordered = createEditor('- item', 3);
    applyAction(ordered, 'ol');
    expect(ordered.getDoc()).toBe('1. item');
    applyAction(ordered, 'ol');
    expect(ordered.getDoc()).toBe('item');

    const task = createEditor('- item', 3);
    applyAction(task, 'task');
    expect(task.getDoc()).toBe('- [ ] item');
    applyAction(task, 'task');
    expect(task.getDoc()).toBe('- item');
  });

  it('toggles blockquotes', () => {
    const editor = createEditor('text', 2);
    applyAction(editor, 'quote');
    expect(editor.getDoc()).toBe('> text');

    applyAction(editor, 'quote');
    expect(editor.getDoc()).toBe('text');
  });

  it('dispatches a single localised undoable transaction', () => {
    const prefix = 'intro\n'.repeat(3);
    const doc = `${prefix}hello world`;
    const editor = createEditor(doc, prefix.length + 6, doc.length);

    applyAction(editor, 'bold');
    expect(editor.getDoc()).toBe(`${prefix}hello **world**`);
    expect(editor.specs).toHaveLength(1);

    const spec = editor.specs[0];
    const changes = spec.changes as { from: number; to: number; insert: string };
    expect(Array.isArray(changes)).toBe(false);
    expect(changes.from).toBe(prefix.length + 6);
    expect(changes.to).toBe(doc.length);
    expect(changes.from).toBeGreaterThan(0);
    expect(changes.to).toBeLessThanOrEqual(doc.length);
    expect(spec.userEvent).toBe('input.format');
  });

  it('does not dispatch when paragraph formatting is a no-op', () => {
    const editor = createEditor('plain text', 3);
    applyAction(editor, 'paragraph');
    expect(editor.specs).toHaveLength(0);
    expect(editor.getDoc()).toBe('plain text');
  });
});

describe('executeCodeMirrorAction toggles the format around the caret', () => {
  it('removes the markers when the caret sits inside bold text', () => {
    const editor = createEditor('say **bold** now', 8);
    applyAction(editor, 'bold');
    expect(editor.getDoc()).toBe('say bold now');
    expect(editor.getSelection()).toEqual({ from: 6, to: 6 });

    const atStart = createEditor('**bold**', 0);
    applyAction(atStart, 'bold');
    expect(atStart.getDoc()).toBe('bold');
  });

  it('removes only the bold markers of a bold/italic nesting', () => {
    const doc = 'a **bold _italic_** b';
    const bold = createEditor(doc, 12);
    applyAction(bold, 'bold');
    expect(bold.getDoc()).toBe('a bold _italic_ b');
    expect(bold.getSelection()).toEqual({ from: 10, to: 10 });

    const italic = createEditor(doc, 12);
    applyAction(italic, 'italic');
    expect(italic.getDoc()).toBe('a **bold italic** b');
    expect(italic.getSelection()).toEqual({ from: 11, to: 11 });
  });

  it('separates bold and italic markers in a triple-asterisk span', () => {
    const bold = createEditor('***both***', 4);
    applyAction(bold, 'bold');
    expect(bold.getDoc()).toBe('*both*');

    const italic = createEditor('***both***', 4);
    applyAction(italic, 'italic');
    expect(italic.getDoc()).toBe('**both**');
  });

  it('toggles underscore bold and multi-backtick inline code', () => {
    const bold = createEditor('__bold__', 3);
    applyAction(bold, 'bold');
    expect(bold.getDoc()).toBe('bold');

    const code = createEditor('``a ` b``', 4);
    applyAction(code, 'inline-code');
    expect(code.getDoc()).toBe('a ` b');
  });

  it('toggles off when the selection only partially covers the formatted text', () => {
    const editor = createEditor('**bold text**', 2, 6);
    applyAction(editor, 'bold');
    expect(editor.getDoc()).toBe('bold text');
    expect(editor.getSelection()).toEqual({ from: 0, to: 4 });
  });

  it('deletes only the delimiters around a huge data URL', () => {
    const url = `data:image/png;base64,${'A'.repeat(20000)}`;
    const doc = `**${url}**`;
    const editor = createEditor(doc, 10);

    applyAction(editor, 'bold');
    expect(editor.getDoc()).toBe(url);
    const changes = editor.specs[0].changes as Array<{ from: number; to: number; insert?: string }>;
    expect(changes).toHaveLength(2);
    expect(changes[0]).toEqual({ from: 0, to: 2 });
    expect(changes[1]).toEqual({ from: doc.length - 2, to: doc.length });
    expect(editor.getSelection()).toEqual({ from: 8, to: 8 });
  });

  it('never removes lookalike markers inside code', () => {
    const inline = createEditor('`**fake**`', 4);
    applyAction(inline, 'bold');
    expect(inline.getDoc().startsWith('`**f')).toBe(true);
    expect(inline.getDoc()).not.toBe('`fake`');

    const fencedDoc = '```\n**fake**\n```';
    const fenced = createEditor(fencedDoc, fencedDoc.indexOf('fake'));
    applyAction(fenced, 'bold');
    expect(fenced.getDoc().startsWith('```\n**')).toBe(true);
    expect(fenced.getDoc()).toContain('fake**');
    expect(fenced.getDoc()).not.toBe('```\nfake\n```');
  });

  it('inserts instead of unwrapping when the whole lookalike span is selected in code', () => {
    const inlineDoc = '`**fake**`';
    const inline = createEditor(inlineDoc, 1, 9);
    applyAction(inline, 'bold');
    expect(inline.getDoc()).not.toBe('`fake`');
    expect(inline.getDoc()).toHaveLength(inlineDoc.length + 4);

    const fencedDoc = '```\n**fake**\n```';
    const fenced = createEditor(fencedDoc, 4, 12);
    applyAction(fenced, 'bold');
    expect(fenced.getDoc()).not.toBe('```\nfake\n```');
    expect(fenced.getDoc()).toHaveLength(fencedDoc.length + 4);
  });
});
