import type { InlineContext, InlineParser, MarkdownConfig } from '@lezer/markdown';

/**
 * Paired punctuation that Chinese prose uses as an emphasis boundary, mirroring
 * `remarkCjkFriendlyEmphasis` (used by the preview). CommonMark classifies these
 * as punctuation, so `采用**“引号标题”**的…` stays literal there.
 */
const CJK_PAIRED_PUNCTUATION = '‘’“”「」『』《》〈〉【】〔〕〖〗〘〙〚〛〝〞〟（）［］｛｝';

/** Lezer's punctuation test, minus the CJK paired characters above. */
const PUNCTUATION = (() => {
  try {
    return new RegExp('[\\p{S}\\p{P}]', 'u');
  } catch {
    // Very old engines: Lezer's own fallback range set.
    return /[!-/:-@[-`{-~\u00A1\u2010-\u2027]/;
  }
})();

// Delimiter descriptors intentionally differ from the built-in ones: Lezer only
// pairs delimiters that share the same descriptor object, so CJK pairs can never
// change the meaning of a run that CommonMark already accepts.
const CJK_STRONG = { resolve: 'StrongEmphasis', mark: 'EmphasisMark' };
const CJK_EMPHASIS = { resolve: 'Emphasis', mark: 'EmphasisMark' };

function isCjkPaired(character: string): boolean {
  return character.length > 0 && CJK_PAIRED_PUNCTUATION.includes(character);
}

function isPunctuation(character: string): boolean {
  return character.length > 0 && PUNCTUATION.test(character) && !isCjkPaired(character);
}

interface RunFlags {
  /** Whether this run may open with CJK paired punctuation treated as text. */
  open: boolean;
  close: boolean;
  /** True when the built-in (CommonMark) parser would decide differently. */
  needsOpen: boolean;
  needsClose: boolean;
}

const MAX_PAIR_SCAN = 2000;

function isEscapedAsterisk(cx: InlineContext, position: number): boolean {
  let backslashes = 0;
  for (let at = position - 1; at >= 0 && cx.char(at) === 92; at--) backslashes++;
  return backslashes % 2 === 1;
}

function flagsAt(cx: InlineContext, start: number, size: number): RunFlags {
  const before = cx.slice(start - 1, start);
  const after = cx.slice(start + size, start + size + 1);
  const standardBefore = PUNCTUATION.test(before);
  const standardAfter = PUNCTUATION.test(after);
  const spaceBefore = /\s|^$/.test(before);
  const spaceAfter = /\s|^$/.test(after);
  const builtInOpen = !spaceAfter && (!standardAfter || spaceBefore || standardBefore);
  const builtInClose = !spaceBefore && (!standardBefore || spaceAfter || standardAfter);
  const cjkBefore = isPunctuation(before);
  const cjkAfter = isPunctuation(after);
  const open = !spaceAfter && (!cjkAfter || spaceBefore || cjkBefore);
  const close = !spaceBefore && (!cjkBefore || spaceAfter || cjkAfter);
  return {
    open,
    close,
    needsOpen: open && !builtInOpen,
    needsClose: close && !builtInClose,
  };
}

/** Next unescaped asterisk run of exactly `size` within the same inline block. */
function nextRun(cx: InlineContext, from: number, size: number): number | null {
  const end = Math.min(cx.end, from + MAX_PAIR_SCAN);
  for (let at = from; at < end;) {
    if (cx.char(at) !== 42 || isEscapedAsterisk(cx, at)) { at++; continue; }
    let runSize = 1;
    while (cx.char(at + runSize) === 42) runSize++;
    if (runSize === size) return at;
    at += runSize;
  }
  return null;
}

/** Previous unescaped asterisk run of exactly `size` within the same block. */
function previousRun(cx: InlineContext, from: number, size: number): number | null {
  const stop = Math.max(0, from - MAX_PAIR_SCAN);
  for (let at = from - 1; at >= stop;) {
    if (cx.char(at) !== 42 || isEscapedAsterisk(cx, at)) { at--; continue; }
    let start = at;
    while (start > stop && cx.char(start - 1) === 42) start--;
    if (at - start + 1 === size) return start;
    at = start - 1;
  }
  return null;
}

/**
 * An opener is adopted only when the next matching run needs CJK closing
 * treatment; that keeps the pair in one descriptor family.
 */
function openerAdopted(cx: InlineContext, start: number, size: number): boolean {
  if (!flagsAt(cx, start, size).open) return false;
  const partner = nextRun(cx, start + size, size);
  return partner !== null && flagsAt(cx, partner, size).needsClose;
}

/**
 * Adds CJK-quote-aware emphasis without rewriting source text.
 *
 * A run is only adopted when its pairing partner is adopted too, so a pair
 * never mixes the CJK descriptor family with CommonMark's. Every other run is
 * left to the built-in Emphasis parser, so existing documents keep parsing
 * exactly as before.
 */
const cjkEmphasis: InlineParser = {
  name: 'CjkEmphasis',
  before: 'Emphasis',
  parse(cx: InlineContext, next: number, start: number) {
    // Asterisks only: underscore intraword rules differ from prose punctuation,
    // and runs longer than two are handled by the built-in parser unchanged.
    if (next !== 42) return -1;
    let position = start + 1;
    while (cx.char(position) === 42) position++;
    const size = position - start;
    if (size > 2) return -1;
    const own = flagsAt(cx, start, size);
    if (!own.open && !own.close) return -1;
    const adoptedOpen = openerAdopted(cx, start, size);
    let adoptedClose = false;
    if (own.close) {
      const partner = previousRun(cx, start, size);
      adoptedClose = partner !== null && openerAdopted(cx, partner, size);
    }
    if (!adoptedOpen && !adoptedClose) return -1;
    return cx.addDelimiter(size === 2 ? CJK_STRONG : CJK_EMPHASIS, start, position,
      adoptedOpen, adoptedClose);
  },
};

/** `$inline$` and `$$display$$` stay opaque so inner Markdown is never styled. */
const inlineMath: InlineParser = {
  name: 'InlineMath',
  before: 'Emphasis',
  parse(cx, next, pos) {
    if (next !== 36) return -1;
    let size = 1;
    while (cx.char(pos + size) === 36) size++;
    const end = Math.min(cx.end, pos + 16_384);
    for (let at = pos + size; at < end; at++) {
      const char = cx.char(at);
      if (char === 10 || char === 13) break;
      if (char === 92) { at++; continue; }
      if (char !== 36) continue;
      let closing = 1;
      while (cx.char(at + closing) === 36) closing++;
      if (closing === size && at > pos + size) return cx.addElement(cx.elt('InlineMath', pos, at + size));
      at += closing - 1;
    }
    return -1;
  },
};

/** CJK-aware emphasis only: a parser configuration for tests and reuse. */
export const cjkFriendlyEmphasis: MarkdownConfig = { parseInline: [cjkEmphasis] };

/**
 * Opaque source fallbacks shared by the editor parser and visual decorations.
 * These constructs already render in Preview; phase one intentionally leaves
 * their exact source editable instead of interpreting inner stars/headings.
 */
export const editorMarkdownFallbacks: MarkdownConfig = {
  defineNodes: [{ name: 'FrontMatter', block: true }, { name: 'MathBlock', block: true }, 'InlineMath'],
  parseBlock: [
    {
      name: 'FrontMatter', before: 'HorizontalRule',
      parse(cx, line) {
        if (cx.lineStart !== 0) return false;
        const fence = line.text.replace(/^\uFEFF/, '').trimEnd();
        if (fence !== '---' && fence !== '+++') return false;
        const from = cx.lineStart;
        let to = from + line.text.length;
        // Keep even unclosed metadata opaque; never render its inner syntax.
        while (cx.nextLine()) {
          to = cx.lineStart + line.text.length;
          const text = line.text.trimEnd();
          if (text === fence || (fence === '---' && text === '...')) { cx.nextLine(); break; }
        }
        cx.addElement(cx.elt('FrontMatter', from, to));
        return true;
      },
    },
    {
      name: 'MathBlock', before: 'FencedCode',
      parse(cx, line) {
        const content = line.text.slice(line.pos);
        const opening = /^(\${2,})(?!\$)/.exec(content);
        if (!opening || line.indent - line.baseIndent >= 4) return false;
        const from = cx.lineStart + line.pos;
        const baseIndent = line.baseIndent;
        let to = cx.lineStart + line.text.length;
        const fence = opening[1];
        if (content.slice(opening[0].length).includes(fence)) cx.nextLine();
        else {
          while (cx.nextLine()) {
            // nextLine recalculates container markers/indentation. Do not eat
            // an outdented paragraph after an unclosed quote/list math block.
            if (line.baseIndent < baseIndent) break;
            to = cx.lineStart + line.text.length;
            if (line.text.slice(line.pos).trimEnd() === fence) { cx.nextLine(); break; }
          }
        }
        cx.addElement(cx.elt('MathBlock', from, to));
        return true;
      },
    },
  ],
  parseInline: [cjkEmphasis, inlineMath],
};
