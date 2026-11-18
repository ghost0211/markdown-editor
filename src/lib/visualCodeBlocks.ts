import { EditorSelection, Facet, type EditorState, type Extension, StateField } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';
import { Decoration, type DecorationSet, EditorView, WidgetType } from '@codemirror/view';
import { isVisualSourceLine } from '@/lib/visualEditing';

/**
 * Visual fenced/indented code blocks.
 *
 * A code block that is not being edited is shown as a styled code box (with a
 * language label and copy action); Mermaid fences render the diagram. Selecting
 * any line of the block reveals its exact Markdown source, so the editor never
 * hides what it cannot round-trip. Source mode is untouched.
 */

export interface VisualCodeBlockLabels {
  label: string;
  copy: string;
  copied: string;
  copyFailed: string;
  mermaidRendering: string;
  mermaidError: string;
}

const codeBlockLabels = Facet.define<VisualCodeBlockLabels, VisualCodeBlockLabels | null>({
  combine: (values) => values[0] ?? null,
});

export const MAX_VISUAL_CODE_BYTES = 200_000;
export const MAX_VISUAL_CODE_LINES = 800;

export interface VisualCodeBlockInfo {
  from: number;
  to: number;
  /** Lower-case fence info string, already restricted to safe characters. */
  language: string;
  length: number;
  /** Bounded edge sample so equal-length edits still refresh the widget. */
  sample: string;
  /** 1-based line number of the opening fence. */
  line: number;
}

const LANGUAGE = /^[a-z0-9+#._-]{1,24}$/;

function languageOf(state: EditorState, node: { getChild(name: string): { from: number; to: number } | null }): string {
  const info = node.getChild('CodeInfo');
  if (!info) return '';
  const raw = state.sliceDoc(info.from, info.to).trim().toLowerCase();
  return LANGUAGE.test(raw) ? raw : '';
}

interface SyntaxNodeLike {
  name: string;
  from: number;
  to: number;
  parent: SyntaxNodeLike | null;
  firstChild: SyntaxNodeLike | null;
  nextSibling: SyntaxNodeLike | null;
  getChild(name: string): SyntaxNodeLike | null;
}

/**
 * Top-level, line-aligned code blocks only. Blocks inside lists or quotes keep
 * their source: a block widget starting mid-line would push the marker out of
 * the line and can make the block impossible to select reliably.
 */
export function collectVisualCodeBlocks(state: EditorState): VisualCodeBlockInfo[] {
  const tree = syntaxTree(state);
  if (tree.length === 0) return [];
  const blocks: VisualCodeBlockInfo[] = [];
  tree.iterate({
    enter(node) {
      const typed = node.node as unknown as SyntaxNodeLike;
      if (typed.name !== 'FencedCode' && typed.name !== 'CodeBlock') return;
      if (typed.parent?.name !== 'Document') return false;
      const length = node.to - node.from;
      if (length > MAX_VISUAL_CODE_BYTES) return false;
      const firstLine = state.doc.lineAt(node.from);
      const lastLine = state.doc.lineAt(node.to);
      if (firstLine.from !== node.from || lastLine.to !== node.to) return false;
      if (lastLine.number - firstLine.number + 1 > MAX_VISUAL_CODE_LINES) return false;
      blocks.push({
        from: node.from,
        to: node.to,
        language: languageOf(state, typed),
        length,
        // 256 bounded characters are enough to detect an equal-length edit
        // without copying a large code block on every keystroke.
        sample: `${state.sliceDoc(node.from, Math.min(node.to, node.from + 128))}\u0000${state.sliceDoc(Math.max(node.from, node.to - 128), node.to)}`,
        line: firstLine.number,
      });
      return false;
    },
  });
  return blocks;
}

let mermaidSequence = 0;

function mermaidId(): string {
  mermaidSequence += 1;
  return `cm-mermaid-${Date.now().toString(36)}-${mermaidSequence}`;
}

function cleanupMermaidArtifacts(id: string, document: Document, keep: Element): void {
  // Mermaid may leave its temporary measurement nodes in the document; the
  // rendered SVG inside `keep` reuses the same id and must never be removed.
  for (const element of Array.from(document.querySelectorAll(`[id="${id}"], [id="d${id}"]`))) {
    if (!keep.contains(element)) element.remove();
  }
}

function isDarkTheme(document: Document): boolean {
  return document.documentElement.classList.contains('dark');
}

async function copyText(document: Document, text: string): Promise<boolean> {
  try {
    const clipboard = document.defaultView?.navigator.clipboard;
    if (clipboard?.writeText) {
      await clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through to the legacy textarea path.
  }
  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.append(area);
    area.select();
    const copied = document.execCommand('copy');
    area.remove();
    return copied;
  } catch {
    return false;
  }
}

class VisualCodeWidget extends WidgetType {
  private readonly cleanups = new WeakMap<HTMLElement, () => void>();

  constructor(readonly block: VisualCodeBlockInfo, readonly labels: VisualCodeBlockLabels) {
    super();
  }

  eq(other: WidgetType): boolean {
    return other instanceof VisualCodeWidget &&
      other.block.from === this.block.from &&
      other.block.to === this.block.to &&
      other.block.length === this.block.length &&
      other.block.sample === this.block.sample &&
      other.block.language === this.block.language &&
      other.labels === this.labels;
  }

  get estimatedHeight(): number {
    return Math.min(420, 44 + Math.min(this.block.length, 6000) / 36);
  }

  toDOM(view: EditorView): HTMLElement {
    const document = view.dom.ownerDocument;
    const block = this.block;
    const code = view.state.sliceDoc(block.from, block.to);
    const language = block.language;
    const container = document.createElement('div');
    container.className = 'cm-visual-code';
    container.dataset.language = language;
    container.setAttribute('role', 'group');
    container.setAttribute('aria-label', language ? `${this.labels.label}: ${language}` : this.labels.label);
    container.setAttribute('aria-roledescription', this.labels.label);

    const header = document.createElement('div');
    header.className = 'cm-visual-code-header';
    const languageLabel = document.createElement('span');
    languageLabel.className = 'cm-visual-code-language';
    languageLabel.textContent = language || this.labels.label;
    const copy = document.createElement('button');
    copy.type = 'button';
    copy.className = 'cm-visual-code-copy';
    copy.textContent = this.labels.copy;
    copy.setAttribute('aria-label', this.labels.copy);
    copy.addEventListener('mousedown', (event) => event.preventDefault());
    copy.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      void this.copy(document, copy, code);
    });
    header.append(languageLabel, copy);

    const pre = document.createElement('pre');
    pre.className = 'cm-visual-code-body';
    const codeElement = document.createElement('code');
    codeElement.textContent = this.codeText(code, language);
    pre.append(codeElement);

    container.append(header, pre);

    // Clicking anywhere outside the copy button reveals the exact source.
    container.addEventListener('mousedown', (event) => {
      if ((event.target as HTMLElement | null)?.closest('button')) return;
      event.preventDefault();
    });
    container.addEventListener('click', (event) => {
      if ((event.target as HTMLElement | null)?.closest('button')) return;
      event.preventDefault();
      event.stopPropagation();
      if (!view.state.doc.length) return;
      const position = Math.min(block.from, view.state.doc.length);
      view.dispatch({ selection: EditorSelection.cursor(position), scrollIntoView: true });
      view.focus();
    });

    let disposed = false;
    let themeObserver: MutationObserver | null = null;
    if (language === 'mermaid' && code.length <= 20_000) {
      const render = () => void this.renderMermaid(view, document, pre, header, code, () => disposed);
      themeObserver = new MutationObserver((mutations) => {
        if (mutations.some((mutation) => mutation.attributeName === 'class')) render();
      });
      themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
      render();
    }
    const wrapper = document.createElement('div');
    wrapper.className = 'cm-visual-code-block';
    wrapper.append(container);
    this.cleanups.set(wrapper, () => {
      disposed = true;
      themeObserver?.disconnect();
    });
    return wrapper;
  }

  destroy(dom: HTMLElement): void {
    this.cleanups.get(dom)?.();
    this.cleanups.delete(dom);
  }

  ignoreEvent(event: Event): boolean {
    return event.type !== 'mousemove' && event.type !== 'mouseover' && event.type !== 'mouseout';
  }

  /** Code body without the fence lines, preserving indentation and blank lines. */
  private codeText(code: string, language: string): string {
    if (language === 'mermaid' || code.startsWith('```') || code.startsWith('~~~')) {
      const lines = code.split('\n');
      if (lines.length >= 2) {
        // A fence that is still open has no closing line to drop.
        const last = lines[lines.length - 1].trim();
        const closed = /^(`{3,}|~{3,})$/.test(last);
        return lines.slice(1, closed ? -1 : undefined).join('\n');
      }
    }
    return code;
  }

  private async copy(document: Document, button: HTMLButtonElement, code: string): Promise<void> {
    const ok = await copyText(document, this.codeText(code, this.block.language));
    button.textContent = ok ? this.labels.copied : this.labels.copyFailed;
    button.dataset.state = ok ? 'copied' : 'failed';
    const documentWindow = document.defaultView;
    documentWindow?.setTimeout(() => {
      if (!button.isConnected) return;
      button.textContent = this.labels.copy;
      delete button.dataset.state;
    }, 1600);
  }

  private async renderMermaid(
    view: EditorView,
    document: Document,
    pre: HTMLElement,
    header: HTMLElement,
    code: string,
    isDisposed: () => boolean
  ): Promise<void> {
    const diagram = this.codeText(code, 'mermaid');
    if (!diagram.trim()) return;
    const token = `${this.block.from}:${this.block.length}:${isDarkTheme(document)}`;
    const state = pre.dataset.mermaidToken === token ? 'rendered' : 'pending';
    if (state === 'rendered') return;
    const status = document.createElement('div');
    status.className = 'cm-visual-code-status';
    status.setAttribute('role', 'status');
    status.textContent = this.labels.mermaidRendering;
    pre.replaceChildren(status);
    const id = mermaidId();
    try {
      const mermaid = (await import('mermaid')).default;
      if (isDisposed() || !view.dom.isConnected) return;
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        theme: isDarkTheme(document) ? 'dark' : 'default',
        fontFamily: 'inherit',
      });
      const { svg } = await mermaid.render(id, diagram);
      if (isDisposed() || !pre.isConnected) return;
      pre.innerHTML = svg;
      pre.dataset.mermaidToken = token;
      delete pre.dataset.mermaidFailed;
      view.requestMeasure();
    } catch {
      if (isDisposed() || !pre.isConnected) return;
      pre.dataset.mermaidFailed = 'true';
      const fallback = document.createElement('div');
      fallback.className = 'cm-visual-code-status';
      fallback.textContent = this.labels.mermaidError;
      const codeElement = document.createElement('pre');
      codeElement.className = 'cm-visual-code-fallback';
      codeElement.textContent = diagram;
      pre.replaceChildren(fallback, codeElement);
      header.dataset.failed = 'true';
      view.requestMeasure();
    } finally {
      cleanupMermaidArtifacts(id, document, pre);
    }
  }
}

interface VisualCodeRenderState {
  blocks: readonly VisualCodeBlockInfo[];
  decorations: DecorationSet;
}

const EMPTY: VisualCodeRenderState = { blocks: [], decorations: Decoration.none };

function compute(state: EditorState): VisualCodeRenderState {
  const labels = state.facet(codeBlockLabels);
  if (!labels) return EMPTY;
  const blocks = collectVisualCodeBlocks(state).filter((block) => !isVisualSourceLine(state, block.from, block.to));
  if (blocks.length === 0) return EMPTY;
  const decorations = Decoration.set(blocks.map((block) =>
    Decoration.replace({ block: true, widget: new VisualCodeWidget(block, labels) }).range(block.from, block.to)
  ), true);
  return { blocks, decorations };
}

export const visualCodeBlockField = StateField.define<VisualCodeRenderState>({
  create: compute,
  update(value, transaction) {
    const state = transaction.state;
    if (!transaction.docChanged && !transaction.selection &&
        transaction.startState.facet(codeBlockLabels) === state.facet(codeBlockLabels) &&
        syntaxTree(transaction.startState) === syntaxTree(state)) {
      return value;
    }
    return compute(state);
  },
  provide: (field) => EditorView.decorations.from(field, (value) => value.decorations),
});

/** True when a range is currently replaced by a rendered code box. */
export function isVisualCodeBlockRendered(state: EditorState, from: number, to: number): boolean {
  return state.field(visualCodeBlockField, false)?.blocks.some((block) => from < block.to && to > block.from) ?? false;
}

export function createVisualCodeBlockExtension(labels: VisualCodeBlockLabels): Extension {
  return [codeBlockLabels.of(labels), visualCodeBlockField, visualCodeTheme];
}

const visualCodeTheme = EditorView.baseTheme({
  // CodeMirror measures the widget's border box, which excludes margins.
  '.cm-visual-code-block': { paddingBlock: '0.55em' },
  '.cm-visual-code': {
    boxSizing: 'border-box',
    border: '1px solid #e2e8f0',
    borderRadius: '7px',
    overflow: 'hidden',
    background: '#f8fafc',
  },
  '&dark .cm-visual-code': { borderColor: '#334155', background: '#0f172a' },
  '.cm-visual-code-header': {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '8px',
    padding: '3px 8px',
    borderBottom: '1px solid #e2e8f0',
    color: '#64748b',
    fontSize: '11px',
  },
  '&dark .cm-visual-code-header': { borderColor: '#334155', color: '#94a3b8' },
  '.cm-visual-code-language': {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
  },
  '.cm-visual-code-copy': {
    padding: '2px 7px',
    font: 'inherit',
    color: 'inherit',
    background: 'transparent',
    border: '1px solid #cbd5e1',
    borderRadius: '4px',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  },
  '&dark .cm-visual-code-copy': { borderColor: '#475569' },
  '.cm-visual-code-copy[data-state=copied]': { color: '#059669', borderColor: '#34d399' },
  '.cm-visual-code-copy[data-state=failed]': { color: '#dc2626', borderColor: '#f87171' },
  '.cm-visual-code-copy:focus-visible': { outline: '2px solid #3b82f6', outlineOffset: '1px' },
  '.cm-visual-code-body': {
    margin: '0',
    padding: '9px 11px',
    overflowX: 'auto',
    maxHeight: '420px',
    color: '#0f172a',
    fontFamily: 'Consolas, "Cascadia Code", monospace',
    fontSize: '0.86em',
    lineHeight: '1.55',
    whiteSpace: 'pre',
  },
  '&dark .cm-visual-code-body': { color: '#e2e8f0' },
  '.cm-visual-code-body svg': { display: 'block', margin: '0 auto', maxWidth: '100%', height: 'auto' },
  '.cm-visual-code-status': { padding: '6px 0', color: '#64748b' },
  '&dark .cm-visual-code-status': { color: '#94a3b8' },
  '.cm-visual-code-fallback': { margin: '6px 0 0', padding: '0', font: 'inherit', whiteSpace: 'pre', color: '#b91c1c' },
  '&dark .cm-visual-code-fallback': { color: '#fca5a5' },
});
