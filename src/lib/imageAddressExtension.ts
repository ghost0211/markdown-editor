import { EditorSelection, EditorState, Extension, Facet, Prec, RangeSetBuilder, StateEffect, StateField } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';
import { Decoration, DecorationSet, EditorView, hoverTooltip, keymap, showTooltip, Tooltip, WidgetType } from '@codemirror/view';
import {
  findImageAddressRanges,
  formatImageAddressLabel,
  imageAddressReplacement,
  ImageAddressRange,
  unwrapImageAddress,
} from '@/lib/imageAddressPresentation';

export interface ImageAddressLabels {
  embedded: string;
  address: string;
  hint: string;
  edit: string;
  copy: string;
  copied: string;
  copyFailed: string;
  apply: string;
  close: string;
  invalid: string;
}

interface AddressState {
  ranges: readonly ImageAddressRange[];
  decorations: DecorationSet;
}

const openAddress = StateEffect.define<ImageAddressRange | null>();
const addressLabels = Facet.define<ImageAddressLabels, ImageAddressLabels>({
  combine: (values) => values[0],
});

function escapeLabel(label: string): string {
  return label.replace(/[\r\n\t]/g, ' ');
}

class ImageAddressWidget extends WidgetType {
  constructor(readonly label: string, readonly labels: ImageAddressLabels) { super(); }

  eq(other: ImageAddressWidget): boolean {
    return this.label === other.label && this.labels === other.labels;
  }

  toDOM(view: EditorView): HTMLElement {
    const button = view.dom.ownerDocument.createElement('button');
    button.type = 'button';
    button.className = 'cm-image-address';
    button.textContent = this.label;
    button.title = this.labels.hint;
    button.setAttribute('aria-label', `${this.labels.address}: ${this.label}. ${this.labels.hint}`);
    // Do not put the data URL in the editor DOM: it can be megabytes long.
    // The full address is populated lazily in a bounded, scrollable tooltip.
    button.addEventListener('mousedown', (event) => event.preventDefault());
    button.addEventListener('click', (event) => {
      event.preventDefault();
      const position = view.posAtDOM(button);
      const range = view.state.field(imageAddresses, false)?.ranges.find((item) => item.from <= position && item.to >= position);
      if (range) view.dispatch({ effects: openAddress.of(range) });
    });
    return button;
  }

  ignoreEvent(event: Event): boolean { return event.type !== 'mousemove' && event.type !== 'mouseover' && event.type !== 'mouseout'; }
}

function makeDecorations(state: EditorState, ranges: readonly ImageAddressRange[], labels: ImageAddressLabels): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  for (const range of ranges) {
    const length = range.to - range.from;
    // Read only the MIME prefix for embedded payloads; rebuilding a display
    // label must not copy megabytes from the document on every keystroke.
    const prefix = state.sliceDoc(range.from, Math.min(range.to, range.from + 100));
    const raw = /^(?:<)?(?:data:|blob:)/i.test(prefix) ? prefix
      : length <= 300 ? state.sliceDoc(range.from, range.to)
      : `${prefix}…${state.sliceDoc(range.to - 100, range.to)}`;
    // URL tokens may span a line in hand-written Markdown; direct StateField
    // decorations can hide those line breaks without violating view layout.
    const label = escapeLabel(formatImageAddressLabel(raw, range.alt, labels.embedded));
    builder.add(range.from, range.to, Decoration.replace({ widget: new ImageAddressWidget(label, labels) }));
  }
  return builder.finish();
}

// StateField-supplied replacements are available before viewport measurement,
// so even a newly inserted multi-megabyte URL never creates thousands of rows.
export const imageAddresses = StateField.define<AddressState>({
  create(state) {
    const ranges = findImageAddressRanges(state);
    return { ranges, decorations: makeDecorations(state, ranges, state.facet(addressLabels)) };
  },
  update(value, transaction) {
    if (transaction.docChanged || syntaxTree(transaction.startState) !== syntaxTree(transaction.state) ||
        transaction.startState.facet(addressLabels) !== transaction.state.facet(addressLabels)) {
      const ranges = findImageAddressRanges(transaction.state);
      return { ranges, decorations: makeDecorations(transaction.state, ranges, transaction.state.facet(addressLabels)) };
    }
    return value;
  },
  provide: (field) => [
    EditorView.decorations.from(field, (value) => value.decorations),
    EditorView.atomicRanges.of((view) => view.state.field(field).decorations),
  ],
});

/** Image files dropped on a chip belong beside that image, not inside its URL. */
export function safeImageInsertionPosition(state: EditorState, position: number): number {
  const range = state.field(imageAddresses, false)?.ranges.find((item) => position >= item.from && position <= item.to);
  return range ? range.imageTo : position;
}

/** Display-only replacements: saved/copied Markdown continues to contain the real URLs. */
export function createImageAddressExtension(labels: ImageAddressLabels): Extension {

  const tooltip = StateField.define<Tooltip | null>({
    create: () => null,
    update(value, transaction) {
      if (transaction.docChanged || transaction.selection) value = null;
      for (const effect of transaction.effects) {
        if (effect.is(openAddress)) {
          const range = effect.value;
          value = range ? {
            pos: range.from, end: range.to, above: true, arrow: true,
            create: (view) => createAddressTooltip(view, range, labels, true),
          } : null;
        }
      }
      return value;
    },
    provide: (field) => showTooltip.from(field),
  });

  function currentRange(view: EditorView, position: number): ImageAddressRange | undefined {
    return view.state.field(imageAddresses).ranges.find((range) => range.from <= position && range.to >= position);
  }

  return [
    addressLabels.of(labels),
    imageAddresses,
    tooltip,
    EditorView.inputHandler.of((view, from, to, text) => {
      const range = currentRange(view, from);
      if (!range || from !== to) return false;
      // A hidden destination cannot safely accept text at an invisible offset.
      // Type before/after the image instead; edit the URL through its popover.
      const at = from === range.from ? range.imageFrom : range.imageTo;
      const insert = range.kind === 'definition'
        ? from === range.from ? `${text}\n` : `\n${text}` : text;
      view.dispatch({ changes: { from: at, insert }, selection: { anchor: at + text.length }, userEvent: 'input' });
      return true;
    }),
    hoverTooltip((view, position) => {
      if (view.state.field(tooltip)) return null;
      const range = currentRange(view, position);
      if (!range) return null;
      return { pos: range.from, end: range.to, above: true, arrow: true,
        create: (editor) => createAddressTooltip(editor, range, labels, false) };
    }, { hoverTime: 250, hideOnChange: true }),
    Prec.high(keymap.of([
      { key: 'Escape', run: (view) => {
        if (!view.state.field(tooltip)) return false;
        view.dispatch({ effects: openAddress.of(null) });
        view.focus();
        return true;
      } },
      { key: 'Mod-Enter', run: (view) => {
        const selection = view.state.selection.main;
        if (!selection.empty) return false;
        const range = currentRange(view, selection.head);
        if (!range || (selection.head !== range.from && selection.head !== range.to)) return false;
        view.dispatch({ effects: openAddress.of(range) });
        return true;
      } },
    ])),
    addressTheme,
  ];
}

function createAddressTooltip(view: EditorView, range: ImageAddressRange, labels: ImageAddressLabels, editing: boolean) {
  const document = view.dom.ownerDocument;
  const dom = document.createElement('div');
  dom.className = 'cm-image-address-popover';
  dom.setAttribute('role', editing ? 'dialog' : 'group');
  dom.setAttribute('aria-label', labels.address);
  const heading = document.createElement('div');
  heading.className = 'cm-image-address-heading';
  heading.textContent = labels.address;
  const original = view.state.sliceDoc(range.from, range.to);
  const textarea = document.createElement('textarea');
  textarea.className = 'cm-image-address-value';
  textarea.setAttribute('aria-label', labels.address);
  textarea.spellcheck = false;
  textarea.wrap = 'soft';
  textarea.readOnly = !editing;
  textarea.value = unwrapImageAddress(original);
  const actions = document.createElement('div');
  actions.className = 'cm-image-address-actions';
  const message = document.createElement('span');
  message.setAttribute('role', 'status');
  function action(label: string, handler: () => void) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.addEventListener('click', handler);
    actions.appendChild(button);
  }
  action(labels.copy, () => {
    // execCommand is a fallback for older WebView clipboard implementations.
    const copy = async () => {
      try {
        try {
          const clipboard = document.defaultView?.navigator.clipboard;
          if (!clipboard?.writeText) throw new Error('Clipboard unavailable');
          await clipboard.writeText(textarea.value);
        } catch {
          textarea.focus(); textarea.select();
          if (!document.execCommand('copy')) throw new Error('Clipboard unavailable');
        }
        message.textContent = labels.copied;
      } catch { message.textContent = labels.copyFailed; }
    };
    void copy();
  });
  if (!editing) {
    action(labels.edit, () => view.dispatch({ effects: openAddress.of(range) }));
  } else {
    action(labels.apply, () => {
      const replacement = imageAddressReplacement(textarea.value);
      if (!replacement) { message.textContent = labels.invalid; return; }
      if (range.to > view.state.doc.length || view.state.sliceDoc(range.from, range.to) !== original) {
        view.dispatch({ effects: openAddress.of(null) });
        view.focus();
        return;
      }
      if (textarea.value !== unwrapImageAddress(original)) {
        view.dispatch({ changes: { from: range.from, to: range.to, insert: replacement },
          selection: EditorSelection.cursor(range.from + replacement.length),
          effects: openAddress.of(null), userEvent: 'input' });
      } else view.dispatch({ effects: openAddress.of(null) });
      view.focus();
    });
    action(labels.close, () => {
      view.dispatch({ effects: openAddress.of(null) });
      view.focus();
    });
  }
  dom.append(heading, textarea, actions, message);
  dom.addEventListener('keydown', (event) => {
    // Inputs inside a tooltip must not trigger Markdown shortcuts or keymaps.
    event.stopPropagation();
    if (event.key === 'Escape') {
      event.preventDefault();
      view.dispatch({ effects: openAddress.of(null) });
      view.focus();
    }
  });
  return { dom, mount: () => { if (editing) textarea.focus(); } };
}

const addressTheme = EditorView.baseTheme({
  '.cm-image-address': {
    display: 'inline-block', boxSizing: 'border-box', maxWidth: 'min(38em, 100%)', overflow: 'hidden', textOverflow: 'ellipsis',
    verticalAlign: 'baseline', whiteSpace: 'nowrap', border: '1px solid #bfdbfe', borderRadius: '4px',
    padding: '0 5px', margin: '0 1px', font: 'inherit', lineHeight: '1.35',
    color: '#1d4ed8', backgroundColor: '#eff6ff', cursor: 'pointer',
  },
  '&dark .cm-image-address': { color: '#93c5fd', backgroundColor: '#172554', borderColor: '#1e40af' },
  '.cm-image-address:focus-visible': { outline: '2px solid #3b82f6', outlineOffset: '1px' },
  '.cm-image-address-popover': { padding: '10px', width: 'min(480px, 75vw)', maxWidth: '75vw', color: '#0f172a', background: '#fff', borderRadius: '5px' },
  '&dark .cm-image-address-popover': { color: '#e2e8f0', background: '#1e293b' },
  '.cm-image-address-heading': { fontWeight: '600', marginBottom: '6px' },
  '.cm-image-address-value': { boxSizing: 'border-box', display: 'block', width: '100%', height: '96px', resize: 'vertical', maxHeight: '240px', overflow: 'auto', fontFamily: 'monospace', fontSize: '12px', lineHeight: '1.5', color: 'inherit', background: 'transparent', border: '1px solid #94a3b8', borderRadius: '3px', padding: '6px', overflowWrap: 'anywhere' },
  '.cm-image-address-actions': { display: 'flex', gap: '6px', marginTop: '8px' },
  '.cm-image-address-actions button': { font: 'inherit', fontSize: '12px', color: 'inherit', background: 'transparent', border: '1px solid #94a3b8', borderRadius: '3px', padding: '2px 8px', cursor: 'pointer' },
  '.cm-image-address-popover [role=status]': { fontSize: '12px' },
});
