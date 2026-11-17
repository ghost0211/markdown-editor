import { describe, it, expect } from 'vitest';
import { calculateStats, stripEmbeddedResourcePayloads } from '../src/lib/stats';

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

  it('excludes a multi-megabyte inline image from words, characters and reading time', () => {
    const payload = 'A'.repeat(2 * 1024 * 1024);
    const text = `# 图片\n\n正文\n\n![替代文本](<data:image/png;base64,${payload}>)`;
    const stats = calculateStats(text);
    expect(stats.words).toBe(8);
    expect(stats.chars).toBeLessThan(256);
    expect(stats.charsNoSpaces).toBeLessThan(100);
    expect(stats.readingTimeMinutes).toBe(1);
    expect(stats.lines).toBe(5);
  });

  it('keeps image alt text while removing the embedded destination', () => {
    const text = '![中文说明](<data:image/png;base64,AAAA>)';
    expect(stripEmbeddedResourcePayloads(text)).toBe('![中文说明](<>)');
    expect(calculateStats(text).words).toBe(4);
  });

  it('excludes data URLs in reference-style images', () => {
    const text = '![替代][图]\n\n[图]: <data:image/png;base64,AAAA>';
    const stripped = stripEmbeddedResourcePayloads(text);
    expect(stripped).toBe('![替代][图]\n\n[图]: <>');
    expect(calculateStats(text).readingTimeMinutes).toBe(1);
  });

  it('also excludes an unused embedded definition without removing its label', () => {
    const text = '# 正文\n\n[unused]: <data:image/png;base64,AAAA>';
    expect(stripEmbeddedResourcePayloads(text)).toBe('# 正文\n\n[unused]: <>');
  });

  it('excludes HTML src and complete srcset payloads', () => {
    const text = '<img alt="图片" src="data:image/png;base64,AAAA">\n<source srcset="data:image/png;base64,AAAA 1x, data:image/png;base64,BBBB 2x">';
    const stripped = stripEmbeddedResourcePayloads(text);
    expect(stripped).not.toContain('data:');
    expect(stripped).toContain('alt="图片"');
    expect(calculateStats(text).chars).toBeLessThan(100);
  });

  it('excludes embedded attachment links while preserving the download label', () => {
    const text = '[下载附件](<data:application/pdf;base64,JVBERi0xLjc=>)';
    expect(stripEmbeddedResourcePayloads(text)).toContain('下载附件');
    expect(stripEmbeddedResourcePayloads(text)).not.toContain('JVBER');
  });

  it('does not mistake fenced or inline code samples for actual embedded images', () => {
    const text = '```md\n[code]: <data:image/png;base64,AAAA>\n```\n\n`![示例](data:image/png;base64,AAAA)`';
    expect(stripEmbeddedResourcePayloads(text)).toBe(text);
  });

  it('leaves ordinary text unchanged and preserves CRLF source line counts', () => {
    const plain = 'Hello 世界\n\n正常正文';
    expect(stripEmbeddedResourcePayloads(plain)).toBe(plain);
    const text = '# 标题\r\n\r\n![图](<data:image/png;base64,AAAA>)';
    expect(calculateStats(text).lines).toBe(3);
    expect(stripEmbeddedResourcePayloads(text)).not.toContain('AAAA');
  });
});
