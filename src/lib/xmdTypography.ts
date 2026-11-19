export interface XmdTypography {
  font?: string;
  size?: number;
  color?: string;
}

export const MIN_XMD_FONT_SIZE = 6;
export const MAX_XMD_FONT_SIZE = 96;
export const XMD_TYPOGRAPHY_CLOSE = '</xmd-style>';

const FONT_NAME = /^[\p{L}\p{N}][\p{L}\p{N}\p{M} ._-]{0,79}$/u;
const FONT_SIZE = /^\d{1,2}(?:\.5)?$/;
const COLOR = /^#[\da-f]{6}$/i;
const OPEN_TAG = /^<xmd-style((?: (?:font|size|color)="[^"\r\n]*"){1,3})>$/;

export function parseXmdTypography(font: string, size: string, color: string): XmdTypography | null {
  font = font.trim();
  size = size.trim();
  color = color.trim();
  const points = Number(size);
  if ((font && !FONT_NAME.test(font)) ||
      (size && (!FONT_SIZE.test(size) || points < MIN_XMD_FONT_SIZE || points > MAX_XMD_FONT_SIZE)) ||
      (color && !COLOR.test(color))) return null;
  return {
    ...(font && { font }),
    ...(size && { size: points }),
    ...(color && { color: color.toLowerCase() }),
  };
}

export function hasXmdTypography(value: XmdTypography): boolean {
  return Boolean(value.font || value.size || value.color);
}

export function xmdTypographyOpen(value: XmdTypography): string {
  const clean = parseXmdTypography(value.font ?? '', String(value.size ?? ''), value.color ?? '');
  if (!clean || !hasXmdTypography(clean)) return '';
  const attributes = Object.entries(clean).map(([name, content]) => name + '="' + content + '"');
  return '<xmd-style ' + attributes.join(' ') + '>';
}

function readXmdTypographyTag(tag: string): XmdTypography | null {
  const match = OPEN_TAG.exec(tag);
  if (!match) return null;
  const values = new Map<string, string>();
  for (const [, key, value] of match[1].matchAll(/ (font|size|color)="([^"]*)"/g)) {
    if (values.has(key)) return null;
    values.set(key, value);
  }
  const style = parseXmdTypography(values.get('font') ?? '', values.get('size') ?? '', values.get('color') ?? '');
  return style && hasXmdTypography(style) ? style : null;
}

/** Tag pairs use sibling indices, so formatting cannot extend into another Markdown block. */
export function pairXmdTypography<T>(nodes: readonly T[], tagForNode: (node: T) => string): {
  open: number;
  close: number;
  style: XmdTypography;
}[] {
  const openTags: number[] = [];
  const result: { open: number; close: number; style: XmdTypography }[] = [];
  for (let index = 0; index < nodes.length; index++) {
    const tag = tagForNode(nodes[index]);
    if (/^<xmd-style[\s>]/i.test(tag)) {
      openTags.push(index);
    } else if (tag.toLowerCase() === XMD_TYPOGRAPHY_CLOSE && openTags.length) {
      const open = openTags.pop()!;
      const style = readXmdTypographyTag(tagForNode(nodes[open]));
      if (style) result.push({ open, close: index, style });
    }
  }
  return result;
}

/** Call only with a parsed or generated style, never arbitrary HTML or CSS. */
export function xmdTypographyCss(style: XmdTypography): string {
  return [
    style.font && 'font-family:"' + style.font + '"',
    style.size && 'font-size:' + style.size + 'pt',
    style.color && 'color:' + style.color,
  ].filter(Boolean).join(';');
}
