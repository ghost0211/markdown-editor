import JSZip from 'jszip';
import { resolveDocumentLink } from '@/lib/documentLinks';
import { isTauri, readXmdResource, fetchXmdImage } from '@/lib/native';
import {
  createXmdExportCache,
  type CachedXmdResource,
  type XmdExportCache,
  type XmdExportCacheStats,
} from '@/lib/export/xmdExportCache';
import {
  isLocalDestination,
  isPackagedLinkDestination,
  mediaTypeForPackagePath,
  scanXmdReferences,
  XMD_ASSET_DIRECTORY,
  XMD_DOCUMENT_FILE,
  XMD_MANIFEST_FILE,
  XMD_VERSION,
  type XmdManifest,
  type XmdReference,
  type XmdSourceSpan,
} from '@/lib/xmdPackage';

export { XMD_VERSION, type XmdManifest, type XmdManifestResource } from '@/lib/xmdPackage';
export { DEFAULT_XMD_EXPORT_CACHE_BYTES, type XmdExportCache, type XmdExportCacheStats } from '@/lib/export/xmdExportCache';
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
  /**
   * Package cache used to reuse already-compressed `data:` assets. Defaults to
   * the shared bounded cache; pass `null` to disable it.
   */
  cache?: XmdExportCache | null;
  /** Document bucket for cache eviction; defaults to `sourceFilePath`. */
  cacheScope?: string;
}

/** Shared cache backing ordinary saves/exports. Callers may pass their own. */
const sharedXmdExportCache = createXmdExportCache();

/**
 * Drops cached XMD packages for one document (or all documents when `scope` is
 * omitted). Useful when a tab is closed or its resources were replaced.
 */
export function clearXmdExportCache(scope?: string): void {
  if (scope === undefined) {
    sharedXmdExportCache.clear();
  } else {
    sharedXmdExportCache.deleteScope(scope);
  }
}

/** Diagnostics for the shared cache (never contains package bytes). */
export function getXmdExportCacheStats(): XmdExportCacheStats {
  return sharedXmdExportCache.stats;
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
  'application/pdf': 'pdf',
  'application/zip': 'zip',
  'application/json': 'json',
  'text/plain': 'txt',
  'text/markdown': 'md',
  'audio/mpeg': 'mp3',
  'video/mp4': 'mp4',
};

/**
 * Portable extension for an attachment MIME type. Re-exported `data:` URLs
 * (for example an imported PDF) carry no path, so only the MIME type can name
 * the asset; unknown/opaque types fall back to `.bin`.
 */
function extensionForMediaType(mediaType: string): string | undefined {
  const known = EXTENSION_BY_MIME[mediaType];
  if (known) return known;
  const subtype = mediaType.split('/')[1]?.split(';')[0]?.trim().toLowerCase();
  if (!subtype || subtype === 'octet-stream') return undefined;
  const cleaned = subtype.replace(/^x-/, '').replace(/^vnd\.[^.]*\./, '').split('+')[0];
  return /^[a-z\d]{1,10}$/.test(cleaned) ? cleaned : undefined;
}

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
  return mediaTypeForPackagePath(`resource.${extension || 'bin'}`);
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
  // An imported attachment/image is a `data:` URL that may carry a `#fragment`.
  // The fragment is not part of the payload, so split it before decoding and
  // carry it over to the rewritten package path.
  if (/^data:/i.test(source)) {
    const hash = source.indexOf('#');
    return hash === -1
      ? { key: source, suffix: '' }
      : { key: source.slice(0, hash), suffix: source.slice(hash) };
  }
  if (!isLocalDestination(source) && !/^file:\/\//i.test(source)) {
    throw new Error('不支持的资源协议 / Unsupported resource protocol');
  }
  const resolved = resolveDocumentLink(source.replace(/%(?![\da-f]{2})/gi, '%25'), sourceFilePath);
  if (!resolved) throw new Error('无法定位资源 / Cannot resolve resource');
  if (resolved.path.replace(/\\/g, '/').startsWith('//')) {
    throw new Error('不支持网络共享资源 / Network share resources are not supported');
  }
  return { key: resolved.path, suffix: resolved.anchor ? `#${resolved.anchor}` : '' };
}

export function decodeDataUrl(source: string): XmdResourceData {
  const fragment = source.indexOf('#');
  if (fragment !== -1) source = source.slice(0, fragment);
  const match = /^data:([^,]*),(.*)$/is.exec(source);
  if (!match) throw new Error('无效的 data URL / Invalid data URL');
  const mediaType = match[1].split(';')[0].toLowerCase();
  const payload = match[2];
  if (payload.length > MAX_XMD_RESOURCE_BYTES * 4) throw new Error('资源超过 32 MiB / Resource exceeds 32 MiB');
  if (/;base64$/i.test(match[1])) {
    const encoded = decodeURIComponent(payload).replace(/\s/g, '');
    if (encoded.length > Math.ceil(MAX_XMD_RESOURCE_BYTES / 3) * 4) throw new Error('资源超过 32 MiB / Resource exceeds 32 MiB');
    const binary = atob(encoded);
    if (binary.length > MAX_XMD_RESOURCE_BYTES) throw new Error('资源超过 32 MiB / Resource exceeds 32 MiB');
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

function isDataUrlSource(source: string): boolean {
  return /^data:/i.test(source);
}

/** Media type the default `data:` loader will report for this exact source. */
function declaredDataUrlMediaType(source: string): string {
  const header = /^data:([^,]*),/is.exec(source)?.[1];
  return header === undefined ? '' : header.split(';')[0].trim().toLowerCase();
}

/**
 * Cache identity is the ordered list of exact resolved sources. Length
 * prefixes make the key unambiguous even if a source contains separators.
 * Packets are only cached when every source is a `data:` URL, so a changed
 * local/network resource can never be served from this key.
 */
function cacheKeyFor(scope: string, sources: readonly string[]): string {
  const encoded = sources.map((source) => `${source.length}:${source}`).join('|');
  return `xmd-export-v1:deflate-6:${scope.length}:${scope}|${encoded}`;
}

function cachedResourcesMatch(
  sources: readonly string[],
  resources: readonly CachedXmdResource[]
): boolean {
  if (resources.length !== sources.length) return false;
  for (let index = 0; index < sources.length; index++) {
    const resource = resources[index];
    if (!resource || typeof resource.path !== 'string') return false;
    if (!/^assets\/\d{4}\.[a-z\d]+$/.test(resource.path)) return false;
    if (!Number.isInteger(resource.size) || resource.size < 0
      || resource.size > MAX_XMD_RESOURCE_BYTES) return false;
    const mediaType = declaredDataUrlMediaType(sources[index]) || mediaTypeForSource(sources[index]);
    if (resource.mediaType !== mediaType) return false;
  }
  return true;
}

function packageResourceError(source: string, error: unknown): Error {
  const description = error instanceof Error ? error.message : String(error);
  const display = source.length > 160 ? `${source.slice(0, 100)}…` : source;
  return new Error(
    `无法打包资源 / Unable to package resource "${display}": ${description}`,
    { cause: error }
  );
}

/**
 * XMD v1 is a ZIP with manifest.json, document.md and assets/. It preserves the
 * source text except for resource destinations; no input document is mutated.
 * Missing resources fail the export instead of producing a silently broken pack.
 *
 * When every resource is an embedded `data:` URL, the generated package is kept
 * in a bounded LRU cache. A subsequent save with the same sources loads that
 * ZIP again and lets JSZip write the already-compressed `assets/*` entries
 * unchanged, avoiding a full decode + DEFLATE pass for every embedded image.
 * Local files and HTTP images never enter the cache: they are re-read on every
 * export so external changes are always reflected.
 */
export async function exportMarkdownToXmd(
  markdown: string,
  title: string,
  options: XmdExportOptions = {}
): Promise<Uint8Array> {
  const manifest: XmdManifest = {
    format: 'xmd', version: XMD_VERSION, entry: XMD_DOCUMENT_FILE, title, resources: [],
  };
  const edits = new Map<number, { end: number; value: string }>();
  const attributes = new Map<number, { target: XmdSourceSpan; value: string; edits: { from: number; to: number; value: string }[] }>();
  const documentBytes = new TextEncoder().encode(markdown).length;
  let totalBytes = documentBytes;
  if (totalBytes > MAX_XMD_TOTAL_BYTES) throw new Error('文档超过 128 MiB / Document exceeds 128 MiB');

  const scan = scanXmdReferences(markdown);
  if (scan.hasEmptyImage) throw new Error('图片地址为空 / Empty image destination');

  // Resolve first, load later: the cache is keyed by the exact ordered sources
  // and a hit can skip byte loading entirely.
  const resolvedUses: (XmdReference & { key: string; suffix: string })[] = [];
  const sources: string[] = [];
  const seenSources = new Set<string>();
  for (const use of scan.references) {
    // Anchors stay inline; only destinations the package can own are collected.
    // `data:` links are included so a re-export of an imported bundle keeps
    // attachment bytes in `assets/` instead of growing document.md.
    if (!use.source || use.source.startsWith('#')) {
      if (use.image) throw new Error('图片地址为空或仅为锚点 / Image destination is empty or anchor-only');
      continue;
    }
    if (!use.image && !isPackagedLinkDestination(use.source)) continue;
    try {
      const { key, suffix } = resolveResource(use.source, options.sourceFilePath);
      if (!seenSources.has(key)) {
        if (sources.length >= MAX_XMD_RESOURCES) throw new Error('资源数量超过 2048 / More than 2048 resources');
        seenSources.add(key);
        sources.push(key);
      }
      resolvedUses.push({ ...use, key, suffix });
    } catch (error) {
      throw packageResourceError(use.source, error);
    }
  }

  const cache = options.cache === undefined ? sharedXmdExportCache : options.cache;
  const cacheScope = options.cacheScope ?? options.sourceFilePath ?? 'untitled';
  // The key embeds every full data: URL, so a source set whose keys alone would
  // exceed the budget can never be cached: skip building that huge temporary
  // string instead of allocating it and rejecting the entry afterwards.
  const sourceKeyBytes = sources.reduce((sum, source) => sum + source.length * 2, 0);
  const cacheKey = cache && !options.loadResource && sources.length > 0
    && sources.every(isDataUrlSource)
    && sourceKeyBytes + cacheScope.length * 2 + 128 <= cache.maxBytes
    ? cacheKeyFor(cacheScope, sources)
    : null;

  let zip: JSZip | null = null;
  let resources: Map<string, CachedXmdResource> | null = null;

  if (cache && cacheKey) {
    const cached = cache.get(cacheKey);
    if (cached && cachedResourcesMatch(sources, cached.resources)) {
      const cachedContentBytes = cached.resources.reduce((sum, resource) => sum + resource.size, 0);
      if (totalBytes + cachedContentBytes > MAX_XMD_TOTAL_BYTES) {
        throw new Error('资源总大小超过 128 MiB / Package content exceeds 128 MiB');
      }
      try {
        // JSZip reads the central directory lazily and keeps each entry's
        // compressed bytes, so generateAsync can copy them instead of
        // recompressing. The document and manifest entries are replaced below.
        zip = await JSZip.loadAsync(cached.bytes);
        totalBytes += cachedContentBytes;
        resources = new Map(sources.map((source, index) => [source, cached.resources[index]]));
      } catch {
        // A corrupt/incompatible cached package must never break a save.
        cache.delete(cacheKey);
        zip = null;
        resources = null;
        totalBytes = documentBytes;
      }
    } else if (cached) {
      cache.delete(cacheKey);
    }
  }

  if (!zip || !resources) {
    zip = new JSZip();
    const loaded = new Map<string, CachedXmdResource>();
    const loader = options.loadResource || loadResource;
    for (const source of sources) {
      try {
        const data = await loader(source);
        if (data.bytes.length > MAX_XMD_RESOURCE_BYTES) throw new Error('资源超过 32 MiB / Resource exceeds 32 MiB');
        totalBytes += data.bytes.length;
        if (totalBytes > MAX_XMD_TOTAL_BYTES) throw new Error('资源总大小超过 128 MiB / Package content exceeds 128 MiB');
        const mediaType = data.mediaType?.split(';')[0].trim().toLowerCase() || mediaTypeForSource(source);
        const extension = extensionForMediaType(mediaType) || extensionForSource(source) || 'bin';
        const path = `${XMD_ASSET_DIRECTORY}/${String(loaded.size + 1).padStart(4, '0')}.${extension}`;
        loaded.set(source, { path, mediaType, size: data.bytes.length });
        zip.file(path, data.bytes);
      } catch (error) {
        throw packageResourceError(source, error);
      }
    }
    resources = loaded;
  }

  manifest.resources = sources.map((source) => {
    const resource = resources!.get(source)!;
    return { path: resource.path, mediaType: resource.mediaType, size: resource.size };
  });

  for (const use of resolvedUses) {
    try {
      const resource = resources.get(use.key)!;
      if (use.image && !resource.mediaType.startsWith('image/')) {
        throw new Error('资源不是可识别的图片 / Resource is not a recognized image');
      }
      // URL fragments can contain escaped Markdown delimiters in the source.
      // Percent-encode them before reinserting a decoded URL into Markdown or
      // HTML; this also keeps reference definitions and srcset values valid.
      const value = resource.path + use.suffix.replace(/[()<>\\\s"']/g,
        (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
      if (use.html) {
        let attribute = attributes.get(use.target.from);
        if (!attribute) {
          attribute = { target: use.target, value: use.html.value, edits: [] };
          attributes.set(use.target.from, attribute);
        }
        attribute.edits.push({ from: use.html.from, to: use.html.to, value });
      } else {
        edits.set(use.target.from, { end: use.target.to, value });
      }
    } catch (error) {
      throw packageResourceError(use.source, error);
    }
  }
  for (const { target, value, edits: attributeEdits } of attributes.values()) {
    let rewritten = value;
    for (const edit of attributeEdits.sort((a, b) => b.from - a.from)) {
      rewritten = rewritten.slice(0, edit.from) + edit.value + rewritten.slice(edit.to);
    }
    const name = markdown.slice(target.from, target.to).split(/[\s=]/)[0];
    edits.set(target.from, {
      end: target.to,
      value: `${name}="${rewritten.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"`,
    });
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
  zip.file(XMD_DOCUMENT_FILE, pieces.join(''));
  zip.file(XMD_MANIFEST_FILE, JSON.stringify(manifest, null, 2) + '\n');
  const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 6 } });
  if (cache && cacheKey) {
    cache.set(cacheKey, bytes, sources.map((source) => {
      const resource = resources!.get(source)!;
      return { path: resource.path, mediaType: resource.mediaType, size: resource.size };
    }), cacheScope);
  }
  return bytes;
}
