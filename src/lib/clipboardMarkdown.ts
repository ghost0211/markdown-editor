import { parseFragment, type DefaultTreeAdapterMap } from 'parse5';
import { rowsToMarkdownTable } from '@/lib/markdownTable';

type HtmlNode = DefaultTreeAdapterMap['childNode'];
type HtmlElement = DefaultTreeAdapterMap['element'];
const IGNORED = new Set(['script', 'style', 'template', 'iframe', 'object', 'embed', 'head', 'title', 'xml', 'svg', 'canvas']);
const MAX_CLIPBOARD_HTML = 8 * 1024 * 1024;
const MARKDOWN_BREAK = '\\\n';

const attribute = (node: HtmlElement, name: string): string =>
  node.attrs.find((item) => item.name === name)?.value ?? '';

export function escapeMarkdownLabel(value: string): string {
  return value.replace(/[\\[\]<>*_~`&]/g, '\\$&');
}

function escapeText(text: string): string {
  // Keep body text such as "1. results" from becoming an unintended list.
  return escapeMarkdownLabel(text.replace(/[\s\u00a0]+/g, ' '))
    .replace(/^([ ]*)([#>+-]|\d+[.)])(?= )/, (_match, space: string, marker: string) =>
      space + marker.replace(/[.)#>+-]$/, '\\$&')
    );
}

function plain(node: HtmlNode): string {
  if (node.nodeName === '#text' && 'value' in node) return node.value;
  if (!('tagName' in node) || IGNORED.has(node.tagName)) return '';
  if (node.tagName === 'br') return '\n';
  return node.childNodes.map(plain).join('');
}

function destination(value: string, image: boolean): string {
  const url = value.trim();
  if (image && /^data:image\/(?:png|jpe?g|gif|webp|bmp|avif);base64,[a-z0-9+/=]+$/i.test(url)) return url;
  if (!url || [...url].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) return '';
  if (!(image ? /^https?:\/\//i : /^(?:https?:\/\/|mailto:|#)/i).test(url)) return '';
  return url.replace(/[ ()<>"\\]/g, (character) =>
    '%' + character.charCodeAt(0).toString(16).toUpperCase()
  );
}

function wrap(value: string, start: string, end = start): string {
  if (!value.trim()) return value;
  return value.replace(/^(\s*)([\s\S]*?\S)(\s*)$/, (_match, before, body, after) =>
    before + start + body + end + after
  );
}

function trimBlock(value: string, lineBreak: string): string {
  if (lineBreak === MARKDOWN_BREAK) value = value.replace(/(?:\\\n\s*)+$/, '');
  return value.trim();
}

function codeFence(text: string, min: number): string {
  const ticks = text.match(/`+/g) ?? [];
  return '`'.repeat(ticks.reduce((size, run) => Math.max(size, run.length + 1), min));
}

function blockTag(tag: string): boolean {
  return /^(?:h[1-6]|p|div|section|article|header|footer|main|aside|table|blockquote|pre|ol|ul|hr|figure|figcaption|center|dl|dt|dd)$/i.test(tag);
}

function headingLevel(node: HtmlElement): number {
  if (/^h[1-6]$/.test(node.tagName)) return Number(node.tagName[1]);
  if (node.tagName !== 'p') return 0;
  const heading = /\bmsoheading([1-6])\b/i.exec(attribute(node, 'class'));
  const outline = /\bmso-outline-level:\s*([0-5])\b/i.exec(attribute(node, 'style'));
  return heading ? Number(heading[1]) : outline ? Number(outline[1]) + 1 : 0;
}

export interface ClipboardMarkdown { markdown: string; block: boolean; imageOnly: boolean }

export function clipboardHtmlToMarkdown(html: string): ClipboardMarkdown | null {
  if (!html || html.length > MAX_CLIPBOARD_HTML) return null;
  const start = '<!--StartFragment-->';
  const from = html.indexOf(start);
  const to = html.indexOf('<!--EndFragment-->', from + start.length);
  const tree = parseFragment(from >= 0 && to >= 0 ? html.slice(from + start.length, to) : html);
  let rich = false;
  let block = false;
  let images = 0;
  let text = false;

  function inline(nodes: readonly HtmlNode[], lineBreak: string): string {
    return nodes.map((node): string => {
      if (node.nodeName === '#text' && 'value' in node) {
        if (node.value.trim()) text = true;
        return escapeText(node.value);
      }
      if (!('tagName' in node) || IGNORED.has(node.tagName) || /mso-list:\s*ignore/i.test(attribute(node, 'style'))) return '';
      const { tagName } = node;
      if (tagName === 'br') { rich = true; return lineBreak; }
      if (tagName === 'img') {
        rich = true;
        images++;
        const alt = escapeMarkdownLabel(attribute(node, 'alt'));
        const src = destination(attribute(node, 'src'), true);
        return src ? '![' + alt + '](' + src + ')' : alt;
      }
      if (tagName === 'code') {
        rich = text = true;
        const value = plain(node).replace(/\n/g, ' ');
        const fence = codeFence(value, 1);
        const pad = /^`|`$|^ | $/.test(value) && value.trim() ? ' ' : '';
        return value ? fence + pad + value + pad + fence : '';
      }
      let value = inline(node.childNodes, lineBreak);
      if (tagName === 'a') {
        const href = destination(attribute(node, 'href'), false);
        if (href && value.trim()) { rich = true; return wrap(value, '[', '](' + href + ')'); }
        return value;
      }
      const style = attribute(node, 'style');
      const bold = /^(?:b|strong)$/.test(tagName) || /font-weight:\s*(?:bold|[6-9]00)\b/i.test(style);
      const italic = /^(?:i|em)$/.test(tagName) || /font-style:\s*italic\b/i.test(style);
      const strike = /^(?:s|strike|del)$/.test(tagName) || /text-decoration(?:-line)?:[^;]*\bline-through\b/i.test(style);
      if (bold || italic || strike) rich = true;
      if (bold && italic) value = wrap(value, '***');
      else if (bold) value = wrap(value, '**');
      else if (italic) value = wrap(value, '*');
      if (strike) value = wrap(value, '~~');
      return value;
    }).join('');
  }

  function renderTable(table: HtmlElement): string {
    const rows: string[][] = [];
    function visit(node: HtmlElement): void {
      for (const child of node.childNodes) {
        if (!('tagName' in child)) continue;
        if (/^(?:thead|tbody|tfoot)$/.test(child.tagName)) visit(child);
        if (child.tagName === 'tr') {
          const cells = child.childNodes.filter((cell): cell is HtmlElement => 'tagName' in cell && /^(?:th|td)$/.test(cell.tagName));
          rows.push(cells.map((cell) => flow(cell.childNodes, '<br>').join('<br>')));
        }
      }
    }
    visit(table);
    return rowsToMarkdownTable(rows);
  }

  function renderBlock(node: HtmlElement, lineBreak: string): string {
    const level = headingLevel(node);
    if (level) {
      rich = block = true;
      return '#'.repeat(level) + ' ' + inline(node.childNodes, ' ').trim();
    }
    switch (node.tagName) {
      case 'p': {
        const value = trimBlock(inline(node.childNodes, lineBreak), lineBreak);
        const wordList = /\bmso-list:\s*[^;]*\blevel([1-9])\b/i.exec(attribute(node, 'style'));
        if (!wordList || !value) return value;
        rich = block = true;
        const marker = /^\s*(\d+)[.)]/.exec(plain(node));
        return '    '.repeat(Number(wordList[1]) - 1) + (marker ? marker[1] + '. ' : '- ') + value;
      }
      case 'pre': {
        rich = block = text = true;
        const value = plain(node).replace(/\n$/, '');
        const fence = codeFence(value, 3);
        return fence + '\n' + value + '\n' + fence;
      }
      case 'blockquote':
        rich = block = true;
        return flow(node.childNodes, lineBreak).join('\n\n').split('\n').map((line) => line ? '> ' + line : '>').join('\n');
      case 'ol':
      case 'ul': {
        rich = block = true;
        const initial = Number.parseInt(attribute(node, 'start'), 10);
        return node.childNodes
          .filter((item): item is HtmlElement => 'tagName' in item && item.tagName === 'li')
          .map((item, index) => {
            const marker = node.tagName === 'ol' ? (Number.isFinite(initial) ? initial + index : index + 1) + '. ' : '- ';
            const lines = flow(item.childNodes, lineBreak).join('\n\n').split('\n');
            return marker + lines[0] + lines.slice(1).map((line) => '\n' + (line ? ' '.repeat(marker.length) + line : '')).join('');
          }).join('\n');
      }
      case 'table':
        rich = block = true;
        return renderTable(node);
      case 'hr':
        rich = block = true;
        return '---';
      default:
        return flow(node.childNodes, lineBreak).join('\n\n');
    }
  }

  function flow(nodes: readonly HtmlNode[], lineBreak: string): string[] {
    const result: string[] = [];
    let pending: HtmlNode[] = [];
    const flush = () => {
      const value = trimBlock(inline(pending, lineBreak), lineBreak);
      if (value) result.push(value);
      pending = [];
    };
    for (const node of nodes) {
      if ('tagName' in node && blockTag(node.tagName)) {
        flush();
        const value = renderBlock(node, lineBreak);
        if (value.trim()) result.push(value);
      } else {
        pending.push(node);
      }
    }
    flush();
    return result;
  }
  const parts = flow(tree.childNodes, MARKDOWN_BREAK);
  if (parts.length > 1) rich = block = true;
  const markdown = parts.join('\n\n');
  return rich && markdown ? { markdown, block, imageOnly: images > 0 && !text && !block } : null;
}
