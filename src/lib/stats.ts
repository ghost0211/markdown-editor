import { TextStats } from '@/types';

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

  const chars = text.length;
  const charsNoSpaces = text.replace(/\s/g, '').length;
  const lines = text.split(/\r?\n/).length;

  // Count CJK characters
  const cjkMatches = text.match(/[\u4e00-\u9fa5\u3040-\u30ff\uac00-\ud7af]/g);
  const cjkCount = cjkMatches ? cjkMatches.length : 0;

  // Remove CJK characters, then count remaining Western/Alphanumeric words
  const nonCjkText = text.replace(/[\u4e00-\u9fa5\u3040-\u30ff\uac00-\ud7af]/g, ' ');
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
