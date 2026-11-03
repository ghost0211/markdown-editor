import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Preview } from '../src/components/Preview';
import { I18nProvider } from '../src/i18n';

const CONTENT = ['- [ ] buy milk', '- [x] walk dog'].join('\n');

const render = (props: { onToggleTask?: (next: string) => void }) =>
  renderToStaticMarkup(
    <I18nProvider language="en-US">
      <Preview content={CONTENT} {...props} />
    </I18nProvider>
  );

describe('Preview task-list checkboxes', () => {
  it('renders task checkboxes for GFM task items', () => {
    const html = render({ onToggleTask: vi.fn() });
    const checkboxes = html.match(/type="checkbox"/g) || [];
    expect(checkboxes.length).toBe(2);
  });

  it('leaves checkboxes enabled when they can be toggled', () => {
    const html = render({ onToggleTask: vi.fn() });
    // remark-gfm emits `disabled`; the preview must drop it, otherwise clicking
    // the box never fires onChange.
    expect(html).not.toMatch(/<input[^>]*type="checkbox"[^>]*disabled/);
    expect(html).toMatch(/class="[^"]*cursor-pointer/);
  });

  it('keeps checkboxes disabled when no toggle handler is provided', () => {
    const html = render({});
    expect(html).toMatch(/<input[^>]*type="checkbox"[^>]*disabled/);
  });

  it('reflects the checked state from the source', () => {
    const html = render({ onToggleTask: vi.fn() });
    // Exactly one item is checked in the markdown. Match per-input tags so the
    // assertion does not depend on React's attribute ordering.
    const inputs = html.match(/<input[^>]*type="checkbox"[^>]*>/g) || [];
    const checkedInputs = inputs.filter((tag) => tag.includes('checked=""'));
    expect(inputs).toHaveLength(2);
    expect(checkedInputs).toHaveLength(1);
  });
});
