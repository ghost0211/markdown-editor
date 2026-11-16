import { bytesToBase64 } from '@/lib/export/embedImages';
import {
  mediaTypeForPackagePath,
  normalizePackageEntryPath,
  scanXmdReferences,
  unwrapXmdDestination,
  XMD_ASSET_DIRECTORY,
  XMD_DOCUMENT_FILE,
  XMD_MANIFEST_FILE,
  XMD_VERSION,
  type XmdManifest,
  type XmdManifestResource,
  type XmdSourceSpan,
} from '@/lib/xmdPackage';

/**
 * Public entry point for the XMD (Markdown + bundled assets) document format.
 *
 * The writer lives in `@/lib/export/xmdExporter`; both sides share the reference
 * scanner and package helpers in `@/lib/xmdPackage`. An XMD bundle is
 * self-contained: importing never extracts to disk, never touches the network
 * and never loads a resource the archive does not own.
 *
 * Reading parses the ZIP central directory itself instead of relying on
 * `JSZip.loadAsync`, which has no decompression cap: entries are inflated
 * through a bounded stream and CRC-checked before a single byte is accepted.
 */

/** Largest `.xmd` file accepted (compressed ZIP); 128 MiB content + ZIP overhead. */
export const MAX_XMD_FILE_BYTES = 136 * 1024 * 1024;
/** A single unpacked asset; mirrors the exporter's per-resource limit. */
export const MAX_XMD_ENTRY_BYTES = 32 * 1024 * 1024;
/** Total unpacked bytes (document + assets); mirrors the exporter's content cap. */
export const MAX_XMD_UNPACKED_BYTES = 128 * 1024 * 1024;
export const MAX_XMD_ENTRIES = 2048;
export const MAX_XMD_MANIFEST_BYTES = 1024 * 1024;

const LOCAL_HEADER_SIGNATURE = 0x04034b50;
const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const ZIP64_LOCATOR_SIGNATURE = 0x07064b50;
const FLAG_ENCRYPTED = 0x0001;
const SUPPORTED_COMPRESSION = new Set([0, 8]);

export interface ImportedXmd {
  /** Markdown source with package assets replaced by `data:` URLs. */
  markdown: string;
  manifest: XmdManifest;
  title: string;
  /** Package-relative asset paths that were inlined. */
  inlined: string[];
}

export interface XmdImportOptions {
  maxEntryBytes?: number;
  maxTotalBytes?: number;
}

interface CentralEntry {
  name: string;
  flags: number;
  method: number;
  crc32: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function truncate(value: string, limit = 120): string {
  return value.length > limit ? `${value.slice(0, limit)}…` : value;
}

let crcTable: Uint32Array | null = null;

function crc32(bytes: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let index = 0; index < 256; index++) {
      let value = index;
      for (let bit = 0; bit < 8; bit++) {
        value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
      }
      crcTable[index] = value >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let index = 0; index < bytes.byteLength; index++) {
    crc = crcTable[(crc ^ bytes[index]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * Reads the end-of-central-directory record and every central-directory entry.
 * This happens before any decompression so declared sizes can be vetted, and
 * the authoritative names let us reject traversal entries that a ZIP library
 * would otherwise silently sanitize.
 */
function readCentralDirectory(bytes: Uint8Array): CentralEntry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const length = bytes.byteLength;
  const minimumEocd = 22;
  if (length < minimumEocd) throw new Error('不是有效的 ZIP 归档 / Not a valid ZIP archive');

  let eocd = -1;
  const firstCandidate = Math.max(0, length - minimumEocd - 0xffff);
  for (let offset = length - minimumEocd; offset >= firstCandidate; offset--) {
    if (view.getUint32(offset, true) === EOCD_SIGNATURE) {
      eocd = offset;
      break;
    }
  }
  if (eocd < 0) throw new Error('不是有效的 ZIP 归档 / Not a valid ZIP archive');

  const diskNumber = view.getUint16(eocd + 4, true);
  const directoryDisk = view.getUint16(eocd + 6, true);
  const entriesOnDisk = view.getUint16(eocd + 8, true);
  const entryCount = view.getUint16(eocd + 10, true);
  const directorySize = view.getUint32(eocd + 12, true);
  const directoryOffset = view.getUint32(eocd + 16, true);

  if (diskNumber !== 0 || directoryDisk !== 0 || entriesOnDisk !== entryCount) {
    throw new Error('不支持分卷 ZIP 归档 / Multi-disk ZIP archives are not supported');
  }
  if (entryCount === 0xffff || directorySize === 0xffffffff || directoryOffset === 0xffffffff
    || (eocd >= 20 && view.getUint32(eocd - 20, true) === ZIP64_LOCATOR_SIGNATURE)) {
    throw new Error('不支持 ZIP64 归档 / ZIP64 archives are not supported');
  }
  if (entryCount > MAX_XMD_ENTRIES) {
    throw new Error(`归档文件过多 / Too many archive entries (limit ${MAX_XMD_ENTRIES})`);
  }
  if (directoryOffset + directorySize > length) {
    throw new Error('中央目录损坏 / Corrupt central directory');
  }

  const decoder = new TextDecoder('utf-8', { fatal: false });
  const entries: CentralEntry[] = [];
  let position = directoryOffset;
  for (let index = 0; index < entryCount; index++) {
    if (position + 46 > length || view.getUint32(position, true) !== CENTRAL_DIRECTORY_SIGNATURE) {
      throw new Error('中央目录损坏 / Corrupt central directory');
    }
    const flags = view.getUint16(position + 8, true);
    const method = view.getUint16(position + 10, true);
    const crc = view.getUint32(position + 16, true);
    const compressedSize = view.getUint32(position + 20, true);
    const uncompressedSize = view.getUint32(position + 24, true);
    const nameLength = view.getUint16(position + 28, true);
    const extraLength = view.getUint16(position + 30, true);
    const commentLength = view.getUint16(position + 32, true);
    const localHeaderOffset = view.getUint32(position + 42, true);
    const nameStart = position + 46;
    const nameEnd = nameStart + nameLength;
    if (nameEnd > length) throw new Error('中央目录损坏 / Corrupt central directory');
    if (flags & FLAG_ENCRYPTED) {
      throw new Error('不支持加密的 XMD 归档 / Encrypted XMD archives are not supported');
    }
    if (!SUPPORTED_COMPRESSION.has(method)) {
      throw new Error(`不支持的压缩方式 / Unsupported compression method: ${method}`);
    }
    entries.push({
      name: decoder.decode(bytes.subarray(nameStart, nameEnd)),
      flags,
      method,
      crc32: crc,
      compressedSize,
      uncompressedSize,
      localHeaderOffset,
    });
    position = nameEnd + extraLength + commentLength;
  }
  return entries;
}

async function inflateDeflateRaw(
  compressed: Uint8Array,
  cap: number,
  path: string
): Promise<Uint8Array> {
  if (typeof DecompressionStream !== 'function' || typeof ReadableStream !== 'function') {
    throw new Error('当前环境不支持解压 deflate / deflate decompression is unavailable');
  }
  let decompressor: DecompressionStream;
  try {
    decompressor = new DecompressionStream('deflate-raw');
  } catch (error) {
    throw new Error('当前环境不支持解压 deflate / deflate decompression is unavailable', { cause: error });
  }
  const source = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(compressed);
      controller.close();
    },
  });
  const reader = source
    // TS models the transform as BufferSource in/out; we feed one Uint8Array.
    .pipeThrough(decompressor as unknown as TransformStream<Uint8Array, Uint8Array>)
    .getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let overflow = false;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      // Cancel the stream the moment the declared size is exceeded, so a
      // lying central directory cannot inflate into unbounded memory.
      if (total > cap) {
        overflow = true;
        await reader.cancel();
        break;
      }
      chunks.push(value);
    }
  } catch (error) {
    throw new Error(`无法解压 ${path} / Cannot extract ${path}: ${describeError(error)}`, { cause: error });
  }
  if (overflow) {
    throw new Error(`资源超过声明大小 / Resource exceeds its declared size: ${path}`);
  }
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

function parseManifest(text: string): XmdManifest {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    throw new Error(`manifest.json 不是有效的 JSON / Invalid manifest JSON: ${describeError(error)}`, { cause: error });
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('manifest.json 格式无效 / Invalid manifest');
  }
  const manifest = raw as Partial<XmdManifest>;
  if (manifest.format !== 'xmd') {
    throw new Error('不是 XMD 文档 / Not an XMD document (manifest.format !== "xmd")');
  }
  const version = typeof manifest.version === 'number' ? manifest.version : XMD_VERSION;
  if (!Number.isInteger(version) || version < 1) {
    throw new Error(`manifest.json 版本无效 / Invalid manifest version: ${String(manifest.version)}`);
  }
  if (version > XMD_VERSION) {
    throw new Error(`不支持的 XMD 版本 / Unsupported XMD version: ${version}`);
  }
  if (manifest.entry !== XMD_DOCUMENT_FILE) {
    throw new Error(`不支持的入口 / Unsupported entry "${String(manifest.entry)}" (expected ${XMD_DOCUMENT_FILE})`);
  }
  if (!Array.isArray(manifest.resources)) {
    throw new Error('manifest.json 缺少资源清单 / Missing manifest resource list');
  }

  const seen = new Set<string>();
  const resources: XmdManifestResource[] = [];
  for (const candidate of manifest.resources) {
    const resource = candidate as Partial<XmdManifestResource> | null;
    const path = resource && typeof resource.path === 'string'
      ? normalizePackageEntryPath(resource.path)
      : null;
    if (!path || !path.startsWith(`${XMD_ASSET_DIRECTORY}/`) || path === XMD_DOCUMENT_FILE || path === XMD_MANIFEST_FILE) {
      throw new Error(`manifest.json 资源路径无效 / Invalid manifest resource path: ${truncate(String(resource?.path))}`);
    }
    const key = path.toLowerCase();
    if (seen.has(key)) {
      throw new Error(`manifest.json 资源重复 / Duplicate manifest resource: ${path}`);
    }
    seen.add(key);
    if (typeof resource?.mediaType !== 'string' || !resource.mediaType.trim()) {
      throw new Error(`manifest.json 缺少媒体类型 / Missing mediaType for ${path}`);
    }
    if (typeof resource?.size !== 'number' || !Number.isInteger(resource.size) || resource.size < 0) {
      throw new Error(`manifest.json 资源大小无效 / Invalid size for ${path}`);
    }
    resources.push({ path, mediaType: resource.mediaType.trim().toLowerCase(), size: resource.size });
  }

  return {
    format: 'xmd',
    version: XMD_VERSION,
    entry: XMD_DOCUMENT_FILE,
    title: typeof manifest.title === 'string' ? manifest.title : '',
    resources,
  };
}

/** Splits `assets/a.png#frag` into a package path and the URL suffix to keep. */
function splitPackageDestination(destination: string): { path: string; suffix: string } | null {
  const separator = destination.search(/[#?]/);
  const rawPath = separator === -1 ? destination : destination.slice(0, separator);
  const suffix = separator === -1 ? '' : destination.slice(separator);
  // `./assets/x.png` is equivalent to `assets/x.png`; a leading slash is
  // package-absolute and therefore not owned by the archive.
  const path = normalizePackageEntryPath(rawPath.replace(/^\.\//, ''));
  if (!path || !path.startsWith(`${XMD_ASSET_DIRECTORY}/`)) return null;
  return { path, suffix };
}

/**
 * Imports an XMD v1 archive into editable Markdown.
 *
 * Strict by design: the archive must contain a valid manifest, every entry must
 * be declared, sizes must match, and every image/local attachment in the body
 * must resolve to a declared asset. Anything else throws instead of silently
 * dropping an image or letting the document point outside the package.
 */
export async function importXmdPackage(
  bytes: Uint8Array,
  options: XmdImportOptions = {}
): Promise<ImportedXmd> {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0) {
    throw new Error('不是有效的 XMD 文件 / Not a valid XMD archive');
  }
  if (bytes.byteLength > MAX_XMD_FILE_BYTES) {
    throw new Error('XMD 文件超过 136 MiB / XMD archive exceeds the 136 MiB limit');
  }
  const maxEntryBytes = options.maxEntryBytes ?? MAX_XMD_ENTRY_BYTES;
  const maxTotalBytes = options.maxTotalBytes ?? MAX_XMD_UNPACKED_BYTES;

  // Preflight from the central directory: no decompression has happened yet.
  const centralEntries = readCentralDirectory(bytes);
  const archive = new Map<string, CentralEntry>();
  const seenPaths = new Map<string, string>();
  let declaredTotal = 0;

  for (const entry of centralEntries) {
    // Directory records carry no data and are recreated from paths.
    if (entry.name.endsWith('/')) continue;
    const path = normalizePackageEntryPath(entry.name);
    if (!path) {
      throw new Error(`归档包含不安全的路径 / Archive contains an unsafe path: ${truncate(entry.name)}`);
    }
    const duplicate = seenPaths.get(path.toLowerCase());
    if (duplicate) {
      throw new Error(`归档包含重复路径 / Archive contains a duplicate path: ${duplicate} 与 ${path}`);
    }
    seenPaths.set(path.toLowerCase(), path);

    const isDocument = path === XMD_DOCUMENT_FILE;
    const isManifest = path === XMD_MANIFEST_FILE;
    if (!isDocument && !isManifest && !path.startsWith(`${XMD_ASSET_DIRECTORY}/`)) {
      throw new Error(`归档包含未知文件 / Archive contains an unexpected entry: ${truncate(path)}`);
    }
    if (entry.uncompressedSize > maxEntryBytes) {
      throw new Error(`资源超过 32 MiB / Resource exceeds the per-entry limit: ${path}`);
    }
    declaredTotal += entry.uncompressedSize;
    if (declaredTotal > maxTotalBytes) {
      throw new Error('解压后内容超过 128 MiB / Unpacked content exceeds the 128 MiB limit');
    }
    archive.set(path, entry);
  }

  const documentEntry = archive.get(XMD_DOCUMENT_FILE);
  if (!documentEntry) {
    throw new Error(`XMD 缺少 ${XMD_DOCUMENT_FILE} / Missing ${XMD_DOCUMENT_FILE}`);
  }
  const manifestEntry = archive.get(XMD_MANIFEST_FILE);
  if (!manifestEntry) {
    throw new Error(`XMD 缺少 ${XMD_MANIFEST_FILE} / Missing ${XMD_MANIFEST_FILE}`);
  }
  if (manifestEntry.uncompressedSize > MAX_XMD_MANIFEST_BYTES) {
    throw new Error('manifest.json 过大 / manifest.json is too large');
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder('utf-8', { fatal: false });
  let readBytes = 0;
  const cache = new Map<string, Uint8Array>();

  async function extract(path: string, limit: number): Promise<Uint8Array> {
    const cached = cache.get(path);
    if (cached) return cached;
    const entry = archive.get(path);
    if (!entry) throw new Error(`归档缺少 ${path} / Missing ${path} from the archive`);

    // Local header must agree with the central directory: a mismatch is a
    // name-confusion attempt, not a recoverable inconsistency.
    const header = entry.localHeaderOffset;
    if (header + 30 > bytes.byteLength || view.getUint32(header, true) !== LOCAL_HEADER_SIGNATURE) {
      throw new Error(`本地文件头损坏 / Corrupt local file header: ${path}`);
    }
    const nameLength = view.getUint16(header + 26, true);
    const extraLength = view.getUint16(header + 28, true);
    const localName = decoder.decode(bytes.subarray(header + 30, header + 30 + nameLength));
    if (localName !== entry.name) {
      throw new Error(`归档结构与中央目录不一致 / Archive structure does not match its central directory: ${path}`);
    }
    const dataStart = header + 30 + nameLength + extraLength;
    const dataEnd = dataStart + entry.compressedSize;
    if (dataEnd > bytes.byteLength) {
      throw new Error(`本地文件头损坏 / Corrupt local file header: ${path}`);
    }

    const cap = Math.min(entry.uncompressedSize, limit);
    let data: Uint8Array;
    if (entry.method === 0) {
      if (entry.compressedSize !== entry.uncompressedSize) {
        throw new Error(`资源大小不一致 / Declared size mismatch for ${path}`);
      }
      data = bytes.subarray(dataStart, dataEnd);
    } else {
      data = await inflateDeflateRaw(bytes.subarray(dataStart, dataEnd), cap, path);
    }

    if (data.byteLength !== entry.uncompressedSize) {
      throw new Error(`资源大小不一致 / Declared size mismatch for ${path}`);
    }
    if (data.byteLength > limit) {
      throw new Error(`资源超过 32 MiB / Resource exceeds the per-entry limit: ${path}`);
    }
    if (crc32(data) !== entry.crc32) {
      throw new Error(`XMD 压缩包损坏 / Corrupt XMD archive: CRC 校验失败 (${path})`);
    }
    readBytes += data.byteLength;
    if (readBytes > maxTotalBytes) {
      throw new Error('解压后内容超过 128 MiB / Unpacked content exceeds the 128 MiB limit');
    }
    const owned = data.byteLength === 0 ? data : data.slice();
    cache.set(path, owned);
    return owned;
  }

  // The BOM is part of the document bytes and must survive the round trip
  // (`ignoreBOM` keeps it instead of letting TextDecoder strip it).
  const document = new TextDecoder('utf-8', { fatal: false, ignoreBOM: true })
    .decode(await extract(XMD_DOCUMENT_FILE, maxTotalBytes));
  const manifest = parseManifest(
    decoder.decode(await extract(XMD_MANIFEST_FILE, MAX_XMD_MANIFEST_BYTES))
  );

  // The manifest is the authoritative inventory: no hidden payloads, no gaps.
  const declared = new Map(manifest.resources.map((resource) => [resource.path.toLowerCase(), resource]));
  for (const [path] of archive) {
    if (path === XMD_DOCUMENT_FILE || path === XMD_MANIFEST_FILE) continue;
    if (!declared.has(path.toLowerCase())) {
      throw new Error(`归档包含未声明资源 / Asset is not declared in manifest.json: ${path}`);
    }
  }
  const manifestPaths = new Map<string, string>();
  for (const resource of manifest.resources) {
    const entry = archive.get(resource.path);
    if (!entry) {
      throw new Error(`manifest.json 声明的资源缺失 / Declared asset is missing: ${resource.path}`);
    }
    if (resource.size !== entry.uncompressedSize) {
      throw new Error(`资源大小与清单不一致 / Size mismatch for ${resource.path}`);
    }
    manifestPaths.set(resource.path.toLowerCase(), resource.path);
  }

  const mediaTypeByPath = new Map(manifest.resources.map((resource) => [resource.path.toLowerCase(), resource.mediaType]));

  function resolveDeclared(destination: string): { path: string; suffix: string } | null {
    const split = splitPackageDestination(destination);
    if (!split) return null;
    const candidates = [split.path];
    try {
      const decoded = normalizePackageEntryPath(decodeURIComponent(split.path));
      if (decoded && decoded !== split.path) candidates.push(decoded);
    } catch {
      // A literal `%` is a valid file name character; keep the raw path only.
    }
    for (const candidate of candidates) {
      const declaredPath = manifestPaths.get(candidate.toLowerCase());
      if (declaredPath) return { path: declaredPath, suffix: split.suffix };
    }
    return null;
  }

  const edits = new Map<number, { end: number; value: string }>();
  const attributes = new Map<number, {
    target: XmdSourceSpan;
    value: string;
    edits: { from: number; to: number; value: string }[];
  }>();
  const inlined = new Set<string>();

  function fail(reference: { image: boolean; source: string }, reason: string): never {
    throw new Error(
      `无法打开 XMD / Cannot open XMD: ${reference.image ? '图片' : '附件'} "${truncate(reference.source)}" ${reason}`
    );
  }

  const scan = scanXmdReferences(document);
  if (scan.hasEmptyImage) throw new Error('无法打开 XMD / Cannot open XMD: 图片地址为空 / Empty image destination');

  for (const reference of scan.references) {
    const destination = unwrapXmdDestination(reference.source).trim();
    if (!destination) {
      if (reference.image) fail(reference, '地址为空 / has an empty destination');
      continue;
    }
    // In-page anchors never load a resource.
    if (destination.startsWith('#')) {
      if (reference.image) fail(reference, '仅包含锚点 / is anchor-only');
      continue;
    }
    // `data:` payloads are already inside document.md, so they cannot reach
    // outside the package; re-exports collect them back into `assets/`.
    if (/^data:/i.test(destination)) continue;
    // Session-scoped `blob:` URLs never resolve, so they would just break.
    if (/^blob:/i.test(destination)) {
      fail(reference, '引用了临时的 blob 资源 / references a transient blob URL');
    }
    // A web link is user-initiated navigation, not a bundled resource. An image
    // that lives on the network would silently load (or leak) a request.
    if (/^(?:https?:|mailto:)/i.test(destination)) {
      if (reference.image) {
        fail(reference, '指向包外远程图片 / references a remote image outside the package');
      }
      continue;
    }

    const resolved = resolveDeclared(destination);
    if (!resolved) {
      fail(reference, '未在包内声明 / is not a declared asset of this package');
    }
    const data = await extract(resolved.path, maxEntryBytes);
    const mediaType = mediaTypeByPath.get(resolved.path.toLowerCase())
      || mediaTypeForPackagePath(resolved.path);
    if (reference.image && !mediaType.startsWith('image/')) {
      fail(reference, `不是可识别的图片类型 (${mediaType}) / is not a recognized image`);
    }
    // Base64 never contains spaces, parentheses or quotes, so a bare
    // destination is valid Markdown and HTML for every asset.
    const value = `data:${mediaType};base64,${bytesToBase64(data)}${resolved.suffix}`;
    inlined.add(resolved.path);
    if (reference.html) {
      let attribute = attributes.get(reference.target.from);
      if (!attribute) {
        attribute = { target: reference.target, value: reference.html.value, edits: [] };
        attributes.set(reference.target.from, attribute);
      }
      attribute.edits.push({ from: reference.html.from, to: reference.html.to, value });
    } else {
      edits.set(reference.target.from, { end: reference.target.to, value });
    }
  }

  for (const { target, value, edits: attributeEdits } of attributes.values()) {
    let rewritten = value;
    for (const edit of attributeEdits.sort((a, b) => b.from - a.from)) {
      rewritten = rewritten.slice(0, edit.from) + edit.value + rewritten.slice(edit.to);
    }
    const name = document.slice(target.from, target.to).split(/[\s=]/)[0];
    edits.set(target.from, {
      end: target.to,
      value: `${name}="${rewritten.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"`,
    });
  }

  const pieces: string[] = [];
  let cursor = 0;
  for (const [start, edit] of [...edits].sort(([a], [b]) => a - b)) {
    pieces.push(document.slice(cursor, start), edit.value);
    cursor = edit.end;
  }
  pieces.push(document.slice(cursor));

  return {
    markdown: pieces.join(''),
    manifest,
    title: manifest.title,
    inlined: [...inlined].sort(),
  };
}

/** Imports an XMD archive and returns just the editable Markdown source. */
export async function importXmd(
  bytes: Uint8Array,
  options: XmdImportOptions = {}
): Promise<string> {
  return (await importXmdPackage(bytes, options)).markdown;
}

export {
  XMD_ASSET_DIRECTORY,
  XMD_DOCUMENT_FILE,
  XMD_MANIFEST_FILE,
  XMD_VERSION,
  type XmdManifest,
  type XmdManifestResource,
} from '@/lib/xmdPackage';

/** Whether a file name is an XMD bundle (case-insensitive). */
export function isXmdFileName(name: string | null | undefined): boolean {
  return typeof name === 'string' && /\.xmd$/i.test(name.trim());
}
