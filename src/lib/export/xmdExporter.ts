import JSZip from 'jszip';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkFrontmatter from 'remark-frontmatter';
import remarkMath from 'remark-math';
import { parse, postprocess, preprocess } from 'micromark';
import { parseFragment, type DefaultTreeAdapterMap } from 'parse5';
import type { Nodes, Definition } from 'mdast';
import { resolveDocumentLink } from '@/lib/documentLinks';
import { mimeTypeForPath } from '@/lib/export/embedImages';
import { isTauri, readXmdResource, fetchXmdImage } from '@/lib/native';

export const XMD_VERSION = 1;
export const MAX_XMD_RESOURCE_BYTES = 32 * 1024 * 1024;
export const MAX_XMD_TOTAL_BYTES = 128 * 1024 * 1024;
export const MAX_XMD_RESOURCES = 2048;

export interface XmdResourceData {
  bytes: Uint8Array;
  mediaType?: string;
}

export interface XmdExportOptions {
  sourceFilePath?: string | null;
  /** Injectable byte loader; receives a resolved local path or an absolute URL. */
  loadResource?: (source: string) => Promise<XmdResourceData>;
}

export interface XmdManifest {
  format: 'xmd';
  version: 1;
  entry: 'document.md';
  title: string;
  resources: { path: string; mediaType: string; size: number }[];
}

interface Destination {
  start: number;
  end: number;
}

interface ResourceUse {
  source: string;
  image: boolean;
  /** May represent a Markdown destination, or a complete HTML attribute. */
  target: Destination;
  attribute?: { value: string; start: number; end: number };
}

const EXTENSION_BY_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/bmp': 'bmp',
  'image/avif': 'avif',
  'image/x-icon': 'ico',
  'image/vnd.microsoft.icon': 'ico',
  'image/svg+xml': 'svg',
  'image/tiff': 'tiff',
  'image/apng': 'apng',
};

function extensionForSource(source: string): string | undefined {
  // A resolved filesystem path can contain literal # and ? (percent-decoded
  // from Markdown); only actual URLs have a query/fragment to strip.
  const path = /^(?:https?:|blob:)/i.test(source) ? new URL(source).pathname : source;
  return path.match(/\.([a-z\d]{1,10})$/i)?.[1].toLowerCase();
}

function mediaTypeForSource(source: string): string {
  const extension = extensionForSource(source);
  if (extension === 'tif' || extension === 'tiff') return 'image/tiff';
  if (extension === 'apng') return 'image/apng';
  return mimeTypeForPath(`resource.${extension || 'bin'}`);
}

function localDestination(source: string): boolean {
  return !source.startsWith('#') && !/^(?![a-z]:[/\\])[a-z][a-z\d+.-]*:/i.test(source);
}

function walk(node: Nodes, visit: (node: Nodes) => void): void {
  visit(node);
  if ('children' in node) for (const child of node.children) walk(child, visit);
}

/** Read srcset URL spans without mistaking commas inside data URLs for separators. */
function srcsetUrls(value: string): { source: string; start: number; end: number }[] {
  const urls: ReturnType<typeof srcsetUrls> = [];
  let index = 0;
  while (index < value.length) {
    while (/[\s,]/.test(value[index] || '') && index < value.length) index++;
    const start = index;
    while (index < value.length && !/\s/.test(value[index])) index++;
    let end = index;
    while (end > start && value[end - 1] === ',') end--;
    if (end > start) urls.push({ source: value.slice(start, end), start, end });
    if (end !== index) continue;
    // Ignore descriptors (e.g. 1x, 640w), up to the next candidate.
    while (index < value.length && value[index] !== ',') index++;
    if (index < value.length) index++;
  }
  return urls;
}

function htmlImages(raw: string, offset: number): ResourceUse[] {
  const uses: ResourceUse[] = [];
  const fragment = parseFragment(raw, { sourceCodeLocationInfo: true });
  function visit(node: DefaultTreeAdapterMap['node']): void {
    if ('tagName' in node && (node.tagName === 'img' || node.tagName === 'source')) {
      for (const attribute of node.attrs) {
        if (attribute.name !== 'src' && attribute.name !== 'srcset') continue;
        // <source src> belongs to audio/video, whereas picture candidates use
        // srcset. XMD v1 does not recursively bundle audio/video dependencies.
        if (node.tagName === 'source' && attribute.name === 'src') continue;
        const location = node.sourceCodeLocation?.attrs?.[attribute.name];
        if (!location) continue;
        const target = { start: offset + location.startOffset, end: offset + location.endOffset };
        const spans = attribute.name === 'srcset'
          ? srcsetUrls(attribute.value)
          : [{ source: attribute.value, start: 0, end: attribute.value.length }];
        for (const span of spans) {
          uses.push({ source: span.source, image: true, target, attribute: { value: attribute.value, ...span } });
        }
      }
    }
    if ('childNodes' in node) for (const child of node.childNodes) visit(child);
  }
  visit(fragment);
  return uses;
}

/** Parse real syntax nodes, not a regex over code samples, comments or front matter. */
function collectResourceUses(markdown: string): ResourceUse[] {
  const processor = unified().use(remarkParse).use(remarkGfm).use(remarkMath)
    .use(remarkFrontmatter, ['yaml', 'toml']).freeze();
  // micromark strips a leading BOM before assigning offsets. Retain that BOM
  // in document.md, but parse/slice a consistently BOM-free view and rebase.
  const bomOffset = markdown.startsWith('\uFEFF') ? 1 : 0;
  markdown = markdown.slice(bomOffset);
  const tree = processor.parse(markdown);
  const events = postprocess(parse({ extensions: processor.data('micromarkExtensions') || [] })
    .document().write(preprocess()(markdown, undefined, true)));
  const destinations: Destination[] = [];
  for (const [kind, token] of events) {
    if (kind === 'enter' && (token.type === 'resourceDestinationString' || token.type === 'definitionDestinationString')) {
      destinations.push({ start: token.start.offset, end: token.end.offset });
    }
  }

  destinations.sort((a, b) => a.start - b.start);

  const definitions = new Map<string, Definition>();
  walk(tree, (node) => {
    if (node.type === 'definition' && !definitions.has(node.identifier)) definitions.set(node.identifier, node);
  });
  const targets = new Map<Definition, boolean>();
  const uses: ResourceUse[] = [];
  function add(node: Nodes & { url: string }, image: boolean): void {
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    if (start === undefined || end === undefined) return;
    // A link label can contain an image; its own destination comes last.
    let low = 0;
    let high = destinations.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (destinations[middle].start < end) low = middle + 1;
      else high = middle;
    }
    const candidate = destinations[low - 1];
    const target = candidate && candidate.start >= start && candidate.end <= end ? candidate : undefined;
    if (!target) {
      if (image) throw new Error('图片地址为空 / Empty image destination');
      return;
    }
    uses.push({ source: node.url, image, target });
  }
  walk(tree, (node) => {
    if (node.type === 'image') add(node, true);
    if (node.type === 'link' && (localDestination(node.url) || /^file:\/\//i.test(node.url))) add(node, false);
    if (node.type === 'imageReference' || node.type === 'linkReference') {
      const definition = definitions.get(node.identifier);
      if (definition) targets.set(definition, Boolean(targets.get(definition)) || node.type === 'imageReference');
    }
    if (node.type === 'html' && node.position?.start.offset !== undefined && node.position.end.offset !== undefined) {
      const offset = node.position.start.offset;
      uses.push(...htmlImages(markdown.slice(offset, node.position.end.offset), offset));
    }
  });
  for (const [definition, image] of targets) {
    if (image || localDestination(definition.url) || /^file:\/\//i.test(definition.url)) add(definition, image);
  }
  return uses.map((use) => ({
    ...use,
    target: { start: use.target.start + bomOffset, end: use.target.end + bomOffset },
  })).sort((a, b) => a.target.start - b.target.start);
}

function resolveResource(source: string, sourceFilePath?: string | null): { key: string; suffix: string } {
  // Protocol-relative web URLs must never fall through to Windows UNC/SMB.
  if (source.startsWith('//')) source = `https:${source}`;
  if (/^\\\\/.test(source)) throw new Error('不支持网络共享资源 / Network share resources are not supported');
  if (/^(?:https?:|blob:)/i.test(source)) {
    const url = new URL(source);
    if (url.username || url.password) throw new Error('不支持带凭据的图片 URL / Image URL credentials are not supported');
    const suffix = url.hash;
    url.hash = '';
    return { key: url.href, suffix };
  }
  if (/^data:/i.test(source)) return { key: source, suffix: '' };
  if (!localDestination(source) && !/^file:\/\//i.test(source)) {
    throw new Error('不支持的资源协议 / Unsupported resource protocol');
  }
  const resolved = resolveDocumentLink(source.replace(/%(?![\da-f]{2})/gi, '%25'), sourceFilePath);
  if (!resolved) throw new Error('无法定位资源 / Cannot resolve resource');
  if (resolved.path.replace(/\\/g, '/').startsWith('//')) {
    throw new Error('不支持网络共享资源 / Network share resources are not supported');
  }
  return { key: resolved.path, suffix: resolved.anchor ? `#${resolved.anchor}` : '' };
}

function decodeDataUrl(source: string): XmdResourceData {
  const match = /^data:([^,]*),(.*)$/is.exec(source);
  if (!match) throw new Error('无效的 data URL / Invalid data URL');
  const mediaType = match[1].split(';')[0].toLowerCase();
  const payload = match[2];
  if (payload.length > MAX_XMD_RESOURCE_BYTES * 4) throw new Error('资源超过 32 MiB / Resource exceeds 32 MiB');
  if (/;base64$/i.test(match[1])) {
    const binary = atob(decodeURIComponent(payload).replace(/\s/g, ''));
    return { bytes: Uint8Array.from(binary, (character) => character.charCodeAt(0)), mediaType };
  }
  const bytes: number[] = [];
  for (let index = 0; index < payload.length;) {
    if (payload[index] === '%') {
      const hex = payload.slice(index + 1, index + 3);
      if (!/^[\da-f]{2}$/i.test(hex)) throw new Error('无效的 data URL 编码 / Invalid data URL encoding');
      bytes.push(parseInt(hex, 16));
      index += 3;
    } else {
      const character = String.fromCodePoint(payload.codePointAt(index)!);
      bytes.push(...new TextEncoder().encode(character));
      index += character.length;
    }
    if (bytes.length > MAX_XMD_RESOURCE_BYTES) throw new Error('资源超过 32 MiB / Resource exceeds 32 MiB');
  }
  return { bytes: new Uint8Array(bytes), mediaType };
}

async function readWebResource(source: string): Promise<XmdResourceData> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(source, {
      credentials: 'omit', referrerPolicy: 'no-referrer', signal: controller.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    if (Number(response.headers.get('content-length')) > MAX_XMD_RESOURCE_BYTES) {
      throw new Error('资源超过 32 MiB / Resource exceeds 32 MiB');
    }
    const chunks: Uint8Array[] = [];
    let size = 0;
    const reader = response.body?.getReader();
    if (!reader) throw new Error('无法读取资源响应 / Cannot read resource response');
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MAX_XMD_RESOURCE_BYTES) {
        await reader.cancel();
        throw new Error('资源超过 32 MiB / Resource exceeds 32 MiB');
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    return { bytes, mediaType: response.headers.get('content-type') || undefined };
  } finally {
    clearTimeout(timeout);
  }
}

async function loadResource(source: string): Promise<XmdResourceData> {
  if (/^data:/i.test(source)) return decodeDataUrl(source);
  if (/^https?:/i.test(source) && isTauri()) {
    const response = await fetchXmdImage(source);
    return { bytes: response.data, mediaType: response.contentType };
  }
  if (/^(?:https?:|blob:)/i.test(source)) return readWebResource(source);
  if (!isTauri()) throw new Error('浏览器无法读取本地附件，请使用桌面版 / Local resources require the desktop app');
  return { bytes: await readXmdResource(source) };
}

/**
 * XMD v1 is a ZIP with manifest.json, document.md and assets/. It preserves the
 * source text except for resource destinations; no input document is mutated.
 * Missing resources fail the export instead of producing a silently broken pack.
 */
export async function exportMarkdownToXmd(
  markdown: string,
  title: string,
  options: XmdExportOptions = {}
): Promise<Uint8Array> {
  const zip = new JSZip();
  const manifest: XmdManifest = { format: 'xmd', version: XMD_VERSION, entry: 'document.md', title, resources: [] };
  const resources = new Map<string, { path: string; mediaType: string }>();
  const edits = new Map<number, { end: number; value: string }>();
  const attributes = new Map<number, { target: Destination; value: string; edits: { start: number; end: number; value: string }[] }>();
  let totalBytes = new TextEncoder().encode(markdown).length;
  if (totalBytes > MAX_XMD_TOTAL_BYTES) throw new Error('文档超过 128 MiB / Document exceeds 128 MiB');

  for (const use of collectResourceUses(markdown)) {
    try {
      if (!use.source || use.source.startsWith('#')) {
        if (use.image) throw new Error('图片地址为空或仅为锚点 / Image destination is empty or anchor-only');
        continue;
      }
      const { key, suffix } = resolveResource(use.source, options.sourceFilePath);
      let resource = resources.get(key);
      if (!resource) {
        if (resources.size >= MAX_XMD_RESOURCES) throw new Error('资源数量超过 2048 / More than 2048 resources');
        const data = await (options.loadResource || loadResource)(key);
        if (data.bytes.length > MAX_XMD_RESOURCE_BYTES) throw new Error('资源超过 32 MiB / Resource exceeds 32 MiB');
        totalBytes += data.bytes.length;
        if (totalBytes > MAX_XMD_TOTAL_BYTES) throw new Error('资源总大小超过 128 MiB / Package content exceeds 128 MiB');
        const mediaType = data.mediaType?.split(';')[0].trim().toLowerCase() || mediaTypeForSource(key);
        const extension = EXTENSION_BY_MIME[mediaType] || extensionForSource(key) || 'bin';
        const path = `assets/${String(resources.size + 1).padStart(4, '0')}.${extension}`;
        resource = { path, mediaType };
        resources.set(key, resource);
        zip.file(path, data.bytes);
        manifest.resources.push({ path, mediaType, size: data.bytes.length });
      }
      if (use.image && !resource.mediaType.startsWith('image/')) {
        throw new Error('资源不是可识别的图片 / Resource is not a recognized image');
      }
      // URL fragments can contain escaped Markdown delimiters in the source.
      // Percent-encode them before reinserting a decoded URL into Markdown or
      // HTML; this also keeps reference definitions and srcset values valid.
      const value = resource.path + suffix.replace(/[()<>\\\s"']/g,
        (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
      if (use.attribute) {
        let attribute = attributes.get(use.target.start);
        if (!attribute) {
          attribute = { target: use.target, value: use.attribute.value, edits: [] };
          attributes.set(use.target.start, attribute);
        }
        attribute.edits.push({ start: use.attribute.start, end: use.attribute.end, value });
      } else {
        edits.set(use.target.start, { end: use.target.end, value });
      }
    } catch (error) {
      const description = error instanceof Error ? error.message : String(error);
      const source = use.source.length > 160 ? `${use.source.slice(0, 100)}…` : use.source;
      throw new Error(`无法打包资源 / Unable to package resource "${source}": ${description}`, { cause: error });
    }
  }
  for (const { target, value, edits: attributeEdits } of attributes.values()) {
    let rewritten = value;
    for (const edit of attributeEdits.sort((a, b) => b.start - a.start)) {
      rewritten = rewritten.slice(0, edit.start) + edit.value + rewritten.slice(edit.end);
    }
    const name = markdown.slice(target.start, target.end).split(/[\s=]/)[0];
    edits.set(target.start, { end: target.end, value: `${name}="${rewritten.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"` });
  }
  // Build once instead of copying the entire document for every image (which
  // becomes quadratic for long documents with thousands of references).
  const pieces: string[] = [];
  let cursor = 0;
  for (const [start, edit] of [...edits].sort(([a], [b]) => a - b)) {
    pieces.push(markdown.slice(cursor, start), edit.value);
    cursor = edit.end;
  }
  pieces.push(markdown.slice(cursor));
  zip.file('document.md', pieces.join(''));
  zip.file('manifest.json', JSON.stringify(manifest, null, 2) + '\n');
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 6 } });
}
