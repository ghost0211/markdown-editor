import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Preview } from '../src/components/Preview';
import { I18nProvider } from '../src/i18n';

const require = createRequire(import.meta.url);
const rendererRequire = createRequire(require.resolve('rehype-katex'));
const samples = readFileSync(new URL('./fixtures/math-formulas.md', import.meta.url), 'utf8');
const sections = samples.split(/^## /m).slice(1).map(section => {
  const newline = section.indexOf('\n');
  return { name: section.slice(0, newline), markdown: section.slice(newline + 1) };
});

function render(markdown: string): string {
  return renderToStaticMarkup(
    <I18nProvider language="zh-CN">
      <Preview content={markdown} />
    </I18nProvider>
  );
}

describe('math preview compatibility', () => {
  it('loads the stylesheet belonging to the KaTeX version used by rehype-katex', () => {
    const css = readFileSync(require.resolve('katex/dist/katex.min.css'), 'utf8');
    const stylesheetVersion = css.match(/\.katex-version(?:::|:)after\s*\{\s*content:\s*["']([^"']+)/)?.[1];
    const rendererVersion = rendererRequire('katex').version;

    // Generated layout classes change between KaTeX releases. Markup existing
    // in the DOM does not prove that an unrelated stylesheet can display it.
    expect(stylesheetVersion).toBe(rendererVersion);
  });

  it.each(sections)('renders $name without formula errors', ({ markdown }) => {
    const html = render(markdown);
    const visualHtml = html.replace(/<span class="katex-mathml">[\s\S]*?<\/math><\/span>/g, '');

    expect(visualHtml).toContain('class="katex-html"');
    expect(visualHtml).not.toContain('katex-error');
    expect(visualHtml).not.toContain('color:#cc0000');
    expect(visualHtml).toMatch(/class="(?:mord|mrel|mbin|mop|mopen)[^"]*"[^>]*>[^<]+</);
  });

  it('preserves inline code and escaped dollar signs alongside adjacent formulas', () => {
    const html = render(sections[12].markdown);

    expect(html).toContain('>$x^2$</code>');
    expect(html).toContain('$100 和 $200');
    expect(html.match(/class="katex"/g)).toHaveLength(3);
  });
});
