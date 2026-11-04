const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'avif', 'ico']);

const EXTENSION_BY_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/bmp': 'bmp',
  'image/avif': 'avif',
  'image/x-icon': 'ico',
};

export function getImageExtension(file: Pick<File, 'name' | 'type'>): string | null {
  const fromName = file.name.split('.').pop()?.toLowerCase() || '';
  if (file.name.includes('.') && IMAGE_EXTENSIONS.has(fromName)) return fromName;
  return EXTENSION_BY_MIME[file.type.toLowerCase()] || null;
}

export function isSupportedImageFile(file: Pick<File, 'name' | 'type'>): boolean {
  return getImageExtension(file) !== null;
}

export function filterImageFiles(files: Iterable<File>): File[] {
  return Array.from(files).filter(isSupportedImageFile);
}

/** A stable, portable filename for an image copied into `assets/`. */
export function createImageAssetName(
  file: Pick<File, 'name' | 'type'>,
  now = new Date(),
  uniquePart = Math.random().toString(36).slice(2, 8)
): string {
  const extension = getImageExtension(file) || 'png';
  const pad = (value: number) => String(value).padStart(2, '0');
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `pasted-${stamp}-${uniquePart.replace(/[^a-z0-9]/gi, '').toLowerCase() || 'image'}.${extension}`;
}

export function getDocumentDirectory(documentPath: string): string {
  const normalized = documentPath.replace(/\\/g, '/');
  const index = normalized.lastIndexOf('/');
  return index === -1 ? '' : normalized.slice(0, index);
}

export function getImageAssetDestination(documentPath: string, fileName: string): {
  absolutePath: string;
  markdownPath: string;
} {
  const directory = getDocumentDirectory(documentPath);
  return {
    absolutePath: `${directory}/assets/${fileName}`,
    markdownPath: `assets/${fileName}`,
  };
}

export function createImageMarkdown(pathOrDataUrl: string, alt: string): string {
  const safeAlt = alt.replace(/[\[\]\n\r]/g, ' ').replace(/\s+/g, ' ').trim();
  // Wrap destinations in angle brackets so paths containing spaces or
  // parentheses remain valid Markdown.
  return `![${safeAlt}](<${pathOrDataUrl.replace(/>/g, '%3E')}>)`;
}

export function getImageAltFromName(name: string, fallback: string): string {
  const base = name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').trim();
  return base || fallback;
}
