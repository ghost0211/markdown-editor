import { describe, it, expect } from 'vitest';
import { formatMarkdownString } from '../src/lib/markdownCommands';

describe('Markdown formatting string commands', () => {
  it('should wrap selected text with bold syntax', () => {
    const text = 'Hello world';
    const res = formatMarkdownString(text, 6, 11, 'bold');
    expect(res.newText).toBe('Hello **world**');
    expect(res.selectionStart).toBe(8);
    expect(res.selectionEnd).toBe(13);
  });

  it('should insert empty bold placeholder if no selection', () => {
    const text = 'Hello ';
    const res = formatMarkdownString(text, 6, 6, 'bold');
    expect(res.newText).toBe('Hello ****');
    expect(res.selectionStart).toBe(8);
    expect(res.selectionEnd).toBe(8);
  });

  it('should wrap selected text with italic syntax', () => {
    const text = 'Hello italic world';
    const res = formatMarkdownString(text, 6, 12, 'italic');
    expect(res.newText).toBe('Hello *italic* world');
  });

  it('should wrap selected text with strikethrough syntax', () => {
    const text = 'Hello old world';
    const res = formatMarkdownString(text, 6, 9, 'strike');
    expect(res.newText).toBe('Hello ~~old~~ world');
  });

  it('should wrap selected text with inline code syntax', () => {
    const text = 'Use const variable';
    const res = formatMarkdownString(text, 4, 9, 'inline-code');
    expect(res.newText).toBe('Use `const` variable');
  });

  it('should format code block with language placeholder', () => {
    const text = 'console.log("hi");';
    const res = formatMarkdownString(text, 0, text.length, 'code-block');
    expect(res.newText).toBe('```javascript\nconsole.log("hi");\n```\n');
  });

  it('should format blockquote', () => {
    const text = 'Line 1\nLine 2';
    const res = formatMarkdownString(text, 0, text.length, 'quote');
    expect(res.newText).toBe('> Line 1\n> Line 2');
  });

  it('should format task lists', () => {
    const text = 'Buy milk\nDo homework';
    const res = formatMarkdownString(text, 0, text.length, 'task');
    expect(res.newText).toBe('- [ ] Buy milk\n- [ ] Do homework');
  });

  it('should format links', () => {
    const text = 'Click here';
    const res = formatMarkdownString(text, 0, text.length, 'link');
    expect(res.newText).toBe('[Click here](https://example.com)');
  });

  it('should format tables', () => {
    const text = '';
    const res = formatMarkdownString(text, 0, 0, 'table');
    expect(res.newText).toContain('| 列 1 | 列 2 | 列 3 |');
    expect(res.newText).toContain('| :--- | :---: | ---: |');
  });
});
