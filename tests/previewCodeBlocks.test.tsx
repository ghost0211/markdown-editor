import React from 'react';
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  Preview,
  CODE_THEME,
  extractTextContent,
  CodeBlock,
  PreRenderer,
  InlineCode,
  BlockCode,
  PreContext,
} from '../src/components/Preview';
import { I18nProvider } from '../src/i18n';

/**
 * Convert standard sRGB 8-bit color component (0-255) to linear luminance value
 * according to WCAG 2.1 specification.
 */
function srgbToLinear(c: number): number {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

/**
 * Computes relative luminance (0.0 to 1.0) of a hexadecimal color string (#rrggbb)
 * as defined in WCAG 2.1 guidelines.
 */
function getRelativeLuminance(hex: string): number {
  const clean = hex.replace('#', '');
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
}

/**
 * Calculates the WCAG 2.1 contrast ratio between two hexadecimal colors.
 * Formula: (L1 + 0.05) / (L2 + 0.05) where L1 is lighter and L2 is darker.
 */
function getContrastRatio(color1: string, color2: string): number {
  const l1 = getRelativeLuminance(color1);
  const l2 = getRelativeLuminance(color2);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

describe('Preview Code Block High-Contrast & Hook-Safe Architecture Tests', () => {
  describe('WCAG 2.1 Contrast Ratio Verification & Theme Constants', () => {
    it('should exceed WCAG AAA contrast ratio (>= 7.0:1) for base code text foreground against card background', () => {
      const contrast = getContrastRatio(CODE_THEME.text, CODE_THEME.bg);
      // #c9d1d9 on #0d1117 gives ~12.26:1
      expect(contrast).toBeGreaterThanOrEqual(7.0);
      expect(contrast).toBeGreaterThanOrEqual(4.5); // AA is also satisfied
      expect(CODE_THEME.text.toLowerCase()).toBe('#c9d1d9');
      expect(CODE_THEME.bg.toLowerCase()).toBe('#0d1117');
    });

    it('should satisfy WCAG AA contrast ratio (>= 4.5:1) for header text against header background', () => {
      const contrast = getContrastRatio(CODE_THEME.headerText, CODE_THEME.headerBg);
      // #8b949e on #161b22 gives ~5.74:1
      expect(contrast).toBeGreaterThanOrEqual(4.5);
      expect(CODE_THEME.headerText.toLowerCase()).toBe('#8b949e');
      expect(CODE_THEME.headerBg.toLowerCase()).toBe('#161b22');
    });

    it('should define headerBorder constant conforming to GitHub dark theme palette', () => {
      expect(CODE_THEME.headerBorder.toLowerCase()).toBe('#30363d');
    });
  });

  describe('Block vs Inline Code Classification', () => {
    it('should classify inline backtick code as inline element without card wrapper', () => {
      const md = 'This is an `inline_variable` and another `inlineFunction()`.';
      const html = renderToStaticMarkup(
        <I18nProvider language="zh-CN">
          <Preview content={md} />
        </I18nProvider>
      );

      // Inline code should have pink styling and slate background
      expect(html).toContain('text-pink-600');
      expect(html).toContain('inline_variable');
      expect(html).toContain('inlineFunction()');

      // Should NOT contain block card header or copy buttons
      expect(html).not.toContain('uppercase tracking-wider');
      expect(html).not.toContain('background-color:#161b22');
    });

    it('should classify single-line fenced code block without language as block card (not inline)', () => {
      const md = '```\nsingle line without language\n```';
      const html = renderToStaticMarkup(
        <I18nProvider language="zh-CN">
          <Preview content={md} />
        </I18nProvider>
      );

      // Must be rendered in block card with high-contrast theme styling
      expect(html).toContain('single line without language');
      expect(html).toContain(`background-color:${CODE_THEME.bg}`);
      expect(html).toContain(`border-color:${CODE_THEME.headerBorder}`);
      expect(html).toContain(`background-color:${CODE_THEME.headerBg}`);
      expect(html).toContain(`color:${CODE_THEME.headerText}`);
      expect(html).toContain(`color:${CODE_THEME.text}`);
      expect(html).toContain('background-color:transparent');
      expect(html).toContain('uppercase');
      expect(html).toContain('>text<'); // fallback language badge
    });

    it('should classify multi-line fenced code block without language with high contrast fallback', () => {
      const md = '```\nconst a = 1;\nconst b = 2;\nconsole.log(a + b);\n```';
      const html = renderToStaticMarkup(
        <I18nProvider language="zh-CN">
          <Preview content={md} />
        </I18nProvider>
      );

      expect(html).toContain('const a = 1;');
      expect(html).toContain('console.log(a + b);');
      expect(html).toContain(`background-color:${CODE_THEME.bg}`);
      expect(html).toContain(`color:${CODE_THEME.text}`);
      expect(html).toContain('background-color:transparent');
    });

    it('should render fenced code block with text / plaintext with bright foreground fallback', () => {
      const md = '```text\nSample plaintext logs\nLine 2 of log\n```';
      const html = renderToStaticMarkup(
        <I18nProvider language="en-US">
          <Preview content={md} />
        </I18nProvider>
      );

      expect(html).toContain('Sample plaintext logs');
      expect(html).toContain('Line 2 of log');
      expect(html).toContain('>text<');
      expect(html).toContain(`background-color:${CODE_THEME.bg}`);
      expect(html).toContain(`color:${CODE_THEME.text}`);
      expect(html).toContain('background-color:transparent');
    });

    it('should render fenced code block with unknown language with bright foreground fallback', () => {
      const md = '```unknownlang\ncustom_instruction parameter = 42;\n```';
      const html = renderToStaticMarkup(
        <I18nProvider language="zh-CN">
          <Preview content={md} />
        </I18nProvider>
      );

      expect(html).toContain('custom_instruction parameter = 42;');
      expect(html).toContain('>unknownlang<');
      expect(html).toContain(`background-color:${CODE_THEME.bg}`);
      expect(html).toContain(`color:${CODE_THEME.text}`);
      expect(html).toContain('background-color:transparent');
    });

    it('should render indented code blocks (4 spaces) as code card with high-contrast styles', () => {
      const md = 'Paragraph before\n\n    def hello():\n        return "world"\n\nParagraph after';
      const html = renderToStaticMarkup(
        <I18nProvider language="en-US">
          <Preview content={md} />
        </I18nProvider>
      );

      expect(html).toContain('def hello():');
      expect(html).toContain('return &quot;world&quot;');
      expect(html).toContain(`background-color:${CODE_THEME.bg}`);
      expect(html).toContain(`color:${CODE_THEME.text}`);
      expect(html).toContain('background-color:transparent');
    });
  });

  describe('Mixed Inline + Block Code in Single Document', () => {
    it('should accurately and cleanly render documents containing both inline and block code', () => {
      const md = `# Mixed Document Test

Here is an inline expression: \`const answer = 42;\`.

Followed by a TypeScript block:
\`\`\`typescript
interface User {
  id: string;
  name: string;
}
\`\`\`

And another inline reference \`user.id\` with an untyped block:
\`\`\`
raw unformatted content
\`\`\`

Final inline: \`done()\`.
`;

      const html = renderToStaticMarkup(
        <I18nProvider language="zh-CN">
          <Preview content={md} />
        </I18nProvider>
      );

      // Inline code snippets must have inline styling
      expect(html).toContain('text-pink-600');
      expect(html).toContain('const answer = 42;');
      expect(html).toContain('user.id');
      expect(html).toContain('done()');

      // Block code snippets must have card wrappers and language badges
      expect(html).toContain('>typescript<');
      expect(html).toContain('>text<');
      expect(html).toContain('raw unformatted content');
      expect(html).toContain('hljs-keyword');
      expect(html).toContain('User');
      expect(html).toContain(`background-color:${CODE_THEME.bg}`);
      expect(html).toContain(`border-color:${CODE_THEME.headerBorder}`);
    });
  });

  describe('Dispatcher & Hook-Safety Architecture', () => {
    it('should route to InlineCode when rendered outside PreContext', () => {
      const html = renderToStaticMarkup(
        <I18nProvider language="zh-CN">
          <CodeBlock className="custom-inline">inline snippet</CodeBlock>
        </I18nProvider>
      );

      expect(html).toContain('<code');
      expect(html).toContain('custom-inline');
      expect(html).toContain('text-pink-600');
      expect(html).toContain('inline snippet');
      // No block card or copy button
      expect(html).not.toContain('uppercase tracking-wider');
      expect(html).not.toContain('background-color:#161b22');
    });

    it('should route to BlockCode when rendered inside PreRenderer / PreContext', () => {
      const html = renderToStaticMarkup(
        <I18nProvider language="zh-CN">
          <PreRenderer>
            <CodeBlock className="language-js">console.log("hello");</CodeBlock>
          </PreRenderer>
        </I18nProvider>
      );

      expect(html).toContain('>js<');
      expect(html).toContain('uppercase');
      expect(html).toContain('console.log(&quot;hello&quot;);');
      expect(html).toContain(`background-color:${CODE_THEME.bg}`);
      expect(html).toContain(`border-color:${CODE_THEME.headerBorder}`);
      expect(html).toContain(`background-color:${CODE_THEME.headerBg}`);
      expect(html).toContain('复制代码');
    });

    it('should preserve hook order without errors when switching context dynamically across renders', () => {
      // Test dynamic context switching simulating alternating render shapes
      const renderWithContext = (insidePre: boolean) => {
        return renderToStaticMarkup(
          <I18nProvider language="en-US">
            <PreContext.Provider value={insidePre}>
              <CodeBlock className="language-python">x = 1</CodeBlock>
            </PreContext.Provider>
          </I18nProvider>
        );
      };

      // 1. Render as inline
      const inlineOutput = renderWithContext(false);
      expect(inlineOutput).toContain('text-pink-600');
      expect(inlineOutput).not.toContain('Copy Code');

      // 2. Render as block
      const blockOutput = renderWithContext(true);
      expect(blockOutput).toContain('Copy Code');
      expect(blockOutput).toContain('>python<');
      expect(blockOutput).toContain('uppercase');

      // 3. Render as inline again
      const inlineOutput2 = renderWithContext(false);
      expect(inlineOutput2).toContain('text-pink-600');
      expect(inlineOutput2).not.toContain('Copy Code');
    });
  });

  describe('Incoming Style Prop Override Protection', () => {
    it('should not allow conflicting incoming DOM style props to override required fallback contrast in BlockCode', () => {
      // An attacker or parent component passes black background and light text or inverted colors
      const conflictingStyle: React.CSSProperties = {
        color: '#ff0000',
        backgroundColor: '#ffffff',
        fontSize: '20px',
      };

      const html = renderToStaticMarkup(
        <I18nProvider language="zh-CN">
          <BlockCode className="language-json" style={conflictingStyle}>
            {`{"key": "value"}`}
          </BlockCode>
        </I18nProvider>
      );

      // The custom non-conflicting style property is preserved
      expect(html).toContain('font-size:20px');
      // Crucial fallback contrast colors MUST NOT be overwritten by incoming style
      expect(html).toContain(`color:${CODE_THEME.text}`);
      expect(html).toContain('background-color:transparent');
    });

    it('should preserve incoming style props on InlineCode', () => {
      const customStyle: React.CSSProperties = {
        fontStyle: 'italic',
      };

      const html = renderToStaticMarkup(
        <InlineCode style={customStyle}>italic inline</InlineCode>
      );

      expect(html).toContain('font-style:italic');
      expect(html).toContain('italic inline');
    });
  });

  describe('Syntax Highlighting Token Preservation', () => {
    it('should preserve highlight.js syntax token classes for known languages (TypeScript)', () => {
      const md = '```typescript\nimport React from "react";\nconst count: number = 42;\n```';
      const html = renderToStaticMarkup(
        <I18nProvider language="zh-CN">
          <Preview content={md} />
        </I18nProvider>
      );

      // Syntax token spans must be present
      expect(html).toContain('hljs-keyword');
      expect(html).toContain('hljs-string');
      expect(html).toContain('hljs-number');
      expect(html).toContain('>typescript<');

      // Base card styles and high-contrast fallback are retained
      expect(html).toContain(`background-color:${CODE_THEME.bg}`);
      expect(html).toContain(`color:${CODE_THEME.text}`);
      expect(html).toContain('background-color:transparent');
    });

    it('should preserve highlight.js syntax token classes for Rust', () => {
      const md = '```rust\nfn main() {\n    let msg = "hello";\n    println!("{}", msg);\n}\n```';
      const html = renderToStaticMarkup(
        <I18nProvider language="en-US">
          <Preview content={md} />
        </I18nProvider>
      );

      expect(html).toContain('hljs-keyword');
      expect(html).toContain('hljs-title');
      expect(html).toContain('hljs-string');
      expect(html).toContain('>rust<');
      expect(html).toContain(`background-color:${CODE_THEME.bg}`);
    });
  });

  describe('Recursive Text Extraction for Copy Operation', () => {
    it('should extract plain string content cleanly from string input', () => {
      expect(extractTextContent('hello world\n')).toBe('hello world\n');
    });

    it('should extract plain string content recursively from React elements and nested token spans', () => {
      const reactTree = (
        <span>
          <span className="hljs-keyword">const</span> x = <span className="hljs-number">100</span>;
        </span>
      );
      expect(extractTextContent(reactTree)).toBe('const x = 100;');
    });

    it('should handle arrays, numbers, null, and undefined without throwing or producing [object Object]', () => {
      expect(extractTextContent(null)).toBe('');
      expect(extractTextContent(undefined)).toBe('');
      expect(extractTextContent(42)).toBe('42');
      expect(extractTextContent(['first ', <span>second</span>, ' third'])).toBe('first second third');
    });
  });
});
