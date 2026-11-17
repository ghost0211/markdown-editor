import { type EditorState, type Text } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';
import { EditorView, WidgetType } from '@codemirror/view';
import { decodeString } from 'micromark-util-decode-string';
import { isTauri, readBinaryFile } from '@/lib/native';
import { resolveLocalImagePath } from '@/lib/previewImages';
import { type VisualEditingOptions } from '@/lib/visualEditing';
import { unwrapImageAddress } from '@/lib/imageAddressPresentation';
import { openVisualImageContext, visualImageContextEnabled } from '@/lib/visualImageCommands';

export interface VisualImageRange {
  from: number;
  to: number;
  urlFrom: number;
  urlTo: number;
  alt: string;
}
const normalize = (text: string) => text.replace(/^\[|\]$/g, '').trim().replace(/\s+/g, ' ').toLowerCase();

/** Resolve references using parser nodes, without reading/copying URL payloads. */
export function findVisualImageRanges(state: EditorState): VisualImageRange[] {
  const definitions = new Map<string, { from: number; to: number }>();
  const images: Array<{ from: number; to: number; alt: string; url?: { from: number; to: number }; ref?: string }> = [];
  syntaxTree(state).iterate({ enter(node) {
    if (node.name === 'Image') {
      const marks = node.node.getChildren('LinkMark');
      const close = marks.find((mark) => state.sliceDoc(mark.from, mark.to) === ']');
      const alt = close ? state.sliceDoc(node.from + 2, Math.min(close.from, node.from + 162)) : '';
      const url = node.node.getChild('URL');
      const label = node.node.getChild('LinkLabel');
      const reference = label ? state.sliceDoc(label.from, label.to) : alt;
      images.push({ from: node.from, to: node.to, alt: decodeString(alt), url: url || undefined,
        ref: url ? undefined : normalize(reference === '[]' ? alt : reference) });
      return false;
    }
    if (node.name === 'LinkReference') {
      const label = node.node.getChild('LinkLabel');
      const url = node.node.getChild('URL');
      if (label && url) {
        const key = normalize(state.sliceDoc(label.from, label.to));
        if (!definitions.has(key)) definitions.set(key, { from: url.from, to: url.to });
      }
      return false;
    }
  } });
  return images.flatMap((image) => {
    const url = image.url || definitions.get(image.ref || '');
    return url ? [{ from: image.from, to: image.to, urlFrom: url.from, urlTo: url.to, alt: image.alt }] : [];
  });
}

export function visualImageSource(raw: string): string | null {
  const value = unwrapImageAddress(raw);
  // Data payloads are already canonical. Do not decode/scan their megabytes.
  if (/^data:/i.test(value)) return /^data:image\/(?:png|jpe?g|gif|webp|bmp|avif|x-icon|svg\+xml);base64,/i.test(value) ? value : null;
  const decoded = decodeString(value);
  // Browser/file access is kept identical to the preview: no executable schemes,
  // app-internal URLs, protocol-relative URLs, or arbitrary data attachments.
  if (/^(?:https?:\/\/|blob:|file:\/\/|[a-z]:[/\\])/i.test(decoded)) return decoded;
  if (/^[a-z][a-z\d+.-]*:/i.test(decoded) || decoded.startsWith('//') || decoded.startsWith('#') || !decoded) return null;
  return decoded;
}

function imageMime(path: string): string {
  const extension = path.split('.').pop()?.toLowerCase() || '';
  return ({ jpg: 'image/jpeg', jpeg: 'image/jpeg', svg: 'image/svg+xml', ico: 'image/x-icon' } as Record<string, string>)[extension] || `image/${extension}`;
}

/** Source identity survives unrelated edits; the payload is read only on mount. */
export interface VisualImageSource {
  doc: Text;
  from: number;
  to: number;
}

export class VisualImageWidget extends WidgetType {
  private readonly cleanups = new WeakMap<HTMLElement, () => void>();
  constructor(readonly source: VisualImageSource, readonly alt: string, readonly options: VisualEditingOptions) { super(); }
  eq(other: VisualImageWidget): boolean {
    return this.source === other.source && this.alt === other.alt &&
      this.options.sourcePath === other.options.sourcePath && this.options.imageEdit === other.options.imageEdit &&
      this.options.imageLoading === other.options.imageLoading && this.options.imageFailed === other.options.imageFailed;
  }
  toDOM(view: EditorView): HTMLElement {
    const document = view.dom.ownerDocument;
    const dom = document.createElement('span');
    dom.className = 'cm-visual-image';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'cm-visual-image-edit';
    button.setAttribute('aria-label', this.alt ? `${this.options.imageEdit}: ${this.alt}` : this.options.imageEdit);
    button.title = this.options.imageEdit;
    const image = document.createElement('img');
    image.alt = this.alt;
    image.loading = 'lazy';
    image.decoding = 'async';
    image.referrerPolicy = 'no-referrer';
    const status = document.createElement('span');
    status.className = 'cm-visual-image-status';
    status.textContent = this.options.imageLoading;
    dom.setAttribute('aria-busy', 'true');
    button.append(image, status);
    dom.append(button);
    let disposed = false;
    let objectUrl: string | null = null;
    const failed = () => {
      if (disposed) return;
      image.hidden = true;
      status.hidden = false;
      status.textContent = this.alt ? `${this.options.imageFailed}: ${this.alt}` : this.options.imageFailed;
      dom.removeAttribute('aria-busy');
      view.requestMeasure();
    };
    image.addEventListener('load', () => {
      if (disposed) return;
      status.hidden = true;
      dom.removeAttribute('aria-busy');
      view.requestMeasure();
    });
    image.addEventListener('error', failed);
    button.addEventListener('mousedown', (event) => event.preventDefault());
    button.addEventListener('click', (event) => {
      event.preventDefault(); event.stopPropagation();
      const from = view.posAtDOM(dom);
      if (view.state.facet(visualImageContextEnabled)) view.dispatch({ effects: openVisualImageContext.of(Math.min(from + 2, view.state.doc.length)) });
      else {
        view.dispatch({ selection: { anchor: Math.min(from + 2, view.state.doc.length) }, scrollIntoView: true });
        view.focus();
      }
    });
    const source = visualImageSource(this.source.doc.sliceString(this.source.from, this.source.to));
    const local = source ? resolveLocalImagePath(source, this.options.sourcePath) : null;
    if (!source || (local && !isTauri()) || (!local && !/^(?:https?:|data:|blob:)/i.test(source))) {
      failed();
    } else if (local) {
      void readBinaryFile(local).then((bytes) => {
        if (disposed) return;
        objectUrl = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: imageMime(local) }));
        image.src = objectUrl;
      }).catch(failed);
    } else image.src = source;
    this.cleanups.set(dom, () => { disposed = true; if (objectUrl) URL.revokeObjectURL(objectUrl); });
    return dom;
  }
  destroy(dom: HTMLElement): void { this.cleanups.get(dom)?.(); this.cleanups.delete(dom); }
  ignoreEvent(): boolean { return true; }
}

export const visualImageTheme = EditorView.baseTheme({
  '.cm-visual-image': { display: 'inline-block', maxWidth: '100%', verticalAlign: 'middle', padding: '6px 0' },
  '.cm-visual-image-edit': { display: 'inline-flex', maxWidth: '100%', border: '1px solid #e2e8f0', background: 'transparent', borderRadius: '6px', padding: '3px', color: 'inherit', cursor: 'pointer', font: 'inherit', overflow: 'hidden' },
  '&dark .cm-visual-image-edit': { borderColor: '#475569' },
  '.cm-visual-image-edit:focus-visible': { outline: '2px solid #3b82f6', outlineOffset: '2px' },
  '.cm-visual-image img': { display: 'block', maxWidth: '100%', maxHeight: '360px', objectFit: 'contain', borderRadius: '3px' },
  '.cm-visual-image img[hidden]': { display: 'none' },
  '.cm-visual-image-status': { padding: '8px 12px', color: '#64748b', fontSize: '0.85em', whiteSpace: 'normal', overflowWrap: 'anywhere' },
  '&dark .cm-visual-image-status': { color: '#94a3b8' },
});
