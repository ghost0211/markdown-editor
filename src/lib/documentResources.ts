import { isPackagedLinkDestination, isLocalDestination, mediaTypeForPackagePath, scanXmdReferences, unwrapXmdDestination, type XmdHtmlReference, type XmdSourceSpan } from '@/lib/xmdPackage';
import { resolveDocumentLink } from '@/lib/documentLinks';

export type ResourceLocation = 'embedded' | 'local' | 'remote' | 'transient';
export type ResourceStatus = 'loading' | 'ready' | 'missing' | 'unknown';
export interface ResourceReference { line: number; target: XmdSourceSpan; html?: XmdHtmlReference }
export interface DocumentResource {
  id: string;
  name: string;
  kind: 'image' | 'attachment';
  location: ResourceLocation;
  source: string;
  displayAddress: string;
  localPath?: string;
  mimeType: string;
  referenceCount: number;
  references: ResourceReference[];
  status: ResourceStatus;
  byteLength?: number;
}

const EXTENSIONS: Record<string, string> = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif',
  'image/webp': 'webp', 'image/bmp': 'bmp', 'image/avif': 'avif',
  'image/svg+xml': 'svg', 'image/x-icon': 'ico', 'image/vnd.microsoft.icon': 'ico',
  'image/apng': 'apng', 'image/tiff': 'tiff', 'image/heic': 'heic', 'image/heif': 'heif',
};

/** Keep the actual media type; never save unknown image bytes with a fake .png extension. */
export function convertedImageExtension(mediaType: string): string {
  const extension = EXTENSIONS[mediaType.toLowerCase()];
  if (!extension) throw new Error(`不支持转存此图片类型 / Unsupported image type: ${mediaType}`);
  return extension;
}

function sourceHash(source: string): string {
  // Include every byte: sampling large data URLs can collide for two images
  // that differ only between samples. IDs identify rows, never rewrite targets.
  let first = 2166136261;
  let second = 5381;
  for (let offset = 0; offset < source.length; offset++) {
    first = Math.imul(first ^ source.charCodeAt(offset), 16777619);
    second = Math.imul(second, 33) ^ source.charCodeAt(offset);
  }
  return `${(first >>> 0).toString(36)}-${(second >>> 0).toString(36)}-${source.length.toString(36)}`;
}

function compactAddress(source: string): string {
  if (/^data:/i.test(source)) return source.slice(0, source.indexOf(',') + 1) + '…';
  if (source.length <= 180) return source;
  return `${source.slice(0, 100)}…${source.slice(-60)}`;
}

function resourceName(address: string, localPath: string | undefined, ordinal: number): string {
  if (localPath) return localPath.replace(/\\/g, '/').split('/').pop() || `resource-${ordinal}`;
  const raw = address.split(/[?#]/)[0].replace(/\\/g, '/').split('/').pop() || '';
  try { return decodeURIComponent(raw) || `resource-${ordinal}`; } catch { return raw || `resource-${ordinal}`; }
}

export function embeddedByteLength(source: string): number | undefined {
  const fragment = source.indexOf('#');
  const address = fragment === -1 ? source : source.slice(0, fragment);
  const comma = address.indexOf(',');
  if (comma < 0) return undefined;
  const payload = address.slice(comma + 1);
  if (/;base64$/i.test(address.slice(0, comma))) {
    let encoded: string;
    try { encoded = decodeURIComponent(payload).replace(/\s/g, ''); } catch { return undefined; }
    const padding = encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0;
    return Math.max(0, Math.floor(encoded.length * 3 / 4) - padding);
  }
  let bytes = 0;
  for (let index = 0; index < payload.length;) {
    if (payload[index] === '%') {
      if (!/^[\da-f]{2}$/i.test(payload.slice(index + 1, index + 3))) return undefined;
      bytes++;
      index += 3;
    } else {
      const point = payload.codePointAt(index)!;
      bytes += point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
      index += point > 0xffff ? 2 : 1;
    }
  }
  return bytes;
}

/** Parse real Markdown/HTML syntax and group references to the same source. */
export function scanDocumentResources(markdown: string, sourceFilePath?: string | null): DocumentResource[] {
  const grouped = new Map<string, DocumentResource>();
  let line = 1;
  let lastPosition = 0;
  for (const reference of scanXmdReferences(markdown).references) {
    const originalSource = unwrapXmdDestination(reference.source);
    const source = originalSource.startsWith('//') ? `https:${originalSource}` : originalSource;
    if (!source || source.startsWith('#') || (!reference.image && !isPackagedLinkDestination(source))) continue;
    while (lastPosition < reference.target.from) {
      const newline = markdown.indexOf('\n', lastPosition);
      if (newline < 0 || newline > reference.target.from) break;
      line++;
      lastPosition = newline + 1;
    }
    const embedded = /^data:/i.test(source);
    const transient = /^blob:/i.test(source);
    const remote = /^https?:\/\//i.test(source);
    let localPath: string | undefined;
    if (!embedded && !transient && !remote && (isLocalDestination(source) || /^file:/i.test(source))) {
      try { localPath = resolveDocumentLink(source.replace(/%(?![\da-f]{2})/gi, '%25'), sourceFilePath)?.path || undefined; } catch { /* Report below. */ }
    }
    const mimeType = embedded ? source.slice(5, source.indexOf(',')).split(';')[0].toLowerCase() || 'application/octet-stream'
      : mediaTypeForPackagePath(localPath || source);
    const key = `${reference.image ? 'image' : 'attachment'}:${localPath || source}`;
    let resource = grouped.get(key);
    if (!resource) {
      const ordinal = grouped.size + 1;
      const name = embedded
        ? `embedded-${reference.image ? 'image' : 'resource'}-${ordinal}.${EXTENSIONS[mimeType] || (/^[a-z0-9]+$/i.test(mimeType.split('/')[1] || '') ? mimeType.split('/')[1] : 'bin')}`
        : resourceName(source, localPath, ordinal);
      const location: ResourceLocation = embedded ? 'embedded' : transient ? 'transient' : remote ? 'remote' : 'local';
      resource = {
        id: `${location}-${sourceHash(key)}`,
        name, kind: reference.image ? 'image' : 'attachment', location,
        source, displayAddress: compactAddress(localPath || source), localPath,
        mimeType, referenceCount: 0, references: [],
        status: localPath ? 'loading' : embedded ? 'ready' : location === 'local' ? 'missing' : 'unknown',
        byteLength: embedded ? embeddedByteLength(source) : undefined,
      };
      grouped.set(key, resource);
    }
    const lines = reference.usageLines?.length ? reference.usageLines : [line];
    resource.referenceCount += lines.length;
    for (const usageLine of lines) {
      resource.references.push({ line: usageLine, target: reference.target, html: reference.html });
    }
  }
  return [...grouped.values()].map((resource) => ({
    ...resource, references: resource.references.sort((left, right) => left.line - right.line),
  }));
}

export function formatResourceSize(bytes?: number): string {
  if (bytes === undefined) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

/** Replace only destinations, preserving all surrounding Markdown and HTML. */
export function replaceResourcePaths(markdown: string, resources: DocumentResource[], paths: Map<string, string>): string {
  const edits = new Map<number, { to: number; value: string }>();
  const htmlAttributes = new Map<number, { target: XmdSourceSpan; value: string; changes: { from: number; to: number; value: string }[] }>();
  for (const resource of resources) {
    const path = paths.get(resource.id);
    if (!path) continue;
    for (const reference of resource.references) {
      if (reference.html) {
        let attribute = htmlAttributes.get(reference.target.from);
        if (!attribute) {
          attribute = { target: reference.target, value: reference.html.value, changes: [] };
          htmlAttributes.set(reference.target.from, attribute);
        }
        attribute.changes.push({ from: reference.html.from, to: reference.html.to, value: path });
      } else {
        const escaped = path.replace(/&/g, '&amp;').replace(/</g, '%3C').replace(/>/g, '%3E');
        const bracketed = markdown[reference.target.from - 1] === '<' && markdown[reference.target.to] === '>';
        edits.set(reference.target.from, { to: reference.target.to, value: bracketed ? escaped : `<${escaped}>` });
      }
    }
  }
  for (const { target, value, changes } of htmlAttributes.values()) {
    let rewritten = value;
    for (const change of changes.sort((a, b) => b.from - a.from)) {
      rewritten = rewritten.slice(0, change.from) + change.value + rewritten.slice(change.to);
    }
    const name = markdown.slice(target.from, target.to).split(/[\s=]/)[0];
    edits.set(target.from, { to: target.to, value: `${name}="${rewritten.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"` });
  }
  const pieces: string[] = [];
  let cursor = 0;
  for (const [from, edit] of [...edits].sort(([a], [b]) => a - b)) {
    pieces.push(markdown.slice(cursor, from), edit.value);
    cursor = edit.to;
  }
  pieces.push(markdown.slice(cursor));
  return pieces.join('');
}
