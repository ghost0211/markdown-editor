import { SETTINGS_BOUNDS } from '@/lib/settings';

/** Dropping a file larger than this is almost certainly not a hand-written document. */
export const MAX_DROPPED_FILE_BYTES = 10 * 1024 * 1024;

export function isMarkdownFileName(name: string): boolean {
  const lower = name.toLowerCase();
  return SETTINGS_BOUNDS.supportedExtensions.some((ext) => lower.endsWith(ext));
}

export function filterMarkdownFiles(files: Iterable<File>): File[] {
  return Array.from(files).filter((file) => isMarkdownFileName(file.name));
}

/** True when an OS drag carries files (as opposed to text or a tab being reordered). */
export function dragCarriesFiles(dataTransfer?: Pick<DataTransfer, 'types'> | null): boolean {
  return Boolean(dataTransfer && Array.from(dataTransfer.types).includes('Files'));
}
