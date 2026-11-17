import { type Extension, Facet, Prec, StateField } from '@codemirror/state';
import { isolateHistory } from '@codemirror/commands';
import { EditorView, keymap, showTooltip, type Tooltip } from '@codemirror/view';
import { decodeString } from 'micromark-util-decode-string';
import { imageAddressReplacement, unwrapImageAddress } from '@/lib/imageAddressPresentation';
import { buildVisualImageEdit, openVisualImageContext, visualImageContextEnabled, visualImageTargetAt, type VisualImageTarget } from '@/lib/visualImageCommands';
import { isSupportedImageFile } from '@/lib/imageAssets';

export interface VisualImageContextLabels {
  title: string; alt: string; address: string; embedded: string; apply: string; close: string;
  source: string; replace: string; remove: string; confirmRemove: string; removeHint: string;
  invalid: string; fileFailed: string; busy: string;
}
const contextLabels = Facet.define<VisualImageContextLabels, VisualImageContextLabels>({ combine: (values) => values[0] });

export function createVisualImageContextExtension(labels: VisualImageContextLabels): Extension {
  const context = StateField.define<Tooltip | null>({
    create: () => null,
    update(value, tr) {
      if (tr.docChanged || tr.selection || tr.startState.facet(contextLabels) !== tr.state.facet(contextLabels)) value = null;
      for (const effect of tr.effects) if (effect.is(openVisualImageContext)) {
        const target = effect.value === null ? null : visualImageTargetAt(tr.state, effect.value);
        value = target ? { pos: target.from, end: target.to, above: true, arrow: true,
          create: (view) => createImageContext(view, target, labels) } : null;
      }
      return value;
    },
    provide: (field) => showTooltip.from(field),
  });
  return [visualImageContextEnabled.of(true), contextLabels.of(labels), context,
    Prec.high(keymap.of([{ key: 'Escape', run(view) {
      if (!view.state.field(context)) return false;
      view.dispatch({ effects: openVisualImageContext.of(null) }); view.focus(); return true;
    } }])), imageContextTheme];
}

function createImageContext(view: EditorView, target: VisualImageTarget, labels: VisualImageContextLabels) {
  const document = view.dom.ownerDocument;
  const snapshot = view.state.doc;
  const dom = document.createElement('div');
  dom.className = 'cm-visual-image-context';
  dom.setAttribute('role', 'dialog');
  dom.setAttribute('aria-label', labels.title);
  const heading = document.createElement('strong'); heading.textContent = labels.title;
  const alt = document.createElement('input'); alt.type = 'text'; alt.maxLength = 4096;
  alt.value = decodeString(view.state.sliceDoc(target.altFrom, target.altTo));
  const address = document.createElement('textarea'); address.rows = 2; address.spellcheck = false;
  // Do not copy megabytes into a form just to change the description.
  const compact = target.urlTo - target.urlFrom > 8192 || /^<?(?:data:|blob:)/i.test(view.state.sliceDoc(target.urlFrom, Math.min(target.urlTo, target.urlFrom + 20)));
  const originalAddress = compact ? null : decodeString(unwrapImageAddress(view.state.sliceDoc(target.urlFrom, target.urlTo)));
  address.value = originalAddress || ''; address.placeholder = compact ? labels.embedded : '';
  const addField = (label: string, input: HTMLElement) => {
    const wrapper = document.createElement('label'); const name = document.createElement('span'); name.textContent = label;
    input.setAttribute('aria-label', label); wrapper.append(name, input); dom.appendChild(wrapper);
  };
  dom.append(heading); addField(labels.alt, alt); addField(labels.address, address);
  const status = document.createElement('div'); status.setAttribute('role', 'status'); status.className = 'cm-visual-image-context-status';
  const actions = document.createElement('div'); actions.className = 'cm-visual-image-context-actions';
  const close = () => { if (view.dom.isConnected) { view.dispatch({ effects: openVisualImageContext.of(null) }); view.focus(); } };
  const current = () => view.dom.isConnected && view.state.doc === snapshot && !view.state.readOnly;
  const action = (label: string, handler: () => void) => {
    const button = document.createElement('button'); button.type = 'button'; button.textContent = label;
    button.addEventListener('click', handler); actions.appendChild(button); return button;
  };
  const apply = (newAddress?: string) => {
    if (!current()) { close(); return; }
    const changes = buildVisualImageEdit(view.state, target, { alt: alt.value, address: newAddress });
    if (!changes) { status.textContent = labels.invalid; return; }
    if (changes.length) view.dispatch({ changes, userEvent: 'input.image', annotations: isolateHistory.of('full'), effects: openVisualImageContext.of(null) });
    else close();
    view.focus();
  };
  action(labels.apply, () => {
    const editedAddress = address.value.trim();
    if (address.value !== (originalAddress || '') && !imageAddressReplacement(editedAddress)) { status.textContent = labels.invalid; return; }
    apply(address.value === (originalAddress || '') ? undefined : editedAddress);
  });
  const file = document.createElement('input'); file.type = 'file'; file.accept = 'image/png,image/jpeg,image/gif,image/webp,image/bmp,image/avif,image/x-icon';
  file.hidden = true; dom.appendChild(file);
  const replace = action(labels.replace, () => file.click());
  let disposed = false;
  let reader: FileReader | null = null;
  file.addEventListener('change', () => {
    const selected = file.files?.[0];
    if (!selected) return;
    if (!isSupportedImageFile(selected) || selected.size > 32 * 1024 * 1024) { status.textContent = labels.fileFailed; return; }
    replace.disabled = true; status.textContent = labels.busy;
    reader = new FileReader();
    const activeReader = reader;
    reader.onload = () => { if (!disposed && current()) apply(String(activeReader.result || '')); };
    reader.onerror = () => { if (!disposed) { replace.disabled = false; status.textContent = labels.fileFailed; } };
    reader.readAsDataURL(selected);
  });
  action(labels.source, () => {
    if (!current()) { close(); return; }
    view.dispatch({ selection: { anchor: target.altFrom }, effects: openVisualImageContext.of(null), scrollIntoView: true }); view.focus();
  });
  let armed = false;
  let armTimer: ReturnType<typeof setTimeout> | null = null;
  const remove = action(labels.remove, () => {
    if (!armed) {
      armed = true; remove.textContent = labels.confirmRemove; status.textContent = labels.removeHint;
      armTimer = setTimeout(() => { armed = false; remove.textContent = labels.remove; status.textContent = ''; }, 5000);
      return;
    }
    if (!current()) { close(); return; }
    view.dispatch({ changes: { from: target.from, to: target.to }, selection: { anchor: target.from },
      effects: openVisualImageContext.of(null), annotations: isolateHistory.of('full'), userEvent: 'delete.image' }); view.focus();
  });
  action(labels.close, close);
  dom.append(actions, status);
  dom.addEventListener('keydown', (event) => {
    event.stopPropagation();
    if (event.key === 'Escape') { event.preventDefault(); close(); }
    if (event.key === 'Tab') {
      const focusable = [...dom.querySelectorAll<HTMLElement>('input:not([hidden]):not([disabled]),textarea,button:not([disabled])')];
      const index = focusable.indexOf(document.activeElement as HTMLElement);
      if ((event.shiftKey && index <= 0) || (!event.shiftKey && index === focusable.length - 1)) {
        event.preventDefault(); focusable[event.shiftKey ? focusable.length - 1 : 0]?.focus();
      }
    }
  });
  // Input/clipboard/pointer events belong to the form, not CodeMirror's hidden
  // source selection (especially important for paste over an image data URL).
  for (const type of ['mousedown', 'input', 'paste', 'drop', 'compositionstart', 'compositionend']) dom.addEventListener(type, (event) => event.stopPropagation());
  const outside = (event: Event) => { if (!dom.contains(event.target as Node)) close(); };
  return { dom, mount() { document.addEventListener('mousedown', outside, true); alt.focus(); },
    destroy() { disposed = true; if (armTimer) clearTimeout(armTimer); if (reader?.readyState === FileReader.LOADING) reader.abort(); document.removeEventListener('mousedown', outside, true); } };
}

const imageContextTheme = EditorView.baseTheme({
  '.cm-visual-image-context': { boxSizing: 'border-box', width: 'min(390px, 85vw)', maxHeight: 'min(460px, 75vh)', overflowY: 'auto', padding: '12px', borderRadius: '8px', border: '1px solid #cbd5e1', color: '#0f172a', background: '#fff', boxShadow: '0 8px 24px #0f172a26', fontFamily: 'system-ui, sans-serif', fontSize: '12px' },
  '&dark .cm-visual-image-context': { background: '#1e293b', color: '#e2e8f0', borderColor: '#475569' },
  '.cm-visual-image-context label': { display: 'block', marginTop: '9px' },
  '.cm-visual-image-context label span': { display: 'block', marginBottom: '4px' },
  '.cm-visual-image-context input:not([hidden]), .cm-visual-image-context textarea': { display: 'block', boxSizing: 'border-box', width: '100%', padding: '6px 8px', font: 'inherit', color: 'inherit', background: 'transparent', border: '1px solid #94a3b8', borderRadius: '4px', resize: 'vertical' },
  '.cm-visual-image-context-actions': { display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '10px' },
  '.cm-visual-image-context button': { padding: '4px 8px', font: 'inherit', background: 'transparent', color: 'inherit', border: '1px solid #94a3b8', borderRadius: '4px', cursor: 'pointer' },
  '.cm-visual-image-context button:focus-visible': { outline: '2px solid #3b82f6' },
  '.cm-visual-image-context-status': { marginTop: '6px', color: '#64748b' },
  '&dark .cm-visual-image-context-status': { color: '#cbd5e1' },
});
