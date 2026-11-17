import { TextStats } from '@/types';
import { collectCodeRanges, collectEmbeddedDataUrlRanges } from '@/lib/documentSearch';

/** Preserve visible prose and alt text while excluding embedded binary payloads. */
export function stripEmbeddedResourcePayloads(text: string): string {
  // Use bounded, linear scans instead of reparsing a multi-megabyte Base64 URL.
  // Literal examples in code are not actual resources and remain untouched.
  if (!/data:/i.test(text)) return text;
  const codeRanges = collectCodeRanges(text);
  const ranges = collectEmbeddedDataUrlRanges(text).filter((range) =>
    !codeRanges.some((code) => range.from < code.to && range.to > code.from)
  );
  ranges.sort((left, right) => left.from - right.from || left.to - right.to);
  const pieces: string[] = [];
  let cursor = 0;
  for (const range of ranges) {
    if (range.from < cursor) continue;
    pieces.push(text.slice(cursor, range.from));
    cursor = range.to;
  }
  pieces.push(text.slice(cursor));
  return pieces.join('');
}

/**
 * Calculates detailed statistics for markdown/plain text.
 * CJK characters count as 1 word each.
 * Western words (alphanumeric sequences) count as 1 word each.
 */
export function calculateStats(text: string): TextStats {
  if (!text) {
    return {
      words: 0,
      chars: 0,
      charsNoSpaces: 0,
      lines: 0,
      readingTimeMinutes: 0,
    };
  }

  const readableText = stripEmbeddedResourcePayloads(text);
  const chars = readableText.length;
  const charsNoSpaces = readableText.replace(/\s/g, '').length;
  const lines = text.split(/\r?\n/).length;

  // Count CJK characters
  const cjkMatches = readableText.match(/[\u4e00-\u9fa5\u3040-\u30ff\uac00-\ud7af]/g);
  const cjkCount = cjkMatches ? cjkMatches.length : 0;

  // Remove CJK characters, then count remaining Western/Alphanumeric words
  const nonCjkText = readableText.replace(/[\u4e00-\u9fa5\u3040-\u30ff\uac00-\ud7af]/g, ' ');
  const westernWords = nonCjkText.match(/[a-zA-Z0-9_-]+/g);
  const westernCount = westernWords ? westernWords.length : 0;

  const totalWords = cjkCount + westernCount;

  // Average reading speed: ~300 words per minute
  const readingTimeMinutes = Math.max(1, Math.ceil(totalWords / 300));

  return {
    words: totalWords,
    chars,
    charsNoSpaces,
    lines,
    readingTimeMinutes,
  };
}
