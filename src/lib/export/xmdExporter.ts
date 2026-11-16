import JSZip from 'jszip';
import { resolveDocumentLink } from '@/lib/documentLinks';
import { isTauri, readXmdResource, fetchXmdImage } from '@/lib/native';
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
  type XmdSourceSpan,
} from '@/lib/xmdPackage';

export { XMD_VERSION, type XmdManifest, type XmdManifestResource } from '@/lib/xmdPackage';
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
  const manifest: XmdManifest = {
    format: 'xmd', version: XMD_VERSION, entry: XMD_DOCUMENT_FILE, title, resources: [],
  };
  const resources = new Map<string, { path: string; mediaType: string }>();
  const edits = new Map<number, { end: number; value: string }>();
  const attributes = new Map<number, { target: XmdSourceSpan; value: string; edits: { from: number; to: number; value: string }[] }>();
  let totalBytes = new TextEncoder().encode(markdown).length;
  if (totalBytes > MAX_XMD_TOTAL_BYTES) throw new Error('文档超过 128 MiB / Document exceeds 128 MiB');

  const scan = scanXmdReferences(markdown);
  if (scan.hasEmptyImage) throw new Error('图片地址为空 / Empty image destination');

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
      let resource = resources.get(key);
      if (!resource) {
        if (resources.size >= MAX_XMD_RESOURCES) throw new Error('资源数量超过 2048 / More than 2048 resources');
        const data = await (options.loadResource || loadResource)(key);
        if (data.bytes.length > MAX_XMD_RESOURCE_BYTES) throw new Error('资源超过 32 MiB / Resource exceeds 32 MiB');
        totalBytes += data.bytes.length;
        if (totalBytes > MAX_XMD_TOTAL_BYTES) throw new Error('资源总大小超过 128 MiB / Package content exceeds 128 MiB');
        const mediaType = data.mediaType?.split(';')[0].trim().toLowerCase() || mediaTypeForSource(key);
        const extension = extensionForMediaType(mediaType) || extensionForSource(key) || 'bin';
        const path = `${XMD_ASSET_DIRECTORY}/${String(resources.size + 1).padStart(4, '0')}.${extension}`;
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
      const description = error instanceof Error ? error.message : String(error);
      const source = use.source.length > 160 ? `${use.source.slice(0, 100)}…` : use.source;
      throw new Error(`无法打包资源 / Unable to package resource "${source}": ${description}`, { cause: error });
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
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 6 } });
}
