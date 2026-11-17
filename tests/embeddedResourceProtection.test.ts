import { describe, expect, it, vi } from 'vitest';
import { EditorState } from '@codemirror/state';
import { createEmbeddedResourceProtection } from '../src/lib/embeddedResourceProtection';

const payload = 'data:image/png;base64,AAAA';

describe('legacy editor replacement protection', () => {
  it('refuses a replace-all transaction touching inline image or attachment data', async () => {
    const blocked = vi.fn();
    const doc = `AAAA\n\n![a](<${payload}>)\n\n[file](data:application/pdf;base64,AAAA)`;
    const state = EditorState.create({ doc, extensions: [createEmbeddedResourceProtection(blocked)] });
    const from = doc.indexOf('AAAA', 4);
    const transaction = state.update({ changes: [{ from: 0, to: 4, insert: 'BBBB' }, { from, to: from + 4, insert: 'BBBB' }], userEvent: 'input.replace.all' });
    expect(transaction.state.doc.toString()).toBe(doc);
    await Promise.resolve();
    expect(blocked).toHaveBeenCalledOnce();
  });

  it('permits ordinary prose replacement and explicit resource conversion', () => {
    const doc = `text\n\n![a](<${payload}>)`;
    const state = EditorState.create({ doc, extensions: [createEmbeddedResourceProtection()] });
    expect(state.update({ changes: { from: 0, to: 4, insert: 'new' }, userEvent: 'input.replace' }).state.doc.toString()).toContain('new');
    const from = doc.indexOf(payload);
    expect(state.update({ changes: { from, to: from + payload.length, insert: 'assets/a.png' }, userEvent: 'input.resource' }).state.doc.toString()).toContain('assets/a.png');
  });

  it('protects reference definitions and HTML srcset payloads but ignores code samples', () => {
    for (const doc of [`![a][pic]\n\n[pic]: ${payload}`, `<img srcset="${payload} 1x">`]) {
      const state = EditorState.create({ doc, extensions: [createEmbeddedResourceProtection()] });
      const from = doc.indexOf('AAAA');
      expect(state.update({ changes: { from, to: from + 4, insert: 'BBBB' }, userEvent: 'input.replace' }).state.doc.toString()).toBe(doc);
    }
    const doc = `\`![a](${payload})\``;
    const state = EditorState.create({ doc, extensions: [createEmbeddedResourceProtection()] });
    const from = doc.indexOf('AAAA');
    expect(state.update({ changes: { from, to: from + 4, insert: 'BBBB' }, userEvent: 'input.replace' }).state.doc.toString()).toContain('BBBB');
  });
});
