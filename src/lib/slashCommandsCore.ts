import { type EditorState, Facet, type TransactionSpec } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import {
  buildMarkdownEdit,
  type MarkdownAction,
  type MarkdownEdit,
  type MarkdownLocaleInput,
} from '@/lib/markdownCommands';
import { isVisualOpaquePosition } from '@/lib/visualSelectionCore';

/** Longest query that keeps the menu open; longer input is plain text. */
export const MAX_SLASH_QUERY = 64;

/** Up to three leading spaces still start a normal Markdown line. */
export const MAX_SLASH_INDENT = 3;

export type SlashCommandId =
  | 'paragraph'
  | 'h1'
  | 'h2'
  | 'h3'
  | 'ul'
  | 'task'
  | 'quote'
  | 'code-block'
  | 'table'
  | 'image'
  | 'link'
  | 'hr';

/** UI strings, supplied by the host from the `visualTools` locale root. */
export interface SlashCommandLabels {
  menuLabel: string;
  paragraph: string;
  heading1: string;
  heading2: string;
  heading3: string;
  list: string;
  task: string;
  quote: string;
  codeBlock: string;
  table: string;
  image: string;
  link: string;
  divider: string;
}

export const DEFAULT_SLASH_COMMAND_LABELS: SlashCommandLabels = {
  menuLabel: '插入 Markdown 命令',
  paragraph: '正文',
  heading1: '标题 1',
  heading2: '标题 2',
  heading3: '标题 3',
  list: '无序列表',
  task: '任务列表',
  quote: '引用',
  codeBlock: '代码块',
  table: '表格',
  image: '图片',
  link: '链接',
  divider: '分隔线',
};

export interface SlashCommandDefinition {
  id: SlashCommandId;
  action: MarkdownAction;
  /** Label field in `SlashCommandLabels`. */
  labelKey: keyof Omit<SlashCommandLabels, 'menuLabel'>;
  /** Short syntax preview shown at the right of the row. */
  detail: string;
  /**
   * Language-independent search terms. Both Chinese and English words are
   * included so `/quote` works in a Chinese UI and `/引用` in an English one.
   */
  searchTerms: readonly string[];
}

/** Menu order is the documented insertion order. */
export const SLASH_COMMAND_DEFINITIONS: readonly SlashCommandDefinition[] = Object.freeze([
  {
    id: 'paragraph',
    action: 'paragraph',
    labelKey: 'paragraph',
    detail: '',
    searchTerms: ['paragraph', 'text', 'body', 'plain', '正文', '文本', '段落', '普通文本'],
  },
  {
    id: 'h1',
    action: 'h1',
    labelKey: 'heading1',
    detail: '#',
    searchTerms: ['h1', 'heading1', 'heading 1', 'title', '标题1', '一级标题', '标题', '大标题'],
  },
  {
    id: 'h2',
    action: 'h2',
    labelKey: 'heading2',
    detail: '##',
    searchTerms: ['h2', 'heading2', 'heading 2', 'subtitle', '标题2', '二级标题', '标题'],
  },
  {
    id: 'h3',
    action: 'h3',
    labelKey: 'heading3',
    detail: '###',
    searchTerms: ['h3', 'heading3', 'heading 3', '标题3', '三级标题', '标题'],
  },
  {
    id: 'ul',
    action: 'ul',
    labelKey: 'list',
    detail: '-',
    searchTerms: ['ul', 'bullet', 'list', 'bulleted list', '无序列表', '列表', '项目符号'],
  },
  {
    id: 'task',
    action: 'task',
    labelKey: 'task',
    detail: '- [ ]',
    searchTerms: ['task', 'todo', 'checkbox', 'checklist', '任务', '待办', '任务列表', '清单'],
  },
  {
    id: 'quote',
    action: 'quote',
    labelKey: 'quote',
    detail: '>',
    searchTerms: ['quote', 'blockquote', 'citation', '引用', '引用块', 'block quote'],
  },
  {
    id: 'code-block',
    action: 'code-block',
    labelKey: 'codeBlock',
    detail: '```',
    searchTerms: ['code', 'codeblock', 'code block', 'fence', '代码', '代码块', 'pre'],
  },
  {
    id: 'table',
    action: 'table',
    labelKey: 'table',
    detail: '| | |',
    searchTerms: ['table', 'grid', '表格', '表', '数据表'],
  },
  {
    id: 'image',
    action: 'image',
    labelKey: 'image',
    detail: '![]()',
    searchTerms: ['image', 'img', 'picture', 'photo', '图片', '图像', '插图'],
  },
  {
    id: 'link',
    action: 'link',
    labelKey: 'link',
    detail: '[]()',
    searchTerms: ['link', 'url', '链接', '网址', '超链接'],
  },
  {
    id: 'hr',
    action: 'hr',
    labelKey: 'divider',
    detail: '---',
    searchTerms: ['hr', 'divider', 'rule', 'separator', 'horizontal rule', '分隔线', '分割线', '水平线'],
  },
]);

export interface SlashCommandItem {
  id: SlashCommandId;
  action: MarkdownAction;
  label: string;
  detail: string;
  searchTerms: readonly string[];
}

export interface SlashCommandConfig {
  labels: SlashCommandLabels;
  localeInput?: MarkdownLocaleInput;
}

/**
 * Labels/locale provided by `createSlashCommandExtension`. Kept in a facet so
 * the parsing and insertion helpers stay pure functions of editor state.
 */
export const slashCommandConfig = Facet.define<
  SlashCommandConfig,
  SlashCommandConfig | null
>({ combine: (values) => values[0] ?? null });

/** Builds the localised menu rows in documented order. */
export function buildSlashCommandItems(
  labels: SlashCommandLabels = DEFAULT_SLASH_COMMAND_LABELS
): SlashCommandItem[] {
  return SLASH_COMMAND_DEFINITIONS.map((definition) => ({
    id: definition.id,
    action: definition.action,
    label: labels[definition.labelKey],
    detail: definition.detail,
    searchTerms: definition.searchTerms,
  }));
}

export function getSlashCommandItem(
  id: SlashCommandId,
  labels: SlashCommandLabels = DEFAULT_SLASH_COMMAND_LABELS
): SlashCommandItem | undefined {
  return buildSlashCommandItems(labels).find((item) => item.id === id);
}

/**
 * Case-insensitive search over the localised label and the built-in
 * Chinese/English terms. Exact label prefixes rank first, then label
 * substrings, then term matches; ties keep the documented order.
 */
export function filterSlashCommandItems(
  items: readonly SlashCommandItem[],
  query: string
): SlashCommandItem[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...items];
  const scored: Array<{ item: SlashCommandItem; score: number }> = [];
  for (const item of items) {
    const label = item.label.toLowerCase();
    let score = -1;
    if (label.startsWith(needle)) {
      score = 0;
    } else if (label.includes(needle)) {
      score = 1;
    } else {
      for (const term of item.searchTerms) {
        const lowered = term.toLowerCase();
        if (!lowered.includes(needle)) continue;
        const candidate = lowered.startsWith(needle) ? 2 : 3;
        if (score < 0 || candidate < score) score = candidate;
        if (score === 2) break;
      }
    }
    if (score >= 0) scored.push({ item, score });
  }
  scored.sort((left, right) => left.score - right.score);
  return scored.map((entry) => entry.item);
}

export interface SlashQuery {
  /** Document position of the leading `/`. */
  from: number;
  /** Document position of the caret (end of the query). */
  to: number;
  query: string;
}

function indentWidth(text: string): number {
  let width = 0;
  for (const character of text) {
    if (character === '\t') width += 4;
    else width += 1;
  }
  return width;
}

/**
 * Pure line parser: a `/` may open the menu only as the first non-space
 * character of a normal line (at most three columns of indentation), with the
 * caret at the end of a whitespace-free query of at most 64 characters.
 */
export function parseSlashQueryLine(
  lineText: string,
  caretOffset: number,
  lineFrom: number
): SlashQuery | null {
  if (caretOffset < 1 || caretOffset > lineText.length) return null;
  let slash = 0;
  while (slash < caretOffset && (lineText[slash] === ' ' || lineText[slash] === '\t')) slash += 1;
  if (slash >= caretOffset || lineText[slash] !== '/') return null;
  if (indentWidth(lineText.slice(0, slash)) > MAX_SLASH_INDENT) return null;
  const afterSlash = lineText.slice(slash + 1);
  const stop = afterSlash.search(/\s/);
  const token = stop < 0 ? afterSlash : afterSlash.slice(0, stop);
  if (token.length > MAX_SLASH_QUERY) return null;
  if (token.includes('/')) return null;
  // The menu is only valid while the caret sits at the end of the query, so a
  // caret parked in the middle of typed text never inserts on Enter.
  if (caretOffset !== slash + 1 + token.length) return null;
  return { from: lineFrom + slash, to: lineFrom + caretOffset, query: token };
}

/**
 * Resolves the slash trigger at the caret. Returns `null` for selections,
 * protected syntax (fences, math, front matter, tables, HTML, images) and any
 * line that does not start with the optional indentation plus `/`.
 *
 * The line is probed through a bounded window instead of `line.text`, so a
 * multi-megabyte image data line never gets copied on cursor/focus
 * transactions; a command only applies at the end of a short trigger line.
 */
export function findSlashQuery(state: EditorState, position?: number): SlashQuery | null {
  const selection = state.selection;
  if (selection.ranges.length > 1) return null;
  const main = selection.main;
  if (!main.empty) return null;
  const at = position ?? main.head;
  if (at < 0 || at > state.doc.length) return null;
  if (state.readOnly) return null;
  const line = state.doc.lineAt(at);
  const caretOffset = at - line.from;
  const probeLength = MAX_SLASH_INDENT + 1 + MAX_SLASH_QUERY;
  if (caretOffset > probeLength) return null;
  // Commands open at the end of a line whose whole content is the trigger;
  // trailing text after the caret keeps the slash as plain typing.
  if (caretOffset !== line.length) return null;
  const head = state.sliceDoc(line.from, Math.min(line.to, line.from + probeLength));
  const query = parseSlashQueryLine(head, caretOffset, line.from);
  if (!query) return null;
  if (isVisualOpaquePosition(state, query.from)) return null;
  if (isVisualOpaquePosition(state, query.to)) return null;
  return query;
}

function clampPosition(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max));
}

/**
 * Builds the single, line-scoped edit that removes the `/query` and inserts the
 * command's Markdown.
 *
 * Only the current line is handed to the pure `buildMarkdownEdit` /
 * `formatMarkdownString` helpers, so a multi-megabyte document is never copied.
 * The returned edit replaces exactly that line range, which makes the insert
 * one undo step.
 */
export function buildSlashInsertion(
  state: EditorState,
  query: SlashQuery,
  action: MarkdownAction,
  localeInput?: MarkdownLocaleInput
): MarkdownEdit | null {
  const line = state.doc.lineAt(query.from);
  if (query.from < line.from || query.to > line.to) return null;
  // `findSlashQuery` only accepts carets at the line end, so this window is a
  // short trigger line rather than a whole data-URL line.
  const text = state.sliceDoc(line.from, line.to);
  const localFrom = query.from - line.from;
  const localTo = query.to - line.from;
  const stripped = text.slice(0, localFrom) + text.slice(localTo);
  const edit = buildMarkdownEdit(stripped, localFrom, localFrom, action, localeInput);

  const prefix = stripped.slice(0, edit.from);
  const raw = edit.insert;
  let insert = raw;
  // The insertion point is always the start of a line: a leading newline would
  // only create an empty line above the inserted block.
  if (/^[ \t]*$/.test(prefix)) insert = insert.replace(/^\n+/, '');
  // A trailing blank line already exists as the line break that follows the
  // replaced range; keep a single separator instead of stacking two.
  if (query.to < state.doc.length && /\n\n$/.test(insert)) insert = insert.replace(/\n\n$/, '\n');
  const removed = raw.length - insert.length;

  const mapOut = (position: number): number => {
    if (position <= edit.from) return position;
    if (position <= edit.from + raw.length) {
      return edit.from + Math.max(0, position - edit.from - removed);
    }
    return position - removed;
  };

  const finalText = prefix + insert + stripped.slice(edit.to);
  return {
    from: line.from,
    to: line.to,
    insert: finalText,
    selectionStart: line.from + clampPosition(mapOut(edit.selectionStart), 0, finalText.length),
    selectionEnd: line.from + clampPosition(mapOut(edit.selectionEnd), 0, finalText.length),
  };
}

export type SlashCommandEditor = Pick<EditorView, 'state' | 'dispatch'> & {
  focus?: () => void;
  /** Mirrors `EditorView.composing`; IME compositions own Enter/Tab/arrows. */
  readonly composing?: boolean;
};

/**
 * Applies one slash command: removes the query and inserts the Markdown in a
 * single local transaction (one undo step), then returns focus to the editor.
 */
export function applySlashCommand(
  view: SlashCommandEditor,
  commandId: SlashCommandId,
  localeInput?: MarkdownLocaleInput
): boolean {
  const state = view.state;
  if (state.readOnly) return false;
  const query = findSlashQuery(state);
  if (!query) return false;
  const definition = SLASH_COMMAND_DEFINITIONS.find((entry) => entry.id === commandId);
  if (!definition) return false;
  const locale = localeInput ?? state.facet(slashCommandConfig)?.localeInput;
  const edit = buildSlashInsertion(state, query, definition.action, locale);
  if (!edit) return false;
  const spec: TransactionSpec = {
    changes: { from: edit.from, to: edit.to, insert: edit.insert },
    selection: { anchor: edit.selectionStart, head: edit.selectionEnd },
    scrollIntoView: true,
    userEvent: 'input.complete',
  };
  view.dispatch(spec);
  view.focus?.();
  return true;
}
