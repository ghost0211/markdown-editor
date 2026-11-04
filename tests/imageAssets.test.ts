import { describe, expect, it } from 'vitest';
import {
  createImageAssetName,
  createImageMarkdown,
  filterImageFiles,
  getImageAltFromName,
  getImageAssetDestination,
  getImageExtension,
} from '../src/lib/imageAssets';

const file = (name: string, type: string) => ({ name, type }) as File;

describe('image asset helpers', () => {
  it('recognizes supported images by extension and MIME type', () => {
    expect(getImageExtension(file('photo.JPG', ''))).toBe('jpg');
    expect(getImageExtension(file('clipboard', 'image/png'))).toBe('png');
    expect(getImageExtension(file('notes.txt', 'text/plain'))).toBeNull();
    // SVG is deliberately excluded from clipboard/drop insertion.
    expect(getImageExtension(file('vector.svg', 'image/svg+xml'))).toBeNull();
  });

  it('filters mixed pasted/dropped files', () => {
    const files = [file('a.png', 'image/png'), file('b.md', 'text/markdown')];
    expect(filterImageFiles(files).map((item) => item.name)).toEqual(['a.png']);
  });

  it('creates portable timestamped asset names', () => {
    const name = createImageAssetName(
      file('clipboard', 'image/png'),
      new Date(2026, 10, 4, 8, 9, 10),
      'ABC123'
    );
    expect(name).toBe('pasted-20261104-080910-abc123.png');
  });

  it('writes saved-document images into a sibling assets directory', () => {
    expect(getImageAssetDestination('D:\\docs\\note.md', 'image.png')).toEqual({
      absolutePath: 'D:/docs/assets/image.png',
      markdownPath: 'assets/image.png',
    });
  });

  it('escapes alt text and wraps destinations in angle brackets', () => {
    expect(createImageMarkdown('assets/my image(1).png', 'my [diagram]')).toBe(
      '![my diagram](<assets/my image(1).png>)'
    );
  });

  it('derives a readable alt text with a fallback', () => {
    expect(getImageAltFromName('my-diagram_final.png', 'Image')).toBe('my diagram final');
    expect(getImageAltFromName('.png', 'Image')).toBe('Image');
  });
});
