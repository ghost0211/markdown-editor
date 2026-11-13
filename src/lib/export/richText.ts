import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkFrontmatter from 'remark-frontmatter';
import remarkRehype from 'remark-rehype';
import rehypeSanitize from 'rehype-sanitize';
import rehypeStringify from 'rehype-stringify';
import type { Element, Root } from 'hast';
import { SANITIZE_SCHEMA } from '@/lib/export/htmlExporter';
import { remarkCallouts, type CalloutType } from '@/lib/remarkCallouts';
import { remarkDropFrontMatter } from '@/lib/frontMatter';

const FONT = '-apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", Arial, sans-serif';
const MONO = 'Consolas, "Courier New", monospace';

/**
 * Inline styles per tag. Rich-text targets (mail clients, Word, WeChat editors)
 * drop `<style>` blocks and class names, so the look has to travel inline.
 */
export const INLINE_STYLES: Record<string, string> = {
  h1: 'font-size:1.8em;font-weight:700;margin:1.2em 0 0.6em;border-bottom:1px solid #e2e8f0;padding-bottom:0.3em;',
  h2: 'font-size:1.45em;font-weight:700;margin:1.1em 0 0.5em;border-bottom:1px solid #e2e8f0;padding-bottom:0.25em;',
  h3: 'font-size:1.2em;font-weight:700;margin:1em 0 0.4em;',
  h4: 'font-size:1.05em;font-weight:700;margin:1em 0 0.4em;',
  h5: 'font-size:1em;font-weight:700;margin:1em 0 0.4em;',
  h6: 'font-size:0.95em;font-weight:700;margin:1em 0 0.4em;color:#64748b;',
  p: 'margin:0.8em 0;line-height:1.7;',
  blockquote: 'margin:1em 0;padding:0.6em 1em;border-left:4px solid #3b82f6;background:#f8fafc;color:#475569;',
  pre: `margin:1em 0;padding:12px 14px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;font-family:${MONO};font-size:13px;line-height:1.55;white-space:pre-wrap;word-break:break-all;`,
  code: `font-family:${MONO};font-size:0.9em;background:#f1f5f9;padding:2px 5px;border-radius:4px;`,
  table: 'border-collapse:collapse;margin:1em 0;width:100%;',
  th: 'border:1px solid #cbd5e1;padding:6px 10px;background:#f1f5f9;font-weight:600;text-align:left;',
  td: 'border:1px solid #cbd5e1;padding:6px 10px;',
  ul: 'margin:0.8em 0;padding-left:1.6em;',
  ol: 'margin:0.8em 0;padding-left:1.6em;',
  li: 'margin:0.25em 0;',
  a: 'color:#2563eb;text-decoration:underline;',
  img: 'max-width:100%;',
  hr: 'border:none;border-top:1px solid #cbd5e1;margin:1.5em 0;',
};

const CALLOUT_PALETTE: Record<CalloutType, { border: string; bg: string; title: string }> = {
  note: { border: '#0969da', bg: '#eff6ff', title: '#0969da' },
  tip: { border: '#1a7f37', bg: '#f0fdf4', title: '#1a7f37' },
  important: { border: '#8250df', bg: '#faf5ff', title: '#8250df' },
  warning: { border: '#9a6700', bg: '#fffbeb', title: '#9a6700' },
  caution: { border: '#cf222e', bg: '#fef2f2', title: '#cf222e' },
};

function getClassList(el: Element): string[] {
  const raw: unknown = el.properties?.className;
  if (Array.isArray(raw)) return raw.map(String);
  if (typeof raw === 'string') return raw.split(/\s+/).filter(Boolean);
  return [];
}

function getCalloutType(el: Element): CalloutType | null {
  const data = el.properties?.dataCallout;
  if (typeof data === 'string' && data in CALLOUT_PALETTE) {
    return data as CalloutType;
  }
  for (const cls of getClassList(el)) {
    const m = /^md-callout-(note|tip|important|warning|caution)$/.exec(cls);
    if (m) return m[1] as CalloutType;
  }
  return null;
}

function styleTree(node: Root | Element, parentCallout: CalloutType | null = null): void {
  for (const child of node.children) {
    if (child.type !== 'element') continue;
    let style = INLINE_STYLES[child.tagName];
    const currentCallout = child.tagName === 'blockquote' ? getCalloutType(child) : null;

    if (currentCallout) {
      const palette = CALLOUT_PALETTE[currentCallout];
      style = `margin:1em 0;padding:0.6em 1em;border-left:4px solid ${palette.border};background:${palette.bg};color:#1e293b;`;
    }

    // A code span inside <pre> must not get the inline-code chip look.
    if (child.tagName === 'code' && node.type === 'element' && node.tagName === 'pre') {
      style = 'font-family:inherit;background:transparent;padding:0;';
    }
    if (child.tagName === 'p' && getClassList(child).includes('md-callout-title')) {
      const titleColor = parentCallout ? CALLOUT_PALETTE[parentCallout].title : '#0969da';
      style = `margin:0 0 0.4em;line-height:1.5;font-weight:600;color:${titleColor};`;
    }
    if (style) {
      const existing = typeof child.properties?.style === 'string' ? child.properties.style : '';
      child.properties = { ...child.properties, style: `${style}${existing}` };
    }
    styleTree(child, currentCallout ?? parentCallout);
  }
}

function rehypeInlineStyles() {
  return (tree: Root) => styleTree(tree);
}

/** Sanitized HTML fragment of the document with every style inlined. */
export async function buildRichTextHtml(markdown: string, lang?: string): Promise<string> {
  const processed = await unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkFrontmatter, ['yaml', 'toml'])
    .use(remarkDropFrontMatter)
    .use(remarkCallouts, { lang })
    .use(remarkRehype)
    .use(rehypeSanitize, SANITIZE_SCHEMA)
    .use(rehypeInlineStyles)
    .use(rehypeStringify)
    .process(markdown);

  return `<div style="font-family:${FONT};font-size:15px;color:#1e293b;">${String(processed)}</div>`;
}

/** Writes HTML (plus a plain-text fallback) to the system clipboard. */
export async function copyHtmlToClipboard(html: string, plainText: string): Promise<void> {
  if (
    typeof navigator !== 'undefined' &&
    navigator.clipboard &&
    typeof ClipboardItem !== 'undefined' &&
    typeof navigator.clipboard.write === 'function'
  ) {
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/html': new Blob([html], { type: 'text/html' }),
          'text/plain': new Blob([plainText], { type: 'text/plain' }),
        }),
      ]);
      return;
    } catch {
      // fall through to the legacy path
    }
  }

  // Legacy path: select a hidden rendered copy and let the browser copy it.
  const holder = document.createElement('div');
  holder.contentEditable = 'true';
  holder.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0;';
  holder.innerHTML = html;
  document.body.appendChild(holder);
  const selection = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(holder);
  selection?.removeAllRanges();
  selection?.addRange(range);
  const ok = document.execCommand('copy');
  selection?.removeAllRanges();
  document.body.removeChild(holder);
  if (!ok) throw new Error('Clipboard is not available');
}
