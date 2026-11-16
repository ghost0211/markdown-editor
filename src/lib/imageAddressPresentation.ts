import { EditorState } from '@codemirror/state';
import { ensureSyntaxTree, syntaxTree } from '@codemirror/language';

export interface ImageAddressRange {
  from: number;
  to: number;
  /** Source label, used only to name embedded resources (never a real disk path). */
  alt: string;
  imageFrom: number;
  imageTo: number;
  kind: 'image' | 'definition';
}

function normalizeReference(label: string): string {
  return label.replace(/^\[|\]$/g, '').replace(/\\([[\]\\])/g, '$1').trim().replace(/\s+/g, ' ').toLowerCase();
}

/** Uses the editor's Markdown parser so code examples are never mistaken for images. */
export function findImageAddressRanges(state: EditorState): ImageAddressRange[] {
  // A giant data URL is one paragraph, so parsing the first few characters also
  // finishes that paragraph. Background parser transactions cover later blocks.
  const tree = ensureSyntaxTree(state, Math.min(state.doc.length, 3000), 25) || syntaxTree(state);
  const ranges: ImageAddressRange[] = [];
  const referenced = new Map<string, string>();
  const definitions: { label: string; from: number; to: number }[] = [];
  tree.iterate({
    enter(node) {
      if (node.name === 'Image') {
        const close = node.node.getChildren('LinkMark').find((mark) => state.sliceDoc(mark.from, mark.to) === ']');
        const alt = close ? state.sliceDoc(node.from + 2, Math.min(close.from, node.from + 162)) : '';
        const url = node.node.getChild('URL');
        if (url) ranges.push({ from: url.from, to: url.to, alt, imageFrom: node.from, imageTo: node.to, kind: 'image' });
        else {
          const label = node.node.getChild('LinkLabel');
          const identifier = label ? state.sliceDoc(label.from, label.to) : alt;
          const key = normalizeReference(identifier === '[]' ? alt : identifier);
          if (!referenced.has(key)) referenced.set(key, alt);
        }
      }
      if (node.name === 'LinkReference') {
        const label = node.node.getChild('LinkLabel');
        const url = node.node.getChild('URL');
        if (label && url) definitions.push({ label: normalizeReference(state.sliceDoc(label.from, label.to)), from: url.from, to: url.to });
      }
    },
  });
  const defined = new Set<string>();
  for (const definition of definitions) {
    if (defined.has(definition.label)) continue;
    defined.add(definition.label);
    if (referenced.has(definition.label)) {
      ranges.push({ from: definition.from, to: definition.to, alt: referenced.get(definition.label)!, imageFrom: state.doc.lineAt(definition.from).from, imageTo: state.doc.lineAt(definition.to).to, kind: 'definition' });
    }
  }
  return ranges.sort((a, b) => a.from - b.from);
}

export function unwrapImageAddress(raw: string): string {
  return raw.startsWith('<') ? raw.slice(1, raw.endsWith('>') ? -1 : undefined) : raw;
}

/** A display label only. Never substitute this synthetic path into the document. */
export function formatImageAddressLabel(raw: string, alt: string, embeddedLabel: string): string {
  const address = unwrapImageAddress(raw);
  if (/^(?:data:|blob:)/i.test(address)) {
    const mime = /^data:image\/([a-z\d.+-]+)/i.exec(address)?.[1].toLowerCase();
    const extension = mime === 'jpeg' ? 'jpg' : mime === 'svg+xml' ? 'svg' : mime === 'x-icon' ? 'ico' : mime || 'png';
    // eslint-disable-next-line no-control-regex
    const name = alt.replace(/[<>:"/\\|?*\x00-\x1f]/g, ' ').replace(/\s+/g, ' ').trim() || 'image';
    const filename = /\.[a-z\d]{2,5}$/i.test(name) ? name : `${name}.${extension}`;
    return `${embeddedLabel}/${filename}`;
  }
  const safePrefix = address.slice(0, 300);
  const tail = address.slice(-100);
  let display = address.length <= 300 ? safePrefix : `${safePrefix.slice(0, 30)}…${tail}`;
  try { display = decodeURI(display); } catch { /* Keep malformed percent sequences literal. */ }
  return display.length > 72 ? `${display.slice(0, 28)}…${display.slice(-36)}` : display;
}

/** Wrap an edited URL in a valid, space/parenthesis-safe Markdown destination. */
export function imageAddressReplacement(address: string): string | null {
  const trimmed = address.trim();
  // eslint-disable-next-line no-control-regex
  if (!trimmed || /[\r\n\x00]/.test(trimmed)) return null;
  // Always use an angle destination: spaces and unbalanced parentheses are safe.
  return `<${trimmed.replace(/\\/g, '\\\\').replace(/&/g, '&amp;').replace(/</g, '%3C').replace(/>/g, '%3E')}>`;
}
