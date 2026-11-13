import { Extension, RangeSetBuilder } from '@codemirror/state';
import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate } from '@codemirror/view';

const FENCE_RE = /^\s*(`{3,}|~{3,})/;

/**
 * Computes the 0-based inclusive line range `[start, end]` of the active block
 * around `cursorLineIndex`. Contiguous non-empty lines form a paragraph; a
 * fenced code block stays focused as a single unit.
 */
export function getActiveParagraphRange(
  lines: readonly string[],
  cursorLineIndex: number
): { start: number; end: number } {
  if (lines.length === 0) return { start: 0, end: 0 };
  const clamped = Math.max(0, Math.min(cursorLineIndex, lines.length - 1));

  // Check whether the cursor sits inside a fenced code block (scan up to a
  // reasonable window around the cursor so giant files stay O(1)).
  const scanStart = Math.max(0, clamped - 500);
  const scanEnd = Math.min(lines.length - 1, clamped + 500);
  let inFence = false;
  let fenceChar = '';
  let fenceStart = -1;

  for (let i = scanStart; i <= scanEnd; i++) {
    const match = FENCE_RE.exec(lines[i]);
    if (match) {
      const ch = match[1][0];
      if (!inFence) {
        inFence = true;
        fenceChar = ch;
        fenceStart = i;
      } else if (ch === fenceChar) {
        if (clamped >= fenceStart && clamped <= i) {
          return { start: fenceStart, end: i };
        }
        inFence = false;
        fenceChar = '';
        fenceStart = -1;
      }
    }
  }
  if (inFence && fenceStart !== -1 && clamped >= fenceStart) {
    return { start: fenceStart, end: scanEnd };
  }

  if (lines[clamped].trim() === '') {
    return { start: clamped, end: clamped };
  }

  let start = clamped;
  while (start > 0 && lines[start - 1].trim() !== '' && !FENCE_RE.test(lines[start - 1])) {
    start--;
  }
  let end = clamped;
  while (
    end < lines.length - 1 &&
    lines[end + 1].trim() !== '' &&
    !FENCE_RE.test(lines[end + 1])
  ) {
    end++;
  }
  return { start, end };
}

const dimLineDecoration = Decoration.line({ class: 'cm-focus-dim' });

function buildFocusDecorations(view: EditorView): DecorationSet {
  const { doc, selection } = view.state;
  const cursorLineNum = doc.lineAt(selection.main.head).number; // 1-based

  // Extract a bounded window around the cursor so finding the active block is
  // O(1) regardless of total document length.
  const winFirst = Math.max(1, cursorLineNum - 500);
  const winLast = Math.min(doc.lines, cursorLineNum + 500);
  const windowLines: string[] = [];
  for (let n = winFirst; n <= winLast; n++) {
    windowLines.push(doc.line(n).text);
  }
  const rel = getActiveParagraphRange(windowLines, cursorLineNum - winFirst);
  const activeStartLine = winFirst + rel.start;
  const activeEndLine = winFirst + rel.end;

  const builder = new RangeSetBuilder<Decoration>();
  for (const { from, to } of view.visibleRanges) {
    let pos = from;
    while (pos <= to) {
      const line = doc.lineAt(pos);
      if (line.number < activeStartLine || line.number > activeEndLine) {
        builder.add(line.from, line.from, dimLineDecoration);
      }
      if (line.to >= to) break;
      pos = line.to + 1;
    }
  }
  return builder.finish();
}

/**
 * Focus mode: dims paragraphs other than the one currently under the cursor.
 */
export function createFocusModeExtension(): Extension {
  const plugin = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = buildFocusDecorations(view);
      }
      update(update: ViewUpdate) {
        if (update.docChanged || update.selectionSet || update.viewportChanged) {
          this.decorations = buildFocusDecorations(update.view);
        }
      }
    },
    { decorations: (instance) => instance.decorations }
  );

  const theme = EditorView.baseTheme({
    '.cm-line.cm-focus-dim': {
      opacity: '0.35',
      transition: 'opacity 120ms ease-out',
    },
  });

  return [plugin, theme];
}
