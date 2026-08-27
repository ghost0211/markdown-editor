import { describe, it, expect } from 'vitest';
import {
  formatMarkdownString,
  resolveMarkdownPlaceholders,
  DEFAULT_ZH_PLACEHOLDERS,
  DEFAULT_EN_PLACEHOLDERS,
} from '../src/lib/markdownCommands';
import { t } from '../src/i18n';

describe('Markdown formatting string commands', () => {
  describe('Basic Syntax Wrapping with Selection', () => {
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

    it('should format code block with selected text', () => {
      const text = 'console.log("hi");';
      const res = formatMarkdownString(text, 0, text.length, 'code-block');
      expect(res.newText).toBe('```javascript\nconsole.log("hi");\n```\n');
    });

    it('should format blockquote with selected text', () => {
      const text = 'Line 1\nLine 2';
      const res = formatMarkdownString(text, 0, text.length, 'quote');
      expect(res.newText).toBe('> Line 1\n> Line 2');
    });

    it('should format task lists with selected text', () => {
      const text = 'Buy milk\nDo homework';
      const res = formatMarkdownString(text, 0, text.length, 'task');
      expect(res.newText).toBe('- [ ] Buy milk\n- [ ] Do homework');
    });

    it('should format links with selected text', () => {
      const text = 'Click here';
      const res = formatMarkdownString(text, 0, text.length, 'link');
      expect(res.newText).toBe('[Click here](https://example.com)');
    });

    it('should format images with selected text as alt description', () => {
      const text = 'Custom Diagram';
      const res = formatMarkdownString(text, 0, text.length, 'image');
      expect(res.newText).toBe('![Custom Diagram](https://example.com/image.png)');
    });
  });

  describe('Locale-aware Empty-Selection Placeholders (zh-CN vs en-US)', () => {
    it('should resolve correct default placeholders for zh-CN and en-US', () => {
      const zh = resolveMarkdownPlaceholders('zh-CN');
      expect(zh).toEqual(DEFAULT_ZH_PLACEHOLDERS);
      expect(zh.heading).toBe('标题内容');
      expect(zh.tableCol1).toBe('列 1');

      const en = resolveMarkdownPlaceholders('en-US');
      expect(en).toEqual(DEFAULT_EN_PLACEHOLDERS);
      expect(en.heading).toBe('Heading');
      expect(en.tableCol1).toBe('Column 1');
    });

    it('should insert Chinese placeholders when language is zh-CN or unprovided', () => {
      expect(formatMarkdownString('', 0, 0, 'code-block', 'zh-CN').newText).toContain('代码片段');
      expect(formatMarkdownString('', 0, 0, 'quote', 'zh-CN').newText).toBe('> 代码片段'.replace('代码片段', '引用文本'));
      expect(formatMarkdownString('', 0, 0, 'h1', 'zh-CN').newText).toBe('# 标题内容');
      expect(formatMarkdownString('', 0, 0, 'h2', 'zh-CN').newText).toBe('## 标题内容');
      expect(formatMarkdownString('', 0, 0, 'ul', 'zh-CN').newText).toBe('- 列表项');
      expect(formatMarkdownString('', 0, 0, 'ol', 'zh-CN').newText).toBe('1. 有序列表项');
      expect(formatMarkdownString('', 0, 0, 'task', 'zh-CN').newText).toBe('- [ ] 待办任务');
      expect(formatMarkdownString('', 0, 0, 'link', 'zh-CN').newText).toBe('[链接文本](https://example.com)');
      expect(formatMarkdownString('', 0, 0, 'image', 'zh-CN').newText).toBe('![图片描述](https://example.com/image.png)');

      const tableZh = formatMarkdownString('', 0, 0, 'table', 'zh-CN').newText;
      expect(tableZh).toContain('| 列 1 | 列 2 | 列 3 |');
      expect(tableZh).toContain('| 单元格 1 | 单元格 2 | 单元格 3 |');
    });

    it('should insert English placeholders when language is en-US', () => {
      expect(formatMarkdownString('', 0, 0, 'code-block', 'en-US').newText).toContain('Code Snippet');
      expect(formatMarkdownString('', 0, 0, 'quote', 'en-US').newText).toBe('> Quote text');
      expect(formatMarkdownString('', 0, 0, 'h1', 'en-US').newText).toBe('# Heading');
      expect(formatMarkdownString('', 0, 0, 'h2', 'en-US').newText).toBe('## Heading');
      expect(formatMarkdownString('', 0, 0, 'ul', 'en-US').newText).toBe('- List item');
      expect(formatMarkdownString('', 0, 0, 'ol', 'en-US').newText).toBe('1. Ordered item');
      expect(formatMarkdownString('', 0, 0, 'task', 'en-US').newText).toBe('- [ ] Task item');
      expect(formatMarkdownString('', 0, 0, 'link', 'en-US').newText).toBe('[Link text](https://example.com)');
      expect(formatMarkdownString('', 0, 0, 'image', 'en-US').newText).toBe('![Image description](https://example.com/image.png)');

      const tableEn = formatMarkdownString('', 0, 0, 'table', 'en-US').newText;
      expect(tableEn).toContain('| Column 1 | Column 2 | Column 3 |');
      expect(tableEn).toContain('| Cell 1 | Cell 2 | Cell 3 |');
      expect(tableEn).toContain('| Cell 4 | Cell 5 | Cell 6 |');
    });

    it('should accept a typed translator function or options object', () => {
      const enTranslator = (key: Parameters<typeof t>[1]) => t('en-US', key);
      const res = formatMarkdownString('', 0, 0, 'table', enTranslator);
      expect(res.newText).toContain('| Column 1 | Column 2 | Column 3 |');

      const resObj = formatMarkdownString('', 0, 0, 'code-block', { t: enTranslator });
      expect(resObj.newText).toContain('Code Snippet');
    });
  });

  describe('Selected-Content Integrity Across Locales', () => {
    it('should never alter explicitly selected user text regardless of locale setting', () => {
      const userText = 'User Custom Title';
      const zhH1 = formatMarkdownString(userText, 0, userText.length, 'h1', 'zh-CN');
      const enH1 = formatMarkdownString(userText, 0, userText.length, 'h1', 'en-US');

      expect(zhH1.newText).toBe('# User Custom Title');
      expect(enH1.newText).toBe('# User Custom Title');

      const userCode = 'const x = 42;';
      const zhCode = formatMarkdownString(userCode, 0, userCode.length, 'code-block', 'zh-CN');
      const enCode = formatMarkdownString(userCode, 0, userCode.length, 'code-block', 'en-US');

      expect(zhCode.newText).toBe('```javascript\nconst x = 42;\n```\n');
      expect(enCode.newText).toBe('```javascript\nconst x = 42;\n```\n');

      const userList = 'Alpha\nBeta';
      const zhUl = formatMarkdownString(userList, 0, userList.length, 'ul', 'zh-CN');
      const enUl = formatMarkdownString(userList, 0, userList.length, 'ul', 'en-US');

      expect(zhUl.newText).toBe('- Alpha\n- Beta');
      expect(enUl.newText).toBe('- Alpha\n- Beta');
    });
  });
});
