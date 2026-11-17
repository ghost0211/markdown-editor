import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { EditorState, type Transaction, type TransactionSpec } from '@codemirror/state';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { ensureSyntaxTree } from '@codemirror/language';
import { history, undo } from '@codemirror/commands';
import type { EditorView } from '@codemirror/view';
import { editorMarkdownFallbacks } from '../src/lib/editorMarkdown';
import { visualEditorFocusEffect } from '../src/lib/visualSelectionCore';
import {
  DEFAULT_SLASH_COMMAND_LABELS,
  MAX_SLASH_QUERY,
  SLASH_COMMAND_DEFINITIONS,
  applySlashCommand,
  buildSlashCommandItems,
  buildSlashInsertion,
  createSlashCommandExtension,
  dismissSlashMenu,
  filterSlashCommandItems,
  findSlashQuery,
  getSlashMenuSnapshot,
  isImeComposingEvent,
  isSlashMenuOpen,
  moveSlashMenuActive,
  parseSlashQueryLine,
  slashMenuKeyBindings,
  type SlashCommandEditor,
  type SlashCommandLabels,
} from '../src/lib/slashCommands';

const zh: SlashCommandLabels = DEFAULT_SLASH_COMMAND_LABELS;
const en: SlashCommandLabels = {
  menuLabel: 'Insert Markdown command',
  paragraph: 'Paragraph',
  heading1: 'Heading 1',
  heading2: 'Heading 2',
  heading3: 'Heading 3',
  list: 'Bullet list',
  task: 'Task list',
  quote: 'Quote',
  codeBlock: 'Code block',
  table: 'Table',
  image: 'Image',
  link: 'Link',
  divider: 'Divider',
};

function createState(
  doc: string,
  at = doc.length,
  labels: SlashCommandLabels = zh,
  localeInput?: 'zh-CN' | 'en-US'
) {
  return EditorState.create({
    doc,
    selection: { anchor: at },
    extensions: [
      markdown({ base: markdownLanguage, extensions: editorMarkdownFallbacks }),
      history(),
      createSlashCommandExtension(labels, localeInput),
    ],
  });
}

const focus = (state: EditorState) =>
  state.update({ effects: visualEditorFocusEffect.of(true) }).state;

/** Minimal editor stand-in: state + dispatch (+ focus/composing for key paths). */
function editor(initial: EditorState) {
  let state = initial;
  const specs: Array<Transaction | TransactionSpec> = [];
  let composing = false;
  const focusCalls: number[] = [];
  const view = {
    get state() {
      return state;
    },
    get composing() {
      return composing;
    },
    dispatch(spec: Transaction | TransactionSpec) {
      specs.push(spec);
      state = state.update(spec).state;
    },
    focus() {
      focusCalls.push(Date.now());
    },
  } as unknown as SlashCommandEditor & EditorView;
  return {
    view,
    specs,
    getState: () => state,
    setComposing: (value: boolean) => {
      composing = value;
    },
    focusCalls,
  };
}

const bindingFor = (key: string) => slashMenuKeyBindings.find((binding) => binding.key === key);

describe('slash query parsing', () => {
  it.each([
    ['/h1', 3, { query: 'h1', from: 0, to: 3 }],
    ['/', 1, { query: '', from: 0, to: 1 }],
    ['  /h1', 5, { query: 'h1', from: 2, to: 5 }],
    ['\t/h2', 4, null],
    ['/head', 2, null],
    ['/h1 ', 4, null],
    ['    /h1', 7, null],
    ['text /h1', 8, null],
    ['/a/b', 4, null],
    ['', 0, null],
  ])('parses %j at offset %i', (line, offset, expected) => {
    const result = parseSlashQueryLine(line, offset, 100);
    if (expected === null) {
      expect(result).toBeNull();
    } else {
      expect(result).toMatchObject({
        from: 100 + expected.from,
        to: 100 + expected.to,
        query: expected.query,
      });
    }
  });

  it('accepts queries up to 64 characters and rejects longer ones', () => {
    const allowed = `/${'a'.repeat(MAX_SLASH_QUERY)}`;
    expect(parseSlashQueryLine(allowed, allowed.length, 0)).toMatchObject({
      query: 'a'.repeat(MAX_SLASH_QUERY),
    });
    const tooLong = `/${'a'.repeat(MAX_SLASH_QUERY + 1)}`;
    expect(parseSlashQueryLine(tooLong, tooLong.length, 0)).toBeNull();
  });
});

describe('slash trigger discovery', () => {
  it('finds a slash query at the caret in a normal line', () => {
    const state = createState('intro\n\n/h1', 10);
    expect(findSlashQuery(state)).toMatchObject({ from: 7, to: 10, query: 'h1' });
  });

  it('ignores selections, read-only state and queries larger than 64 characters', () => {
    const selected = EditorState.create({
      doc: '/h1',
      selection: { anchor: 0, head: 3 },
      extensions: [markdown({ base: markdownLanguage }), createSlashCommandExtension(zh)],
    });
    expect(findSlashQuery(selected)).toBeNull();

    const readOnly = EditorState.create({
      doc: '/h1',
      selection: { anchor: 3 },
      extensions: [
        markdown({ base: markdownLanguage }),
        EditorState.readOnly.of(true),
        createSlashCommandExtension(zh),
      ],
    });
    expect(findSlashQuery(readOnly)).toBeNull();

    const long = `/${'a'.repeat(MAX_SLASH_QUERY + 1)}`;
    expect(findSlashQuery(createState(long, long.length))).toBeNull();
  });

  it('only opens at the end of the trigger line', () => {
    const trailing = '/h1 more';
    expect(findSlashQuery(createState(trailing, 3))).toBeNull();
    expect(findSlashQuery(createState(trailing, trailing.length))).toBeNull();
    expect(findSlashQuery(createState('  /h1', 5))).toMatchObject({ query: 'h1', from: 2 });
  });

  it('never copies a multi-megabyte line while probing slash triggers', () => {
    const payload = 'A'.repeat(2_000_000);
    const doc = `![big](data:image/png;base64,${payload})\n\n/h1`;
    const spy = vi.spyOn(EditorState.prototype, 'sliceDoc');
    try {
      let state = createState(doc, 4);
      expect(findSlashQuery(state)).toBeNull();
      state = state.update({ selection: { anchor: 120 } }).state;
      spy.mockClear();
      // Cursor/focus transactions stay inside the bounded probe window; nothing
      // near the 2 MB payload is ever copied.
      for (const at of [0, 40, 2000, doc.indexOf('/h1') + 3, doc.length]) {
        state = state.update({ selection: { anchor: at } }).state;
      }
      const widths = spy.mock.calls.map(
        (call) => (call[1] ?? state.doc.length) - (call[0] ?? 0)
      );
      expect(Math.max(...widths)).toBeLessThan(1000);

      // Unparsed source stays protected: the menu may stay closed until the
      // syntax tree reaches the trigger line. Once it does, the query resolves.
      const before = findSlashQuery(state);
      if (before) {
        expect(before.query).toBe('h1');
        expect(before.from).toBe(doc.indexOf('/h1'));
      }
      ensureSyntaxTree(state, state.doc.length, 5000);
      expect(findSlashQuery(state)).toMatchObject({
        query: 'h1',
        from: doc.indexOf('/h1'),
      });
    } finally {
      spy.mockRestore();
    }
  });

  it.each([
    ['```\n/h1\n```', 'fenced code'],
    ['    /h1\n', 'indented code'],
    ['---\n/h1\n---', 'front matter'],
    ['$$\n/h1\n$$', 'math block'],
    ['<div>\n/h1\n</div>', 'html block'],
    ['![photo](\n/h1\n)', 'image source'],
  ])('never opens inside %s', (doc, label) => {
    const at = doc.indexOf('/h1') + 3;
    const state = createState(doc, at);
    expect(findSlashQuery(state), label).toBeNull();
    expect(getSlashMenuSnapshot(state), label).toBeNull();
  });
});

describe('slash command metadata and search', () => {
  const items = buildSlashCommandItems(zh);

  it('publishes the documented command set in menu order', () => {
    expect(items.map((item) => item.id)).toEqual([
      'paragraph',
      'h1',
      'h2',
      'h3',
      'ul',
      'task',
      'quote',
      'code-block',
      'table',
      'image',
      'link',
      'hr',
    ]);
    expect(items.map((item) => item.action)).toEqual(
      SLASH_COMMAND_DEFINITIONS.map((definition) => definition.action)
    );
    expect(items.map((item) => item.label)).toEqual([
      '正文',
      '标题 1',
      '标题 2',
      '标题 3',
      '无序列表',
      '任务列表',
      '引用',
      '代码块',
      '表格',
      '图片',
      '链接',
      '分隔线',
    ]);
    // Syntax previews are plain text metadata used by the row detail column.
    expect(items.find((item) => item.id === 'hr')?.detail).toBe('---');
  });

  it('returns every command for an empty query and filters by label', () => {
    expect(filterSlashCommandItems(items, '')).toHaveLength(items.length);
    expect(filterSlashCommandItems(items, 'head').map((item) => item.id)).toEqual([
      'h1',
      'h2',
      'h3',
    ]);
    expect(filterSlashCommandItems(items, '标题').map((item) => item.id)).toEqual([
      'h1',
      'h2',
      'h3',
    ]);
    expect(filterSlashCommandItems(items, 'zzz')).toEqual([]);
  });

  it('matches Chinese and English terms in either UI language', () => {
    expect(filterSlashCommandItems(items, 'quote').map((item) => item.id)).toEqual(['quote']);
    expect(filterSlashCommandItems(items, '引用').map((item) => item.id)).toEqual(['quote']);
    expect(filterSlashCommandItems(items, 'tab').map((item) => item.id)).toEqual(['table']);
    const english = buildSlashCommandItems(en);
    expect(filterSlashCommandItems(english, '表格').map((item) => item.id)).toEqual(['table']);
    expect(filterSlashCommandItems(english, '分隔线').map((item) => item.id)).toEqual(['hr']);
  });
});

describe('slash command insertion', () => {
  it('removes the query and inserts headings in one local transaction', () => {
    const editorState = editor(createState('/h1', 3));
    const query = findSlashQuery(editorState.getState());
    expect(query).not.toBeNull();
    const edit = buildSlashInsertion(editorState.getState(), query!, 'h1');
    expect(edit).toMatchObject({ from: 0, to: 3 });
    expect(edit?.insert).toBe('# 标题内容');

    expect(applySlashCommand(editorState.view, 'h1')).toBe(true);
    expect(editorState.specs).toHaveLength(1);
    expect(editorState.getState().doc.toString()).toBe('# 标题内容');
    const selection = editorState.getState().selection.main;
    expect(editorState.getState().sliceDoc(selection.from, selection.to)).toBe('标题内容');
    expect(editorState.focusCalls).toHaveLength(1);
  });

  it('is a single undo step, not delete-then-command', () => {
    const source = 'before\n\n/h1';
    const ed = editor(createState(source, source.length));
    expect(applySlashCommand(ed.view, 'h1')).toBe(true);
    expect(ed.getState().doc.toString()).toBe('before\n\n# 标题内容');
    expect(undo({ state: ed.getState(), dispatch: (tr) => ed.view.dispatch(tr) })).toBe(true);
    expect(ed.getState().doc.toString()).toBe('before\n\n/h1');
  });

  it('keeps indentation and inserts block commands at the line start', () => {
    expect(applySlashCommand(editor(createState('  /h2', 5)).view, 'h2')).toBe(true);
    expect(editor(createState('  /h2', 5)).getState().doc.toString()).toBe('  /h2');

    const indented = editor(createState('  /h2', 5));
    applySlashCommand(indented.view, 'h2');
    expect(indented.getState().doc.toString()).toBe('  ## 标题内容');

    const table = editor(createState('/table', 6));
    applySlashCommand(table.view, 'table');
    expect(table.getState().doc.toString().startsWith('| 列 1 | 列 2 | 列 3 |')).toBe(true);
    expect(table.getState().doc.toString().startsWith('\n')).toBe(false);

    const rule = editor(createState('a\n\n/hr\nb', 6));
    applySlashCommand(rule.view, 'hr');
    expect(rule.getState().doc.toString()).toBe('a\n\n---\n\nb');
  });

  it('inserts code blocks, links and images with a useful selection', () => {
    const code = editor(createState('/code', 5));
    applySlashCommand(code.view, 'code-block');
    expect(code.getState().doc.toString()).toBe('```javascript\n代码片段\n```\n');
    const codeSelection = code.getState().selection.main;
    expect(code.getState().sliceDoc(codeSelection.from, codeSelection.to)).toBe('javascript');

    const link = editor(createState('/link', 5));
    applySlashCommand(link.view, 'link');
    expect(link.getState().doc.toString()).toBe('[链接文本](https://example.com)');
    const linkSelection = link.getState().selection.main;
    expect(link.getState().sliceDoc(linkSelection.from, linkSelection.to)).toBe(
      'https://example.com'
    );

    const image = editor(createState('/img', 4));
    applySlashCommand(image.view, 'image');
    expect(image.getState().doc.toString()).toBe('![图片描述](https://example.com/image.png)');
  });

  it('converts to a paragraph by removing the query without adding syntax', () => {
    const ed = editor(createState('intro\n/p', 8));
    expect(applySlashCommand(ed.view, 'paragraph')).toBe(true);
    expect(ed.getState().doc.toString()).toBe('intro\n');
  });

  it('localises placeholders through the locale input', () => {
    const state = createState('/h1', 3, en, 'en-US');
    const ed = editor(state);
    applySlashCommand(ed.view, 'h1');
    expect(ed.getState().doc.toString()).toBe('# Heading');

    const localized = editor(createState('/quote', 6, zh));
    applySlashCommand(localized.view, 'quote');
    expect(localized.getState().doc.toString()).toBe('> 引用文本');
  });

  it('does nothing without a slash trigger or in read-only state', () => {
    const plain = editor(createState('plain text', 10));
    expect(applySlashCommand(plain.view, 'h1')).toBe(false);
    expect(plain.specs).toHaveLength(0);

    const readOnly = EditorState.create({
      doc: '/h1',
      selection: { anchor: 3 },
      extensions: [
        markdown({ base: markdownLanguage }),
        EditorState.readOnly.of(true),
        createSlashCommandExtension(zh),
      ],
    });
    const readonlyEditor = editor(readOnly);
    expect(applySlashCommand(readonlyEditor.view, 'h1')).toBe(false);
    expect(readonlyEditor.specs).toHaveLength(0);
  });
});

describe('slash menu state and keyboard', () => {
  it('opens only while focused and tracks the active row with wrap-around', () => {
    const unfocused = createState('/h', 2);
    expect(getSlashMenuSnapshot(unfocused)).not.toBeNull();
    expect(isSlashMenuOpen(unfocused)).toBe(false);

    const ed = editor(focus(unfocused));
    expect(isSlashMenuOpen(ed.getState())).toBe(true);
    expect(getSlashMenuSnapshot(ed.getState())).toMatchObject({ query: 'h', activeIndex: 0 });

    const all = editor(focus(createState('/', 1)));
    expect(getSlashMenuSnapshot(all.getState())?.items).toHaveLength(12);
    moveSlashMenuActive(all.view, 1);
    expect(getSlashMenuSnapshot(all.getState())?.activeIndex).toBe(1);
    moveSlashMenuActive(all.view, -1);
    moveSlashMenuActive(all.view, -1);
    expect(getSlashMenuSnapshot(all.getState())?.activeIndex).toBe(11);
  });

  it('cancels on Escape without editing text and reopens for a new query', () => {
    const ed = editor(focus(createState('/h', 2)));
    expect(dismissSlashMenu(ed.view)).toBe(true);
    expect(getSlashMenuSnapshot(ed.getState())).toBeNull();
    expect(isSlashMenuOpen(ed.getState())).toBe(false);
    expect(ed.getState().doc.toString()).toBe('/h');

    // Any further typed character is a new query and reopens the menu.
    ed.view.dispatch({ changes: { from: 2, insert: 'e' }, selection: { anchor: 3 } });
    expect(getSlashMenuSnapshot(ed.getState())).toMatchObject({ query: 'he', activeIndex: 0 });
  });

  it('commits with Enter/Tab via the key bindings', () => {
    const heading = editor(focus(createState('/h', 2)));
    expect(bindingFor('Enter')?.run?.(heading.view)).toBe(true);
    expect(heading.getState().doc.toString()).toBe('# 标题内容');

    const paragraph = editor(focus(createState('/', 1)));
    expect(bindingFor('Tab')?.run?.(paragraph.view)).toBe(true);
    expect(paragraph.getState().doc.toString()).toBe('');
  });

  it('never claims Enter, Tab or arrows while an IME is composing', () => {
    const ed = editor(focus(createState('/h', 2)));
    ed.setComposing(true);
    for (const key of ['Enter', 'Tab', 'ArrowDown', 'ArrowUp', 'Escape']) {
      expect(bindingFor(key)?.run?.(ed.view), key).toBe(false);
    }
    expect(ed.specs).toHaveLength(0);
    expect(ed.getState().doc.toString()).toBe('/h');

    expect(isImeComposingEvent({ isComposing: true, keyCode: 13 })).toBe(true);
    expect(isImeComposingEvent({ isComposing: false, keyCode: 229 })).toBe(true);
    expect(isImeComposingEvent({ isComposing: false, keyCode: 13 })).toBe(false);
  });

  it('stays inert outside a slash query', () => {
    const ed = editor(focus(createState('plain', 5)));
    for (const key of ['Enter', 'Tab', 'ArrowDown', 'Escape']) {
      expect(bindingFor(key)?.run?.(ed.view), key).toBe(false);
    }
    expect(getSlashMenuSnapshot(ed.getState())).toBeNull();
  });
});

describe('slash menu DOM contract', () => {
  const source = readFileSync(new URL('../src/lib/slashMenu.ts', import.meta.url), 'utf8');

  it('renders an aria listbox with an active descendant and constrained scrolling', () => {
    expect(source).toContain("setAttribute('role', 'listbox')");
    expect(source).toContain("setAttribute('aria-activedescendant'");
    expect(source).toContain('aria-selected');
    expect(source).toContain("setAttribute('role', 'option')");
    expect(source).toContain('maxHeight');
    expect(source).toContain('overflowY');
    // Reveal happens in an animation frame on the menu's own scrollTop: no
    // layout read inside a CodeMirror update and no page-level scrolling.
    expect(source).toContain('requestAnimationFrame');
    expect(source).toContain('cancelAnimationFrame');
    expect(source).toContain('dom.scrollTop');
    expect(source).not.toMatch(/\.scrollIntoView\(/);
  });

  it('builds local text only: no HTML injection and no network access', () => {
    expect(source).toContain('textContent');
    expect(source).not.toContain('innerHTML');
    expect(source).not.toContain('insertAdjacentHTML');
    expect(source).not.toMatch(/\bfetch\(|XMLHttpRequest|WebSocket/);
  });

  it('isolates widget events from window shortcuts and CodeMirror keys', () => {
    expect(source).toContain('stopPropagation');
    expect(source).toContain('isImeComposingEvent');
    expect(source).toContain("addEventListener('keydown'");
    expect(source).toContain("addEventListener('mousedown'");
    expect(source).toContain('preventDefault');
  });
});
