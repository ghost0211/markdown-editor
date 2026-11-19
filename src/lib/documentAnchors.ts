import type { Element, Root } from 'hast';
import { decodeString } from 'micromark-util-decode-string';
import rehypeKatex from 'rehype-katex';
import rehypeSlug from 'rehype-slug';
import remarkRehype from 'remark-rehype';
import type { QualityIssue, QualityLanguage } from '@/lib/documentQuality';
import { resolveDocumentLink } from '@/lib/documentLinks';
import { buildLineStarts, offsetToLineColumn } from '@/lib/documentSearch';
import { documentStructureParser } from '@/lib/documentStructure';
import { normalizePathKey } from '@/lib/documentUtils';
import { readDocumentOutlineSource } from '@/lib/native';
import { previewHtmlPlugins } from '@/lib/previewHtml';
import { remarkCjkFriendlyEmphasis } from '@/lib/remarkCjkFriendlyEmphasis';
import { isSupportedWorkspaceDocument } from '@/lib/workspace';
import { scanXmdReferences } from '@/lib/xmdPackage';

export interface AnchorHeading { slug: string; text: string }

export interface AnchorRepair {
  from: number;
  to: number;
  expected: string;
  shared: boolean;
  headings: readonly AnchorHeading[];
}

interface AnchorIndex {
  ids: Set<string>;
  headings: AnchorHeading[];
}

const MAX_TARGET_DOCUMENTS = 64;
const MAX_TARGET_TEXT = 12 * 1024 * 1024;
const baseProcessor = documentStructureParser()
  .use(remarkCjkFriendlyEmphasis)
  .use(remarkRehype, { allowDangerousHtml: true });
const markdownProcessor = baseProcessor().use(rehypeKatex).use(rehypeSlug).freeze();
const htmlProcessor = baseProcessor().use(previewHtmlPlugins).use(rehypeKatex).use(rehypeSlug).freeze();

function headingText(node: Element | Element['children'][number]): string {
  if (node.type === 'text') return node.value;
  if (node.type !== 'element' || node.properties.ariaHidden === 'true') return '';
  return node.children.map(headingText).join('');
}

export function indexDocumentAnchors(content: string, renderHtml = false): AnchorIndex {
  const processor = renderHtml ? htmlProcessor : markdownProcessor;
  const tree = processor.runSync(processor.parse(content.replace(/^\uFEFF/, ''))) as Root;
  const ids = new Set<string>();
  const headings: AnchorHeading[] = [];
  function walk(node: Root | Element): void {
    for (const child of node.children) {
      if (child.type !== 'element') continue;
      const id = child.properties.id;
      if (typeof id === 'string') {
        ids.add(id);
        if (/^h[1-6]$/.test(child.tagName) && child.position) {
          headings.push({ slug: id, text: headingText(child).trim() || id });
        }
      }
      walk(child);
    }
  }
  walk(tree);
  return { ids, headings };
}

/** Finds the literal source span of the fragment delimiter, including entities or escapes. */
function fragmentStart(source: string): number {
  const tokens = /\\#|&(?:#[xX][\da-fA-F]+|#\d+|[a-zA-Z][a-zA-Z\d]+);|#/g;
  for (const token of source.matchAll(tokens)) {
    if (token[0] === '#' || decodeString(token[0]) === '#') return token.index;
  }
  return -1;
}

function decodedAnchor(anchor: string): string {
  try { return decodeURIComponent(anchor); } catch { return anchor; }
}

export async function checkDocumentAnchors(
  markdown: string,
  options: {
    sourcePath?: string | null;
    language?: QualityLanguage;
    renderHtml?: boolean;
    readTarget?: (path: string) => Promise<string>;
    cancelled?: () => boolean;
  } = {}
): Promise<QualityIssue[]> {
  const { sourcePath, language, renderHtml, readTarget = readDocumentOutlineSource, cancelled } = options;
  const references = scanXmdReferences(markdown).references.filter((reference) => !reference.image && reference.source.includes('#'));
  if (!references.length) return [];
  const lineStarts = buildLineStarts(markdown);
  const known = new Map<string, AnchorIndex | null>();
  const ownPath = normalizePathKey(sourcePath);
  const issues: QualityIssue[] = [];
  let remaining = MAX_TARGET_TEXT;

  for (const reference of references) {
    if (cancelled?.()) break;
    let path: string | null = null;
    let anchor = reference.source.slice(1);
    if (!reference.source.startsWith('#')) {
      try {
        const destination = resolveDocumentLink(reference.source, sourcePath);
        if (!destination?.anchor || !isSupportedWorkspaceDocument(destination.path) ||
            destination.path.replace(/\\/g, '/').startsWith('//')) continue;
        path = destination.path;
        anchor = destination.anchor;
      } catch { continue; }
    }
    if (!anchor) continue;
    const key = normalizePathKey(path);
    const self = !path || key === ownPath;
    const cacheKey = self ? '' : key;
    if (!known.has(cacheKey)) {
      if (!self && (known.size >= MAX_TARGET_DOCUMENTS || remaining <= 0)) continue;
      let index = null;
      try {
        const target = self ? markdown : await readTarget(path!);
        if (cancelled?.()) break;
        if (self || target.length <= remaining) {
          index = indexDocumentAnchors(target, renderHtml);
          if (!self) remaining -= target.length;
        }
      } catch { /* File availability is checked by the existing resource check. */ }
      known.set(cacheKey, index);
    }
    const index = known.get(cacheKey);
    const id = decodedAnchor(anchor);
    if (!index || index.ids.has(anchor) || index.ids.has(id)) continue;
    const raw = markdown.slice(reference.target.from, reference.target.to);
    const marker = fragmentStart(raw);
    if (marker < 0) continue;
    const from = reference.target.from + marker;
    const position = offsetToLineColumn(markdown, lineStarts, from);
    const line = reference.usageLines?.[0] ?? position.line;
    const column = line === position.line ? position.column : 1;
    const label = id.length > 80 ? id.slice(0, 80) + '…' : id;
    issues.push({
      id: 'anchor-' + from,
      rule: 'link-anchor-missing',
      severity: 'warning',
      line,
      column,
      message: language === 'en-US' ? 'Heading anchor not found: #' + label : '找不到标题锚点：#' + label,
      repair: {
        from,
        to: reference.target.to,
        expected: raw.slice(marker),
        shared: Boolean(reference.usageLines && reference.usageLines.length > 1),
        headings: index.headings,
      },
    });
  }
  return issues;
}

export function repairDocumentAnchor(markdown: string, repair: AnchorRepair, slug: string): string | null {
  if (!slug || !repair.headings.some((item) => item.slug === slug) ||
      markdown.slice(repair.from, repair.to) !== repair.expected) return null;
  const encoded = encodeURIComponent(slug).replace(/[!'()*]/g, (value) =>
    '%' + value.charCodeAt(0).toString(16).toUpperCase()
  );
  return markdown.slice(0, repair.from) + '#' + encoded + markdown.slice(repair.to);
}
