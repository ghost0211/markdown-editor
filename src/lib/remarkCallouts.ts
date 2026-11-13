import type { Blockquote, Paragraph, Parent, Root, RootContent, Text } from 'mdast';

export const CALLOUT_TYPES = ['note', 'tip', 'important', 'warning', 'caution'] as const;
export type CalloutType = (typeof CALLOUT_TYPES)[number];

const TITLES: Record<'zh-CN' | 'en-US', Record<CalloutType, string>> = {
  'en-US': {
    note: 'Note',
    tip: 'Tip',
    important: 'Important',
    warning: 'Warning',
    caution: 'Caution',
  },
  'zh-CN': {
    note: '注意',
    tip: '提示',
    important: '重要',
    warning: '警告',
    caution: '危险',
  },
};

export function getCalloutTitle(type: CalloutType, lang?: string): string {
  const table = lang && lang.toLowerCase().startsWith('zh') ? TITLES['zh-CN'] : TITLES['en-US'];
  return table[type];
}

const MARKER = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\][ \t]*\r?\n?/i;

/**
 * Detects a GitHub-style alert (`> [!NOTE]`). Returns the type and the marker
 * length to strip from the first text node, or null for an ordinary quote.
 */
export function matchCalloutMarker(
  blockquote: Blockquote
): { type: CalloutType; markerLength: number; text: Text; paragraph: Paragraph } | null {
  const paragraph = blockquote.children[0];
  if (!paragraph || paragraph.type !== 'paragraph') return null;
  const text = paragraph.children[0];
  if (!text || text.type !== 'text') return null;
  const match = MARKER.exec(text.value);
  if (!match) return null;
  return {
    type: match[1].toLowerCase() as CalloutType,
    markerLength: match[0].length,
    text,
    paragraph,
  };
}

function transformBlockquote(node: Blockquote, lang?: string): void {
  const found = matchCalloutMarker(node);
  if (!found) return;

  const { type, markerLength, text, paragraph } = found;
  text.value = text.value.slice(markerLength);
  if (text.value === '') paragraph.children.shift();
  if (paragraph.children.length === 0) node.children.shift();

  const title: Paragraph = {
    type: 'paragraph',
    data: { hName: 'p', hProperties: { className: ['md-callout-title'] } },
    children: [
      { type: 'strong', children: [{ type: 'text', value: getCalloutTitle(type, lang) }] },
    ],
  };
  node.children.unshift(title);

  // Keep the element a <blockquote> so the preview's line mapping still applies.
  node.data = {
    ...node.data,
    hProperties: { className: ['md-callout', `md-callout-${type}`], dataCallout: type },
  };
}

function visit(node: Parent, lang?: string): void {
  for (const child of node.children as RootContent[]) {
    if (child.type === 'blockquote') transformBlockquote(child, lang);
    if ('children' in child && Array.isArray(child.children)) visit(child as Parent, lang);
  }
}

/** Pure tree transform, also used directly by the DOCX exporter. */
export function transformCallouts(tree: Root, lang?: string): Root {
  visit(tree, lang);
  return tree;
}

export interface RemarkCalloutsOptions {
  lang?: string;
}

/** remark plugin: turns `> [!NOTE]` style quotes into styled callouts. */
export function remarkCallouts(options: RemarkCalloutsOptions = {}) {
  return (tree: Root) => {
    transformCallouts(tree, options.lang);
  };
}
