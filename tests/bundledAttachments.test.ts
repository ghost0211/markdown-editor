import { describe, expect, it } from 'vitest';
import { bundledAttachmentBlob } from '../src/lib/bundledAttachments';

describe('bundled XMD attachment downloads', () => {
  it('preserves bytes while forcing a non-executable download MIME', async () => {
    const blob = bundledAttachmentBlob('data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==');
    expect(blob.type).toBe('application/octet-stream');
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(new TextEncoder().encode('<script>alert(1)</script>'));
  });
  it('accepts encoded image bytes and rejects invalid or oversized input', async () => {
    const blob = bundledAttachmentBlob('data:image/png;base64,iVBO\nRw0KGgo=');
    expect(blob.type).toBe('application/octet-stream');
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10));
    expect(() => bundledAttachmentBlob('data:application/pdf,notbase64')).toThrow('Invalid');
    expect(() => bundledAttachmentBlob('https://example.com/file.pdf')).toThrow('Invalid');
    expect(() => bundledAttachmentBlob('data:application/octet-stream;base64,' + 'A'.repeat(33 * 1024 * 1024 * 4))).toThrow('32 MiB');
  });
});
