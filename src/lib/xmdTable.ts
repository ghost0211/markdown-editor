import type { Element, Root as HastRoot } from 'hast';
import type { Root } from 'mdast';
import type { VFile } from 'vfile';
import { documentStructureParser } from './documentStructure';
import { readXmdComment, writeXmdComment } from './xmdComment';

export interface XmdTableStyle {
  widths?: number[];
  vertical?: 'top' | 'middle' | 'bottom';
  repeatHeader?: boolean;
}

export const XMD_TABLE_PREFIX = '<!-- xmd:table ';
export const XMD_TABLE_LIMIT = 1024;
type XmdTableByOffset = Map<number, XmdTableStyle>;

export function parseXmdTableMarker(value: string): XmdTableStyle | undefined {
  const raw = readXmdComment(value, XMD_TABLE_PREFIX, XMD_TABLE_LIMIT);
  if (!raw) return;
  const style: XmdTableStyle = {};
  if (Array.isArray(raw.widths) && raw.widths.length && raw.widths.length <= 64 &&
      raw.widths.every((width) => Number.isInteger(width) && width >= 1 && width <= 100_000)) {
    style.widths = raw.widths as number[];
  }
  if (raw.vertical === 'top' || raw.vertical === 'middle' || raw.vertical === 'bottom') style.vertical = raw.vertical;
  if (typeof raw.repeatHeader === 'boolean') style.repeatHeader = raw.repeatHeader;
  return Object.keys(style).length ? style : undefined;
}

export function xmdTableMarker(style: XmdTableStyle): string {
  const marker = writeXmdComment(XMD_TABLE_PREFIX, style);
  const valid = parseXmdTableMarker(marker);
  return valid ? writeXmdComment(XMD_TABLE_PREFIX, valid) : '';
}

/** Keep valid widths when columns are added or removed in source mode. */
export function tableWidthWeights(widths: readonly number[] | undefined, count: number): number[] | undefined {
  if (!widths?.length) return;
  const defaultWidth = Math.round(widths.reduce((sum, x) => sum + x, 0) / widths.length);
  return Array.from({ length: count }, (_, index) => widths[index] ?? defaultWidth);
}

export function tableWidthPercentages(widths: readonly number[]): number[] {
  const total = widths.reduce((sum, width) => sum + width, 0);
  return widths.map((width) => width / total * 100);
}

declare module 'mdast' {
  interface TableData { xmdTable?: XmdTableStyle }
}

export function transformXmdTable(root: Root): Map<number, XmdTableStyle> {
  const styles = new Map<number, XmdTableStyle>();
  root.children = root.children.filter((node, index, siblings) => {
    const next = siblings[index + 1];
    if (node.type !== 'html' || next?.type !== 'table' ||
      node.position?.end.line !== (next.position?.start.line ?? 0) - 1) return true;
    const style = parseXmdTableMarker(node.value);
    if (!style) return true;
    next.data = { ...next.data, xmdTable: style };
    const offset = next.position?.start.offset;
    if (offset !== undefined) styles.set(offset, style);
    return false;
  });
  return styles;
}

export function hasXmdTable(markdown: string): boolean {
  return markdown.includes(XMD_TABLE_PREFIX) && transformXmdTable(documentStructureParser.parse(markdown)).size > 0;
}

declare module 'vfile' {
  interface DataMap { xmdTables: XmdTableByOffset }
}

export function remarkXmdTable() {
  return (root: Root, file: VFile) => {
    if (file.toString().includes(XMD_TABLE_PREFIX)) file.data.xmdTables = transformXmdTable(root);
  };
}

function tableCells(table: Element): Element[] {
  return table.children.flatMap((group) => group.type === 'element' && /^(?:thead|tbody)$/.test(group.tagName)
    ? group.children.flatMap((row) => row.type === 'element' && row.tagName === 'tr'
      ? row.children.filter((cell): cell is Element => cell.type === 'element' && /^(?:th|td)$/.test(cell.tagName))
      : []) : []);
}

export function rehypeXmdTable() {
  return (root: HastRoot, file: VFile) => {
    if (!file.data.xmdTables?.size) return;
    for (const node of root.children) {
      if (node.type !== 'element' || node.tagName !== 'table') continue;
      const style = file.data.xmdTables.get(node.position?.start.offset ?? -1);
      if (!style) continue;
      const cells = tableCells(node);
      if (style.vertical) for (const cell of cells) cell.properties.style = 'vertical-align:' + style.vertical;
      if (style.repeatHeader !== undefined) node.properties.dataXmdRepeatHeader = String(style.repeatHeader);
      const header = node.children.find((child): child is Element => child.type === 'element' && child.tagName === 'thead');
      const row = header?.children.find((child): child is Element => child.type === 'element' && child.tagName === 'tr');
      const count = row?.children.filter((child) => child.type === 'element' && child.tagName === 'th').length ?? 0;
      const widths = count && tableWidthWeights(style.widths, count);
      if (widths) {
        node.properties.style = 'table-layout:fixed;width:100%;overflow-wrap:anywhere';
        node.children.unshift({
          type: 'element', tagName: 'colgroup', properties: {},
          children: tableWidthPercentages(widths).map((width) => ({
            type: 'element', tagName: 'col', properties: { style: 'width:' + width.toFixed(3) + '%' }, children: [],
          })),
        });
      }
    }
  };
}
