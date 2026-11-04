import { resolveDocumentLink } from '@/lib/documentLinks';

/**
 * Resolves an image destination to a local file path when the preview needs to
 * read bytes through the native command. Remote and embedded images are left
 * to the browser unchanged.
 */
export function resolveLocalImagePath(
  src: string | undefined,
  sourcePath?: string | null
): string | null {
  if (!src) return null;
  if (/^(?:https?:|data:|blob:|asset:|about:)/i.test(src)) return null;
  if (src.startsWith('#')) return null;

  try {
    return resolveDocumentLink(src, sourcePath)?.path || null;
  } catch {
    // Unsaved/browser documents cannot resolve relative local paths.
    return null;
  }
}
