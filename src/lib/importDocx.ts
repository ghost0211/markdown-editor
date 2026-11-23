import JSZip from 'jszip';
import { bytesToBase64 } from '@/lib/export/embedImages';
import { parseXmdTypography, xmdTypographyOpen, XMD_TYPOGRAPHY_CLOSE } from '@/lib/xmdTypography';
import { validateXmdParagraph, xmdParagraphMarker, type XmdParagraphStyle } from '@/lib/xmdParagraph';
import { XMD_ALIGNMENT_PREFIX, type XmdAlignment } from '@/lib/xmdAlignment';
import { XMD_PAGE_BREAK } from '@/lib/xmdLayout';
import { xmdTableMarker } from '@/lib/xmdTable';
import GithubSlugger from 'github-slugger';

export const MAX_DOCX_IMPORT_BYTES = 64 * 1024 * 1024;
const MAX_XML_BYTES = 12 * 1024 * 1024;
const MAX_IMAGE_BYTES = 24 * 1024 * 1024;
const MAX_MEDIA_TOTAL = 48 * 1024 * 1024;
const MAX_COLUMNS = 64;

interface ZipStream {
  on(event: 'data', listener: (chunk: Uint8Array) => void): ZipStream;
  on(event: 'error', listener: (error: Error) => void): ZipStream;
  on(event: 'end', listener: () => void): ZipStream;
  resume(): ZipStream;
  pause(): ZipStream;
}

function readPart(zip: JSZip, path: string, limit: number): Promise<Uint8Array | undefined> {
  const entry = zip.file(path);
  if (!entry || (entry.unsafeOriginalName && entry.unsafeOriginalName !== path)) return Promise.resolve(undefined);
  return new Promise((resolve, reject) => {
    // JSZip streams byte chunks without materializing potentially oversized ZIP entries.
    const stream = (entry as typeof entry & { internalStream(type: 'uint8array'): ZipStream }).internalStream('uint8array');
    const chunks: Uint8Array[] = [];
    let length = 0;
    stream.on('data', (chunk) => {
      length += chunk.length;
      if (length > limit) {
        stream.pause();
        reject(new Error('DOCX part exceeds the import limit'));
        return;
      }
      chunks.push(chunk);
    }).on('error', reject).on('end', () => {
      const bytes = new Uint8Array(length);
      let index = 0;
      for (const chunk of chunks) { bytes.set(chunk, index); index += chunk.length; }
      resolve(bytes);
    }).resume();
  });
}

async function readXml(zip: JSZip, path: string): Promise<Element | undefined> {
  const bytes = await readPart(zip, path, MAX_XML_BYTES);
  if (!bytes) return;
  const utf16 = bytes[0] === 0xff && bytes[1] === 0xfe ? 'utf-16le'
    : bytes[0] === 0xfe && bytes[1] === 0xff ? 'utf-16be' : 'utf-8';
  const xml = new TextDecoder(utf16, { fatal: true }).decode(bytes);
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error('Unsupported DOCX XML declaration');
  const document = new DOMParser().parseFromString(xml, 'application/xml');
  if (document.querySelector('parsererror')) throw new Error('Invalid DOCX XML');
  return document.documentElement;
}

function children(node?: Element): Element[] {
  return node ? [...node.children] : [];
}

function child(node: Element | undefined, name: string): Element | undefined {
  return children(node).find((element) => element.localName === name);
}

function descendants(node: Element, name: string): Element[] {
  return [...node.getElementsByTagNameNS('*', name)];
}

function attr(node: Element | undefined, name: string): string {
  return node?.getAttribute(name) ?? node?.getAttribute('w:' + name) ??
    [...(node?.attributes ?? [])].find((attribute) => attribute.localName === name)?.value ?? '';
}

function typedChild(node: Element | undefined, name: string, key = 'val'): string {
  return attr(child(node, name), key);
}

function switched(node: Element | undefined): boolean {
  return Boolean(node && !/^(0|false|off)$/i.test(attr(node, 'val')));
}

function boundedNumber(value: string, min: number, max: number): number | undefined {
  const number = Number(value);
  return value && Number.isFinite(number) && number >= min && number <= max ? number : undefined;
}

function markdownText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/[\\*_~[\]#|!+\-.=^$]/g, (char) => '\\' + char)
    .split(String.fromCharCode(96)).join('\\' + String.fromCharCode(96));
}

function decorateText(text: string, markers: string): string {
  return text.replace(/^(\s*)([\s\S]*?\S)(\s*)$/, (_, start: string, body: string, end: string) =>
    start + markers + body + markers + end);
}

function safeHyperlink(target: string): string | undefined {
  let url: URL;
  try { url = new URL(target); } catch { return; }
  if (!['http:', 'https:', 'mailto:'].includes(url.protocol) || url.username || url.password) return;
  return url.href.replace(/[<>\s\\]/g, (character) => encodeURIComponent(character));
}

function imagePart(target: string): string | undefined {
  let path: string;
  try { path = decodeURIComponent(target); } catch { return; }
  if (/[:\\?#]/.test(path)) return;
  path = path.startsWith('/') ? path.slice(1) : 'word/' + path;
  return path.startsWith('word/') && path.split('/').every((segment) => segment && segment !== '.' && segment !== '..') ? path : undefined;
}

function rasterType(bytes: Uint8Array): string | undefined {
  const start = Array.from(bytes.subarray(0, 12));
  const ascii = String.fromCharCode(...start);
  if (start[0] === 0x89 && ascii.slice(1, 4) === 'PNG') return 'image/png';
  if (start[0] === 0xff && start[1] === 0xd8 && start[2] === 0xff) return 'image/jpeg';
  if (ascii.startsWith('GIF87a') || ascii.startsWith('GIF89a')) return 'image/gif';
  if (ascii.startsWith('RIFF') && ascii.slice(8, 12) === 'WEBP') return 'image/webp';
  if (ascii.startsWith('BM')) return 'image/bmp';
}

interface ListLevel { ordered: boolean; start: number }

function readNumbering(root?: Element): Map<string, ListLevel> {
  const abstracts = new Map<string, Element>();
  for (const item of children(root)) if (item.localName === 'abstractNum') abstracts.set(attr(item, 'abstractNumId'), item);
  const levels = new Map<string, ListLevel>();
  for (const item of children(root)) {
    if (item.localName !== 'num') continue;
    const id = attr(item, 'numId');
    const abstract = abstracts.get(typedChild(item, 'abstractNumId'));
    const overrides = new Map(children(item).filter((element) => element.localName === 'lvlOverride')
      .map((element) => [attr(element, 'ilvl'), element]));
    for (const level of children(abstract)) {
      if (level.localName !== 'lvl') continue;
      const index = attr(level, 'ilvl');
      const override = overrides.get(index);
      const effective = child(override, 'lvl') ?? level;
      const format = typedChild(effective, 'numFmt');
      const start = typedChild(override, 'startOverride') || typedChild(effective, 'start');
      levels.set(id + ':' + index, { ordered: format !== 'bullet' && format !== 'none', start: boundedNumber(start, 1, 999_999) ?? 1 });
    }
  }
  return levels;
}

export interface DocxImportResult {
  markdown: string;
  skippedImages: number;
}

export async function importDocx(bytes: ArrayBuffer, preserveLayout = false): Promise<DocxImportResult> {
  if (!bytes.byteLength || bytes.byteLength > MAX_DOCX_IMPORT_BYTES) throw new Error('DOCX file exceeds the import limit');
  const zip = await JSZip.loadAsync(bytes);
  if (Object.keys(zip.files).length > 4096) throw new Error('DOCX package contains too many parts');
  const [document, styleRoot, numbering, relationRoot] = await Promise.all([
    readXml(zip, 'word/document.xml'), readXml(zip, 'word/styles.xml'), readXml(zip, 'word/numbering.xml'),
    readXml(zip, 'word/_rels/document.xml.rels'),
  ]);
  const body = child(document, 'body');
  if (!body || document?.localName !== 'document' || !document.namespaceURI?.endsWith('/main')) throw new Error('DOCX has no Word document body');
  const styles = new Map(children(styleRoot).filter((item) => item.localName === 'style').map((item) => [attr(item, 'styleId'), item]));
  const relations = new Map(children(relationRoot).filter((item) => item.localName === 'Relationship').map((item) => [attr(item, 'Id'), item]));
  const levels = readNumbering(numbering);
  const imageIds = new Map<string, string>();
  const definitions: string[] = [];
  let mediaTotal = 0;
  let skippedImages = 0;

  function styleChain(node: Element, properties: string, styleKey: string) {
    const direct = child(node, properties);
    const chain = direct ? [direct] : [];
    let id = typedChild(direct, styleKey);
    const seen = new Set<string>();
    while (id && !seen.has(id) && seen.size < 20) {
      seen.add(id);
      const style = styles.get(id);
      const next = child(style, properties);
      if (next) chain.push(next);
      id = typedChild(style, 'basedOn');
    }
    return chain;
  }
  const firstProperty = (chain: Element[], name: string) => chain.map((value) => child(value, name)).find(Boolean);
  const heading = (node: Element) => {
    const outline = attr(firstProperty(styleChain(node, 'pPr', 'pStyle'), 'outlineLvl'), 'val');
    if (/^[0-5]$/.test(outline)) return Number(outline) + 1;
    const id = typedChild(child(node, 'pPr'), 'pStyle');
    const name = typedChild(styles.get(id), 'name');
    return Number(/(?:heading|标题)\s*([1-6])$/i.exec(name || id)?.[1] ?? 0);
  };
  const bookmarks = new Map<string, string>();
  const slugger = new GithubSlugger();
  for (const paragraph of children(body)) {
    if (paragraph.localName !== 'p' || !heading(paragraph)) continue;
    const slug = slugger.slug(descendants(paragraph, 't').map((node) => node.textContent ?? '').join(''));
    for (const bookmark of descendants(paragraph, 'bookmarkStart')) bookmarks.set(attr(bookmark, 'name'), slug);
  }

  const picture = async (node: Element): Promise<string> => {
    const blip = descendants(node, 'blip')[0];
    const legacy = descendants(node, 'imagedata')[0];
    const reference = relations.get(attr(blip, 'embed') || attr(legacy, 'id'));
    const path = attr(reference, 'TargetMode') !== 'External' && attr(reference, 'Type').endsWith('/image')
      ? imagePart(attr(reference, 'Target')) : undefined;
    const properties = descendants(node, 'docPr')[0];
    const alt = markdownText((attr(properties, 'descr') || attr(properties, 'name') || path?.split('/').at(-1) || 'Image').replace(/[\r\n]+/g, ' '));
    if (!path) { skippedImages++; return alt; }
    let id = imageIds.get(path);
    if (!id) {
      const budget = Math.min(MAX_IMAGE_BYTES, MAX_MEDIA_TOTAL - mediaTotal);
      if (budget <= 0) { skippedImages++; return alt; }
      const image = await readPart(zip, path, budget);
      const mime = image && rasterType(image);
      mediaTotal += image?.length ?? 0;
      if (!image || !mime) { skippedImages++; return alt; }
      id = 'word-image-' + (imageIds.size + 1);
      imageIds.set(path, id);
      definitions.push('[' + id + ']: data:' + mime + ';base64,' + bytesToBase64(image));
    }
    return '![' + alt + '][' + id + ']';
  };

  const inline = async (node: Element, inTable = false): Promise<string> => {
    const parts: string[] = [];
    for (const item of children(node)) {
      switch (item.localName) {
        case 't': parts.push(markdownText(item.textContent ?? '')); break;
        case 'tab': parts.push('    '); break;
        case 'br':
        case 'cr': parts.push(inTable ? '<br>' : '  \n'); break;
        case 'noBreakHyphen': parts.push('‑'); break;
        case 'drawing':
        case 'pict': parts.push(await picture(item)); break;
        case 'r': {
          let text = await inline(item, inTable);
          const properties = styleChain(item, 'rPr', 'rStyle');
          const bold = switched(firstProperty(properties, 'b'));
          const italic = switched(firstProperty(properties, 'i'));
          const strike = switched(firstProperty(properties, 'strike'));
          if (bold || italic) text = decorateText(text, bold && italic ? '***' : bold ? '**' : '*');
          if (strike) text = decorateText(text, '~~');
          if (preserveLayout && text.trim() && !text.includes('\n') && !/!\[/.test(text)) {
            const fonts = firstProperty(properties, 'rFonts');
            const size = boundedNumber(attr(firstProperty(properties, 'sz'), 'val'), 12, 192);
            const color = attr(firstProperty(properties, 'color'), 'val');
            const font = attr(fonts, 'eastAsia') || attr(fonts, 'ascii') || attr(fonts, 'hAnsi');
            const typography = parseXmdTypography(font, size ? String(size / 2) : '', /^[a-f\d]{6}$/i.test(color) ? '#' + color : '');
            const tag = typography && xmdTypographyOpen(typography);
            if (tag) text = text.replace(/^(\s*)([\s\S]*?\S)(\s*)$/, (_, a: string, value: string, b: string) => a + tag + value + XMD_TYPOGRAPHY_CLOSE + b);
          }
          parts.push(text);
          break;
        }
        case 'hyperlink': {
          const text = await inline(item, inTable);
          const reference = relations.get(attr(item, 'id'));
          const anchor = bookmarks.get(attr(item, 'anchor'));
          const href = anchor ? '#' + encodeURIComponent(anchor) : attr(reference, 'Type').endsWith('/hyperlink')
            ? safeHyperlink(attr(reference, 'Target')) : undefined;
          parts.push(href && text ? '[' + text + '](<' + href + '>)' : text);
          break;
        }
        case 'ins':
        case 'smartTag':
        case 'sdtContent':
        case 'sdt': parts.push(await inline(item, inTable)); break;
      }
    }
    return parts.join('');
  };

  function paragraphLayout(chain: Element[]): { style: XmdParagraphStyle; align?: XmdAlignment } {
    const spacing = firstProperty(chain, 'spacing');
    const ind = firstProperty(chain, 'ind');
    const before = boundedNumber(attr(spacing, 'before'), 0, 2160);
    const after = boundedNumber(attr(spacing, 'after'), 0, 2160);
    const indent = boundedNumber(attr(ind, 'firstLine'), 0, 2880);
    const lineHeight = /^(?:auto)?$/.test(attr(spacing, 'lineRule')) ? boundedNumber(attr(spacing, 'line'), 240, 720) : undefined;
    const jc = attr(firstProperty(chain, 'jc'), 'val');
    const align = jc === 'center' || jc === 'right' ? jc : jc === 'both' ? 'justify' : undefined;
    return { style: validateXmdParagraph({
      before: before === undefined ? undefined : before / 20,
      after: after === undefined ? undefined : after / 20,
      indent: indent === undefined ? undefined : indent / 20,
      lineHeight: lineHeight === undefined ? undefined : lineHeight / 240,
    }) ?? {}, align };
  }

  const blocks: string[] = [];
  const counters: { id: string; next: number; indent: number; markerLength: number }[] = [];
  let listLines: string[] = [];
  const flushList = () => {
    if (listLines.length) blocks.push(listLines.join('\n'));
    listLines = [];
    counters.length = 0;
  };
  for (const item of children(body)) {
    if (item.localName === 'p') {
      const chain = styleChain(item, 'pPr', 'pStyle');
      const text = (await inline(item)).trim();
      const numberingProps = firstProperty(chain, 'numPr');
      const numId = typedChild(numberingProps, 'numId');
      if (numId && numId !== '0' && text) {
        const sourceLevel = boundedNumber(typedChild(numberingProps, 'ilvl'), 0, 8) ?? 0;
        const level = Math.min(Math.floor(sourceLevel), counters.length);
        const config = levels.get(numId + ':' + sourceLevel) ?? { ordered: false, start: 1 };
        counters.splice(level + 1);
        const indent = level ? counters[level - 1].indent + counters[level - 1].markerLength : 0;
        const count = counters[level]?.id === numId ? counters[level].next : config.start;
        if (!level && counters[0] && counters[0].id !== numId) flushList();
        const marker = config.ordered ? count + '. ' : '- ';
        counters[level] = { id: numId, next: count + 1, indent, markerLength: marker.length };
        listLines.push(' '.repeat(indent) + marker + text.replace(/\n/g, '\n' + ' '.repeat(indent + marker.length)));
        continue;
      }
      flushList();
      if (!text) continue;
      const depth = heading(item);
      const prefix = depth ? '#'.repeat(depth) + ' ' : '';
      if (!preserveLayout) { blocks.push(prefix + (depth ? text.replace(/ {2}\n/g, ' ') : text)); continue; }
      const { style, align } = paragraphLayout(chain);
      if (switched(firstProperty(chain, 'pageBreakBefore'))) blocks.push(XMD_PAGE_BREAK);
      const markers = [xmdParagraphMarker(style), align && XMD_ALIGNMENT_PREFIX + align + ' -->'].filter(Boolean);
      blocks.push(prefix + (depth ? text.replace(/ {2}\n/g, ' ') : text) + (markers.length ? ' ' + markers.join(' ') : ''));
    } else if (item.localName === 'tbl') {
      flushList();
      const rows: string[][] = [];
      for (const row of children(item).filter((node) => node.localName === 'tr')) {
        const cells: string[] = [];
        for (const cell of children(row).filter((node) => node.localName === 'tc')) {
          const spans = Math.floor(boundedNumber(typedChild(child(cell, 'tcPr'), 'gridSpan'), 1, MAX_COLUMNS) ?? 1);
          const paragraphs: string[] = [];
          for (const paragraph of children(cell).filter((node) => node.localName === 'p')) paragraphs.push((await inline(paragraph, true)).trim());
          cells.push(paragraphs.join('<br>'), ...Array<string>(spans - 1).fill(''));
        }
        if (cells.length > MAX_COLUMNS) throw new Error('DOCX table exceeds the supported column count');
        if (cells.length) rows.push(cells);
      }
      if (!rows.length) continue;
      const count = rows.reduce((max, row) => Math.max(max, row.length), 1);
      const line = (cells: string[]) => '| ' + Array.from({ length: count }, (_, i) => cells[i] ?? '').join(' | ') + ' |';
      const table = [line(rows[0]), line(Array<string>(count).fill('---')), ...rows.slice(1).map(line)].join('\n');
      const widths = children(child(item, 'tblGrid')).map((column) => boundedNumber(attr(column, 'w'), 1, 100_000));
      const repeatHeader = switched(child(child(child(item, 'tr'), 'trPr'), 'tblHeader'));
      const marker = preserveLayout && xmdTableMarker({
        widths: widths.length === count && widths.every((width): width is number => Number.isInteger(width)) ? widths : undefined,
        ...(repeatHeader && { repeatHeader }),
      });
      blocks.push(marker ? marker + '\n' + table : table);
    }
  }
  flushList();
  if (definitions.length) blocks.push(definitions.join('\n'));
  return { markdown: blocks.join('\n\n'), skippedImages };
}
