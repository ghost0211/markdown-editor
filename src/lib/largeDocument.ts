/**
 * Utilities for fast math detection, fence-safe Markdown chunking, and
 * adaptive preview scheduling on large documents.
 */

/** Documents above either threshold use chunked rendering + adaptive typing debounce. */
export const LARGE_DOC_CHAR_THRESHOLD = 48_000;
export const LARGE_DOC_LINE_THRESHOLD = 1_200;

/** Approximate size of each fence-safe chunk in large documents. */
export const TARGET_CHUNK_LINES = 240;
export const TARGET_CHUNK_CHARS = 12_000;

/** Number of chunks rendered immediately on first paint in browser mode. */
export const INITIAL_VISIBLE_CHUNKS = 2;
export const CHUNKS_PER_IDLE_BATCH = 3;

export interface MarkdownChunk {
  index: number;
  /** 1-based starting line number of this chunk in the full document. */
  startLine: number;
  /** Number of lines in this chunk. */
  lineCount: number;
  /** Raw Markdown slice for this chunk. */
  text: string;
}

/**
 * Fast O(n) check for whether a Markdown string could possibly contain math
 * expressions (`$...$`, `$$...$$`, `\(...\)`, `\[...\]`).
 * When false, `remark-math` and `rehype-katex` can be skipped entirely.
 */
export function hasPotentialMathSyntax(markdown: string): boolean {
  if (!markdown) return false;
  if (
    markdown.indexOf('$') !== -1 ||
    markdown.indexOf('\\(') !== -1 ||
    markdown.indexOf('\\[') !== -1
  ) {
    return true;
  }
  // Fenced ```math / ~~~math blocks are also rendered by rehype-katex
  return /(?:`{3,}|~{3,})[ \t]*math\b/i.test(markdown);
}

/**
 * Returns whether the document is large enough to benefit from chunked preview
 * rendering and adaptive typing debounce.
 */
export function isLargeMarkdownDocument(
  markdown: string,
  charThreshold = LARGE_DOC_CHAR_THRESHOLD,
  lineThreshold = LARGE_DOC_LINE_THRESHOLD
): boolean {
  if (!markdown) return false;
  if (markdown.length >= charThreshold) return true;

  let lines = 1;
  let idx = -1;
  while ((idx = markdown.indexOf('\n', idx + 1)) !== -1) {
    lines += 1;
    if (lines >= lineThreshold) return true;
  }
  return false;
}

/**
 * Returns an input debounce delay (in ms) scaled to document length so typing
 * in multi-hundred-KB or multi-MB files stays smooth at 60fps.
 * Normal-sized documents return `0` (immediate update).
 */
export function getAdaptivePreviewDebounceMs(charLength: number): number {
  if (charLength < LARGE_DOC_CHAR_THRESHOLD) return 0;
  if (charLength < 200_000) return 160;
  if (charLength < 600_000) return 280;
  return 420;
}

function matchFenceMarker(line: string): { char: '`' | '~'; length: number } | null {
  const match = /^ {0,3}(`{3,}|~{3,})/.exec(line);
  if (!match) return null;
  const run = match[1];
  const char = run[0] as '`' | '~';
  // Backtick info strings cannot contain backticks per CommonMark
  if (char === '`' && line.slice(match[0].length).includes('`')) {
    return null;
  }
  return { char, length: run.length };
}

function isClosingFence(line: string, fenceChar: '`' | '~', minLen: number): boolean {
  const match = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(line);
  if (!match) return false;
  const run = match[1];
  return run[0] === fenceChar && run.length >= minLen;
}

function isDisplayMathDelimiterLine(line: string): boolean {
  const trimmed = line.trim();
  return trimmed === '$$' || (trimmed.startsWith('$$') && !trimmed.slice(2).includes('$$'));
}

/**
 * Splits a large Markdown document into top-level chunks along blank lines,
 * strictly avoiding splits inside:
 * - YAML / TOML front matter at line 1
 * - Fenced code blocks (``` or ~~~ of arbitrary length)
 * - Multi-line `$$` display math blocks
 *
 * Documents below the large-document threshold (or documents containing GFM
 * footnote syntax `[^` up to 250 KB so cross-document footnote definitions stay
 * linked) are returned as a single chunk.
 */
export function splitLargeMarkdownIntoChunks(
  markdown: string,
  options?: {
    forceChunking?: boolean;
    targetLines?: number;
    targetChars?: number;
  }
): MarkdownChunk[] {
  const force = options?.forceChunking ?? false;
  const targetLines = options?.targetLines ?? TARGET_CHUNK_LINES;
  const targetChars = options?.targetChars ?? TARGET_CHUNK_CHARS;

  if (!force) {
    if (!isLargeMarkdownDocument(markdown)) {
      const lineCount = markdown ? markdown.split(/\r?\n/).length : 1;
      return [{ index: 0, startLine: 1, lineCount, text: markdown }];
    }
    // Keep medium-large documents with footnotes unified so `[^id]` links resolve
    if (markdown.length < 250_000 && markdown.indexOf('[^') !== -1) {
      const lineCount = markdown.split(/\r?\n/).length;
      return [{ index: 0, startLine: 1, lineCount, text: markdown }];
    }
  }

  const lines = markdown.split(/\r?\n/);
  if (lines.length <= targetLines && markdown.length <= targetChars) {
    return [{ index: 0, startLine: 1, lineCount: lines.length, text: markdown }];
  }

  const chunks: MarkdownChunk[] = [];
  let chunkStartIdx = 0;
  let chunkChars = 0;

  let activeFence: { char: '`' | '~'; length: number } | null = null;
  let inDisplayMath = false;
  let inFrontMatter = false;
  let frontMatterDelimiter = '';

  if (lines[0] === '---' || lines[0] === '+++') {
    inFrontMatter = true;
    frontMatterDelimiter = lines[0];
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    chunkChars += line.length + 1;

    if (inFrontMatter) {
      if (i > 0 && (line === frontMatterDelimiter || (frontMatterDelimiter === '---' && line === '...'))) {
        inFrontMatter = false;
      }
      continue;
    }

    if (activeFence) {
      if (isClosingFence(line, activeFence.char, activeFence.length)) {
        activeFence = null;
      }
      continue;
    }

    const openingFence = matchFenceMarker(line);
    if (openingFence) {
      activeFence = openingFence;
      continue;
    }

    if (isDisplayMathDelimiterLine(line)) {
      inDisplayMath = !inDisplayMath;
      continue;
    }

    if (inDisplayMath) {
      continue;
    }

    const linesInCurrentChunk = i - chunkStartIdx + 1;
    const isBlank = line.trim().length === 0;
    const nextLine = i + 1 < lines.length ? lines[i + 1] : '';
    // Avoid splitting right before an indented continuation or setext underline
    const nextIsSafeBoundary =
      i + 1 < lines.length &&
      !/^( {4,}|\t)/.test(nextLine) &&
      !/^ {0,3}(=+|-+)\s*$/.test(nextLine);

    if (
      isBlank &&
      nextIsSafeBoundary &&
      (linesInCurrentChunk >= targetLines || chunkChars >= targetChars)
    ) {
      const slice = lines.slice(chunkStartIdx, i + 1);
      chunks.push({
        index: chunks.length,
        startLine: chunkStartIdx + 1,
        lineCount: slice.length,
        text: slice.join('\n'),
      });
      chunkStartIdx = i + 1;
      chunkChars = 0;
    }
  }

  if (chunkStartIdx < lines.length) {
    const slice = lines.slice(chunkStartIdx);
    chunks.push({
      index: chunks.length,
      startLine: chunkStartIdx + 1,
      lineCount: slice.length,
      text: slice.join('\n'),
    });
  }

  return chunks;
}
