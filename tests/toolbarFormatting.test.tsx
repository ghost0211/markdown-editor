import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Toolbar } from '../src/components/Toolbar';
import type { ToolbarProps } from '../src/components/Toolbar';
import { I18nProvider } from '../src/i18n';

function renderToolbar(language: 'zh-CN' | 'en-US', props: Partial<ToolbarProps> = {}): string {
  return renderToStaticMarkup(
    <I18nProvider language={language}>
      <Toolbar onAction={vi.fn()} {...props} />
    </I18nProvider>
  );
}

const countOccurrences = (html: string, needle: string) => html.split(needle).length - 1;

describe('Toolbar formatting controls', () => {
  it('merges heading levels into one native select including body text and H1-H6', () => {
    const html = renderToolbar('zh-CN');
    expect(html).toContain('<select');
    expect(html).toContain('aria-label="段落样式"');
    for (const value of ['paragraph', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6']) {
      expect(html).toContain(`value="${value}"`);
    }
    expect(html).toContain('正文');
    expect(html).toContain('一级标题 (# )');
    expect(html).toContain('六级标题 (###### )');
  });

  it('reflects activeFormats with a selected heading and aria-pressed toggles', () => {
    const html = renderToolbar('zh-CN', { activeFormats: ['h2', 'bold', 'task'] });
    expect(html).toMatch(/value="h2"[^>]*selected/);
    expect(html).toMatch(/aria-label="粗体[^"]*" aria-pressed="true"/);
    expect(html).toMatch(/aria-label="任务清单[^"]*" aria-pressed="true"/);
    expect(html).toMatch(/aria-label="斜体[^"]*" aria-pressed="false"/);
    // 4 inline + 2 code + 3 list toggles and 2 presentation buttons.
    expect(countOccurrences(html, 'aria-pressed')).toBe(11);
  });

  it('does not advertise insert-only actions as toggles', () => {
    const html = renderToolbar('zh-CN');
    const linkButton = html.match(/<button[^>]*aria-label="插入链接[^"]*"[^>]*>/)?.[0] ?? '';
    expect(linkButton).not.toBe('');
    expect(linkButton).not.toContain('aria-pressed');
  });

  it('renders the compact source/visual switch with bilingual titles and aria state', () => {
    const zh = renderToolbar('zh-CN', {
      presentation: 'visual',
      onPresentationChange: vi.fn(),
    });
    expect(zh).toContain('role="group"');
    expect(zh).toContain('aria-label="编辑视图模式"');
    expect(zh).toMatch(/aria-label="源码模式" aria-pressed="false"/);
    expect(zh).toMatch(/aria-label="可视化模式" aria-pressed="true"/);

    const en = renderToolbar('en-US', {
      presentation: 'source',
      onPresentationChange: vi.fn(),
    });
    expect(en).toContain('aria-label="Editor view mode"');
    expect(en).toMatch(/aria-label="Source mode" aria-pressed="true"/);
    expect(en).toMatch(/aria-label="Visual mode" aria-pressed="false"/);
  });

  it('keeps the existing insertion capabilities and English labels', () => {
    const html = renderToolbar('en-US');
    expect(html).toContain('Paragraph');
    expect(html).toContain('Heading 1 (# )');
    expect(html).toContain('Heading 4 (#### )');
    expect(html).toContain('Heading 6 (###### )');
    expect(html).toContain('Bold (**text**)');
    expect(html).toContain('Insert Link ([title](url))');
    expect(html).toContain('Insert Image (![alt](url))');
    expect(html).toContain('Insert Table');
    expect(html).toContain('Horizontal Rule (---)');
    expect(html).toContain('Code Block (```lang ... ```)');
  });

  it('disables the presentation switch until a handler is supplied', () => {
    const html = renderToolbar('zh-CN', { presentation: 'source' });
    expect(html).toMatch(/aria-label="源码模式"[^>]*disabled/);
    expect(html).toMatch(/aria-label="可视化模式"[^>]*disabled/);
  });

  it('disables every control when the editor is unavailable', () => {
    const html = renderToolbar('zh-CN', { disabled: true });
    expect(countOccurrences(html, 'disabled=""')).toBe(
      countOccurrences(html, '<button') + countOccurrences(html, '<select')
    );
  });
});
