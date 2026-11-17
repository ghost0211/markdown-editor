import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkFrontmatter from 'remark-frontmatter';
import remarkMath from 'remark-math';
import { parse, postprocess, preprocess } from 'micromark';
import { parseFragment, type DefaultTreeAdapterMap } from 'parse5';
import type { Definition, Nodes } from 'mdast';
import { mimeTypeForPath } from '@/lib/export/embedImages';

export const XMD_VERSION = 1;
export const XMD_MANIFEST_FILE = 'manifest.json';
export const XMD_DOCUMENT_FILE = 'document.md';
export const XMD_ASSET_DIRECTORY = 'assets';

export interface XmdManifestResource {
  path: string;
  mediaType: string;
  size: number;
}

export interface XmdManifest {
  format: 'xmd';
  version: 1;
  entry: 'document.md';
  title: string;
  resources: XmdManifestResource[];
}

export interface XmdSourceSpan {
  from: number;
  to: number;
}

/**
 * One URL inside an HTML `src`/`srcset` attribute. The whole attribute is
 * replaced because srcset holds several candidates that must be rewritten
 * together; `from`/`to` locate this candidate inside the decoded `value`.
 */
export interface XmdHtmlReference {
  name: 'src' | 'srcset';
  target: XmdSourceSpan;
  value: string;
  from: number;
  to: number;
}

export interface XmdReference {
  /** Destination exactly as written, angle brackets included for `<...>`. */
  source: string;
  image: boolean;
  /** Markdown destination span, or the HTML attribute span. */
  target: XmdSourceSpan;
  html?: XmdHtmlReference;
  /** Body locations of reference-style uses; the destination itself lives in a definition. */
  usageLines?: number[];
}

export interface XmdReferenceScan {
  references: XmdReference[];
  /** An image without any destination token, e.g. `![alt]()`. */
  hasEmptyImage: boolean;
}

interface Destination {
  start: number;
  end: number;
}

/** Removes the optional Markdown angle-bracket destination delimiters. */
export function unwrapXmdDestination(source: string): string {
  return source.startsWith('<') && source.endsWith('>') ? source.slice(1, -1) : source;
}

/** A relative path or drive-absolute path, i.e. not an anchored or scheme URL. */
export function isLocalDestination(source: string): boolean {
  return !source.startsWith('#') && !/^(?![a-z]:[/\\])[a-z][a-z\d+.-]*:/i.test(source);
}

/**
 * Links the XMD package can carry as attachments: local paths, `file://`
 * URLs and already-embedded `data:` URLs (re-embedded so a later export keeps
 * them inside `assets/` instead of growing `document.md`).
 */
export function isPackagedLinkDestination(source: string): boolean {
  return /^data:/i.test(source) || /^file:\/\//i.test(source) || isLocalDestination(source);
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

function htmlReferences(raw: string, offset: number): XmdReference[] {
  const references: XmdReference[] = [];
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
        const target = { from: offset + location.startOffset, to: offset + location.endOffset };
        const spans = attribute.name === 'srcset'
          ? srcsetUrls(attribute.value)
          : [{ source: attribute.value, start: 0, end: attribute.value.length }];
        for (const span of spans) {
          references.push({
            source: span.source,
            image: true,
            target,
            html: {
              name: attribute.name === 'srcset' ? 'srcset' : 'src',
              target, value: attribute.value, from: span.start, to: span.end,
            },
          });
        }
      }
    }
    if ('childNodes' in node) for (const child of node.childNodes) visit(child);
  }
  visit(fragment);
  return references;
}

/**
 * Finds every resource destination in a Markdown document using the real
 * syntax tree instead of a regex, so code samples, HTML comments, math and
 * front matter are never rewritten. Spans use the original document offsets
 * (a leading BOM is preserved and rebased).
 */
export function scanXmdReferences(markdown: string): XmdReferenceScan {
  const processor = unified().use(remarkParse).use(remarkGfm).use(remarkMath)
    .use(remarkFrontmatter, ['yaml', 'toml']).freeze();
  // micromark strips a leading BOM before assigning offsets. Retain that BOM
  // in the document, but parse/slice a consistently BOM-free view and rebase.
  const bomOffset = markdown.startsWith('\uFEFF') ? 1 : 0;
  const body = markdown.slice(bomOffset);
  const tree = processor.parse(body);
  const events = postprocess(parse({ extensions: processor.data('micromarkExtensions') || [] })
    .document().write(preprocess()(body, undefined, true)));
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

  const targets = new Map<Definition, { image: boolean; usageLines: number[] }>();
  const references: XmdReference[] = [];
  let hasEmptyImage = false;

  function add(node: Nodes & { url: string }, image: boolean, usageLines?: number[]): void {
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
      if (image) hasEmptyImage = true;
      return;
    }
    references.push({ source: node.url, image, target: { from: target.start, to: target.end }, usageLines });
  }

  walk(tree, (node) => {
    if (node.type === 'image') add(node, true);
    if (node.type === 'link') add(node, false);
    if (node.type === 'imageReference' || node.type === 'linkReference') {
      const definition = definitions.get(node.identifier);
      if (definition) {
        const entry = targets.get(definition) || { image: false, usageLines: [] };
        entry.image ||= node.type === 'imageReference';
        if (node.position) entry.usageLines.push(node.position.start.line);
        targets.set(definition, entry);
      }
    }
    if (node.type === 'html' && node.position?.start.offset !== undefined && node.position.end.offset !== undefined) {
      const offset = node.position.start.offset;
      references.push(...htmlReferences(body.slice(offset, node.position.end.offset), offset));
    }
  });

  for (const [definition, { image, usageLines }] of targets) add(definition, image, usageLines);

  return {
    hasEmptyImage,
    references: references.map((reference) => {
      const target = { from: reference.target.from + bomOffset, to: reference.target.to + bomOffset };
      return {
        ...reference,
        target,
        html: reference.html ? { ...reference.html, target } : undefined,
      };
    }).sort((a, b) => a.target.from - b.target.from),
  };
}

/**
 * Media type for an asset path. Images come from the shared extension table;
 * common attachment types are added explicitly because a bundled PDF or Office
 * document must keep a meaningful type (and therefore a useful extension on
 * re-export). Unknown types fall back to `application/octet-stream`.
 */
const MIME_BY_EXTENSION: Record<string, string> = {
  pdf: 'application/pdf',
  zip: 'application/zip',
  json: 'application/json',
  txt: 'text/plain',
  md: 'text/markdown',
  markdown: 'text/markdown',
  csv: 'text/csv',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  mp4: 'video/mp4',
  webm: 'video/webm',
};

export function mediaTypeForPackagePath(path: string): string {
  const extension = path.split(/[?#]/)[0].split('.').pop()?.toLowerCase() ?? '';
  return MIME_BY_EXTENSION[extension] ?? mimeTypeForPath(path);
}

/**
 * Validates a package entry name and returns it with `/` separators. Rejects
 * absolute paths, drive letters, `.`/`..` segments and empty segments so a
 * malicious archive cannot escape its own directory.
 */export function normalizePackageEntryPath(name: string): string | null {
  const normalized = name.replace(/\\/g, '/');
  if (!normalized || normalized.startsWith('/') || /^[a-zA-Z]:/.test(normalized)) return null;
  const segments = normalized.split('/');
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) return null;
  return normalized;
}
