import { describe, expect, it } from 'vitest';
import { resolveLocalImagePath } from '../src/lib/previewImages';

describe('resolveLocalImagePath', () => {
  it('resolves relative and absolute local images against the document', () => {
    expect(resolveLocalImagePath('assets/pasted.png', 'D:/docs/note.md')).toBe(
      'D:/docs/assets/pasted.png'
    );
    expect(resolveLocalImagePath('file:///D:/docs/a.png', null)).toBe('D:/docs/a.png');
  });

  it('leaves remote and embedded images to the browser', () => {
    expect(resolveLocalImagePath('https://example.com/a.png', 'D:/docs/note.md')).toBeNull();
    expect(resolveLocalImagePath('data:image/png;base64,AAAA', null)).toBeNull();
    expect(resolveLocalImagePath('blob:https://example.com/id', null)).toBeNull();
  });

  it('returns null for an unresolvable or empty source', () => {
    expect(resolveLocalImagePath('assets/a.png', null)).toBeNull();
    expect(resolveLocalImagePath('', 'D:/docs/note.md')).toBeNull();
    expect(resolveLocalImagePath(undefined, 'D:/docs/note.md')).toBeNull();
  });
});
