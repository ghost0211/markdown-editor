import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkRehype from 'remark-rehype';
import rehypeHighlight from 'rehype-highlight';
import rehypeSanitize, { defaultSchema, Options as SanitizeSchema } from 'rehype-sanitize';
import rehypeStringify from 'rehype-stringify';
import { exportPdfFromHtml } from '../native';

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Custom sanitize schema extending github default schema to support syntax highlighting and checkboxes safely.
 */
export const SANITIZE_SCHEMA: SanitizeSchema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    span: [
      ...(defaultSchema.attributes?.span || []),
      ['className', /^hljs(-[a-z0-9_-]+)?$/i],
    ],
    code: [
      ...(defaultSchema.attributes?.code || []),
      ['className', /^(hljs|language-[a-z0-9_#-]+)$/i],
    ],
    input: [
      ...(defaultSchema.attributes?.input || []),
      ['type', 'checkbox'],
      'disabled',
      'checked',
    ],
    th: [...(defaultSchema.attributes?.th || []), ['align', /^(left|center|right)$/i]],
    td: [...(defaultSchema.attributes?.td || []), ['align', /^(left|center|right)$/i]],
  },
  clobberPrefix: 'user-content-',
  strip: ['script'],
};

/**
 * Builds standalone printable HTML with Chinese font support, A4 pagination, and security sanitization.
 */
export async function buildPrintableHtml(
  markdown: string,
  title: string,
  sourceFilePath?: string
): Promise<string> {
  const processed = await unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkRehype)
    .use(rehypeHighlight)
    .use(rehypeSanitize, SANITIZE_SCHEMA)
    .use(rehypeStringify)
    .process(markdown);

  const htmlBody = String(processed);
  const safeTitle = escapeHtml(title || 'Markdown Document');

  let baseTag = '';
  if (sourceFilePath) {
    const normalized = sourceFilePath.replace(/\\/g, '/');
    const lastSlash = normalized.lastIndexOf('/');
    if (lastSlash !== -1) {
      const dir = normalized.slice(0, lastSlash + 1);
      const encodedDir = encodeURI(dir);
      baseTag = `<base href="file:///${escapeHtml(encodedDir)}">\n`;
    }
  }

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${safeTitle}</title>
${baseTag}<style>
@page {
  size: A4 portrait;
  margin: 20mm 15mm 20mm 15mm;
}

@media print {
  body {
    -webkit-print-color-adjust: exact !important;
    print-color-adjust: exact !important;
  }
}

*, *::before, *::after {
  box-sizing: border-box;
}

body {
  margin: 0;
  padding: 0;
  background-color: #ffffff;
  color: #1e293b;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "WenQuanYi Micro Hei", "Helvetica Neue", Arial, sans-serif;
  font-size: 14px;
  line-height: 1.65;
  text-rendering: optimizeLegibility;
  -webkit-font-smoothing: antialiased;
}

.markdown-body {
  max-width: 100%;
  margin: 0 auto;
}

h1, h2, h3, h4, h5, h6 {
  color: #0f172a;
  font-weight: 600;
  line-height: 1.35;
  margin-top: 24px;
  margin-bottom: 12px;
  break-after: avoid;
  page-break-after: avoid;
}

h1 {
  font-size: 22pt;
  border-bottom: 2px solid #e2e8f0;
  padding-bottom: 0.3em;
  margin-top: 0;
  margin-bottom: 18px;
}

h2 {
  font-size: 16pt;
  border-bottom: 1px solid #e2e8f0;
  padding-bottom: 0.25em;
  margin-top: 28px;
  margin-bottom: 14px;
}

h3 {
  font-size: 13.5pt;
  margin-top: 20px;
  margin-bottom: 10px;
}

h4 {
  font-size: 12pt;
  margin-top: 16px;
  margin-bottom: 8px;
}

h5 {
  font-size: 11pt;
  margin-top: 14px;
  margin-bottom: 6px;
}

h6 {
  font-size: 10pt;
  color: #64748B;
  margin-top: 12px;
  margin-bottom: 4px;
}

p {
  margin-top: 0;
  margin-bottom: 12px;
  word-break: break-word;
}

strong, b {
  font-weight: 600;
  color: #0f172a;
}

em, i {
  font-style: italic;
}

del, s {
  text-decoration: line-through;
  color: #64748b;
}

a {
  color: #2563eb;
  text-decoration: underline;
  text-underline-offset: 2px;
}

ul, ol {
  padding-left: 24px;
  margin-top: 0;
  margin-bottom: 12px;
}

li {
  margin-bottom: 4px;
}

li > ul, li > ol {
  margin-top: 4px;
  margin-bottom: 4px;
}

ul.contains-task-list {
  list-style-type: none;
  padding-left: 4px;
}

li.task-list-item {
  list-style-type: none;
  display: flex;
  align-items: baseline;
  margin-bottom: 4px;
}

li.task-list-item input[type="checkbox"] {
  margin-right: 8px;
  position: relative;
  top: 1px;
}

blockquote {
  margin: 14px 0;
  padding: 8px 16px;
  border-left: 4px solid #3b82f6;
  background-color: #f8fafc;
  color: #475569;
  border-radius: 0 4px 4px 0;
  break-inside: avoid;
  page-break-inside: avoid;
}

blockquote p:last-child {
  margin-bottom: 0;
}

code {
  font-family: Consolas, "Fira Code", Monaco, "Cascadia Code", "Courier New", monospace;
  font-size: 0.9em;
  background-color: #f1f5f9;
  color: #0f172a;
  padding: 2px 5px;
  border-radius: 4px;
}

pre {
  font-family: Consolas, "Fira Code", Monaco, "Cascadia Code", "Courier New", monospace;
  background-color: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  padding: 12px 14px;
  font-size: 11.5px;
  line-height: 1.5;
  overflow-x: auto;
  white-space: pre-wrap;
  word-break: break-all;
  break-inside: avoid;
  page-break-inside: avoid;
  margin: 14px 0;
}

pre code {
  background-color: transparent;
  padding: 0;
  border: none;
  font-size: inherit;
  color: inherit;
}

/* Syntax Highlighting */
.hljs-keyword, .hljs-selector-tag, .hljs-subst { color: #d73a49; font-weight: 600; }
.hljs-string, .hljs-title, .hljs-section, .hljs-attribute, .hljs-literal, .hljs-template-tag, .hljs-template-variable, .hljs-type, .hljs-addition { color: #032f62; }
.hljs-comment, .hljs-quote, .hljs-deletion, .hljs-meta { color: #6a737d; font-style: italic; }
.hljs-number { color: #005cc5; }
.hljs-variable { color: #e36209; }
.hljs-params { color: #24292e; }

table {
  width: 100%;
  border-collapse: collapse;
  margin: 16px 0;
  break-inside: avoid;
  page-break-inside: avoid;
  font-size: 12.5px;
}

th, td {
  border: 1px solid #cbd5e1;
  padding: 7px 10px;
  text-align: left;
}

th {
  background-color: #f1f5f9;
  font-weight: 600;
  color: #0f172a;
}

tr:nth-child(even) td {
  background-color: #f8fafc;
}

hr {
  border: none;
  border-top: 1px solid #cbd5e1;
  margin: 20px 0;
}

img {
  max-width: 100%;
  height: auto;
  display: block;
  margin: 12px auto;
  border-radius: 4px;
  break-inside: avoid;
  page-break-inside: avoid;
}
</style>
</head>
<body>
<div class="markdown-body">
${htmlBody}
</div>
</body>
</html>`;
}

/**
 * Converts markdown directly to PDF file via printable HTML and headless browser backend
 */
export async function exportMarkdownToPdf(
  markdown: string,
  title: string,
  targetPath: string,
  sourceFilePath?: string
): Promise<void> {
  const html = await buildPrintableHtml(markdown, title, sourceFilePath);
  await exportPdfFromHtml(targetPath, html);
}
