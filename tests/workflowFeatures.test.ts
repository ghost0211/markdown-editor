import JSZip from 'jszip';
import { describe, expect, it, vi } from 'vitest';
import { checkDocumentAnchors, repairDocumentAnchor } from '../src/lib/documentAnchors';
import { moveOutlineSection, renumberOutline } from '../src/lib/outlineEditing';
import { buildPrintableHtml } from '../src/lib/export/pdfExporter';
import { buildStandaloneHtml } from '../src/lib/export/htmlExporter';
import { buildRichTextHtml } from '../src/lib/export/richText';
import { exportMarkdownToDocx } from '../src/lib/export/docxExporter';
import { parseSpreadsheetText } from '../src/lib/markdownTable';
import { workspaceSearchDocuments } from '../src/lib/workspaceSearch';
import { searchDocuments } from '../src/lib/documentSearch';

describe('workspace search', () => {
  it('searches unopened paths, overlays open buffers, and excludes other folders and diff tabs', () => {
    const documents = workspaceSearchDocuments({
      root: 'D:/Notes', skipped: 0, truncated: false,
      documents: [
        { id: 'd:/notes/a.md', filePath: 'D:/Notes/A.md', title: 'A.md', content: 'old' },
        { id: 'd:/notes/sub/b.md', filePath: 'D:/Notes/sub/B.md', title: 'sub/B.md', content: 'Intro\n密钥字段' },
      ],
    }, [
      { id: 'tab-a', title: 'A.md', filePath: 'd:\\NOTES\\a.md', content: '当前 密钥字段' },
      { id: 'tab-diff', title: 'diff', filePath: 'D:/Notes/diff.md', content: '密钥字段', kind: 'diff' },
      { id: 'tab-outside', title: 'external', filePath: 'D:/Notes2/test.md', content: '密钥字段' },
    ]);
    const result = searchDocuments(documents, { query: '密钥字段', caseSensitive: false, wholeWord: false, regex: false });
    expect(result.results.map((item) => [item.title, item.matches[0].line])).toEqual([
      ['A.md', 1], ['sub/B.md', 2],
    ]);
    expect(documents[0].content).toBe('当前 密钥字段');
  });
});

describe('outline editing', () => {
  it('moves an entire sibling subtree with preface, code and EOF preserved', () => {
    const source = [
      '\uFEFF# 文档', '', '引言', '',
      '## 4. 后端', '正文 A', '',
      '### 4.1 数据库', '```sql', '## 假标题', '```', '',
      '## 5. 前端', '正文 B',
    ].join('\r\n');
    const next = moveOutlineSection(source, 5, { line: 13, placement: 'after' });
    expect(next).toBe([
      '\uFEFF# 文档', '', '引言', '',
      '## 5. 前端', '正文 B', '',
      '## 4. 后端', '正文 A', '',
      '### 4.1 数据库', '```sql', '## 假标题', '```',
    ].join('\r\n'));
    expect(moveOutlineSection(source, 8, { line: 13, placement: 'before' })).toBeNull();
    expect(moveOutlineSection(source, 13, { direction: -1 })).toBe(next);
  });

  it('previews ordered numbering, propagates parent numbers and preserves other text', () => {
    const source = '# 设计\n\n## 5. 前端\n### 5.2 交互\n### 5.1 样式\n\n## 4. 后端\n### 4.1 数据库 ###\n\n## 2026 规划';
    const plan = renumberOutline(source);
    expect(plan.content).toBe('# 设计\n\n## 4. 前端\n### 4.1 交互\n### 4.2 样式\n\n## 5. 后端\n### 5.1 数据库 ###\n\n## 2026 规划');
    expect(plan.changes.map((row) => row.line)).toEqual([3, 4, 5, 7, 8]);
    expect(renumberOutline(plan.content).changes).toEqual([]);
  });
});

describe('table clipboard and export', () => {
  it('reads single columns and quoted spreadsheet cells', () => {
    expect(parseSpreadsheetText('第一行\r\n第二行\r\n')).toEqual([['第一行'], ['第二行']]);
    expect(parseSpreadsheetText('A\t"多\r\n行"\r\nB\t"a""b"\r\n')).toEqual([['A', '多\n行'], ['B', 'a"b']]);
    expect(parseSpreadsheetText('普通文本')).toBeNull();
  });

  it('exports real line breaks in prose and cells while keeping code literal', async () => {
    const source = '甲<br>乙\n\n| 列 |\n| --- |\n| 上<BR />下 |\n\n`<br>`\n\n<script>alert(1)</script>';
    const results = await Promise.all([
      buildStandaloneHtml(source, 'Doc'),
      buildPrintableHtml(source, 'Doc'),
      buildRichTextHtml(source),
      exportMarkdownToDocx(source, 'Doc'),
    ]);
    for (const html of results.slice(0, 3) as string[]) {
      expect(html).toMatch(/甲<br>\s*乙/);
      expect(html).toMatch(/上<br>\s*下/);
      expect(html).toMatch(/(?:&lt;|&#x3C;)br>/i);
      expect(html).not.toContain('<script>');
    }
    const zip = await JSZip.loadAsync(results[3]);
    const xml = await zip.file('word/document.xml')!.async('string');
    expect(xml.match(/<w:br\/>/g)).toHaveLength(2);
    expect(xml).toContain('&lt;br&gt;');
  });
});

describe('heading anchor repair', () => {
  it('checks current and local headings, respects duplicate slugs, and only rewrites the chosen anchor', async () => {
    const source = [
      '\uFEFF# 本页', '', '[好](#%E6%9C%AC%E9%A1%B5)', '[坏](#删掉的标题)', '',
      '[跨文档](<sub/设计 方案.md#old> "原来的 title")',
      '[引用一][doc] [引用二][doc]', '',
      '[doc]: sub/file.md&#35;before "保留"',
      '[有效的重复标题](sub/file.md#data-1)', '[外站](https://example.test/#old)',
      '', '`[代码例子](#missing)`',
    ].join('\n');
    const readTarget = vi.fn(async () => '# Data\n\n## Data\n\n## 处理流程');
    const issues = await checkDocumentAnchors(source, { sourcePath: 'D:/work/main.md', readTarget });
    expect(issues.map((issue) => issue.line)).toEqual([4, 6, 7]);
    expect(readTarget.mock.calls).toHaveLength(2);
    expect(issues[1].repair?.headings.map(({ slug }) => slug)).toEqual(['data', 'data-1', '处理流程']);
    const repaired = repairDocumentAnchor(source, issues[1].repair!, '处理流程')!;
    expect(repaired).toContain('<sub/设计 方案.md#%E5%A4%84%E7%90%86%E6%B5%81%E7%A8%8B> "原来的 title"');
    expect(repairDocumentAnchor(repaired, issues[1].repair!, 'data')).toBeNull();
    expect(issues[2].repair?.shared).toBe(true);
    expect(repairDocumentAnchor(source, issues[2].repair!, 'data')).toContain('[doc]: sub/file.md#data "保留"');
  });
});
