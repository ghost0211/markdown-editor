import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkFrontmatter from 'remark-frontmatter';
import { remarkCallouts } from '@/lib/remarkCallouts';
import { remarkDropFrontMatter } from '@/lib/frontMatter';
import { rehypeEmbedImages, type ImageResolver } from '@/lib/export/embedImages';
import remarkRehype from 'remark-rehype';
import rehypeHighlight from 'rehype-highlight';
import rehypeSanitize, { defaultSchema, Options as SanitizeSchema } from 'rehype-sanitize';
import rehypeStringify from 'rehype-stringify';
import { writeHtmlFile } from '../native';

export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Custom sanitize schema extending GitHub default schema:
 * - Allows syntax highlighting spans and language code classes
 * - Allows task list checkbox inputs (disabled)
 * - Restricts link protocols strictly to http, https, mailto (blocking javascript, file, data, vbscript)
 * - Restricts image source protocols strictly to http, https
 * - Strips dangerous tags: script, style, iframe, object, embed, form
 */
export const SANITIZE_SCHEMA: SanitizeSchema = {
  ...defaultSchema,
  protocols: {
    ...defaultSchema.protocols,
    href: ['http', 'https', 'mailto'],
    src: ['http', 'https'],
  },
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
    blockquote: [
      ...(defaultSchema.attributes?.blockquote || []),
      ['className', /^md-callout(-(note|tip|important|warning|caution))?$/],
      ['dataCallout', /^(note|tip|important|warning|caution)$/],
    ],
    p: [...(defaultSchema.attributes?.p || []), ['className', 'md-callout-title']],
    th: [...(defaultSchema.attributes?.th || []), ['align', /^(left|center|right)$/i]],
    td: [...(defaultSchema.attributes?.td || []), ['align', /^(left|center|right)$/i]],
    a: [
      ...(defaultSchema.attributes?.a || []),
      'target',
      'rel',
    ],
  },
  // remark-rehype already prefixes footnote ids with "user-content-"; letting
  // the sanitizer add a second prefix broke every footnote link in the export.
  clobberPrefix: '',
  strip: ['script', 'style', 'iframe', 'object', 'embed', 'form'],
};

export interface HtmlRenderOptions {
  sourceFilePath?: string;
  lang?: string;
  /**
   * When set, relative images are resolved through it and inlined as data URLs
   * so the exported file is fully self-contained. Without it images stay
   * references (relative / absolute paths or network links).
   */
  resolveImage?: ImageResolver;
}

/**
 * Generates a hardened, RFC-compliant file:// base URL string from a local source file path.
 * Properly encodes Unicode, spaces, '#' and '?' characters, while rejecting relative,
 * malformed, or browser-scheme paths.
 *
 * Supported formats:
 * - Windows Drive Absolute: C:\Users\name\doc.md -> file:///C:/Users/name/
 * - UNC Share: \\server\share\folder\doc.md -> file://server/share/folder/
 * - POSIX Absolute: /home/user/doc.md -> file:///home/user/
 *
 * Pure JavaScript implementation with zero Node-only path dependencies.
 */
export function getBaseUrlFromSourcePath(sourceFilePath?: string | null): string | undefined {
  if (!sourceFilePath || typeof sourceFilePath !== 'string') {
    return undefined;
  }
  const trimmed = sourceFilePath.trim();
  if (!trimmed) {
    return undefined;
  }

  // Reject non-file custom URI schemes (e.g. browser://, http://, https://, data:, blob:)
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed)) {
    return undefined;
  }

  // UNC paths: starts with \\ or //
  if (trimmed.startsWith('\\\\') || trimmed.startsWith('//')) {
    const withoutPrefix = trimmed.replace(/^[/\\]{2}/, '');
    const normalized = withoutPrefix.replace(/\\/g, '/');
    const lastSlash = normalized.lastIndexOf('/');
    if (lastSlash === -1) {
      return undefined;
    }
    const dirPart = normalized.slice(0, lastSlash);
    const segments = dirPart.split('/').filter(Boolean);
    if (segments.length < 2) {
      // Must contain at least server and share name
      return undefined;
    }
    const server = encodeURIComponent(segments[0]);
    const share = encodeURIComponent(segments[1]);
    const rest = segments.slice(2).map(encodeURIComponent);
    const restPath = rest.length > 0 ? rest.join('/') + '/' : '';
    return `file://${server}/${share}/${restPath}`;
  }

  // Windows drive absolute path: e.g. C:\path\to\file.md or c:/path/to/file.md
  const winMatch = trimmed.match(/^([a-zA-Z]):[/\\](.*)$/);
  if (winMatch) {
    const driveLetter = winMatch[1].toUpperCase();
    const rest = winMatch[2].replace(/\\/g, '/');
    const lastSlash = rest.lastIndexOf('/');
    if (lastSlash === -1) {
      return `file:///${driveLetter}:/`;
    }
    const dirPart = rest.slice(0, lastSlash);
    const segments = dirPart.split('/').filter(Boolean);
    const encodedSegments = segments.map(encodeURIComponent);
    const encodedPath = encodedSegments.length > 0 ? encodedSegments.join('/') + '/' : '';
    return `file:///${driveLetter}:/${encodedPath}`;
  }

  // POSIX absolute path: starts with /
  if (trimmed.startsWith('/')) {
    const normalized = trimmed.replace(/\\/g, '/');
    const lastSlash = normalized.lastIndexOf('/');
    if (lastSlash <= 0) {
      return 'file:///';
    }
    const dirPart = normalized.slice(1, lastSlash);
    const segments = dirPart.split('/').filter(Boolean);
    const encodedSegments = segments.map(encodeURIComponent);
    const encodedPath = encodedSegments.length > 0 ? encodedSegments.join('/') + '/' : '';
    return `file:///${encodedPath}`;
  }

  // Relative or unparseable paths: return undefined (no base tag emitted)
  return undefined;
}

/**
 * Generates full standalone HTML document with embedded CSS, responsive screen styling,
 * print pagination, GFM, syntax highlighting, and strict sanitization.
 */
export async function buildStandaloneHtml(
  markdown: string,
  title?: string,
  options?: HtmlRenderOptions | string
): Promise<string> {
  const opts: HtmlRenderOptions =
    typeof options === 'string' ? { sourceFilePath: options } : options || {};

  const processed = await unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkFrontmatter, ['yaml', 'toml'])
    .use(remarkDropFrontMatter)
    .use(remarkCallouts, { lang: opts.lang })
    .use(remarkRehype)
    .use(rehypeHighlight)
    .use(rehypeSanitize, SANITIZE_SCHEMA)
    .use(rehypeEmbedImages, { resolve: opts.resolveImage })
    .use(rehypeStringify)
    .process(markdown);

  const htmlBody = String(processed);
  const safeTitle = escapeHtml(title || 'Markdown Document');

  const rawLang = opts.lang?.trim();
  const safeLang = rawLang && /^[a-zA-Z0-9_-]+$/.test(rawLang) ? rawLang : 'zh-CN';

  const baseUrl = getBaseUrlFromSourcePath(opts.sourceFilePath);
  const baseTag = baseUrl ? `<base href="${escapeHtml(baseUrl)}">\n` : '';

  return `<!DOCTYPE html>
<html lang="${safeLang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${safeTitle}</title>
${baseTag}<style>
*, *::before, *::after {
  box-sizing: border-box;
}

body {
  margin: 0;
  padding: 32px 24px;
  background-color: #ffffff;
  color: #1e293b;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "WenQuanYi Micro Hei", "Helvetica Neue", Arial, sans-serif;
  font-size: 15px;
  line-height: 1.68;
  text-rendering: optimizeLegibility;
  -webkit-font-smoothing: antialiased;
}

.markdown-body {
  max-width: 860px;
  margin: 0 auto;
}

h1, h2, h3, h4, h5, h6 {
  color: #0f172a;
  font-weight: 600;
  line-height: 1.35;
  margin-top: 28px;
  margin-bottom: 14px;
  break-after: avoid;
  page-break-after: avoid;
}

h1 {
  font-size: 24pt;
  border-bottom: 2px solid #e2e8f0;
  padding-bottom: 0.3em;
  margin-top: 0;
  margin-bottom: 20px;
}

h2 {
  font-size: 17pt;
  border-bottom: 1px solid #e2e8f0;
  padding-bottom: 0.25em;
  margin-top: 30px;
  margin-bottom: 14px;
}

h3 {
  font-size: 14pt;
  margin-top: 22px;
  margin-bottom: 10px;
}

h4 {
  font-size: 12.5pt;
  margin-top: 18px;
  margin-bottom: 8px;
}

h5 {
  font-size: 11.5pt;
  margin-top: 14px;
  margin-bottom: 6px;
}

h6 {
  font-size: 10.5pt;
  color: #64748b;
  margin-top: 12px;
  margin-bottom: 4px;
}

p {
  margin-top: 0;
  margin-bottom: 14px;
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
  transition: color 0.15s ease;
}

a:hover {
  color: #1d4ed8;
}

ul, ol {
  padding-left: 26px;
  margin-top: 0;
  margin-bottom: 14px;
}

li {
  margin-bottom: 5px;
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
  margin-bottom: 5px;
}

li.task-list-item input[type="checkbox"] {
  margin-right: 8px;
  position: relative;
  top: 1px;
}

blockquote {
  margin: 16px 0;
  padding: 10px 18px;
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

/* GitHub-style alerts: > [!NOTE] */
blockquote.md-callout { color: #1e293b; }
blockquote.md-callout .md-callout-title { margin: 0 0 6px; font-weight: 600; }
blockquote.md-callout-note { border-left-color: #0969da; background-color: #eff6ff; }
blockquote.md-callout-note .md-callout-title { color: #0969da; }
blockquote.md-callout-tip { border-left-color: #1a7f37; background-color: #f0fdf4; }
blockquote.md-callout-tip .md-callout-title { color: #1a7f37; }
blockquote.md-callout-important { border-left-color: #8250df; background-color: #faf5ff; }
blockquote.md-callout-important .md-callout-title { color: #8250df; }
blockquote.md-callout-warning { border-left-color: #9a6700; background-color: #fffbeb; }
blockquote.md-callout-warning .md-callout-title { color: #9a6700; }
blockquote.md-callout-caution { border-left-color: #cf222e; background-color: #fef2f2; }
blockquote.md-callout-caution .md-callout-title { color: #cf222e; }

/* Footnotes */
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

section.footnotes {
  margin-top: 32px;
  padding-top: 12px;
  border-top: 1px solid #cbd5e1;
  font-size: 13px;
  color: #475569;
}

section.footnotes ol { padding-left: 1.4em; }
section.footnotes p { margin: 0.3em 0; }
sup a[data-footnote-ref] { text-decoration: none; padding: 0 1px; }
a[data-footnote-backref] { text-decoration: none; margin-left: 4px; }

code {
  font-family: Consolas, "Fira Code", Monaco, "Cascadia Code", "Courier New", monospace;
  font-size: 0.9em;
  background-color: #f1f5f9;
  color: #0f172a;
  padding: 2px 6px;
  border-radius: 4px;
}

pre {
  font-family: Consolas, "Fira Code", Monaco, "Cascadia Code", "Courier New", monospace;
  background-color: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  padding: 14px 16px;
  font-size: 12.5px;
  line-height: 1.55;
  overflow-x: auto;
  white-space: pre-wrap;
  word-break: break-all;
  break-inside: avoid;
  page-break-inside: avoid;
  margin: 16px 0;
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
  margin: 18px 0;
  break-inside: avoid;
  page-break-inside: avoid;
  font-size: 13.5px;
}

th, td {
  border: 1px solid #cbd5e1;
  padding: 8px 12px;
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
  margin: 24px 0;
}

img {
  max-width: 100%;
  height: auto;
  display: block;
  margin: 16px auto;
  border-radius: 4px;
  break-inside: avoid;
  page-break-inside: avoid;
}

@media (max-width: 768px) {
  body {
    padding: 16px 12px;
    font-size: 14px;
  }
}

@page {
  size: A4 portrait;
  margin: 20mm 15mm 20mm 15mm;
}

@media print {
  body {
    padding: 0;
    background-color: #ffffff;
    -webkit-print-color-adjust: exact !important;
    print-color-adjust: exact !important;
  }

  .markdown-body {
    max-width: 100%;
  }
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
 * Converts Markdown content to a standalone HTML file and saves to targetPath.
 * Note: Relative images in the document are referenced via base URL or relative paths,
 * not embedded as bundled files.
 */
export async function exportMarkdownToHtml(
  markdown: string,
  title: string,
  targetPath: string,
  options?: HtmlRenderOptions
): Promise<void> {
  const html = await buildStandaloneHtml(markdown, title, options);
  await writeHtmlFile(targetPath, html);
}
