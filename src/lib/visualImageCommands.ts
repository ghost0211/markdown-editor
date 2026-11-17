import { type ChangeSpec, type EditorState, Facet, StateEffect } from '@codemirror/state';

import { ensureSyntaxTree, syntaxTree } from '@codemirror/language';
import { decodeString } from 'micromark-util-decode-string';
import { imageAddressReplacement, unwrapImageAddress } from '@/lib/imageAddressPresentation';

export const openVisualImageContext = StateEffect.define<number | null>();
export const visualImageContextEnabled = Facet.define<boolean, boolean>({ combine: (values) => values.some(Boolean) });

export interface VisualImageTarget {
  from: number;
  to: number;
  altFrom: number;
  altTo: number;
  urlFrom: number;
  urlTo: number;
  /** Suffix to keep an implicit reference stable when its alt text changes. */
  referenceSuffix?: string;
  title?: { from: number; to: number };
}
const normalize = (text: string) => decodeString(text.replace(/^\[|\]$/g, '')).trim().replace(/\s+/g, ' ').toLowerCase();

/** Finds precisely one real Markdown image, never a code/HTML/math look-alike. */
export function visualImageTargetAt(state: EditorState, at: number): VisualImageTarget | null {
  if (at < 0 || at > state.doc.length) return null;
  const tree = ensureSyntaxTree(state, Math.min(at + 1, state.doc.length), 20) ?? syntaxTree(state);
  let image = tree.resolveInner(at, 1);
  while (image.name !== 'Image' && image.parent) image = image.parent;
  if (image.name !== 'Image' || image.to - image.from < 4) return null;
  const close = image.getChildren('LinkMark').find((mark) => state.sliceDoc(mark.from, mark.to) === ']');
  if (!close) return null;
  const base = { from: image.from, to: image.to, altFrom: image.from + 2, altTo: close.from };
  if (base.altTo - base.altFrom > 4096) return null;
  const url = image.getChild('URL');
  const title = image.getChild('LinkTitle');
  if (url) return { ...base, urlFrom: url.from, urlTo: url.to, title: title || undefined };
  // Reference labels are small metadata, not the referenced image's payload.
  const alt = state.sliceDoc(base.altFrom, base.altTo);
  const label = image.getChild('LinkLabel');
  const explicit = label ? state.sliceDoc(label.from, label.to) : '';
  const identifier = explicit && explicit !== '[]' ? explicit : `[${alt}]`;
  const key = normalize(identifier);
  let definition: { urlFrom: number; urlTo: number; title?: { from: number; to: number } } | null = null;
  tree.iterate({ enter(node) {
    if (node.name !== 'LinkReference') return;
    const name = node.node.getChild('LinkLabel');
    const destination = node.node.getChild('URL');
    if (!definition && name && destination && normalize(state.sliceDoc(name.from, name.to)) === key) {
      definition = { urlFrom: destination.from, urlTo: destination.to, title: node.node.getChild('LinkTitle') || undefined };
    }
    return false;
  } });
  return definition ? { ...base, ...(definition as { urlFrom: number; urlTo: number; title?: { from: number; to: number } }), referenceSuffix: identifier } : null;
}

/** Raw alt input is plain text; escaping keeps brackets/backslashes literal. */
export function escapeVisualImageAlt(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').replace(/\\/g, '\\\\').replace(/[[\]]/g, '\\$&');
}

export interface VisualImageEdit {
  alt: string;
  /** Omit to leave the exact source URL/payload intact. */
  address?: string;
}

/** Local source edits only. Updating a reference URL detaches this use, not every shared reference. */
export function buildVisualImageEdit(state: EditorState, target: VisualImageTarget, input: VisualImageEdit): ChangeSpec[] | null {
  if (input.alt.length > 4096) return null;
  const escaped = escapeVisualImageAlt(input.alt);
  let address: string | null = null;
  // A form should not canonicalise/detach a shared reference when its address
  // was merely viewed and left unchanged. Compare bounded non-payload URLs.
  const sameAddress = input.address !== undefined && target.urlTo - target.urlFrom <= 8192 &&
    input.address === decodeString(unwrapImageAddress(state.sliceDoc(target.urlFrom, target.urlTo)));
  if (input.address !== undefined && !sameAddress) {
    address = imageAddressReplacement(input.address);
    if (!address) return null;
    const trimmed = input.address.trim();
    // eslint-disable-next-line no-control-regex
    if (/[\x00-\x1f\x7f]/.test(trimmed)) return null;
    if (!/^(?:data:image\/(?:png|jpe?g|gif|webp|bmp|avif|x-icon|svg\+xml);base64,|https?:\/\/|blob:|file:\/\/|[a-z]:[/\\])/i.test(trimmed) &&
      (/^[a-z][a-z\d+.-]*:/i.test(trimmed) || trimmed.startsWith('//') || trimmed.startsWith('#'))) return null;
  }
  const originalAlt = state.sliceDoc(target.altFrom, target.altTo);
  const altChanged = decodeString(originalAlt) !== input.alt;
  if (target.referenceSuffix !== undefined) {
    if (address !== null) {
      const title = target.title ? ` ${state.sliceDoc(target.title.from, target.title.to)}` : '';
      return [{ from: target.from, to: target.to, insert: `![${altChanged ? escaped : originalAlt}](${address}${title})` }];
    }
    if (!altChanged) return [];
    return [{ from: target.from, to: target.to, insert: `![${escaped}]${target.referenceSuffix}` }];
  }
  const changes: ChangeSpec[] = [];
  if (altChanged) changes.push({ from: target.altFrom, to: target.altTo, insert: escaped });
  if (address !== null) changes.push({ from: target.urlFrom, to: target.urlTo, insert: address });
  return changes;
}
