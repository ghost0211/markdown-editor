import { describe, expect, it } from 'vitest';
import { closeBrackets, insertBracket } from '@codemirror/autocomplete';
import { markdown } from '@codemirror/lang-markdown';
import { EditorState } from '@codemirror/state';
import { keymap, type EditorView } from '@codemirror/view';
import { chapterLinkTrigger, type ChapterLinkInsertion } from '../src/lib/chapterLinkTrigger';
import { clipboardHtmlToMarkdown } from '../src/lib/clipboardMarkdown';
import { documentBacklinks, markdownChapterLink } from '../src/lib/chapterLinks';
import { makeBatchExportNames } from '../src/lib/export/batchExport';
import { sortedVisualTableRows } from '../src/lib/visualTableData';

describe('rich clipboard conversion', () => {
  it('converts a Word fragment with mixed headings, body, list, table, and image', () => {
    const html = [
      '<html><head><title>Excluded</title></head><body><!--StartFragment-->',
      '<p class="MsoHeading2">设计方案</p>',
      '<p>现状 <span style="font-weight:700">重点</span> 和 <a href="https://example.com/a(b)">参考</a></p>',
      '<ul><li>甲<ul><li>子项</li></ul></li><li>乙</li></ul>',
      '<table><tr><th>说明</th></tr><tr><td>上<br>下</td></tr></table>',
      '<p><img alt="图" src="data:image/png;base64,AAAA"></p>',
      '<!--EndFragment--><p>Excluded</p></body></html>',
    ].join('');
    const paste = clipboardHtmlToMarkdown(html)!;
    expect(paste).toMatchObject({ block: true, imageOnly: false });
    expect(paste.markdown).toContain('## 设计方案');
    expect(paste.markdown).toContain('现状 **重点** 和 [参考](https://example.com/a%28b%29)');
    expect(paste.markdown).toContain('  - 子项');
    expect(paste.markdown).toContain('上<br>下');
    expect(paste.markdown).toContain('![图](data:image/png;base64,AAAA)');
    expect(paste.markdown).not.toContain('Excluded');
  });

  it('uses ordinary paste for plain text and drops active HTML content and URLs', () => {
    expect(clipboardHtmlToMarkdown('<span>plain text</span>')).toBeNull();
    const paste = clipboardHtmlToMarkdown('<strong>safe</strong><a href="javascript:bad()">label</a><script>noise</script>');
    expect(paste?.markdown).toBe('**safe**label');
  });

  it('keeps paragraph line breaks when HTML rendering is disabled', () => {
    const paste = clipboardHtmlToMarkdown('<p>First<br>Second</p>');
    expect(paste?.markdown).toBe('First\\\nSecond');
  });
});

describe('chapter links', () => {
  it('opens the picker on the second bracket and consumes the auto-closed bracket', async () => {
    let request: ChapterLinkInsertion | undefined;
    const extensions = [markdown(), closeBrackets(), chapterLinkTrigger((event) => { request = event; })];
    const initial = EditorState.create({ extensions });
    const view = {
      state: insertBracket(initial, '[')!.state,
      dom: { isConnected: true },
      compositionStarted: false,
      dispatch(spec: Parameters<EditorState['update']>[0]) { this.state = this.state.update(spec).state; },
    };
    const binding = view.state.facet(keymap).flat().find((binding) => binding.key === '[');
    expect(binding?.run?.(view as unknown as EditorView)).toBe(true);
    await Promise.resolve();
    expect(view.state.doc.toString()).toBe('[[');
    expect(request).toEqual({ from: 0, to: 2, snapshot: view.state.doc });
  });

  it('generates Markdown relative links and finds encoded and reference links by source line', () => {
    expect(markdownChapterLink('D:/docs/main.md', 'D:/docs/sub/文档 (v2).md', '标题 [说明]', '目标-章节', false)).toBe(
      '[标题 \\[说明\\]](sub/%E6%96%87%E6%A1%A3%20%28v2%29.md#%E7%9B%AE%E6%A0%87-%E7%AB%A0%E8%8A%82)'
    );
    expect(markdownChapterLink(null, null, '本地', '本地', true)).toBe('[本地](#%E6%9C%AC%E5%9C%B0)');
    const target = { id: 'main', filePath: 'D:/docs/main.md', title: 'Main', content: '# 本地\n\n[本页](#本地)' };
    const source = {
      id: 'guide', filePath: 'D:/docs/sub/guide.md', title: 'Guide',
      content: 'A [jump](../main.md#%E6%9C%AC%E5%9C%B0)\n\nB [refer][main]\n\n[main]: ../main.md#本地\n\n[other](https://example.test/main.md#本地)',
    };
    const matches = documentBacklinks(target, [target, source]);
    expect(matches.map((match) => [match.document.id, match.line, match.slug])).toEqual([
      ['main', 3, '本地'], ['guide', 1, '本地'], ['guide', 3, '本地'],
    ]);
    expect(matches[2].snippet).toContain('[refer]');
  });
});

describe('typed table sorting', () => {
  it('sorts Markdown-formatted, empty and invalid data predictably', () => {
    expect(sortedVisualTableRows([['Count'], ['1,200'], ['**20**'], ['invalid'], ['20'], ['']], 0, 'number', 1, 'en-US'))
      .toEqual([2, 4, 1, 3, 5]);
    expect(sortedVisualTableRows([['Date'], ['2026/1/2'], ['2026年11月1日'], ['2026-02-30']], 0, 'date', -1, 'zh-CN'))
      .toEqual([2, 1, 3]);
    expect(sortedVisualTableRows([['Name'], ['Item 12'], ['Item 2']], 0, 'text', 1, 'en-US')).toEqual([2, 1]);
  });
});

describe('batch export names', () => {
  it('allocates Windows-safe unique output names for duplicate basenames', () => {
    expect(makeBatchExportNames([
      { path: 'D:/docs/A/report.md', title: 'Edited title' },
      { path: 'D:/docs/B/Report.xmd', title: 'Report' },
      { path: 'D:/docs/B/Report (2).md', title: 'Another Report' },
    ], 'html')).toEqual(['report.html', 'Report (2).html', 'Report (2) (2).html']);
  });
});
