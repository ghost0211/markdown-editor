import type { Element, Root } from 'hast';

const MIME_BY_EXTENSION: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  avif: 'image/avif',
  ico: 'image/x-icon',
  svg: 'image/svg+xml',
};

/** Images larger than this stay referenced instead of bloating the HTML file. */
export const MAX_EMBED_IMAGE_BYTES = 8 * 1024 * 1024;

export function mimeTypeForPath(path: string): string {
  const extension = path.split(/[?#]/)[0].split('.').pop()?.toLowerCase() ?? '';
  return MIME_BY_EXTENSION[extension] ?? 'application/octet-stream';
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function toDataUrl(bytes: Uint8Array, mime: string): string {
  return `data:${mime};base64,${bytesToBase64(bytes)}`;
}

/** Resolves an `<img src>` to a data URL, or null to leave it untouched. */
export type ImageResolver = (src: string) => Promise<string | null>;

function collectImages(node: Root | Element, found: Element[]): void {
  for (const child of node.children) {
    if (child.type !== 'element') continue;
    if (child.tagName === 'img') found.push(child);
    collectImages(child, found);
  }
}

/**
 * rehype plugin (run after sanitizing, which would strip `data:` URLs): replaces
 * image sources with whatever `resolve` returns. A failing image is left as a
 * plain reference so one missing file never aborts the whole export.
 */
export function rehypeEmbedImages(options: { resolve?: ImageResolver } = {}) {
  return async (tree: Root) => {
    const resolve = options.resolve;
    if (!resolve) return;
    const images: Element[] = [];
    collectImages(tree, images);
    await Promise.all(
      images.map(async (image) => {
        const src = image.properties?.src;
        if (typeof src !== 'string' || /^(?:data:|https?:|blob:)/i.test(src)) return;
        try {
          const dataUrl = await resolve(src);
          if (dataUrl) image.properties = { ...image.properties, src: dataUrl };
        } catch {
          // keep the original reference
        }
      })
    );
  };
}

/** Builds a resolver that reads images next to the source document via the native layer. */
export async function createLocalImageResolver(
  sourceFilePath?: string | null
): Promise<ImageResolver | undefined> {
  if (!sourceFilePath) return undefined;
  const [{ resolveLocalImagePath }, { readBinaryFile, isTauri }] = await Promise.all([
    import('@/lib/previewImages'),
    import('@/lib/native'),
  ]);
  if (!isTauri()) return undefined;

  return async (src: string) => {
    const path = resolveLocalImagePath(src, sourceFilePath);
    if (!path) return null;
    const bytes = await readBinaryFile(path);
    if (bytes.length > MAX_EMBED_IMAGE_BYTES) return null;
    return toDataUrl(bytes, mimeTypeForPath(path));
  };
}
