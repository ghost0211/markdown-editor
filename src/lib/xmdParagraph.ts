import type { Root as HastRoot } from 'hast';
import type { Heading, Paragraph, Root } from 'mdast';
import type { VFile } from 'vfile';
import { documentStructureParser } from './documentStructure';
import { readXmdComment, writeXmdComment } from './xmdComment';
import { parseXmdTypography, xmdTypographyCss, type XmdTypography } from './xmdTypography';

export interface XmdParagraphStyle extends XmdTypography {
  lineHeight?: number;
  before?: number;
  after?: number;
  indent?: number;
}

export const XMD_PARAGRAPH_PREFIX = '<!-- xmd:paragraph ';
export const XMD_PARAGRAPH_LIMIT = 768;
type XmdParagraphByOffset = Map<number, XmdParagraphStyle>;

declare module 'mdast' {
  interface HeadingData { xmdParagraph?: XmdParagraphStyle }
  interface ParagraphData { xmdParagraph?: XmdParagraphStyle }
}

export function validateXmdParagraph(raw: Record<string, unknown>): XmdParagraphStyle | undefined {
  if (['font', 'color'].some((key) => raw[key] !== undefined && typeof raw[key] !== 'string') ||
    (raw.size !== undefined && typeof raw.size !== 'number')) return;
  const typography = parseXmdTypography(String(raw.font ?? ''), String(raw.size ?? ''), String(raw.color ?? ''));
  if (!typography) return;
  const style: XmdParagraphStyle = { ...typography };
  const bounds = { lineHeight: [1, 3], before: [0, 108], after: [0, 108], indent: [0, 144] } as const;
  for (const key of Object.keys(bounds) as (keyof typeof bounds)[]) {
    const value = raw[key];
    if (value === undefined) continue;
    const [min, max] = bounds[key];
    if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) return;
    style[key] = Math.round(value * 100) / 100;
  }
  return style;
}

export function parseXmdParagraphMarker(value: string): XmdParagraphStyle | undefined {
  const raw = readXmdComment(value, XMD_PARAGRAPH_PREFIX, XMD_PARAGRAPH_LIMIT);
  const style = raw && validateXmdParagraph(raw);
  return style && Object.keys(style).length ? style : undefined;
}

export function xmdParagraphMarker(style: XmdParagraphStyle): string {
  const clean = validateXmdParagraph({ ...style });
  return clean && Object.keys(clean).length ? writeXmdComment(XMD_PARAGRAPH_PREFIX, clean) : '';
}

export function xmdParagraphCss(style: XmdParagraphStyle, visual = false): string {
  return [
    xmdTypographyCss(style),
    style.lineHeight !== undefined && 'line-height:' + style.lineHeight,
    style.before !== undefined && (visual ? 'padding-top:' : 'margin-top:') + style.before + 'pt',
    style.after !== undefined && (visual ? 'padding-bottom:' : 'margin-bottom:') + style.after + 'pt',
    style.indent !== undefined && 'text-indent:' + style.indent + 'pt',
  ].filter(Boolean).join(';');
}

export function transformXmdParagraph(root: Root): Map<number, XmdParagraphStyle> {
  const styles = new Map<number, XmdParagraphStyle>();
  for (const node of root.children) {
    if (node.type !== 'heading' && node.type !== 'paragraph') continue;
    const children: (Paragraph | Heading)['children'] = [];
    let style: XmdParagraphStyle | undefined;
    for (const child of node.children) {
      const parsed = child.type === 'html' ? parseXmdParagraphMarker(child.value) : undefined;
      if (!parsed) { children.push(child); continue; }
      style = parsed;
      const previous = children.at(-1);
      if (previous?.type === 'text' && previous.value.endsWith(' ')) {
        previous.value = previous.value.slice(0, -1);
        if (!previous.value) children.pop();
      }
    }
    if (!style) continue;
    node.children = children;
    node.data = { ...node.data, xmdParagraph: style };
    const offset = node.position?.start.offset;
    if (offset !== undefined) styles.set(offset, style);
  }
  return styles;
}

export function hasXmdParagraph(markdown: string): boolean {
  return markdown.includes(XMD_PARAGRAPH_PREFIX) && transformXmdParagraph(documentStructureParser.parse(markdown)).size > 0;
}

declare module 'vfile' {
  interface DataMap { xmdParagraphs: XmdParagraphByOffset }
}

export function remarkXmdParagraph() {
  return (root: Root, file: VFile) => {
    if (file.toString().includes(XMD_PARAGRAPH_PREFIX)) file.data.xmdParagraphs = transformXmdParagraph(root);
  };
}

export function rehypeXmdParagraph() {
  return (root: HastRoot, file: VFile) => {
    const styles = file.data.xmdParagraphs;
    if (!styles?.size) return;
    for (const child of root.children) {
      if (child.type !== 'element' || !/^(?:p|h[1-6])$/.test(child.tagName)) continue;
      const style = styles.get(child.position?.start.offset ?? -1);
      if (!style) continue;
      const existing = child.properties.style;
      child.properties.style = [existing, xmdParagraphCss(style)].filter(Boolean).join(';');
    }
  };
}
