import type { Root } from 'mdast';
import { documentStructureParser } from './documentStructure';
import { validateExportStyle, type ExportStyle } from './exportStyle';
import { getFrontMatterEndLine } from './frontMatter';

export const XMD_PAGE_BREAK = '<!-- xmd:page-break -->';
export const XMD_PAGE_BREAK_CLASS = 'xmd-page-break';
const THEME_PREFIX = '<!-- xmd:document-theme ';
const COMMENT_SUFFIX = ' -->';

function afterFrontMatter(markdown: string): number {
  const bom = markdown.startsWith('\uFEFF') ? 1 : 0;
  if (!/^(?:---|\+\+\+)[ \t]*(?:\r?\n|$)/.test(markdown.slice(bom, bom + 64))) return bom;
  const lines = getFrontMatterEndLine(markdown);
  if (!lines) return bom;
  let offset = bom;
  for (let line = 0; line < lines; line++) {
    const next = markdown.indexOf('\n', offset);
    if (next === -1) return markdown.length;
    offset = next + 1;
  }
  return offset;
}

function themeLine(markdown: string) {
  const afterMetadata = afterFrontMatter(markdown);
  const rest = markdown.slice(afterMetadata);
  const blanks = /^(?:[ \t]*\r?\n)*/.exec(rest)![0].length;
  const start = afterMetadata + blanks;
  const newline = markdown.indexOf('\n', start);
  const line = markdown.slice(start, newline === -1 ? markdown.length : newline).trimEnd();
  return { start, end: newline === -1 ? markdown.length : newline + 1, line, afterMetadata };
}

function parseThemeLine(line: string): ExportStyle | undefined {
  if (!line.startsWith(THEME_PREFIX) || !line.endsWith(COMMENT_SUFFIX) || line.length > 4096) return undefined;
  try {
    const raw: unknown = JSON.parse(line.slice(THEME_PREFIX.length, -COMMENT_SUFFIX.length));
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) return validateExportStyle(raw);
  } catch { /* An invalid comment remains ordinary Markdown. */ }
  return undefined;
}

export function readXmdDocumentTheme(markdown: string): ExportStyle | undefined {
  return markdown.includes(THEME_PREFIX) ? parseThemeLine(themeLine(markdown).line) : undefined;
}

export function setXmdDocumentTheme(markdown: string, style?: ExportStyle): string {
  const { start, end, line } = themeLine(markdown);
  const existing = parseThemeLine(line);
  const head = markdown.slice(0, start);
  if (!style) {
    return existing ? head + markdown.slice(end).replace(/^\r?\n/, '') : markdown;
  }
  // Escape comment delimiters even if they occur in the header's plain text.
  const json = JSON.stringify(validateExportStyle(style)).replace(/[-<>&]/g, (char) =>
    '\\u' + char.charCodeAt(0).toString(16).padStart(4, '0'));
  const newline = markdown.includes('\r\n') ? '\r\n' : '\n';
  const marker = THEME_PREFIX + json + COMMENT_SUFFIX;
  if (existing) return head + marker + (end === markdown.length && !markdown.endsWith('\n') ? '' : newline) + markdown.slice(end);
  const prefix = head && head !== '\uFEFF' && !head.endsWith('\n') ? newline + newline : '';
  return head + prefix + marker + newline + newline + markdown.slice(start);
}

export function isXmdPageBreak(value: string): boolean {
  return value.trimEnd() === XMD_PAGE_BREAK;
}

export function isXmdDocumentThemeMarker(value: string): boolean {
  return Boolean(parseThemeLine(value.trimEnd()));
}

export function hasXmdPageBreak(markdown: string): boolean {
  return markdown.includes(XMD_PAGE_BREAK) && documentStructureParser.parse(markdown).children
    .some((node) => node.type === 'html' && isXmdPageBreak(node.value));
}

export function remarkXmdLayout() {
  return (root: Root) => {
    root.children = root.children.flatMap((node): Root['children'] => {
      if (node.type !== 'html') return [node];
      if (isXmdDocumentThemeMarker(node.value)) return [];
      if (!isXmdPageBreak(node.value)) return [node];
      return [{
        type: 'paragraph', children: [], position: node.position,
        data: { hName: 'div', hProperties: { className: [XMD_PAGE_BREAK_CLASS] } },
      }];
    });
  };
}

/** Insert before the containing top-level block, preserving lists, tables and fences. */
export function planXmdPageBreak(markdown: string, caret: number): { from: number; insert: string } | null {
  const theme = themeLine(markdown);
  const contentStart = parseThemeLine(theme.line) ? theme.end : theme.afterMetadata;
  const target = Math.min(markdown.length, Math.max(contentStart, caret));
  const lineStart = target === 0 ? 0 : markdown.lastIndexOf('\n', target - 1) + 1;
  const blocks = documentStructureParser.parse(markdown).children;
  const block = blocks.find((node) =>
    (node.position?.start.offset ?? Infinity) <= target && (node.position?.end.offset ?? -1) >= target);
  if (block?.type === 'html' && isXmdPageBreak(block.value)) return null;
  const blockOffset = block?.position?.start.offset ?? lineStart;
  const blockStart = blockOffset === 0 ? 0 : markdown.lastIndexOf('\n', blockOffset - 1) + 1;
  const from = Math.max(contentStart, blockStart);
  const before = markdown.slice(0, from);
  const after = markdown.slice(from);
  const newline = markdown.includes('\r\n') ? '\r\n' : '\n';
  const prefix = !before || before === '\uFEFF' || /\r?\n[ \t]*\r?\n$/.test(before) ? ''
    : before.endsWith('\n') ? newline : newline + newline;
  const suffix = after.startsWith('\n') || after.startsWith('\r\n') ? newline : newline + newline;
  return { from, insert: prefix + XMD_PAGE_BREAK + suffix };
}
