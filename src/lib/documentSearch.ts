/**
 * Pure search/replace engine behind the enhanced Find & Replace modal.
 *
 * The engine is intentionally free of React and DOM APIs so it can run inside
 * a Web Worker (with a hard timeout guarding catastrophic regular expressions)
 * and be unit-tested in Node.
 *
 * Design notes:
 * - Matches are plain UTF-16 offsets into the original buffer, so callers can
 *   hand them straight to CodeMirror without any mapping.
 * - Embedded `data:` resource destinations (Markdown images/links, reference
 *   definitions and HTML `src`/`srcset`) are always protected: a match that
 *   intersects such a destination is skipped. This keeps Base64 payloads out of
 *   find/replace results and prevents a replace from corrupting an embedded
 *   image. Protection is a pure linear scan (quoted HTML attributes, angle
 *   destinations, reference definitions and raw tokens), so this module stays
 *   worker-safe: no remark/micromark or browser-DOM imports.
 * - Optional code skipping removes fenced code blocks and inline code spans.
 *   It is a lightweight Markdown scan, not a full CommonMark parse: enough for
 *   predictable editor behaviour without adding another remark pipeline.
 * - Results are capped per tab and globally. The cap is reported as
 *   `truncated`; callers must disable "replace all" when truncated instead of
 *   silently applying only part of the matches.
 */

export const PER_TAB_MATCH_LIMIT = 1000;
export const TOTAL_MATCH_LIMIT = 5000;
export const SEARCH_DEBOUNCE_MS = 220;
/**
 * Upper bound for a replacement buffer (UTF-16 code units). `$`` / `$'`
 * expansions can otherwise duplicate a large document for every match and
 * exhaust memory. The UI shows a localized error instead of applying it.
 */
export const MAX_REPLACEMENT_OUTPUT_LENGTH = 64 * 1024 * 1024;
/** Cold worker module load (large remark/micromark bundle) is not regex work. */
export const SEARCH_WORKER_STARTUP_TIMEOUT_MS = 15000;
/** Bound for the worker-side search/replace computation itself. */
export const SEARCH_WORKER_TIMEOUT_MS = 5000;

export type SearchScope = 'current' | 'all';

export interface SearchTabInput {
  id: string;
  title: string;
  content: string;
  filePath?: string | null;
  /** Diff tabs are always excluded from document search. */
  kind?: 'document' | 'diff' | string;
}

export interface SearchOptions {
  query: string;
  caseSensitive: boolean;
  wholeWord: boolean;
  regex: boolean;
  /** Skip fenced code blocks and inline code spans. Defaults to false. */
  skipCode?: boolean;
}

export interface SearchLimits {
  perTab?: number;
  total?: number;
}

export interface SearchMatch {
  tabId: string;
  /** UTF-16 offset of the match start in the original buffer. */
  from: number;
  /** UTF-16 offset of the match end (exclusive). */
  to: number;
  /** 1-based line number. */
  line: number;
  /** 1-based column number (a leading BOM is not counted on line 1). */
  column: number;
}

export interface SearchTabResult {
  tabId: string;
  title: string;
  matches: SearchMatch[];
  /** More matches existed in this tab than the per-tab cap allowed. */
  truncated: boolean;
  /** Matches skipped because they intersected a protected `data:` destination. */
  protectedMatches: number;
  /** Matches skipped because they were inside code (when skipCode is on). */
  codeMatches: number;
}

export interface SearchOutcome {
  results: SearchTabResult[];
  /** Number of stored matches (never above the total cap). */
  totalMatches: number;
  /** True when at least one match was dropped because of a cap. */
  truncated: boolean;
  protectedMatches: number;
  codeMatches: number;
  elapsedMs: number;
}

export type SearchErrorCode =
  | 'empty-query'
  | 'invalid-regex'
  | 'timeout'
  | 'worker-unavailable'
  | 'output-too-large'
  | 'cancelled'
  | 'internal';

export class SearchError extends Error {
  readonly code: SearchErrorCode;
  readonly detail?: string;

  constructor(code: SearchErrorCode, message: string, detail?: string) {
    super(message);
    this.name = 'SearchError';
    this.code = code;
    this.detail = detail;
  }
}

export interface SearchWorkerSearchRequest {
  kind: 'search';
  id: number;
  tabs: SearchTabInput[];
  options: SearchOptions;
  limits?: SearchLimits;
}

export interface SearchWorkerReplaceRequest {
  kind: 'replace';
  id: number;
  docs: SearchTabInput[];
  results: SearchTabResult[];
  options: SearchOptions;
  replacement: string;
  maxPerTab?: number;
}

export type SearchWorkerRequest =
  | SearchWorkerSearchRequest
  | SearchWorkerReplaceRequest;

export interface SerializedSearchError {
  code: SearchErrorCode;
  message: string;
  detail?: string;
}

export interface SearchWorkerResponse {
  id: number;
  /** Sent by the worker before it starts computing, excluding cold-start time
   * from the expensive-operation timeout. */
  started?: boolean;
  outcome?: SearchOutcome;
  samples?: ReplacePreviewSample[];
  updates?: ReplaceUpdate[];
  expansions?: ExpandedReplacement[];
  error?: SerializedSearchError;
}

export interface TextRange {
  from: number;
  to: number;
}

export interface SearchSnippet {
  before: string;
  match: string;
  after: string;
}

export interface ReplacePreviewSample {
  tabId: string;
  title: string;
  line: number;
  before: string;
  after: string;
}

export interface ReplaceUpdate {
  id: string;
  original: string;
  content: string;
}

export interface ExpandedReplacement {
  tabId: string;
  from: number;
  to: number;
  /** Replacement text after `$1`/`$&`/... expansion. */
  text: string;
}

export interface PreparedReplacements {
  updates: ReplaceUpdate[];
  expansions: ExpandedReplacement[];
}

export interface ApplyResult {
  content: string;
  applied: number;
}

export interface SearchSelection {
  docs: SearchTabInput[];
  /** Current scope points at a diff tab, so there is nothing to search. */
  activeUnavailable: boolean;
}

const MAX_MATCH_TEXT = 140;
const MAX_SNIPPET_SIDE = 160;

export function isSearchableTab(tab: SearchTabInput): boolean {
  return tab.kind !== 'diff';
}

/** Selects the documents for the "current" / "all open" scope, dropping diff tabs. */
export function selectSearchTabs(
  tabs: readonly SearchTabInput[],
  activeTabId: string,
  scope: SearchScope
): SearchSelection {
  const searchable = tabs.filter(isSearchableTab).map((tab) => ({
    id: tab.id,
    title: tab.title,
    content: tab.content,
    kind: tab.kind,
  }));

  if (scope === 'all') {
    return { docs: searchable, activeUnavailable: false };
  }

  const active = tabs.find((tab) => tab.id === activeTabId);
  if (!active || !isSearchableTab(active)) {
    return { docs: [], activeUnavailable: Boolean(active) };
  }
  return {
    docs: [
      {
        id: active.id,
        title: active.title,
        content: active.content,
        kind: active.kind,
      },
    ],
    activeUnavailable: false,
  };
}

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Builds the global RegExp used for both searching and replacement expansion.
 * Whole-word matching uses Unicode letter/number/mark boundaries so CJK text
 * is treated as words rather than every character being its own boundary.
 */
export function buildSearchPattern(query: string, options: SearchOptions): RegExp {
  if (!query) {
    throw new SearchError('empty-query', 'Search query is empty');
  }

  let source = options.regex ? query : escapeRegExp(query);
  if (options.wholeWord) {
    source = `(?<![\\p{L}\\p{N}\\p{M}_])(?:${source})(?![\\p{L}\\p{N}\\p{M}_])`;
  }

  try {
    return new RegExp(source, options.caseSensitive ? 'gu' : 'giu');
  } catch (error) {
    throw new SearchError(
      'invalid-regex',
      'Invalid regular expression',
      error instanceof Error ? error.message : String(error)
    );
  }
}

/** Offset of the first UTF-16 code unit of each line (line endings included). */
export function buildLineStarts(content: string): number[] {
  const starts: number[] = [0];
  for (let index = 0; index < content.length; index += 1) {
    if (content.charCodeAt(index) === 10) starts.push(index + 1);
  }
  return starts;
}

export function offsetToLineColumn(
  content: string,
  lineStarts: readonly number[],
  offset: number
): { line: number; column: number } {
  let low = 0;
  let high = lineStarts.length - 1;
  while (low < high) {
    const middle = (low + high + 1) >> 1;
    if (lineStarts[middle] <= offset) low = middle;
    else high = middle - 1;
  }

  let column = offset - lineStarts[low] + 1;
  // The BOM is part of the buffer but should not shift the first visible
  // character on line 1 by an extra column.
  if (low === 0 && content.charCodeAt(0) === 0xfeff && offset > 0) {
    column -= 1;
  }
  return { line: low + 1, column: Math.max(1, column) };
}

export function mergeRanges(ranges: readonly TextRange[]): TextRange[] {
  const sorted = ranges
    .filter((range) => range.to > range.from)
    .slice()
    .sort((left, right) => left.from - right.from || left.to - right.to);

  const merged: TextRange[] = [];
  for (const range of sorted) {
    const previous = merged[merged.length - 1];
    if (previous && range.from <= previous.to) {
      previous.to = Math.max(previous.to, range.to);
    } else {
      merged.push({ from: range.from, to: range.to });
    }
  }
  return merged;
}

function advanceRangeIndex(
  ranges: readonly TextRange[],
  index: number,
  offset: number
): number {
  let next = index;
  while (next < ranges.length && ranges[next].to <= offset) next += 1;
  return next;
}

function collectFencedCodeRanges(content: string): TextRange[] {
  const ranges: TextRange[] = [];
  let fence: { char: string; length: number; start: number } | null = null;
  let offset = 0;

  while (offset <= content.length) {
    const newline = content.indexOf('\n', offset);
    const lineEnd = newline === -1 ? content.length : newline;
    const rawLine = content.slice(offset, lineEnd);
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;

    if (!fence) {
      const opening = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
      if (opening && !(opening[1][0] === '`' && opening[2].includes('`'))) {
        fence = {
          char: opening[1][0],
          length: opening[1].length,
          start: offset,
        };
      }
    } else {
      const closing = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(line);
      if (
        closing &&
        closing[1][0] === fence.char &&
        closing[1].length >= fence.length
      ) {
        ranges.push({ from: fence.start, to: lineEnd });
        fence = null;
      }
    }

    if (newline === -1) break;
    offset = newline + 1;
  }

  if (fence) ranges.push({ from: fence.start, to: content.length });
  return ranges;
}

function collectInlineCodeRanges(
  content: string,
  fencedRanges: readonly TextRange[]
): TextRange[] {
  const ranges: TextRange[] = [];
  let fenceIndex = 0;
  let index = 0;

  while (index < content.length) {
    fenceIndex = advanceRangeIndex(fencedRanges, fenceIndex, index);
    const fence = fencedRanges[fenceIndex];
    if (fence && index >= fence.from && index < fence.to) {
      index = fence.to;
      continue;
    }

    if (content[index] !== '`') {
      index += 1;
      continue;
    }

    let runEnd = index;
    while (runEnd < content.length && content[runEnd] === '`') runEnd += 1;
    const runLength = runEnd - index;
    const lineEnd = content.indexOf('\n', runEnd);
    const limit = lineEnd === -1 ? content.length : lineEnd;

    let cursor = runEnd;
    let closingStart = -1;
    let closingEnd = -1;
    while (cursor < limit) {
      const next = content.indexOf('`', cursor);
      if (next === -1 || next >= limit) break;
      let end = next;
      while (end < limit && content[end] === '`') end += 1;
      if (end - next === runLength) {
        closingStart = next;
        closingEnd = end;
        break;
      }
      cursor = end;
    }

    if (closingStart !== -1) {
      ranges.push({ from: index, to: closingEnd });
      index = closingEnd;
    } else {
      index = runEnd;
    }
  }

  return ranges;
}

/** Fenced code blocks and inline code spans, merged and sorted. */
export function collectCodeRanges(content: string): TextRange[] {
  const fenced = collectFencedCodeRanges(content);
  return mergeRanges([...fenced, ...collectInlineCodeRanges(content, fenced)]);
}

/**
 * Spans of embedded `data:` destinations that a search must never touch.
 *
 * A DOM-free conservative lexical union covers angle destinations, quoted HTML
 * attributes, balanced Markdown destinations and raw tokens. This module must
 * remain usable in workers, including when browser Markdown parsers use DOM
 * entity decoding. Uncertain adjacent token text is protected rather than
 * risking a partial replacement of an embedded image.
 */
export function collectEmbeddedDataUrlRanges(content: string): TextRange[] {
  if (!/data:/i.test(content)) return [];

  const ranges: TextRange[] = [];

  // Angle-bracketed destinations may contain spaces and quotes, e.g.
  // ![svg](<data:image/svg+xml,%3Csvg width='1'%3E...>) or an unused
  // reference definition [x]: <data:image/svg+xml,... width='1' ...>.
  const angleDestination = /<\s*(data:[^>\n]*)>/gi;
  let angleMatch: RegExpExecArray | null;
  while ((angleMatch = angleDestination.exec(content)) !== null) {
    const start = angleMatch.index + angleMatch[0].indexOf(angleMatch[1]);
    ranges.push({ from: start, to: start + angleMatch[1].length });
  }

  // Quoted HTML attributes may contain spaces and line breaks; protect the
  // entire attribute value (srcset holds several candidates).
  const htmlAttribute = /\b(?:src|srcset)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
  let htmlMatch: RegExpExecArray | null;
  while ((htmlMatch = htmlAttribute.exec(content)) !== null) {
    const value = htmlMatch[1] ?? htmlMatch[2] ?? '';
    if (!/data:/i.test(value)) continue;
    const quoteIndex = htmlMatch[0].search(/["']/);
    if (quoteIndex === -1) continue;
    const start = htmlMatch.index + quoteIndex + 1;
    ranges.push({ from: start, to: start + value.length });
  }

  // Plain tokens and unquoted HTML attributes. This stops at whitespace, which
  // is fine because the exact spans above cover valid whitespace-containing
  // destinations.
  const raw = /data:/gi;
  let match: RegExpExecArray | null;
  while ((match = raw.exec(content)) !== null) {
    const start = match.index;
    let end = raw.lastIndex;
    let depth = 0;
    while (end < content.length && !/[\s<>`]/.test(content[end])) {
      const character = content[end];
      if (character === '\\' && end + 1 < content.length) { end += 2; continue; }
      if (character === '(') depth++;
      else if (character === ')') {
        if (depth === 0) break;
        depth--;
      }
      end++;
    }
    ranges.push({ from: start, to: end });
    raw.lastIndex = Math.max(end, raw.lastIndex);
  }

  return mergeRanges(ranges);
}

function nextOffset(content: string, index: number): number {
  const codePoint = content.codePointAt(index);
  return index + (codePoint !== undefined && codePoint > 0xffff ? 2 : 1);
}

/**
 * Searches the selected documents and returns capped, offset-accurate matches.
 * Throws SearchError for empty/invalid queries so the UI can show a precise
 * message instead of silently returning nothing.
 */
export function searchDocuments(
  tabs: readonly SearchTabInput[],
  options: SearchOptions,
  limits: SearchLimits = {}
): SearchOutcome {
  const perTab = Math.max(1, Math.floor(limits.perTab ?? PER_TAB_MATCH_LIMIT));
  const totalLimit = Math.max(1, Math.floor(limits.total ?? TOTAL_MATCH_LIMIT));
  const pattern = buildSearchPattern(options.query, options);
  const startedAt = Date.now();
  const results: SearchTabResult[] = [];

  let totalMatches = 0;
  let truncated = false;
  let protectedMatches = 0;
  let codeMatches = 0;

  searchLoop: for (const tab of tabs) {
    if (!isSearchableTab(tab)) continue;

    const content = tab.content;
    const tabResult: SearchTabResult = {
      tabId: tab.id,
      title: tab.title,
      matches: [],
      truncated: false,
      protectedMatches: 0,
      codeMatches: 0,
    };

    const protectedRanges = collectEmbeddedDataUrlRanges(content);
    const codeRanges = options.skipCode ? collectCodeRanges(content) : [];
    const lineStarts = buildLineStarts(content);

    pattern.lastIndex = 0;
    let protectedIndex = 0;
    let codeIndex = 0;
    let executed: RegExpExecArray | null;

    while ((executed = pattern.exec(content)) !== null) {
      const from = executed.index;
      const to = from + executed[0].length;

      // A zero-width match (e.g. `\b` or a lookahead) cannot be highlighted or
      // replaced as a range. Skip it and make sure the scan still advances.
      if (executed[0].length === 0) {
        if (pattern.lastIndex === from) {
          pattern.lastIndex = nextOffset(content, from);
        }
        continue;
      }

      protectedIndex = advanceRangeIndex(protectedRanges, protectedIndex, from);
      if (
        protectedIndex < protectedRanges.length &&
        protectedRanges[protectedIndex].from < to
      ) {
        tabResult.protectedMatches += 1;
        protectedMatches += 1;
        continue;
      }

      codeIndex = advanceRangeIndex(codeRanges, codeIndex, from);
      if (codeIndex < codeRanges.length && codeRanges[codeIndex].from < to) {
        tabResult.codeMatches += 1;
        codeMatches += 1;
        continue;
      }

      if (tabResult.matches.length >= perTab || totalMatches >= totalLimit) {
        tabResult.truncated = true;
        truncated = true;
        break;
      }

      const position = offsetToLineColumn(content, lineStarts, from);
      tabResult.matches.push({
        tabId: tab.id,
        from,
        to,
        line: position.line,
        column: position.column,
      });
      totalMatches += 1;
    }

    results.push(tabResult);

    if (truncated && totalMatches >= totalLimit) {
      // The global cap is exhausted. Later tabs were not scanned at all; the
      // outcome says so via `truncated`, and replace-all is disabled.
      break searchLoop;
    }
  }

  return {
    results,
    totalMatches,
    truncated,
    protectedMatches,
    codeMatches,
    elapsedMs: Date.now() - startedAt,
  };
}

/**
 * Expands JavaScript-style replacement tokens (`$$`, `$&`, `` $` ``, `$'`,
 * `$1`, `$<name>`) against a concrete match. Literal (non-regex) replacement
 * deliberately keeps `$` characters verbatim.
 */
export function expandReplacement(
  template: string,
  match: RegExpExecArray,
  content: string
): string {
  let result = '';
  let index = 0;

  while (index < template.length) {
    const character = template[index];
    if (character !== '$') {
      result += character;
      index += 1;
      continue;
    }

    const next = template[index + 1];
    if (next === '$') {
      result += '$';
      index += 2;
      continue;
    }
    if (next === '&') {
      result += match[0];
      index += 2;
      continue;
    }
    if (next === '`') {
      result += content.slice(0, match.index);
      index += 2;
      continue;
    }
    if (next === "'") {
      result += content.slice(match.index + match[0].length);
      index += 2;
      continue;
    }
    if (next === '<') {
      const end = template.indexOf('>', index + 2);
      if (end !== -1) {
        const name = template.slice(index + 2, end);
        const group = match.groups?.[name];
        result += group ?? '';
        index = end + 1;
        continue;
      }
    }
    if (next !== undefined && next >= '0' && next <= '9') {
      const twoDigits = template.slice(index + 1, index + 3);
      if (
        /^[0-9]{2}$/.test(twoDigits) &&
        Number(twoDigits) >= 1 &&
        Number(twoDigits) < match.length
      ) {
        result += match[Number(twoDigits)] ?? '';
        index += 3;
        continue;
      }
      const single = Number(next);
      if (single >= 1 && single < match.length) {
        result += match[single] ?? '';
        index += 2;
        continue;
      }
    }

    result += '$';
    index += 1;
  }

  return result;
}

/**
 * Applies a set of matches to a buffer. Every match is re-executed against the
 * original content and must still align exactly; a mismatch throws
 * `SearchError('internal')` so callers can discard stale results instead of
 * replacing the wrong range.
 */
export function applySearchReplace(
  content: string,
  matches: readonly SearchMatch[],
  options: SearchOptions,
  replacement: string,
  maxOutputLength = MAX_REPLACEMENT_OUTPUT_LENGTH
): ApplyResult {
  if (matches.length === 0) return { content, applied: 0 };

  const pattern = buildSearchPattern(options.query, options);
  const ordered = matches.slice().sort((left, right) => left.from - right.from);
  const pieces: string[] = [];
  let cursor = 0;
  let outputLength = 0;

  for (const match of ordered) {
    if (match.from < cursor) {
      throw new SearchError('internal', 'Apply ranges overlap');
    }

    pattern.lastIndex = match.from;
    const executed = pattern.exec(content);
    if (
      !executed ||
      executed.index !== match.from ||
      executed.index + executed[0].length !== match.to
    ) {
      throw new SearchError('internal', 'Stale search result');
    }

    const value = options.regex
      ? expandReplacement(replacement, executed, content)
      : replacement;
    const unchanged = content.slice(cursor, match.from);
    pieces.push(unchanged, value);
    outputLength += unchanged.length + value.length;
    if (outputLength > maxOutputLength) {
      throw new SearchError(
        'output-too-large',
        'Replacement output exceeds the size limit',
        `${outputLength} > ${maxOutputLength}`
      );
    }
    cursor = match.to;
  }

  const tail = content.slice(cursor);
  pieces.push(tail);
  outputLength += tail.length;
  if (outputLength > maxOutputLength) {
    throw new SearchError(
      'output-too-large',
      'Replacement output exceeds the size limit',
      `${outputLength} > ${maxOutputLength}`
    );
  }
  return { content: pieces.join(''), applied: ordered.length };
}

/**
 * Worker-side replacement preparation: re-validates every match, expands the
 * replacement once and returns both the final buffers and the per-match
 * replacement text. The UI can then apply a single match or the whole batch by
 * slicing strings only — a hostile regex is never executed on the UI thread
 * again after the search worker produced the matches.
 */
export function prepareReplacements(
  docs: readonly SearchTabInput[],
  results: readonly SearchTabResult[],
  options: SearchOptions,
  replacement: string,
  maxOutputLength = MAX_REPLACEMENT_OUTPUT_LENGTH
): PreparedReplacements {
  const pattern = buildSearchPattern(options.query, options);
  const docsById = new Map(docs.map((doc) => [doc.id, doc]));
  const updates: ReplaceUpdate[] = [];
  const expansions: ExpandedReplacement[] = [];

  for (const result of results) {
    const doc = docsById.get(result.tabId);
    if (!doc || result.matches.length === 0) continue;

    const ordered = result.matches
      .slice()
      .sort((left, right) => left.from - right.from);
    const pieces: string[] = [];
    let cursor = 0;
    let outputLength = 0;

    for (const match of ordered) {
      if (match.from < cursor) {
        throw new SearchError('internal', 'Apply ranges overlap');
      }

      pattern.lastIndex = match.from;
      const executed = pattern.exec(doc.content);
      if (
        !executed ||
        executed.index !== match.from ||
        executed.index + executed[0].length !== match.to
      ) {
        throw new SearchError('internal', 'Stale search result');
      }

      const text = options.regex
        ? expandReplacement(replacement, executed, doc.content)
        : replacement;
      if (text.length > maxOutputLength) {
        throw new SearchError(
          'output-too-large',
          'Replacement output exceeds the size limit',
          `${text.length} > ${maxOutputLength}`
        );
      }
      expansions.push({
        tabId: doc.id,
        from: match.from,
        to: match.to,
        text,
      });
      const unchanged = doc.content.slice(cursor, match.from);
      pieces.push(unchanged, text);
      outputLength += unchanged.length + text.length;
      if (outputLength > maxOutputLength) {
        throw new SearchError(
          'output-too-large',
          'Replacement output exceeds the size limit',
          `${outputLength} > ${maxOutputLength}`
        );
      }
      cursor = match.to;
    }

    const tail = doc.content.slice(cursor);
    pieces.push(tail);
    outputLength += tail.length;
    if (outputLength > maxOutputLength) {
      throw new SearchError(
        'output-too-large',
        'Replacement output exceeds the size limit',
        `${outputLength} > ${maxOutputLength}`
      );
    }
    updates.push({
      id: doc.id,
      original: doc.content,
      content: pieces.join(''),
    });
  }

  return { updates, expansions };
}

/** Removes Base64 payloads and newlines so snippets are safe to display. */
export function sanitizeSnippetText(text: string): string {
  return text
    .replace(/\r?\n/g, ' ')
    .replace(/data:[^\s"'`<>()[\]{}]{8,}/gi, (value) => {
      const comma = value.indexOf(',');
      const prefix = comma >= 0 ? value.slice(0, comma + 1) : value.slice(0, 16);
      return `${prefix}…`;
    });
}

function clip(text: string, limit: number): string {
  if (text.length <= limit) return text;
  return `${text.slice(0, Math.max(1, limit - 1))}…`;
}

interface LineWindow {
  start: number;
  end: number;
  windowStart: number;
  windowEnd: number;
}

function lineWindow(content: string, from: number, to: number, radius: number): LineWindow {
  let start = content.lastIndexOf('\n', Math.max(0, from - 1)) + 1;
  const newline = content.indexOf('\n', to);
  const rawEnd = newline === -1 ? content.length : newline;
  let end = rawEnd;
  if (end > start && content[end - 1] === '\r') end -= 1;

  let windowStart = start;
  if (start === 0 && content.charCodeAt(0) === 0xfeff) {
    start = 1;
    windowStart = 1;
  }

  windowStart = Math.max(windowStart, from - radius);
  const windowEnd = Math.min(end, to + radius);
  return { start, end, windowStart, windowEnd };
}

/** Builds a short, Base64-free snippet around a match for the results list. */
export function formatSearchSnippet(
  content: string,
  from: number,
  to: number,
  radius = 36
): SearchSnippet {
  const { start, end, windowStart, windowEnd } = lineWindow(
    content,
    from,
    to,
    radius
  );
  const before = sanitizeSnippetText(content.slice(windowStart, from));
  const rawMatch = content.slice(from, to);
  const match = clip(
    sanitizeSnippetText(
      rawMatch.length > MAX_MATCH_TEXT
        ? `${rawMatch.slice(0, 90)}…${rawMatch.slice(-20)}`
        : rawMatch
    ),
    MAX_MATCH_TEXT
  );
  const after = sanitizeSnippetText(content.slice(to, windowEnd));

  return {
    before: `${windowStart > start ? '…' : ''}${clip(
      before,
      MAX_SNIPPET_SIDE
    )}`,
    match,
    after: `${clip(after, MAX_SNIPPET_SIDE)}${
      windowEnd < end ? '…' : ''
    }`,
  };
}

/**
 * Produces a small before/after sample for the mandatory preview step. The
 * caller must not apply replacements until it has shown these samples.
 */
export function buildReplacePreviewSamples(
  docs: readonly SearchTabInput[],
  results: readonly SearchTabResult[],
  options: SearchOptions,
  replacement: string,
  maxPerTab = 2,
  expansions?: readonly ExpandedReplacement[]
): ReplacePreviewSample[] {
  const pattern = expansions ? null : buildSearchPattern(options.query, options);
  const expansionByMatch = expansions
    ? new Map(
        expansions.map((item) => [
          `${item.tabId}:${item.from}:${item.to}`,
          item.text,
        ])
      )
    : null;
  const docsById = new Map(docs.map((doc) => [doc.id, doc]));
  const samples: ReplacePreviewSample[] = [];

  for (const result of results) {
    const doc = docsById.get(result.tabId);
    if (!doc || result.matches.length === 0) continue;

    for (const match of result.matches.slice(0, Math.max(0, maxPerTab))) {
      let expanded: string;
      if (expansionByMatch) {
        const stored = expansionByMatch.get(
          `${match.tabId}:${match.from}:${match.to}`
        );
        if (stored === undefined) continue;
        expanded = stored;
      } else {
        if (!pattern) continue;
        pattern.lastIndex = match.from;
        const executed = pattern.exec(doc.content);
        if (
          !executed ||
          executed.index !== match.from ||
          executed.index + executed[0].length !== match.to
        ) {
          continue;
        }
        expanded = options.regex
          ? expandReplacement(replacement, executed, doc.content)
          : replacement;
      }

      const { windowStart, windowEnd } = lineWindow(
        doc.content,
        match.from,
        match.to,
        40
      );
      const beforeText = doc.content.slice(windowStart, windowEnd);
      const afterText = `${doc.content.slice(windowStart, match.from)}${expanded}${doc.content.slice(
        match.to,
        windowEnd
      )}`;

      samples.push({
        tabId: doc.id,
        title: doc.title,
        line: match.line,
        before: `${windowStart > 0 ? '…' : ''}${clip(
          sanitizeSnippetText(beforeText),
          MAX_SNIPPET_SIDE * 2
        )}`,
        after: `${clip(sanitizeSnippetText(afterText), MAX_SNIPPET_SIDE * 2)}${
          windowEnd < doc.content.length ? '…' : ''
        }`,
      });
    }
  }

  return samples;
}
