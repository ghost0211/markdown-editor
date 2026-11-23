import type { Root as HastRoot } from 'hast';
import type { Heading, Paragraph, Root as MdastRoot } from 'mdast';
import type { VFile } from 'vfile';
import { documentStructureParser } from './documentStructure';

export type XmdAlignment = 'left' | 'center' | 'right' | 'justify';
export const XMD_ALIGNMENT_PREFIX = '<!-- xmd:align:';

export function parseXmdAlignment(value: string): XmdAlignment | undefined {
  const match = /^<!-- xmd:align:(left|center|right|justify) -->$/.exec(value);
  return match?.[1] as XmdAlignment | undefined;
}

type TextBlock = Heading | Paragraph;
type AlignmentFileData = { xmdAlignments?: Map<number, XmdAlignment> };

declare module 'mdast' {
  interface HeadingData { xmdAlignment?: XmdAlignment }
  interface ParagraphData { xmdAlignment?: XmdAlignment }
}

export function transformXmdAlignment(root: MdastRoot): Map<number, XmdAlignment> {
  const alignments = new Map<number, XmdAlignment>();
  for (const block of root.children) {
    if (block.type !== 'paragraph' && block.type !== 'heading') continue;
    const children: TextBlock['children'] = [];
    let alignment: XmdAlignment | undefined;
    for (const child of block.children) {
      const value = child.type === 'html' ? parseXmdAlignment(child.value) : undefined;
      if (!value) {
        children.push(child);
        continue;
      }
      alignment = value;
      const previous = children[children.length - 1];
      if (previous?.type === 'text' && previous.value.endsWith(' ')) {
        previous.value = previous.value.slice(0, -1);
        if (!previous.value) children.pop();
      }
    }
    if (!alignment) continue;
    block.children = children;
    block.data = { ...block.data, xmdAlignment: alignment };
    const offset = block.position?.start.offset;
    if (offset !== undefined) alignments.set(offset, alignment);
  }
  return alignments;
}

export function getXmdBlockAlignment(block: TextBlock): XmdAlignment | undefined {
  return block.data?.xmdAlignment;
}

export function hasXmdAlignment(markdown: string): boolean {
  return markdown.includes(XMD_ALIGNMENT_PREFIX) && transformXmdAlignment(documentStructureParser.parse(markdown)).size > 0;
}

export function remarkXmdAlignment() {
  return (root: MdastRoot, file: VFile) => {
    (file.data as AlignmentFileData).xmdAlignments = transformXmdAlignment(root);
  };
}

export function rehypeXmdAlignment() {
  return (root: HastRoot, file: VFile) => {
    const alignments = (file.data as AlignmentFileData).xmdAlignments;
    if (!alignments?.size) return;
    for (const child of root.children) {
      if (child.type !== 'element' || !/^(?:p|h[1-6])$/.test(child.tagName)) continue;
      const offset = child.position?.start.offset;
      const alignment = offset === undefined ? undefined : alignments.get(offset);
      if (alignment) child.properties.style = 'text-align:' + alignment;
    }
  };
}
