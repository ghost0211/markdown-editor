import { describe, it, expect } from 'vitest';
import { calculateStats } from '../src/lib/stats';

describe('Text statistics calculation', () => {
  it('should handle empty text', () => {
    const stats = calculateStats('');
    expect(stats).toEqual({
      words: 0,
      chars: 0,
      charsNoSpaces: 0,
      lines: 0,
      readingTimeMinutes: 0,
    });
  });

  it('should accurately count English words', () => {
    const text = 'Hello world, this is a test.';
    const stats = calculateStats(text);
    expect(stats.words).toBe(6);
    expect(stats.chars).toBe(text.length);
    expect(stats.lines).toBe(1);
  });

  it('should accurately count Chinese characters as 1 word each', () => {
    const text = '你好世界，这是一段中文测试。';
    const stats = calculateStats(text);
    expect(stats.words).toBe(12); // 12 chinese characters
    expect(stats.chars).toBe(text.length);
    expect(stats.lines).toBe(1);
  });

  it('should accurately count mixed Chinese and English text', () => {
    const text = '使用 Tauri 2 与 React 构建高性能 Markdown 编辑器。';
    // Chinese characters: 使用(2) 与(1) 构建高性能(5) 编辑器(3) -> 11
    // Western words: Tauri(1), 2(1), React(1), Markdown(1) -> 4
    // Total words = 15
    const stats = calculateStats(text);
    expect(stats.words).toBe(15);
  });

  it('should accurately calculate lines and characters without spaces', () => {
    const text = `Line 1
Line 2

Line 4`;
    const stats = calculateStats(text);
    expect(stats.lines).toBe(4);
    expect(stats.charsNoSpaces).toBe(text.replace(/\s/g, '').length);
  });
});
