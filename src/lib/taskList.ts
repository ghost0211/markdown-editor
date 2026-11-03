/**
 * Toggling GFM task-list checkboxes from the preview.
 *
 * remark-gfm renders `<input type="checkbox" disabled>` for `- [ ] item`, so
 * clicking a box in the preview did nothing. To make it work we need to map a
 * rendered checkbox back to the exact source line that produced it and flip
 * `[ ]` <-> `[x]` there.
 *
 * The line is recovered from the DOM: every block element rendered by
 * `Preview` carries the source line it came from in a `data-line` attribute.
 */

/** Matches a GFM task item, capturing the marker prefix and the state. */
const TASK_LINE_PATTERN = /^(\s*(?:>\s*)*(?:[-*+]|\d+[.)])\s+\[)([ xX])(\])/;

/**
 * Returns the 1-based source line of the closest element carrying
 * `data-line`, or `null` when there is none. Walking up from the checkbox
 * stops at the preview container, so a checkbox can never resolve to a line
 * outside its own document.
 */
export function findSourceLineForElement(element: Element | null): number | null {
  let current: Element | null = element;
  while (current) {
    const raw = current.getAttribute('data-line');
    if (raw) {
      const line = Number.parseInt(raw, 10);
      if (Number.isFinite(line) && line > 0) return line;
    }
    current = current.parentElement;
  }
  return null;
}

/**
 * Flips the checkbox state of the task item on `line` (1-based).
 *
 * Returns the new content when the line actually holds a task item, or `null`
 * when it does not — callers should treat `null` as "nothing to change".
 */
export function toggleTaskCheckboxAtLine(content: string, line: number): string | null {
  if (!Number.isInteger(line) || line < 1) return null;

  const lines = content.split('\n');
  if (line > lines.length) return null;

  const target = lines[line - 1];
  const match = TASK_LINE_PATTERN.exec(target);
  if (!match) return null;

  lines[line - 1] =
    match[1] + (match[2] === ' ' ? 'x' : ' ') + match[3] + target.slice(match[0].length);
  return lines.join('\n');
}
