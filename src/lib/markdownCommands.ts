import { EditorView } from '@codemirror/view';
import { Language, TranslationKey } from '@/i18n';
import { findInlineFormatMarkers } from '@/lib/markdownFormatting';
import type { MarkdownMarkerRange } from '@/lib/markdownFormatting';

export type MarkdownAction =
  | 'paragraph'
  | 'bold'
  | 'italic'
  | 'strike'
  | 'inline-code'
  | 'code-block'
  | 'quote'
  | 'h1'
  | 'h2'
  | 'h3'
  | 'h4'
  | 'h5'
  | 'h6'
  | 'ul'
  | 'ol'
  | 'task'
  | 'link'
  | 'image'
  | 'table'
  | 'hr';

export interface FormatResult {
  newText: string;
  selectionStart: number;
  selectionEnd: number;
}

export interface MarkdownPlaceholders {
  codeSnippet: string;
  quoteText: string;
  heading: string;
  listItem: string;
  orderedItem: string;
  taskItem: string;
  linkText: string;
  imageAlt: string;
  tableCol1: string;
  tableCol2: string;
  tableCol3: string;
  tableCell1: string;
  tableCell2: string;
  tableCell3: string;
  tableCell4: string;
  tableCell5: string;
  tableCell6: string;
}

export const DEFAULT_ZH_PLACEHOLDERS: MarkdownPlaceholders = {
  codeSnippet: '代码片段',
  quoteText: '引用文本',
  heading: '标题内容',
  listItem: '列表项',
  orderedItem: '有序列表项',
  taskItem: '待办任务',
  linkText: '链接文本',
  imageAlt: '图片描述',
  tableCol1: '列 1',
  tableCol2: '列 2',
  tableCol3: '列 3',
  tableCell1: '单元格 1',
  tableCell2: '单元格 2',
  tableCell3: '单元格 3',
  tableCell4: '单元格 4',
  tableCell5: '单元格 5',
  tableCell6: '单元格 6',
};

export const DEFAULT_EN_PLACEHOLDERS: MarkdownPlaceholders = {
  codeSnippet: 'Code Snippet',
  quoteText: 'Quote text',
  heading: 'Heading',
  listItem: 'List item',
  orderedItem: 'Ordered item',
  taskItem: 'Task item',
  linkText: 'Link text',
  imageAlt: 'Image description',
  tableCol1: 'Column 1',
  tableCol2: 'Column 2',
  tableCol3: 'Column 3',
  tableCell1: 'Cell 1',
  tableCell2: 'Cell 2',
  tableCell3: 'Cell 3',
  tableCell4: 'Cell 4',
  tableCell5: 'Cell 5',
  tableCell6: 'Cell 6',
};

export type MarkdownTranslator = (key: TranslationKey) => string;

export type MarkdownLocaleInput =
  | Language
  | MarkdownTranslator
  | Partial<MarkdownPlaceholders>
  | { t?: MarkdownTranslator; language?: Language };

/**
 * Resolves Markdown placeholder strings from locale, translator function, or explicit overrides.
 */
export function resolveMarkdownPlaceholders(
  localeInput?: MarkdownLocaleInput
): MarkdownPlaceholders {
  if (!localeInput) {
    return DEFAULT_ZH_PLACEHOLDERS;
  }
  if (typeof localeInput === 'string') {
    return localeInput === 'en-US' ? DEFAULT_EN_PLACEHOLDERS : DEFAULT_ZH_PLACEHOLDERS;
  }
  if (typeof localeInput === 'function') {
    const t = localeInput;
    return {
      codeSnippet: t('markdown.codeSnippet'),
      quoteText: t('markdown.quoteText'),
      heading: t('markdown.heading'),
      listItem: t('markdown.listItem'),
      orderedItem: t('markdown.orderedItem'),
      taskItem: t('markdown.taskItem'),
      linkText: t('markdown.linkText'),
      imageAlt: t('markdown.imageAlt'),
      tableCol1: t('markdown.tableCol1'),
      tableCol2: t('markdown.tableCol2'),
      tableCol3: t('markdown.tableCol3'),
      tableCell1: t('markdown.tableCell1'),
      tableCell2: t('markdown.tableCell2'),
      tableCell3: t('markdown.tableCell3'),
      tableCell4: t('markdown.tableCell4'),
      tableCell5: t('markdown.tableCell5'),
      tableCell6: t('markdown.tableCell6'),
    };
  }
  if (typeof localeInput === 'object') {
    if ('t' in localeInput && typeof localeInput.t === 'function') {
      const t = localeInput.t;
      return {
        codeSnippet: t('markdown.codeSnippet'),
        quoteText: t('markdown.quoteText'),
        heading: t('markdown.heading'),
        listItem: t('markdown.listItem'),
        orderedItem: t('markdown.orderedItem'),
        taskItem: t('markdown.taskItem'),
        linkText: t('markdown.linkText'),
        imageAlt: t('markdown.imageAlt'),
        tableCol1: t('markdown.tableCol1'),
        tableCol2: t('markdown.tableCol2'),
        tableCol3: t('markdown.tableCol3'),
        tableCell1: t('markdown.tableCell1'),
        tableCell2: t('markdown.tableCell2'),
        tableCell3: t('markdown.tableCell3'),
        tableCell4: t('markdown.tableCell4'),
        tableCell5: t('markdown.tableCell5'),
        tableCell6: t('markdown.tableCell6'),
      };
    }
    if ('language' in localeInput && typeof localeInput.language === 'string') {
      return localeInput.language === 'en-US' ? DEFAULT_EN_PLACEHOLDERS : DEFAULT_ZH_PLACEHOLDERS;
    }
    return {
      ...DEFAULT_ZH_PLACEHOLDERS,
      ...(localeInput as Partial<MarkdownPlaceholders>),
    };
  }
  return DEFAULT_ZH_PLACEHOLDERS;
}

/**
 * Pure string transformation for markdown formatting actions.
 * Localizes placeholders for empty selections while preserving explicitly selected user text without alteration.
 */
export function formatMarkdownString(
  fullText: string,
  start: number,
  end: number,
  action: MarkdownAction,
  localeInput?: MarkdownLocaleInput
): FormatResult {
  const placeholders = resolveMarkdownPlaceholders(localeInput);
  const before = fullText.slice(0, start);
  const selected = fullText.slice(start, end);
  const after = fullText.slice(end);

  switch (action) {
    case 'bold': {
      if (!selected) {
        return {
          newText: `${before}****${after}`,
          selectionStart: start + 2,
          selectionEnd: start + 2,
        };
      }
      return {
        newText: `${before}**${selected}**${after}`,
        selectionStart: start + 2,
        selectionEnd: end + 2,
      };
    }

    case 'italic': {
      if (!selected) {
        return {
          newText: `${before}**${after}`,
          selectionStart: start + 1,
          selectionEnd: start + 1,
        };
      }
      return {
        newText: `${before}*${selected}*${after}`,
        selectionStart: start + 1,
        selectionEnd: end + 1,
      };
    }

    case 'strike': {
      if (!selected) {
        return {
          newText: `${before}~~~~${after}`,
          selectionStart: start + 2,
          selectionEnd: start + 2,
        };
      }
      return {
        newText: `${before}~~${selected}~~${after}`,
        selectionStart: start + 2,
        selectionEnd: end + 2,
      };
    }

    case 'inline-code': {
      if (!selected) {
        return {
          newText: `${before}\`\`${after}`,
          selectionStart: start + 1,
          selectionEnd: start + 1,
        };
      }
      return {
        newText: `${before}\`${selected}\`${after}`,
        selectionStart: start + 1,
        selectionEnd: end + 1,
      };
    }

    case 'code-block': {
      const code = selected || placeholders.codeSnippet;
      const insert = `\`\`\`javascript\n${code}\n\`\`\`\n`;
      return {
        newText: `${before}${insert}${after}`,
        selectionStart: start + 3,
        selectionEnd: start + 13, // highlight "javascript" language tag for quick edit
      };
    }

    case 'quote': {
      const content = selected || placeholders.quoteText;
      const quoted = content
        .split('\n')
        .map((line) => `> ${line}`)
        .join('\n');
      return {
        newText: `${before}${quoted}${after}`,
        selectionStart: start + 2,
        selectionEnd: start + quoted.length,
      };
    }

    case 'h1':
    case 'h2':
    case 'h3':
    case 'h4':
    case 'h5':
    case 'h6': {
      const levelMap: Record<string, string> = {
        h1: '# ',
        h2: '## ',
        h3: '### ',
        h4: '#### ',
        h5: '##### ',
        h6: '###### ',
      };
      const prefix = levelMap[action];
      const headingText = selected || placeholders.heading;
      return {
        newText: `${before}${prefix}${headingText}${after}`,
        selectionStart: start + prefix.length,
        selectionEnd: start + prefix.length + headingText.length,
      };
    }

    case 'ul': {
      const content = selected || placeholders.listItem;
      const formatted = content
        .split('\n')
        .map((line) => `- ${line}`)
        .join('\n');
      return {
        newText: `${before}${formatted}${after}`,
        selectionStart: start + 2,
        selectionEnd: start + formatted.length,
      };
    }

    case 'ol': {
      const content = selected || placeholders.orderedItem;
      const formatted = content
        .split('\n')
        .map((line, idx) => `${idx + 1}. ${line}`)
        .join('\n');
      return {
        newText: `${before}${formatted}${after}`,
        selectionStart: start + 3,
        selectionEnd: start + formatted.length,
      };
    }

    case 'task': {
      const content = selected || placeholders.taskItem;
      const formatted = content
        .split('\n')
        .map((line) => `- [ ] ${line}`)
        .join('\n');
      return {
        newText: `${before}${formatted}${after}`,
        selectionStart: start + 6,
        selectionEnd: start + formatted.length,
      };
    }

    case 'link': {
      const text = selected || placeholders.linkText;
      const insert = `[${text}](https://example.com)`;
      return {
        newText: `${before}${insert}${after}`,
        selectionStart: start + text.length + 3,
        selectionEnd: start + insert.length - 1,
      };
    }

    case 'image': {
      const alt = selected || placeholders.imageAlt;
      const insert = `![${alt}](https://example.com/image.png)`;
      return {
        newText: `${before}${insert}${after}`,
        selectionStart: start + alt.length + 4,
        selectionEnd: start + insert.length - 1,
      };
    }

    case 'table': {
      const c1 = placeholders.tableCol1;
      const c2 = placeholders.tableCol2;
      const c3 = placeholders.tableCol3;
      const r1 = placeholders.tableCell1;
      const r2 = placeholders.tableCell2;
      const r3 = placeholders.tableCell3;
      const r4 = placeholders.tableCell4;
      const r5 = placeholders.tableCell5;
      const r6 = placeholders.tableCell6;
      const table = `\n| ${c1} | ${c2} | ${c3} |\n| :--- | :---: | ---: |\n| ${r1} | ${r2} | ${r3} |\n| ${r4} | ${r5} | ${r6} |\n`;
      return {
        newText: `${before}${table}${after}`,
        selectionStart: start + table.length,
        selectionEnd: start + table.length,
      };
    }

    case 'hr': {
      const hr = '\n\n---\n\n';
      return {
        newText: `${before}${hr}${after}`,
        selectionStart: start + hr.length,
        selectionEnd: start + hr.length,
      };
    }

    default:
      return {
        newText: fullText,
        selectionStart: start,
        selectionEnd: end,
      };
  }
}

/**
 * A Markdown edit restricted to the affected range. Dispatching only this range
 * (instead of replacing the whole document) keeps undo scoped to the change and
 * avoids rebuilding the entire editor state for a single toolbar click.
 */
export interface MarkdownEdit {
  from: number;
  to: number;
  insert: string;
  selectionStart: number;
  selectionEnd: number;
}

const HEADING_LEVELS: Partial<Record<MarkdownAction, number>> = {
  paragraph: 0,
  h1: 1,
  h2: 2,
  h3: 3,
  h4: 4,
  h5: 5,
  h6: 6,
};

const INLINE_MARKERS: Partial<Record<MarkdownAction, string>> = {
  bold: '**',
  italic: '*',
  strike: '~~',
  'inline-code': '`',
};

const ATX_HEADING_RE = /^ {0,3}#{1,6}(?:[ \t]+|$)/;
const SETEXT_UNDERLINE_RE = /^ {0,3}(?:=+|-+)[ \t]*$/;
const QUOTE_RE = /^ {0,3}>[ \t]?/;
const TASK_ITEM_RE = /^([ \t]*)([-*+])[ \t]+\[[ xX]\](?:[ \t]+|$)/;
const BULLET_ITEM_RE = /^([ \t]*)([-*+])[ \t]+/;
const ORDERED_ITEM_RE = /^([ \t]*)(\d{1,9})[.)][ \t]+/;

interface BlockLine {
  from: number;
  to: number;
  text: string;
}

interface LineRewrite {
  oldFrom: number;
  oldTo: number;
  /** Characters at the start of the old line replaced by `newPrefix`. */
  oldPrefixLength: number;
  newPrefix: string;
  /** Text following the old prefix (not including it). */
  content: string;
  /** A block line that disappears completely (a Setext underline). */
  removed?: boolean;
}

function clampPosition(text: string, position: number): number {
  return Math.max(0, Math.min(position, text.length));
}

/** Expands a selection to whole lines, ignoring a trailing newline. */
function expandToLines(text: string, start: number, end: number): { from: number; to: number } {
  let safeEnd = end;
  if (safeEnd > start && text[safeEnd - 1] === '\n') {
    safeEnd -= 1;
  }
  const from = start === 0 ? 0 : text.lastIndexOf('\n', start - 1) + 1;
  const nextBreak = text.indexOf('\n', safeEnd);
  return { from, to: nextBreak === -1 ? text.length : nextBreak };
}

function splitBlockLines(text: string, from: number, to: number): BlockLine[] {
  const block = text.slice(from, to);
  const lines: BlockLine[] = [];
  let offset = 0;
  for (const lineText of block.split('\n')) {
    lines.push({ from: from + offset, to: from + offset + lineText.length, text: lineText });
    offset += lineText.length + 1;
  }
  return lines;
}

/**
 * Applies a per-line rewrite to the selected block and maps the selection into
 * the rewritten text. Only the block range is ever replaced.
 */
function buildLineEdit(
  blockFrom: number,
  blockTo: number,
  rewrites: LineRewrite[],
  selectionStart: number,
  selectionEnd: number
): MarkdownEdit {
  const emitted = rewrites.filter((rewrite) => !rewrite.removed);
  const parts = emitted.map((rewrite) => rewrite.newPrefix + rewrite.content);
  const newStarts: number[] = [];
  let cursor = blockFrom;
  for (const part of parts) {
    newStarts.push(cursor);
    cursor += part.length + 1;
  }

  const mapPosition = (position: number): number => {
    let previousEnd = blockFrom;
    for (let index = 0; index < emitted.length; index++) {
      const rewrite = emitted[index];
      if (position < rewrite.oldFrom) {
        return previousEnd;
      }
      if (position <= rewrite.oldTo) {
        const offset = position - rewrite.oldFrom;
        if (offset <= rewrite.oldPrefixLength) {
          return newStarts[index] + Math.min(offset, rewrite.newPrefix.length);
        }
        return (
          newStarts[index] +
          rewrite.newPrefix.length +
          Math.min(offset - rewrite.oldPrefixLength, rewrite.content.length)
        );
      }
      previousEnd = newStarts[index] + parts[index].length;
    }
    return previousEnd;
  };

  return {
    from: blockFrom,
    to: blockTo,
    insert: parts.join('\n'),
    selectionStart: mapPosition(selectionStart),
    selectionEnd: mapPosition(selectionEnd),
  };
}

/** Derives a localised insertion edit from the legacy string formatter. */
function buildInsertionEdit(
  fullText: string,
  start: number,
  end: number,
  action: MarkdownAction,
  localeInput?: MarkdownLocaleInput
): MarkdownEdit {
  const result = formatMarkdownString(fullText, start, end, action, localeInput);
  const suffixLength = fullText.length - end;
  const insert = result.newText.slice(start, result.newText.length - suffixLength);
  return {
    from: start,
    to: end,
    insert,
    selectionStart: result.selectionStart,
    selectionEnd: result.selectionEnd,
  };
}

function countRunBefore(text: string, position: number, character: string): number {
  let cursor = position;
  while (cursor > 0 && text[cursor - 1] === character) cursor--;
  return position - cursor;
}

function countRunAfter(text: string, position: number, character: string): number {
  let cursor = position;
  while (cursor < text.length && text[cursor] === character) cursor++;
  return cursor - position;
}

/** Returns the inner text when `selected` is already wrapped in `marker`. */
function stripWrappingMarker(selected: string, marker: string): string | null {
  if (selected.length < marker.length * 2) return null;
  if (!selected.startsWith(marker) || !selected.endsWith(marker)) return null;
  if (marker.length === 1) {
    // `**bold**` / `~~strike~~` must not be treated as a single-character wrap.
    if (selected[1] === marker || selected[selected.length - 2] === marker) return null;
  }
  return selected.slice(marker.length, selected.length - marker.length);
}

/**
 * Toggles an inline marker (bold/italic/strike/inline code) off when the
 * selection is already formatted. Returns `null` when the action should wrap.
 */
function buildInlineToggleEdit(
  fullText: string,
  start: number,
  end: number,
  marker: string
): MarkdownEdit | null {
  const selected = fullText.slice(start, end);
  const character = marker[0];

  const inner = stripWrappingMarker(selected, marker);
  if (inner !== null) {
    return {
      from: start,
      to: end,
      insert: inner,
      selectionStart: start,
      selectionEnd: start + inner.length,
    };
  }

  const beforeRun = countRunBefore(fullText, start, character);
  const afterRun = countRunAfter(fullText, end, character);
  const surrounded = marker.length === 1 ? beforeRun === 1 && afterRun === 1 : beforeRun >= marker.length && afterRun >= marker.length;
  if (surrounded) {
    const from = start - marker.length;
    return {
      from,
      to: end + marker.length,
      insert: selected,
      selectionStart: from,
      selectionEnd: from + selected.length,
    };
  }
  return null;
}

/**
 * Splits the leading container syntax of a line (indentation, blockquote
 * markers, list markers and task checkboxes) from its content, so a heading
 * level change keeps the line inside its container.
 */
function splitContainerPrefix(text: string): { prefix: string; rest: string } {
  let index = 0;
  for (;;) {
    const whitespace = /^[ \t]*/.exec(text.slice(index));
    if (whitespace && whitespace[0].length > 0) {
      index += whitespace[0].length;
    }
    const rest = text.slice(index);
    const quote = QUOTE_RE.exec(rest);
    if (quote) {
      index += quote[0].length;
      continue;
    }
    const list = /^(?:[-*+]|\d{1,9}[.)])[ \t]+/.exec(rest);
    if (list) {
      index += list[0].length;
      const task = /^\[[ xX]\][ \t]+/.exec(text.slice(index));
      if (task) index += task[0].length;
      continue;
    }
    break;
  }
  return { prefix: text.slice(0, index), rest: text.slice(index) };
}

function buildHeadingEdit(
  fullText: string,
  start: number,
  end: number,
  level: number
): MarkdownEdit | null {
  const block = expandToLines(fullText, start, end);
  // A Setext underline on the line after the block still belongs to it.
  if (block.to < fullText.length) {
    const nextLineEnd = fullText.indexOf('\n', block.to + 1);
    const nextLine = fullText.slice(block.to + 1, nextLineEnd === -1 ? fullText.length : nextLineEnd);
    const lastLine = fullText.slice(block.from, block.to);
    const lastHasContainer = splitContainerPrefix(lastLine).prefix.trim().length > 0;
    if (
      SETEXT_UNDERLINE_RE.test(nextLine) &&
      lastLine.trim().length > 0 &&
      !lastHasContainer &&
      !ATX_HEADING_RE.test(lastLine)
    ) {
      block.to = block.to + 1 + nextLine.length;
    }
  }

  const lines = splitBlockLines(fullText, block.from, block.to);
  const rewrites: LineRewrite[] = [];
  let foundHeading = false;

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const { prefix, rest } = splitContainerPrefix(line.text);
    const atxMatch = ATX_HEADING_RE.exec(rest);
    if (atxMatch) {
      foundHeading = true;
      rewrites.push({
        oldFrom: line.from,
        oldTo: line.to,
        oldPrefixLength: prefix.length + atxMatch[0].length,
        newPrefix: prefix + (level > 0 ? `${'#'.repeat(level)} ` : ''),
        content: rest.slice(atxMatch[0].length),
      });
      continue;
    }

    const next = lines[index + 1];
    const hasContainer = prefix.trim().length > 0;
    if (!hasContainer && next && SETEXT_UNDERLINE_RE.test(next.text) && line.text.trim().length > 0) {
      foundHeading = true;
      rewrites.push({
        oldFrom: line.from,
        oldTo: line.to,
        oldPrefixLength: prefix.length,
        newPrefix: prefix + (level > 0 ? `${'#'.repeat(level)} ` : ''),
        content: rest,
      });
      rewrites.push({
        oldFrom: next.from,
        oldTo: next.to,
        oldPrefixLength: next.text.length,
        newPrefix: '',
        content: '',
        removed: true,
      });
      index++;
      continue;
    }

    const hasContent = rest.trim().length > 0;
    rewrites.push({
      oldFrom: line.from,
      oldTo: line.to,
      oldPrefixLength: prefix.length,
      newPrefix: level > 0 && hasContent ? prefix + `${'#'.repeat(level)} ` : prefix,
      content: rest,
    });
  }

  if (level === 0 && !foundHeading) {
    // Paragraph conversion only makes sense for an existing heading.
    return null;
  }
  if (start === end && !lines.some((line) => line.text.trim().length > 0)) {
    // A caret on a blank line keeps the legacy placeholder insertion.
    return null;
  }

  return buildLineEdit(block.from, block.to, rewrites, start, end);
}

function buildQuoteEdit(fullText: string, start: number, end: number): MarkdownEdit | null {
  const block = expandToLines(fullText, start, end);
  const lines = splitBlockLines(fullText, block.from, block.to);
  const meaningful = lines.filter((line) => line.text.trim().length > 0);
  if (meaningful.length === 0) return null;

  const allQuoted = meaningful.every((line) => QUOTE_RE.test(line.text));
  const rewrites = lines.map<LineRewrite>((line) => {
    if (line.text.trim().length === 0) {
      return { oldFrom: line.from, oldTo: line.to, oldPrefixLength: 0, newPrefix: '', content: line.text };
    }
    const quote = QUOTE_RE.exec(line.text);
    if (allQuoted) {
      const prefixLength = quote ? quote[0].length : 0;
      return {
        oldFrom: line.from,
        oldTo: line.to,
        oldPrefixLength: prefixLength,
        newPrefix: '',
        content: line.text.slice(prefixLength),
      };
    }
    if (quote) {
      return { oldFrom: line.from, oldTo: line.to, oldPrefixLength: 0, newPrefix: '', content: line.text };
    }
    return { oldFrom: line.from, oldTo: line.to, oldPrefixLength: 0, newPrefix: '> ', content: line.text };
  });

  return buildLineEdit(block.from, block.to, rewrites, start, end);
}

type ListItemKind = 'task' | 'bullet' | 'ordered';

interface ListItemMatch {
  kind: ListItemKind;
  indent: string;
  prefixLength: number;
}

function matchListItem(text: string): ListItemMatch | null {
  const task = TASK_ITEM_RE.exec(text);
  if (task) {
    return { kind: 'task', indent: task[1], prefixLength: task[0].length };
  }
  const ordered = ORDERED_ITEM_RE.exec(text);
  if (ordered) {
    return { kind: 'ordered', indent: ordered[1], prefixLength: ordered[0].length };
  }
  const bullet = BULLET_ITEM_RE.exec(text);
  if (bullet) {
    return { kind: 'bullet', indent: bullet[1], prefixLength: bullet[0].length };
  }
  return null;
}

function buildListEdit(
  fullText: string,
  start: number,
  end: number,
  action: 'ul' | 'ol' | 'task'
): MarkdownEdit | null {
  const block = expandToLines(fullText, start, end);
  const lines = splitBlockLines(fullText, block.from, block.to);
  const meaningful = lines.filter((line) => line.text.trim().length > 0);
  if (meaningful.length === 0) return null;

  const matches = meaningful.map((line) => matchListItem(line.text));
  const every = (predicate: (match: ListItemMatch | null) => boolean) => matches.every(predicate);
  const toggleOff =
    action === 'ul'
      ? every((match) => match !== null && (match.kind === 'bullet' || match.kind === 'task'))
      : action === 'ol'
        ? every((match) => match !== null && match.kind === 'ordered')
        : every((match) => match !== null && match.kind === 'task');

  let orderedIndex = 0;
  const rewrites = lines.map<LineRewrite>((line) => {
    if (line.text.trim().length === 0) {
      return { oldFrom: line.from, oldTo: line.to, oldPrefixLength: 0, newPrefix: '', content: line.text };
    }
    const match = matchListItem(line.text);
    const content = match ? line.text.slice(match.prefixLength) : line.text;
    const indent = match ? match.indent : '';
    orderedIndex += 1;

    if (toggleOff) {
      if (action === 'task' && match?.kind === 'task') {
        return {
          oldFrom: line.from,
          oldTo: line.to,
          oldPrefixLength: match.prefixLength,
          newPrefix: `${indent}- `,
          content,
        };
      }
      const prefixLength = match ? match.prefixLength : 0;
      return {
        oldFrom: line.from,
        oldTo: line.to,
        oldPrefixLength: prefixLength,
        newPrefix: indent,
        content: match ? content : line.text,
      };
    }

    const newPrefix =
      action === 'ul' ? `${indent}- ` : action === 'ol' ? `${indent}${orderedIndex}. ` : `${indent}- [ ] `;
    return {
      oldFrom: line.from,
      oldTo: line.to,
      oldPrefixLength: match ? match.prefixLength : 0,
      newPrefix,
      content,
    };
  });

  return buildLineEdit(block.from, block.to, rewrites, start, end);
}

export interface MarkdownEditOptions {
  /**
   * Pure callers may toggle inline markers from raw text. The editor disables
   * this path because the syntax tree decides what is really formatted, so
   * Markdown look-alikes inside code are never deleted.
   */
  allowInlineToggle?: boolean;
}

/**
 * Builds the toggle-aware edit for a action. Unlike `formatMarkdownString`,
 * applying a format that is already present removes it (or replaces a heading
 * level) instead of nesting new markers.
 */
export function buildMarkdownEdit(
  fullText: string,
  start: number,
  end: number,
  action: MarkdownAction,
  localeInput?: MarkdownLocaleInput,
  options: MarkdownEditOptions = {}
): MarkdownEdit {
  const safeStart = clampPosition(fullText, start);
  const safeEnd = clampPosition(fullText, Math.max(safeStart, end));

  const inlineMarker = INLINE_MARKERS[action];
  if (inlineMarker) {
    if (safeStart === safeEnd) {
      return buildInsertionEdit(fullText, safeStart, safeEnd, action, localeInput);
    }
    if (options.allowInlineToggle !== false) {
      const toggle = buildInlineToggleEdit(fullText, safeStart, safeEnd, inlineMarker);
      if (toggle) return toggle;
    }
    return buildInsertionEdit(fullText, safeStart, safeEnd, action, localeInput);
  }

  const headingLevel = HEADING_LEVELS[action];
  if (headingLevel !== undefined) {
    const heading = buildHeadingEdit(fullText, safeStart, safeEnd, headingLevel);
    if (heading) return heading;
    return buildInsertionEdit(fullText, safeStart, safeEnd, action, localeInput);
  }

  if (action === 'quote') {
    const quote = buildQuoteEdit(fullText, safeStart, safeEnd);
    if (quote) return quote;
    return buildInsertionEdit(fullText, safeStart, safeEnd, action, localeInput);
  }

  if (action === 'ul' || action === 'ol' || action === 'task') {
    const list = buildListEdit(fullText, safeStart, safeEnd, action);
    if (list) return list;
    return buildInsertionEdit(fullText, safeStart, safeEnd, action, localeInput);
  }

  return buildInsertionEdit(fullText, safeStart, safeEnd, action, localeInput);
}

/**
 * Removes only the delimiter ranges of an inline format. Because the wrapped
 * content is never rewritten, toggling off a format that wraps a multi-megabyte
 * data URL stays cheap and undoable as a single transaction.
 */
function dispatchMarkerRemoval(
  view: EditorView,
  docLength: number,
  markers: MarkdownMarkerRange[],
  selectionFrom: number,
  selectionTo: number
): void {
  const removedLength = markers.reduce((total, marker) => total + (marker.to - marker.from), 0);
  const newLength = docLength - removedLength;
  const mapPosition = (position: number): number => {
    let mapped = position;
    for (const marker of markers) {
      if (marker.to <= position) {
        mapped -= marker.to - marker.from;
      } else if (marker.from < position) {
        mapped -= position - marker.from;
      }
    }
    return Math.max(0, Math.min(mapped, newLength));
  };

  view.dispatch({
    changes: markers.map((marker) => ({ from: marker.from, to: marker.to })),
    selection: {
      anchor: mapPosition(selectionFrom),
      head: mapPosition(selectionTo),
    },
    scrollIntoView: true,
    userEvent: 'input.format',
  });
}

/**
 * Executes a formatting action directly on a CodeMirror 6 EditorView instance.
 * The transaction only covers the edited range, so it is undoable as one step
 * and never replaces the whole document.
 */
export function executeCodeMirrorAction(
  view: EditorView,
  action: MarkdownAction,
  localeInput?: MarkdownLocaleInput
): void {
  const state = view.state;
  const mainSelection = state.selection.main;
  const from = mainSelection.from;
  const to = mainSelection.to;

  // Toggle off the format that wraps the caret or selection, using the syntax
  // tree so look-alikes inside code are never mistaken for real formatting.
  if (INLINE_MARKERS[action]) {
    const markers = findInlineFormatMarkers(state, from, to, action);
    if (markers.length > 0) {
      dispatchMarkerRemoval(view, state.doc.length, markers, from, to);
      view.focus();
      return;
    }
  }

  const fullText = state.doc.toString();
  const edit = buildMarkdownEdit(fullText, from, to, action, localeInput, {
    allowInlineToggle: false,
  });
  const unchanged =
    edit.from === from &&
    edit.to === to &&
    edit.insert === fullText.slice(from, to) &&
    edit.selectionStart === from &&
    edit.selectionEnd === to;

  if (unchanged) {
    view.focus();
    return;
  }

  view.dispatch({
    changes: {
      from: edit.from,
      to: edit.to,
      insert: edit.insert,
    },
    selection: {
      anchor: edit.selectionStart,
      head: edit.selectionEnd,
    },
    scrollIntoView: true,
    userEvent: 'input.format',
  });

  view.focus();
}
