import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { getExportFilename } from '../src/lib/documentUtils';
import { exportMarkdownToDocx, isValidDocxHyperlink } from '../src/lib/export/docxExporter';
import { buildPrintableHtml } from '../src/lib/export/pdfExporter';
import {
  buildStandaloneHtml,
  exportMarkdownToHtml,
  escapeHtml,
  getBaseUrlFromSourcePath,
} from '../src/lib/export/htmlExporter';
import { DocumentTab } from '../src/types';

describe('Export Filename Handling (documentUtils.ts)', () => {
  it('should format default names correctly for docx, pdf, and html', () => {
    expect(getExportFilename('My Document.md', 'docx')).toBe('My Document.docx');
    expect(getExportFilename('My Document.md', 'pdf')).toBe('My Document.pdf');
    expect(getExportFilename('My Document.md', 'html')).toBe('My Document.html');
    expect(getExportFilename('Notes.markdown', 'docx')).toBe('Notes.docx');
    expect(getExportFilename('Notes.mdown', 'docx')).toBe('Notes.docx');
    expect(getExportFilename('Notes.mkd', 'docx')).toBe('Notes.docx');
    expect(getExportFilename('Notes.mkd', 'pdf')).toBe('Notes.pdf');
    expect(getExportFilename('Notes.mkd', 'html')).toBe('Notes.html');
    expect(getExportFilename('Notes.MKD', 'html')).toBe('Notes.html');
    expect(getExportFilename('Notes.markdown', 'html')).toBe('Notes.html');
    expect(getExportFilename('Readme.txt', 'pdf')).toBe('Readme.pdf');
    expect(getExportFilename('Readme.txt', 'html')).toBe('Readme.html');
    expect(getExportFilename('archive.tar.gz', 'docx')).toBe('archive.tar.gz.docx');
    expect(getExportFilename('archive.tar.gz', 'html')).toBe('archive.tar.gz.html');
    expect(getExportFilename('AlreadyDocx.docx', 'docx')).toBe('AlreadyDocx.docx');
    expect(getExportFilename('AlreadyDocx.docx', 'html')).toBe('AlreadyDocx.html');
    expect(getExportFilename('AlreadyPdf.pdf', 'docx')).toBe('AlreadyPdf.docx');
    expect(getExportFilename('AlreadyPdf.pdf', 'pdf')).toBe('AlreadyPdf.pdf');
    expect(getExportFilename('AlreadyPdf.pdf', 'html')).toBe('AlreadyPdf.html');
    expect(getExportFilename('WebPage.html', 'html')).toBe('WebPage.html');
    expect(getExportFilename('WebPage.htm', 'html')).toBe('WebPage.html');
    expect(getExportFilename('WebPage.html', 'docx')).toBe('WebPage.docx');
    expect(getExportFilename('WebPage.html', 'pdf')).toBe('WebPage.pdf');
  });

  it('should fallback to 未命名 when title is missing or empty', () => {
    expect(getExportFilename('', 'docx')).toBe('未命名.docx');
    expect(getExportFilename('', 'html')).toBe('未命名.html');
    expect(getExportFilename(null, 'pdf')).toBe('未命名.pdf');
    expect(getExportFilename(null, 'html')).toBe('未命名.html');
    expect(getExportFilename('   ', 'docx')).toBe('未命名.docx');
    expect(getExportFilename('   ', 'html')).toBe('未命名.html');
    expect(getExportFilename('   .md  ', 'pdf')).toBe('未命名.pdf');
    expect(getExportFilename('   .html  ', 'html')).toBe('未命名.html');
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

describe('HTML Exporter / Standalone HTML Generator (htmlExporter.ts)', () => {
  const SAMPLE_MARKDOWN = `# 第一章 快速入门

这是一段包含 **加粗文本**、*斜体文本*、~~删除线~~ 和 \`console.log("hello")\` 的 Markdown 正文。

## 待办与任务

- [x] 完成架构重构
- [ ] 编写 HTML 导出功能
- 普通列表项
  - 二级嵌套项

## 数据汇总表格

| 功能项 | 格式 | 状态 | 优先级 |
| :--- | :---: | ---: | :--- |
| Word 导出 | .docx | 已支持 | High |
| PDF 导出 | .pdf | 已支持 | High |
| HTML 导出 | .html | 已支持 | Critical |

> 提示：导出的 HTML 文件可在任何现代浏览器中离线浏览，内嵌完整排版样式。

\`\`\`typescript
interface UserProfile {
  id: string;
  name: string;
  roles: string[];
}

function formatGreeting(user: UserProfile): string {
  return \`Welcome, \${user.name}!\`;
}
\`\`\`

![示例图片](./assets/preview.png)
`;

  it('should build complete standalone HTML document with embedded CSS, meta tags, and GFM elements', async () => {
    const html = await buildStandaloneHtml(SAMPLE_MARKDOWN, '快速入门指南.md', {
      sourceFilePath: 'C:\\Projects\\Docs\\intro.md',
      lang: 'zh-CN',
    });

    // Standalone HTML5 structure
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('<html lang="zh-CN">');
    expect(html).toContain('<meta charset="utf-8">');
    expect(html).toContain('<meta name="viewport" content="width=device-width, initial-scale=1.0">');
    expect(html).toContain('<title>快速入门指南.md</title>');
    expect(html).toContain('<base href="file:///C:/Projects/Docs/">');

    // Body container
    expect(html).toContain('<div class="markdown-body">');
    expect(html).toContain('第一章 快速入门');
    expect(html).toContain('<strong>加粗文本</strong>');
    expect(html).toContain('<em>斜体文本</em>');
    expect(html).toContain('<del>删除线</del>');

    // Task list and tables
    expect(html).toContain('<input type="checkbox"');
    expect(html).toContain('disabled');
    expect(html).toContain('checked');
    expect(html).toContain('<table>');
    expect(html).toContain('<th align="left">功能项</th>');
    expect(html).toContain('<td align="left">HTML 导出</td>');

    // Code highlighting
    expect(html).toContain('<pre><code');
    expect(html).toContain('class="hljs-keyword">interface</span>');
    expect(html).toContain('UserProfile');

    // Safe relative image reference surviving sanitization
    expect(html).toContain('<img src="./assets/preview.png" alt="示例图片">');

    // Embedded CSS rules
    expect(html).toContain('.markdown-body {');
    expect(html).toContain('max-width: 860px;');
    expect(html).toContain('@media print {');
    expect(html).toContain('size: A4 portrait;');
    expect(html).toContain('Microsoft YaHei');
  });

  it('should reflect UI language in the html lang attribute and safely validate custom lang values', async () => {
    const enHtml = await buildStandaloneHtml('# English Document', 'English Doc', {
      lang: 'en-US',
    });
    expect(enHtml).toContain('<html lang="en-US">');

    const zhHtml = await buildStandaloneHtml('# 中文文档', '中文文档', {
      lang: 'zh-CN',
    });
    expect(zhHtml).toContain('<html lang="zh-CN">');

    // Injection attempt in lang option should fallback to zh-CN safely
    const maliciousLangHtml = await buildStandaloneHtml('# Content', 'Title', {
      lang: 'en"><script>alert(1)</script>',
    });
    expect(maliciousLangHtml).toContain('<html lang="zh-CN">');
    expect(maliciousLangHtml).not.toContain('alert(1)');
  });

  it('should strictly escape document title preventing HTML / script breakout', async () => {
    const maliciousTitle = '"><script>alert("XSS in title")</script><title>test';
    const html = await buildStandaloneHtml('# Hello', maliciousTitle);

    expect(html).not.toContain('<script>alert("XSS in title")</script>');
    expect(html).toContain('<title>&quot;&gt;&lt;script&gt;alert(&quot;XSS in title&quot;)&lt;/script&gt;&lt;title&gt;test</title>');
  });

  it('should strictly sanitize malicious scripts, event handlers, and dangerous URL protocols', async () => {
    const maliciousMarkdown = `# 安全测试

<script>alert('body xss')</script>
<style>body { display: none; }</style>
<iframe src="https://attacker.com/steal"></iframe>
<form action="https://attacker.com/submit"><input type="text" name="secret"></form>
<object data="malicious.swf"></object>
<embed src="malicious.swf">

![safe image](https://safe-cdn.com/image.png)
![safe relative image](./assets/preview.png)

[合法 HTTPS 链接](https://safe-domain.com/docs)
[合法邮件链接](mailto:security@example.com)
[相对锚点链接](#section-1)
[恶意 JavaScript 协议](javascript:alert("XSS via Link"))
[恶意 Data 协议](data:text/html,<script>alert(1)</script>)
[本地敏感文件协议](file:///C:/Windows/System32/drivers/etc/hosts)
[VBScript 协议](vbscript:msgbox(1))
[PowerShell 协议](powershell:calc.exe)
`;

    const html = await buildStandaloneHtml(maliciousMarkdown, 'Security Test Document');

    // Dangerous tags must be completely removed
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<style>body { display: none; }</style>');
    expect(html).not.toContain('<iframe');
    expect(html).not.toContain('<form');
    expect(html).not.toContain('<object');
    expect(html).not.toContain('<embed');
    expect(html).not.toContain('onerror=');

    // Safe links and relative/absolute images must be preserved
    expect(html).toContain('href="https://safe-domain.com/docs"');
    expect(html).toContain('href="mailto:security@example.com"');
    expect(html).toContain('href="#section-1"');
    expect(html).toContain('src="https://safe-cdn.com/image.png"');
    expect(html).toContain('src="./assets/preview.png"');
    expect(html).toContain('alt="safe relative image"');

    // Unsafe href protocols must be stripped
    expect(html).not.toContain('href="javascript:');
    expect(html).not.toContain('href="data:');
    expect(html).not.toContain('href="file:');
    expect(html).not.toContain('href="vbscript:');
    expect(html).not.toContain('href="powershell:');

    // Link text should remain visible and safe
    expect(html).toContain('合法 HTTPS 链接');
    expect(html).toContain('恶意 JavaScript 协议');
    expect(html).toContain('本地敏感文件协议');
  });

  it('should escape HTML special characters properly via escapeHtml utility', () => {
    expect(escapeHtml('<script>alert("hello & goodbye")</script>')).toBe(
      '&lt;script&gt;alert(&quot;hello &amp; goodbye&quot;)&lt;/script&gt;'
    );
    expect(escapeHtml("it's cool")).toBe('it&#39;s cool');
  });

  it('should export HTML via exportMarkdownToHtml in browser fallback without errors', async () => {
    // Should resolve cleanly without error in test environment
    await expect(
      exportMarkdownToHtml('# Title', 'Doc', 'browser://Doc.html')
    ).resolves.toBeUndefined();
  });

  describe('Local Base URL Hardening (getBaseUrlFromSourcePath)', () => {
    it('should generate file:/// base URL for standard Windows drive paths', () => {
      expect(getBaseUrlFromSourcePath('C:\\Users\\Alice\\Documents\\guide.md')).toBe(
        'file:///C:/Users/Alice/Documents/'
      );
      expect(getBaseUrlFromSourcePath('d:/projects/app/README.md')).toBe(
        'file:///D:/projects/app/'
      );
      expect(getBaseUrlFromSourcePath('C:\\file.md')).toBe('file:///C:/');
      expect(getBaseUrlFromSourcePath('C:\\')).toBe('file:///C:/');
    });

    it('should properly encode Unicode characters and spaces in Windows paths', () => {
      expect(getBaseUrlFromSourcePath('C:\\我的文档\\工作 目录\\spec.md')).toBe(
        'file:///C:/%E6%88%91%E7%9A%84%E6%96%87%E6%A1%A3/%E5%B7%A5%E4%BD%9C%20%E7%9B%AE%E5%BD%95/'
      );
      expect(getBaseUrlFromSourcePath('D:\\Café & Restaurant\\menu.md')).toBe(
        'file:///D:/Caf%C3%A9%20%26%20Restaurant/'
      );
    });

    it('should percent-encode # and ? characters so they are not treated as fragment/query delimiters', () => {
      expect(getBaseUrlFromSourcePath('C:\\projects\\c#\\notes.md')).toBe(
        'file:///C:/projects/c%23/'
      );
      expect(getBaseUrlFromSourcePath('C:\\docs\\faq?data\\readme.md')).toBe(
        'file:///C:/docs/faq%3Fdata/'
      );
      expect(getBaseUrlFromSourcePath('C:\\docs\\c#\\test?folder\\file.md')).toBe(
        'file:///C:/docs/c%23/test%3Ffolder/'
      );
    });

    it('should format POSIX absolute paths with three slashes and properly encoded segments', () => {
      expect(getBaseUrlFromSourcePath('/home/user/docs/notes.md')).toBe(
        'file:///home/user/docs/'
      );
      expect(getBaseUrlFromSourcePath('/var/data/项目 说明/c#/report.md')).toBe(
        'file:///var/data/%E9%A1%B9%E7%9B%AE%20%E8%AF%B4%E6%98%8E/c%23/'
      );
      expect(getBaseUrlFromSourcePath('/root.md')).toBe('file:///');
      expect(getBaseUrlFromSourcePath('/')).toBe('file:///');
    });

    it('should format UNC server/share paths correctly with file://server/share/', () => {
      expect(getBaseUrlFromSourcePath('\\\\server\\share\\folder\\file.md')).toBe(
        'file://server/share/folder/'
      );
      expect(getBaseUrlFromSourcePath('//server/share/folder/file.md')).toBe(
        'file://server/share/folder/'
      );
      expect(getBaseUrlFromSourcePath('\\\\server\\share\\file.md')).toBe(
        'file://server/share/'
      );
      expect(getBaseUrlFromSourcePath('\\\\192.168.1.1\\public\\c# docs\\report.md')).toBe(
        'file://192.168.1.1/public/c%23%20docs/'
      );
    });

    it('should reject malformed UNC paths without share', () => {
      expect(getBaseUrlFromSourcePath('\\\\server')).toBeUndefined();
      expect(getBaseUrlFromSourcePath('\\\\')).toBeUndefined();
      expect(getBaseUrlFromSourcePath('//')).toBeUndefined();
    });

    it('should return undefined and emit no base tag for browser://, relative, or malformed paths', () => {
      expect(getBaseUrlFromSourcePath('browser://MyDoc.md')).toBeUndefined();
      expect(getBaseUrlFromSourcePath('http://example.com/doc.md')).toBeUndefined();
      expect(getBaseUrlFromSourcePath('https://example.com/doc.md')).toBeUndefined();
      expect(getBaseUrlFromSourcePath('relative/path.md')).toBeUndefined();
      expect(getBaseUrlFromSourcePath('./relative.md')).toBeUndefined();
      expect(getBaseUrlFromSourcePath('../relative.md')).toBeUndefined();
      expect(getBaseUrlFromSourcePath('notes.md')).toBeUndefined();
      expect(getBaseUrlFromSourcePath('C:relative.md')).toBeUndefined();
      expect(getBaseUrlFromSourcePath('')).toBeUndefined();
      expect(getBaseUrlFromSourcePath('   ')).toBeUndefined();
      expect(getBaseUrlFromSourcePath(null)).toBeUndefined();
      expect(getBaseUrlFromSourcePath(undefined)).toBeUndefined();
    });

    it('should properly integrate base tag in buildStandaloneHtml without emitting unsafe tags for browser/relative paths', async () => {
      const htmlWin = await buildStandaloneHtml('# Windows', 'Doc', {
        sourceFilePath: 'C:\\docs\\c#\\test.md',
      });
      expect(htmlWin).toContain('<base href="file:///C:/docs/c%23/">');

      const htmlPosix = await buildStandaloneHtml('# Posix', 'Doc', {
        sourceFilePath: '/home/user/my docs/notes.md',
      });
      expect(htmlPosix).toContain('<base href="file:///home/user/my%20docs/">');

      const htmlUnc = await buildStandaloneHtml('# UNC', 'Doc', {
        sourceFilePath: '\\\\nas\\share\\docs\\intro.md',
      });
      expect(htmlUnc).toContain('<base href="file://nas/share/docs/">');

      const htmlBrowser = await buildStandaloneHtml('# Browser', 'Doc', {
        sourceFilePath: 'browser://doc.md',
      });
      expect(htmlBrowser).not.toContain('<base');

      const htmlRelative = await buildStandaloneHtml('# Relative', 'Doc', {
        sourceFilePath: 'relative/path.md',
      });
      expect(htmlRelative).not.toContain('<base');
    });
  });

  it('should ignore browser:// paths when generating base tag', async () => {
    const html = await buildStandaloneHtml('# Browser Document', 'Doc', {
      sourceFilePath: 'browser://MyDocument.md',
    });

    expect(html).not.toContain('<base href="file:///browser:');
    expect(html).not.toContain('<base href="browser:');
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
    const pdfHtml = await buildPrintableHtml(originalTab.content, originalTab.title, originalTab.filePath || undefined);
    expect(pdfHtml.length).toBeGreaterThan(0);

    // Export to Standalone HTML
    const standaloneHtml = await buildStandaloneHtml(originalTab.content, originalTab.title, {
      sourceFilePath: originalTab.filePath || undefined,
      lang: 'zh-CN',
    });
    expect(standaloneHtml.length).toBeGreaterThan(0);

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
