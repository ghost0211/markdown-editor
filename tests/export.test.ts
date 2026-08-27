import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { getExportFilename } from '../src/lib/documentUtils';
import { exportMarkdownToDocx, isValidDocxHyperlink } from '../src/lib/export/docxExporter';
import { buildPrintableHtml } from '../src/lib/export/pdfExporter';
import { DocumentTab } from '../src/types';

describe('Export Filename Handling (documentUtils.ts)', () => {
  it('should format default names correctly for docx and pdf', () => {
    expect(getExportFilename('My Document.md', 'docx')).toBe('My Document.docx');
    expect(getExportFilename('My Document.md', 'pdf')).toBe('My Document.pdf');
    expect(getExportFilename('Notes.markdown', 'docx')).toBe('Notes.docx');
    expect(getExportFilename('Readme.txt', 'pdf')).toBe('Readme.pdf');
    expect(getExportFilename('archive.tar.gz', 'docx')).toBe('archive.tar.gz.docx');
    expect(getExportFilename('AlreadyDocx.docx', 'docx')).toBe('AlreadyDocx.docx');
    expect(getExportFilename('AlreadyPdf.pdf', 'docx')).toBe('AlreadyPdf.docx');
    expect(getExportFilename('AlreadyPdf.pdf', 'pdf')).toBe('AlreadyPdf.pdf');
  });

  it('should fallback to 未命名 when title is missing or empty', () => {
    expect(getExportFilename('', 'docx')).toBe('未命名.docx');
    expect(getExportFilename(null, 'pdf')).toBe('未命名.pdf');
    expect(getExportFilename('   ', 'docx')).toBe('未命名.docx');
    expect(getExportFilename('   .md  ', 'pdf')).toBe('未命名.pdf');
  });
});

describe('Word .docx Exporter (docxExporter.ts)', () => {
  const SAMPLE_MARKDOWN = `# 第一章 软件概述

这是一个关于 **Markdown 现代化编辑器** 的示例文档。支持 *斜体*、~~删除线~~、\`行内代码\` 以及 [官方主页](https://example.com)。

## 核心功能清单

- [x] 支持多标签页切换
- [ ] 支持实时大纲同步
- 普通无序列表项
  - 嵌套二级列表项
    - 嵌套三级列表项

1. 有序列表第一步
2. 有序列表第二步
   1. 嵌套有序子步骤

> 这是一段技术引用说明：
> "好的编辑器应当提供流畅的阅读与导出体验。"

### 数据统计表格

| 模块名称 | 导出格式 | 状态 | 说明 |
| :--- | :---: | ---: | :--- |
| Word 导出 | .docx | 支持 | 基于 OOXML 标准 |
| PDF 导出 | .pdf | 支持 | 基于 Headless Edge |

---

\`\`\`typescript
function calculateSum(a: number, b: number): number {
  return a + b;
}
console.log(calculateSum(10, 20));
\`\`\`

![示意图](https://example.com/logo.png)
`;

  it('should generate a valid non-empty docx binary starting with PK zip header', async () => {
    const bytes = await exportMarkdownToDocx(SAMPLE_MARKDOWN, '测试示例文档');
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.byteLength).toBeGreaterThan(1000);

    // ZIP magic bytes: PK\x03\x04 (0x50, 0x4b, 0x03, 0x04)
    expect(bytes[0]).toBe(0x50);
    expect(bytes[1]).toBe(0x4b);
    expect(bytes[2]).toBe(0x03);
    expect(bytes[3]).toBe(0x04);
  });

  it('should contain valid word/document.xml with required elements and Chinese text', async () => {
    const bytes = await exportMarkdownToDocx(SAMPLE_MARKDOWN, '测试示例文档');
    const zip = await JSZip.loadAsync(bytes);

    // Verify main OOXML document file exists
    const docXmlFile = zip.file('word/document.xml');
    expect(docXmlFile).not.toBeNull();

    const docXml = await docXmlFile!.async('string');

    // Chinese content checks
    expect(docXml).toContain('第一章 软件概述');
    expect(docXml).toContain('Markdown 现代化编辑器');
    expect(docXml).toContain('核心功能清单');
    expect(docXml).toContain('数据统计表格');
    expect(docXml).toContain('基于 OOXML 标准');

    // Headings check
    expect(docXml).toMatch(/Heading1|heading 1/i);
    expect(docXml).toMatch(/Heading2|heading 2/i);
    expect(docXml).toMatch(/Heading3|heading 3/i);

    // Table elements check
    expect(docXml).toContain('<w:tbl>');
    expect(docXml).toContain('<w:tr');
    expect(docXml).toContain('<w:tc');

    // Code block check
    expect(docXml).toContain('calculateSum');
    expect(docXml).toContain('Consolas');

    // Inline formatting
    expect(docXml).toContain('<w:b/>'); // Bold
    expect(docXml).toContain('<w:i/>'); // Italic
    expect(docXml).toContain('<w:strike/>'); // Strikethrough
    expect(docXml).toContain('<w:hyperlink'); // Hyperlink
  });

  it('should handle empty markdown gracefully', async () => {
    const bytes = await exportMarkdownToDocx('', '空文档');
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.byteLength).toBeGreaterThan(500);

    const zip = await JSZip.loadAsync(bytes);
    const docXmlFile = zip.file('word/document.xml');
    expect(docXmlFile).not.toBeNull();
  });

  describe('Word Hyperlink Whitelist and Security', () => {
    it('should validate hyperlink protocols correctly (isValidDocxHyperlink)', () => {
      // Safe protocols
      expect(isValidDocxHyperlink('https://example.com')).toBe(true);
      expect(isValidDocxHyperlink('HTTPS://EXAMPLE.COM/DOCS')).toBe(true);
      expect(isValidDocxHyperlink('http://localhost:3000')).toBe(true);
      expect(isValidDocxHyperlink('HTTP://MY-SERVER.LOCAL/API')).toBe(true);
      expect(isValidDocxHyperlink('mailto:support@example.com')).toBe(true);
      expect(isValidDocxHyperlink('MAILTO:SUPPORT@EXAMPLE.COM?subject=Help')).toBe(true);

      // Dangerous and disallowed protocols
      expect(isValidDocxHyperlink('javascript:alert(1)')).toBe(false);
      expect(isValidDocxHyperlink('JAVASCRIPT:alert(1)')).toBe(false);
      expect(isValidDocxHyperlink('javascript:void(0)')).toBe(false);
      expect(isValidDocxHyperlink('file:///C:/Windows/System32/cmd.exe')).toBe(false);
      expect(isValidDocxHyperlink('FILE:///etc/passwd')).toBe(false);
      expect(isValidDocxHyperlink('data:text/html,<script>alert(1)</script>')).toBe(false);
      expect(isValidDocxHyperlink('vbscript:msgbox(1)')).toBe(false);
      expect(isValidDocxHyperlink('powershell:calc.exe')).toBe(false);
      expect(isValidDocxHyperlink('blob:http://localhost:5173/123')).toBe(false);

      // Empty / malformed / relative
      expect(isValidDocxHyperlink('')).toBe(false);
      expect(isValidDocxHyperlink('   ')).toBe(false);
      expect(isValidDocxHyperlink(null)).toBe(false);
      expect(isValidDocxHyperlink(undefined)).toBe(false);
      expect(isValidDocxHyperlink('not-a-valid-url')).toBe(false);
      expect(isValidDocxHyperlink('./relative/path.md')).toBe(false);
      expect(isValidDocxHyperlink('https://\u0000bad.com')).toBe(false);
    });

    it('should strip dangerous javascript/file relationships from rels while retaining link text in document.xml', async () => {
      const securityMarkdown = `# 安全链接与外链隔离测试

- [合法HTTPS链接](https://safe-domain.com/docs)
- [大写协议链接](HTTPS://EXAMPLE.ORG/SPEC)
- [邮件联系链接](mailto:team@company.org)
- [危险脚本链接](javascript:alert("XSS Attack"))
- [本地文件链接](file:///C:/Windows/System32/drivers/etc/hosts)
- [空目标链接]()
`;

      const bytes = await exportMarkdownToDocx(securityMarkdown, '安全链接导出测试');
      const zip = await JSZip.loadAsync(bytes);

      // 1. Verify word/document.xml contains ALL visible link text
      const docXmlFile = zip.file('word/document.xml');
      expect(docXmlFile).not.toBeNull();
      const docXml = await docXmlFile!.async('string');

      expect(docXml).toContain('合法HTTPS链接');
      expect(docXml).toContain('大写协议链接');
      expect(docXml).toContain('邮件联系链接');
      expect(docXml).toContain('危险脚本链接');
      expect(docXml).toContain('本地文件链接');
      expect(docXml).toContain('空目标链接');

      // 2. Verify word/_rels/document.xml.rels for external relationships
      const relsFile = zip.file('word/_rels/document.xml.rels');
      expect(relsFile).not.toBeNull();
      const relsXml = await relsFile!.async('string');

      // Safe links MUST be preserved in relationships
      expect(relsXml).toContain('https://safe-domain.com/docs');
      expect(relsXml).toContain('HTTPS://EXAMPLE.ORG/SPEC');
      expect(relsXml).toContain('mailto:team@company.org');

      // Dangerous schemes MUST NOT exist in rels
      expect(relsXml).not.toContain('javascript:');
      expect(relsXml).not.toContain('alert(');
      expect(relsXml).not.toContain('file:');
      expect(relsXml).not.toContain('System32');
      expect(relsXml).not.toContain('etc/hosts');
    });
  });
});

describe('PDF Exporter / Printable HTML (pdfExporter.ts)', () => {
  const SAMPLE_MARKDOWN = `# 项目架构设计

这是正文段落，包含 **加粗** 和 *倾斜* 内容。

- [ ] 待办事项 1
- [x] 已完成事项 2

| 字段 | 类型 |
| --- | --- |
| id | string |

\`\`\`rust
fn main() {
    println!("Hello, Markdown!");
}
\`\`\`
`;

  it('should build complete standalone HTML with UTF-8, A4 pagination, and styling', async () => {
    const html = await buildPrintableHtml(SAMPLE_MARKDOWN, '架构设计方案', 'C:\\Docs\\Project\\spec.md');

    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('<meta charset="utf-8">');
    expect(html).toContain('<title>架构设计方案</title>');
    expect(html).toContain('@page {');
    expect(html).toContain('size: A4 portrait;');
    expect(html).toContain('Microsoft YaHei');
    expect(html).toContain('项目架构设计');
    expect(html).toContain('<table>');
    expect(html).toContain('<th>字段</th>');
    expect(html).toContain('<input type="checkbox"');
    expect(html).toContain('<pre><code');
    expect(html).toContain('base href="file:///C:/Docs/Project/"');
  });

  it('should strictly sanitize dangerous scripts and malicious URLs', async () => {
    const maliciousMd = `# 恶意代码测试

<script>alert('XSS Attack!')</script>

<img src="x" onerror="alert(1)">

[危险链接](javascript:alert('pwned'))

[安全链接](https://safe-domain.org)
`;

    const html = await buildPrintableHtml(maliciousMd, '安全测试');

    // Scripts and inline events must not be executed
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('alert(');
    expect(html).not.toContain('onerror=');
    expect(html).not.toContain('javascript:');

    // Safe links must be preserved
    expect(html).toContain('href="https://safe-domain.org"');
    expect(html).toContain('安全链接');
  });
});

describe('Document Immutability During Export Flow', () => {
  it('should never mutate original tab properties during export', async () => {
    const originalTab: DocumentTab = {
      id: 'tab-1',
      title: '原有标题.md',
      filePath: 'C:\\docs\\原有标题.md',
      content: '# 内容不变',
      savedContent: '# 内容不变',
      isDirty: false,
      cursorLine: 5,
      cursorCol: 10,
    };

    const tabCopy = { ...originalTab };

    // Export to Docx
    const docxBytes = await exportMarkdownToDocx(originalTab.content, originalTab.title);
    expect(docxBytes.length).toBeGreaterThan(0);

    // Export to PDF HTML
    const html = await buildPrintableHtml(originalTab.content, originalTab.title, originalTab.filePath || undefined);
    expect(html.length).toBeGreaterThan(0);

    // Verify properties remain identical
    expect(originalTab.id).toBe(tabCopy.id);
    expect(originalTab.title).toBe(tabCopy.title);
    expect(originalTab.filePath).toBe(tabCopy.filePath);
    expect(originalTab.content).toBe(tabCopy.content);
    expect(originalTab.savedContent).toBe(tabCopy.savedContent);
    expect(originalTab.isDirty).toBe(tabCopy.isDirty);
    expect(originalTab.cursorLine).toBe(tabCopy.cursorLine);
    expect(originalTab.cursorCol).toBe(tabCopy.cursorCol);
  });
});
