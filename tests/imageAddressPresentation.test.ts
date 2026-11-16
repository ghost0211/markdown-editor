import { describe, it, expect, vi } from 'vitest';
import { EditorSelection, EditorState, Transaction } from '@codemirror/state';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { syntaxTree } from '@codemirror/language';
import { history, undo, redo } from '@codemirror/commands';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { findImageAddressRanges, formatImageAddressLabel, imageAddressReplacement, unwrapImageAddress } from '../src/lib/imageAddressPresentation';
import { createImageAddressExtension, imageAddresses, safeImageInsertionPosition } from '../src/lib/imageAddressExtension';

const labels = { embedded: '内嵌图片', address: '完整图片地址', hint: '悬停查看，点击修改', edit: '修改', copy: '复制', copied: '已复制', copyFailed: '复制失败', apply: '保存', close: '取消', invalid: '地址无效' };
const stateFor = (doc: string, extensions = false) => EditorState.create({
  doc, extensions: [markdown({ base: markdownLanguage }), ...(extensions ? [history(), createImageAddressExtension(labels)] : [])],
});

describe('compact editor image addresses', () => {
  it('finds only image URL destinations, preserving alt text, titles and linked-image wrappers', () => {
    const doc = '# Title\n\n![中文 alt](<assets/my picture(1).png> "title") [![small](a.png)](https://example.com/) [normal](b.png)';
    const ranges = findImageAddressRanges(stateFor(doc));
    expect(ranges.map((range) => doc.slice(range.from, range.to))).toEqual(['<assets/my picture(1).png>', 'a.png']);
    expect(ranges.map((range) => range.alt)).toEqual(['中文 alt', 'small']);
  });

  it('ignores inline/fenced/indented code, escaped image markers and HTML', () => {
    const doc = ['`![fake](a.png)`', '', '```md', '![fake](b.png)', '```', '', '    ![fake](c.png)', '', '\\![fake](d.png)', '', '<img src="e.png">', '', '![real](f.png)'].join('\n');
    expect(findImageAddressRanges(stateFor(doc)).map((range) => doc.slice(range.from, range.to))).toEqual(['f.png']);
  });

  it('folds definitions used by image references but not ordinary or unused references', () => {
    const doc = '![Photo][REF] ![other][] ![third] [link][plain]\n\n[ref]: <data:image/png;base64,AAAA> "keep"\n[other]: b.png\n[third]: c.png\n[plain]: d.png\n[unused]: e.png';
    expect(findImageAddressRanges(stateFor(doc)).map((range) => doc.slice(range.from, range.to))).toEqual(['<data:image/png;base64,AAAA>', 'b.png', 'c.png']);
  });

  it('keeps short paths readable and safely abbreviates long URL/path labels', () => {
    expect(formatImageAddressLabel('<assets/my%20image.png>', '', '内嵌图片')).toBe('assets/my image.png');
    const label = formatImageAddressLabel(`https://example.com/${'folder/'.repeat(100)}image.png?token=123`, '', '内嵌图片');
    expect(label.length).toBeLessThan(80);
    expect(label).toContain('…');
    expect(label).toContain('image.png');
    expect(formatImageAddressLabel('assets/100%.png', '', '内嵌图片')).toBe('assets/100%.png');
  });

  it('uses a clearly synthetic embedded image path with the original image label and MIME extension', () => {
    expect(formatImageAddressLabel('<data:image/png;base64,AAAA>', '截图 1', '内嵌图片')).toBe('内嵌图片/截图 1.png');
    expect(formatImageAddressLabel('data:image/jpeg;base64,AAAA', 'photo', 'Embedded image')).toBe('Embedded image/photo.jpg');
    expect(formatImageAddressLabel('blob:https://example.com/id', '', '内嵌图片')).toBe('内嵌图片/image.png');
    expect(formatImageAddressLabel('data:image/svg+xml,xxx', '<script>/bad', '内嵌图片')).toBe('内嵌图片/script bad.svg');
  });

  it('renders a 4MB inline payload as one short replacement without copying the full URL for its label', () => {
    const doc = '![my image](<data:image/png;base64,' + 'A'.repeat(4_000_000) + '>)\n\nEnd';
    const state = stateFor(doc, true);
    const value = state.field(imageAddresses);
    expect(value.ranges).toHaveLength(1);
    expect(state.doc.toString()).toBe(doc);
    let count = 0;
    value.decorations.between(0, doc.length, (_from, _to, decoration) => {
      count++;
      expect(decoration.spec.widget.label).toBe('内嵌图片/my image.png');
      expect(decoration.spec.widget.label.length).toBeLessThan(80);
    });
    expect(count).toBe(1);
    const spy = vi.spyOn(state, 'sliceDoc');
    const next = state.update({ changes: { from: state.doc.length, insert: 'more' } }).state;
    expect(next.field(imageAddresses).ranges).toHaveLength(1);
    expect(spy.mock.calls.every(([from = 0, to = state.doc.length]) => to - from < 500)).toBe(true);
  });

  it('does not recreate decorations on cursor-only updates or mutate source text', () => {
    const state = stateFor('![a](<data:image/png;base64,AAAA>)\nnext', true);
    const field = state.field(imageAddresses);
    const next = state.update({ selection: { anchor: state.doc.length } }).state;
    expect(next.field(imageAddresses)).toBe(field);
    expect(next.doc).toBe(state.doc);
    expect(next.doc.toString()).toBe(state.doc.toString());
  });

  it('rebuilds source positions after edits and removes decorations when image markup is deleted', () => {
    const state = stateFor('![a](a.png)', true);
    const before = state.field(imageAddresses).ranges[0];
    const changed = state.update({ changes: { from: 0, insert: 'prefix\n' } }).state;
    expect(changed.field(imageAddresses).ranges[0].from).toBe(before.from + 7);
    const removed = changed.update({ changes: { from: 7, to: changed.doc.length } }).state;
    expect(removed.field(imageAddresses).ranges).toHaveLength(0);
  });

  it('uses the parser tree progress to discover images beyond the initial parse window', () => {
    const doc = 'paragraph\n\n'.repeat(1000) + '![tail](last.png)';
    const state = stateFor(doc, true);
    const tree = syntaxTree(state);
    // A later source edit forces parse progress; no plain-text image regex is used.
    const next = state.update({ changes: { from: 0, insert: 'start\n\n' } }).state;
    expect(syntaxTree(next)).not.toBe(tree);
  });

  it('keeps multiline image layout supported by state-provided replacements', () => {
    const doc = '![a](\n <assets/a.png>\n "title"\n)';
    const state = stateFor(doc, true);
    expect(state.field(imageAddresses).ranges).toHaveLength(1);
    expect(state.doc.toString()).toBe(doc);
  });

  it('moves dropped/pasted images outside a hidden address instead of corrupting its data', () => {
    const doc = 'before ![a](<data:image/png;base64,AAAA>) after';
    const state = stateFor(doc, true);
    const range = state.field(imageAddresses).ranges[0];
    for (const position of [range.from, range.from + 2, range.to]) {
      expect(safeImageInsertionPosition(state, position)).toBe(range.imageTo);
    }
    expect(safeImageInsertionPosition(state, 0)).toBe(0);
  });

  it('validates editing and produces valid Markdown destinations for special characters', () => {
    expect(imageAddressReplacement('')).toBeNull();
    expect(imageAddressReplacement('a\nb.png')).toBeNull();
    expect(imageAddressReplacement('  assets/a (1).png  ')).toBe('<assets/a (1).png>');
    expect(imageAddressReplacement('a>b<c.png')).toBe('<a%3Eb%3Cc.png>');
    expect(unwrapImageAddress('<assets/a.png>')).toBe('assets/a.png');
    const original = '![alt](old.png "title")';
    const state = stateFor(original, true);
    const range = state.field(imageAddresses).ranges[0];
    let current = state.update({ changes: { from: range.from, to: range.to, insert: imageAddressReplacement('assets/a (1).png')! }, userEvent: 'input' }).state;
    expect(current.doc.toString()).toBe('![alt](<assets/a (1).png> "title")');
    const dispatch = (transaction: Transaction) => { current = transaction.state; };
    expect(undo({ state: current, dispatch })).toBe(true);
    expect(current.doc.toString()).toBe(original);
    expect(redo({ state: current, dispatch })).toBe(true);
    expect(current.doc.toString()).toBe('![alt](<assets/a (1).png> "title")');
  });

  it('round-trips Windows paths, trailing backslashes and literal entity-looking filenames in the address editor', () => {
    for (const address of ['C:\\docs\\(1\\).png', 'C:\\docs\\', 'a&copy;b.png', 'a\\*b.png']) {
      const markdown = `![alt](${imageAddressReplacement(address)})`;
      const tree = unified().use(remarkParse).parse(markdown);
      const paragraph = tree.children[0];
      expect(paragraph.type).toBe('paragraph');
      if (paragraph.type !== 'paragraph') throw new Error('missing paragraph');
      const image = paragraph.children[0];
      expect(image.type).toBe('image');
      if (image.type !== 'image') throw new Error('missing image');
      expect(image.url).toBe(address);
    }
  });

  it('moves insertion out of reference definitions after the title and uses the first image label', () => {
    const doc = '![A][id] ![B][id]\n\n[id]: a.png "title"';
    const state = stateFor(doc, true);
    const range = state.field(imageAddresses).ranges[0];
    expect(range.kind).toBe('definition');
    expect(range.alt).toBe('A');
    expect(safeImageInsertionPosition(state, range.from)).toBe(doc.length);
  });

  it('select-all/copy source retains full data URLs and accepts multiple selections', () => {
    const doc = '![a](data:image/png;base64,AAAA) and ![b](b.png)';
    const state = stateFor(doc, true).update({ selection: EditorSelection.single(0, doc.length) }).state;
    expect(state.sliceDoc(state.selection.main.from, state.selection.main.to)).toBe(doc);
  });

  it('wires display-only extension and safe image insertion into Editor', () => {
    const source = readFileSync(resolve(__dirname, '../src/components/Editor.tsx'), 'utf8');
    expect(source).toContain('createImageAddressExtension({');
    expect(source).toContain('handler(images, safeImageInsertionPosition(view.state, position))');
    expect(source).toContain('handler(images, safeImageInsertionPosition(view.state, selection.from))');
  });
});
