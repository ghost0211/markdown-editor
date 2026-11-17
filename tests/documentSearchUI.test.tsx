import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { DocumentSearch, type DocumentSearchProps } from '../src/components/DocumentSearch';
import { TitleBar } from '../src/components/TitleBar';
import { I18nProvider } from '../src/i18n';
import type { SearchTabInput } from '../src/lib/documentSearch';

const tabs: SearchTabInput[] = [
  {
    id: 'one',
    title: 'Notes.md',
    kind: 'document',
    content: 'alpha\nbeta gamma alpha',
  },
  {
    id: 'two',
    title: 'Spec.md',
    kind: 'document',
    content: 'gamma',
  },
  {
    id: 'diff',
    title: 'Compare',
    kind: 'diff',
    content: 'alpha',
  },
];

function renderSearch(
  language: 'zh-CN' | 'en-US',
  overrides: Partial<DocumentSearchProps> = {}
): string {
  const props: DocumentSearchProps = {
    isOpen: true,
    onClose: vi.fn(),
    tabs,
    activeTabId: 'one',
    onLocate: vi.fn(),
    onApply: vi.fn(() => true),
    ...overrides,
  };

  return renderToStaticMarkup(
    <I18nProvider language={language}>
      <DocumentSearch {...props} />
    </I18nProvider>
  );
}

describe('DocumentSearch SSR shell', () => {
  it('renders the 900px / 70vh modal with Chinese controls', () => {
    const html = renderSearch('zh-CN');

    expect(html).toContain('高级查找替换');
    expect(html).toContain('当前文档');
    expect(html).toContain('全部文档');
    expect(html).toContain('查找内容');
    expect(html).toContain('替换为');
    expect(html).toContain('预览替换');
    expect(html).toContain('替换当前项');
    expect(html).toContain('全部替换');
    expect(html).toContain('data: 内嵌资源默认受保护');
    expect(html).toContain('输入关键词开始搜索');
    expect(html).toContain('w-[900px]');
    expect(html).toContain('h-[70vh]');
    expect(html).toContain('aria-modal="true"');
  });

  it('renders English controls with tooltips', () => {
    const html = renderSearch('en-US');

    expect(html).toContain('Advanced Find &amp; Replace');
    expect(html).toContain('Current document');
    expect(html).toContain('All documents');
    expect(html).toContain('Preview replacement');
    expect(html).toContain('Replace current');
    expect(html).toContain('Replace all');
    expect(html).toContain('data: embedded resources are protected');
  });

  it('keeps replace actions disabled until a preview exists', () => {
    const html = renderSearch('zh-CN');
    const previewIndex = html.indexOf('预览替换');
    const applyCurrentIndex = html.indexOf('替换当前项');
    const applyAllIndex = html.indexOf('全部替换');

    expect(previewIndex).toBeGreaterThan(-1);
    expect(applyCurrentIndex).toBeGreaterThan(previewIndex);
    expect(applyAllIndex).toBeGreaterThan(applyCurrentIndex);

    const openingTag = (index: number) =>
      html.slice(html.lastIndexOf('<button', index), index);
    // SSR markup uses disabled="" for the two apply buttons.
    expect(openingTag(applyCurrentIndex)).toContain('disabled');
    expect(openingTag(applyAllIndex)).toContain('disabled');
    expect(openingTag(previewIndex)).toContain('disabled');
  });

  it('never renders embedded Base64 payloads in the shell', () => {
    const payload = 'A'.repeat(500);
    const html = renderSearch('zh-CN', {
      tabs: [
        {
          id: 'one',
          title: 'Image.md',
          kind: 'document',
          content: `![alt](data:image/png;base64,${payload})`,
        },
      ],
    });

    expect(html).not.toContain(payload);
    expect(html).not.toContain('data:image/png;base64,AAAA');
  });

  it('renders nothing when closed', () => {
    expect(renderSearch('zh-CN', { isOpen: false })).toBe('');
  });

  it('renders the current-scope warning for diff tabs', () => {
    const html = renderSearch('zh-CN', { activeTabId: 'diff' });
    expect(html).toContain('当前标签页是对比视图');
  });
});

describe('TitleBar search entry point', () => {
  const baseProps = {
    viewMode: 'split' as const,
    onSetViewMode: vi.fn(),
    theme: 'system' as const,
    onSetTheme: vi.fn(),
    isSidebarOpen: true,
    onToggleSidebar: vi.fn(),
    onNew: vi.fn(),
    onOpen: vi.fn(),
    onSave: vi.fn(),
    onSaveAs: vi.fn(),
    onExportWord: vi.fn(),
    onExportPdf: vi.fn(),
    onExportHtml: vi.fn(),
    onOpenShortcuts: vi.fn(),
    onOpenSettings: vi.fn(),
  };

  it('renders an accessible search icon when onOpenSearch is provided', () => {
    const onOpenSearch = vi.fn();
    const html = renderToStaticMarkup(
      <I18nProvider language="zh-CN">
        <TitleBar {...baseProps} onOpenSearch={onOpenSearch} />
      </I18nProvider>
    );

    expect(html).toContain('aria-label="高级查找替换"');
    expect(html).toContain('高级查找替换 (Ctrl+Shift+F / Ctrl+H)');
  });

  it('hides the search icon when the host does not wire it', () => {
    const html = renderToStaticMarkup(
      <I18nProvider language="zh-CN">
        <TitleBar {...baseProps} />
      </I18nProvider>
    );

    expect(html).not.toContain('aria-label="高级查找替换"');
  });
});
