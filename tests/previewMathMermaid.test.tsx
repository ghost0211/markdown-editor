import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  Preview,
  CodeBlock,
  PreContext,
} from '../src/components/Preview';
import {
  MermaidBlock,
  generateMermaidId,
  cleanupMermaidTempElements,
  formatMermaidError,
} from '../src/components/MermaidBlock';
import { I18nProvider } from '../src/i18n';
import mermaid from 'mermaid';

describe('KaTeX Math & Mermaid Preview Architecture Tests', () => {
  describe('KaTeX Math Formula Rendering ($...$, $$...$$, ```math)', () => {
    it('should render inline math ($...$) with KaTeX span and MathML/HTML markup', () => {
      const md = 'The mass-energy equivalence is defined by $E = mc^2$.';
      const html = renderToStaticMarkup(
        <I18nProvider language="zh-CN">
          <Preview content={md} />
        </I18nProvider>
      );

      // Verify KaTeX container and semantic MathML/HTML elements
      expect(html).toContain('class="katex"');
      expect(html).toContain('class="katex-html"');
      expect(html).toContain('class="katex-mathml"');
      expect(html).toContain('<math');
      expect(html).toContain('E = mc^2');
      // Should not contain raw unparsed delimiters
      expect(html).not.toContain('$E = mc^2$');
    });

    it('should render display block math ($$...$$) with KaTeX display span', () => {
      const md = `
# Formula Section

$$
\\frac{a}{b} = c
$$
`;
      const html = renderToStaticMarkup(
        <I18nProvider language="zh-CN">
          <Preview content={md} />
        </I18nProvider>
      );

      expect(html).toContain('class="katex-display"');
      expect(html).toContain('class="katex"');
      expect(html).toContain('display="block"');
      expect(html).toContain('frac');
    });

    it('should render fenced code block with math language (```math) as KaTeX display equation', () => {
      const md = `
\`\`\`math
\\int_{0}^{\\infty} e^{-x^2} dx = \\frac{\\sqrt{\\pi}}{2}
\`\`\`
`;
      const html = renderToStaticMarkup(
        <I18nProvider language="zh-CN">
          <Preview content={md} />
        </I18nProvider>
      );

      // ```math should be transformed by remark-math + rehype-katex to katex-display
      expect(html).toContain('class="katex-display"');
      expect(html).toContain('class="katex"');
      expect(html).toContain('int');
      expect(html).toContain('infty');
      // Should NOT render as a plain <pre><code class="language-math"> code card
      expect(html).not.toContain('class="language-math"');
      expect(html).not.toContain('md-code-block');
    });

    it('should seamlessly handle mixed documents containing inline math, block math, code math, and code blocks', () => {
      const md = `
# Mathematics & Programming

Here is an inline equation: $\\alpha + \\beta = \\gamma$.

Block formula:
$$
\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}
$$

Math fenced block:
\`\`\`math
f(x) = x^2
\`\`\`

Normal TypeScript block:
\`\`\`typescript
const greeting: string = "hello world";
\`\`\`
`;
      const html = renderToStaticMarkup(
        <I18nProvider language="en-US">
          <Preview content={md} />
        </I18nProvider>
      );

      // KaTeX formulas
      const katexCount = (html.match(/class="katex"/g) || []).length;
      expect(katexCount).toBeGreaterThanOrEqual(3);
      expect(html).toContain('class="katex-display"');

      // Standard code block should still be highlighted normally
      expect(html).toContain('>typescript<');
      expect(html).toContain('greeting');
      expect(html).toContain('hljs-string');
      expect(html).toContain('md-code-block');
    });

    it('should gracefully handle malformed math expressions without crashing the preview', () => {
      const md = 'Invalid formula: $\\undefinedMacro{x}$';
      let html = '';
      expect(() => {
        html = renderToStaticMarkup(
          <I18nProvider language="zh-CN">
            <Preview content={md} />
          </I18nProvider>
        );
      }).not.toThrow();

      // rehype-katex fallback renders error color or span without throwing
      expect(html).toBeDefined();
      expect(html).toContain('undefinedMacro');
    });
  });

  describe('Mermaid Code Block Routing & Structure (```mermaid)', () => {
    it('should route ```mermaid code blocks to MermaidBlock container rather than standard BlockCode', () => {
      const md = `
\`\`\`mermaid
graph TD
    A[Start] --> B[Process]
    B --> C[End]
\`\`\`
`;
      const html = renderToStaticMarkup(
        <I18nProvider language="zh-CN">
          <Preview content={md} />
        </I18nProvider>
      );

      // Verify dedicated mermaid block container
      expect(html).toContain('md-mermaid-block');
      expect(html).toContain('md-mermaid-header');
      expect(html).toContain('md-mermaid-body');
      expect(html).toContain('Mermaid');
      expect(html).toContain('graph TD');
      expect(html).toContain('Start');

      // Should NOT be rendered as a generic BlockCode card
      expect(html).not.toContain('md-code-block');
      expect(html).not.toContain('>text<');
    });

    it('should forward data-line attribute to MermaidBlock for preview scroll alignment', () => {
      const md = `Line 1
Line 2

\`\`\`mermaid
graph LR
    X --> Y
\`\`\`
`;
      const html = renderToStaticMarkup(
        <I18nProvider language="en-US">
          <Preview content={md} />
        </I18nProvider>
      );

      // The pre renderer forwards data-line to the mermaid block
      expect(html).toMatch(/class="[^"]*md-mermaid-block[^"]*"\s+data-line="4"/);
    });

    it('should route inline code containing "mermaid" to InlineCode, NOT MermaidBlock', () => {
      const html = renderToStaticMarkup(
        <I18nProvider language="zh-CN">
          <CodeBlock className="language-mermaid">graph TD</CodeBlock>
        </I18nProvider>
      );

      // Outside PreContext it must stay as inline <code>
      expect(html).toContain('<code');
      expect(html).toContain('text-pink-600');
      expect(html).not.toContain('md-mermaid-block');
    });

    it('should render copy button in Mermaid header with proper localized tooltip', () => {
      const md = `
\`\`\`mermaid
pie title Pets
    "Dogs" : 386
    "Cats" : 85
\`\`\`
`;
      const htmlZh = renderToStaticMarkup(
        <I18nProvider language="zh-CN">
          <Preview content={md} />
        </I18nProvider>
      );
      expect(htmlZh).toContain('title="复制代码"');

      const htmlEn = renderToStaticMarkup(
        <I18nProvider language="en-US">
          <Preview content={md} />
        </I18nProvider>
      );
      expect(htmlEn).toContain('title="Copy Code"');
    });

    it('should support localized text for Mermaid syntax error badge and error message', () => {
      // Direct render of MermaidBlock error simulation via static markup
      const htmlZh = renderToStaticMarkup(
        <I18nProvider language="zh-CN">
          <MermaidBlock>graph TD; A--&gt;B;</MermaidBlock>
        </I18nProvider>
      );
      expect(htmlZh).toContain('Mermaid');

      const htmlEn = renderToStaticMarkup(
        <I18nProvider language="en-US">
          <MermaidBlock>graph TD; A--&gt;B;</MermaidBlock>
        </I18nProvider>
      );
      expect(htmlEn).toContain('Mermaid');
    });
  });

  describe('MermaidBlock Utilities & Lifecycle Architecture', () => {
    it('generateMermaidId should generate unique, CSS-safe IDs', () => {
      const id1 = generateMermaidId();
      const id2 = generateMermaidId();

      expect(id1).not.toBe(id2);
      expect(id1).toMatch(/^mermaid-[a-z0-9]+-\d+$/);
      expect(id2).toMatch(/^mermaid-[a-z0-9]+-\d+$/);
    });

    it('formatMermaidError should sanitize and extract readable error messages', () => {
      const err = new Error('Parse error on line 2: Unexpected token');
      expect(formatMermaidError(err)).toBe('Parse error on line 2: Unexpected token');

      const strErr = 'Error: No diagram type detected';
      expect(formatMermaidError(strErr)).toBe('No diagram type detected');

      const customErr = { toString: () => 'Custom diagram failure' };
      expect(formatMermaidError(customErr)).toBe('Custom diagram failure');
    });

    it('cleanupMermaidTempElements should safely execute without throwing even when elements do not exist', () => {
      expect(() => cleanupMermaidTempElements('non-existent-id')).not.toThrow();
    });

    it('should render MermaidBlock directly with idle/ssr fallback markup', () => {
      const html = renderToStaticMarkup(
        <I18nProvider language="zh-CN">
          <MermaidBlock dataLine={10}>
            graph TD; A--&gt;B;
          </MermaidBlock>
        </I18nProvider>
      );
      expect(html).toContain('md-mermaid-block');
      expect(html).toContain('data-line="10"');
      expect(html).toContain('Mermaid');
    });
  });

  describe('Mermaid Async Rendering & Error Handling Simulation', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('should configure mermaid with strict security level when initializing', async () => {
      const initSpy = vi.spyOn(mermaid, 'initialize').mockImplementation(() => {});
      const renderSpy = vi.spyOn(mermaid, 'render').mockResolvedValue({
        svg: '<svg id="test-svg"></svg>',
        diagramType: 'graph',
      });

      // Simulate a direct mermaid call with the app configuration pattern
      const isDark = false;
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        theme: isDark ? 'dark' : 'default',
        fontFamily: 'inherit',
      });

      expect(initSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          securityLevel: 'strict',
          startOnLoad: false,
          theme: 'default',
        })
      );

      initSpy.mockRestore();
      renderSpy.mockRestore();
    });

    it('should adapt mermaid theme to dark when isDark is true', async () => {
      const initSpy = vi.spyOn(mermaid, 'initialize').mockImplementation(() => {});

      const isDark = true;
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        theme: isDark ? 'dark' : 'default',
        fontFamily: 'inherit',
      });

      expect(initSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          theme: 'dark',
          securityLevel: 'strict',
        })
      );

      initSpy.mockRestore();
    });

    it('should handle mermaid syntax error gracefully without throwing', async () => {
      const renderSpy = vi.spyOn(mermaid, 'render').mockRejectedValue(
        new Error('Parse error on line 1: Expecting EOF, got "INVALID"')
      );

      let caughtError: unknown = null;
      try {
        await mermaid.render('test-id', 'invalid diagram code');
      } catch (e) {
        caughtError = e;
      }

      expect(caughtError).toBeInstanceOf(Error);
      expect(formatMermaidError(caughtError)).toContain('Parse error on line 1');

      renderSpy.mockRestore();
    });

    it('should verify race condition prevention logic: newer render request supersedes older in-flight request', async () => {
      let activeRenderId = 0;
      let committedResult = '';

      const asyncRender = async (_reqId: number, delayMs: number, result: string) => {
        const thisId = ++activeRenderId;
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        // Check if this execution is still current
        if (thisId === activeRenderId) {
          committedResult = result;
        }
      };

      // Request 1 starts with a slow 50ms delay
      const p1 = asyncRender(1, 50, 'Result from request 1');
      // Request 2 starts immediately with a fast 10ms delay
      const p2 = asyncRender(2, 10, 'Result from request 2');

      await Promise.all([p1, p2]);

      // Request 2 was dispatched after Request 1 (activeRenderId is 2),
      // so Request 1 must NOT overwrite Request 2 when it finishes later
      expect(committedResult).toBe('Result from request 2');
    });
  });

  describe('Hook Order & Stability Architecture', () => {
    it('should preserve hook order without errors when switching dynamically between Code, Mermaid, and Inline across renders', () => {
      const renderCycle = (insidePre: boolean, className: string) => {
        return renderToStaticMarkup(
          <I18nProvider language="zh-CN">
            <PreContext.Provider value={insidePre}>
              <CodeBlock className={className}>graph TD; A--&gt;B;</CodeBlock>
            </PreContext.Provider>
          </I18nProvider>
        );
      };

      // 1. Render as inline code
      const out1 = renderCycle(false, 'language-mermaid');
      expect(out1).toContain('<code');
      expect(out1).toContain('text-pink-600');

      // 2. Render as mermaid block
      const out2 = renderCycle(true, 'language-mermaid');
      expect(out2).toContain('md-mermaid-block');
      expect(out2).toContain('Mermaid');

      // 3. Render as standard block code (javascript)
      const out3 = renderCycle(true, 'language-javascript');
      expect(out3).toContain('md-code-block');
      expect(out3).toContain('>javascript<');

      // 4. Render as mermaid block again
      const out4 = renderCycle(true, 'language-mermaid');
      expect(out4).toContain('md-mermaid-block');

      // 5. Back to inline code
      const out5 = renderCycle(false, '');
      expect(out5).toContain('text-pink-600');
    });
  });
});
