import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  QualityPanel,
  QualityPanelView,
  filterQualityIssues,
  formatQualityError,
  summarizeQualityIssues,
  type QualityPanelViewProps,
} from '../src/components/QualityPanel';
import { I18nProvider } from '../src/i18n';
import type { QualityIssue } from '../src/lib/documentQuality';

const sampleIssues: QualityIssue[] = [
  {
    id: 'syntax-0-unclosed-code-fence-3-1',
    rule: 'unclosed-code-fence',
    severity: 'error',
    line: 3,
    column: 1,
    message: '代码块围栏未闭合',
  },
  {
    id: 'syntax-1-heading-level-jump-5-1',
    rule: 'heading-level-jump',
    severity: 'warning',
    line: 5,
    column: 1,
    message: '标题层级跳跃：H1 之后直接出现 H3',
  },
  {
    id: 'syntax-2-duplicate-heading-7-1',
    rule: 'duplicate-heading',
    severity: 'info',
    line: 7,
    column: 1,
    message: '标题重复：“Intro”（首次出现于第 1 行）',
  },
];

function renderView(
  overrides: Partial<QualityPanelViewProps> = {},
  language: 'zh-CN' | 'en-US' = 'zh-CN'
): string {
  const props: QualityPanelViewProps = {
    isOpen: true,
    onClose: vi.fn(),
    onLocate: vi.fn(),
    onRefresh: vi.fn(),
    status: 'ready',
    issues: sampleIssues,
    error: null,
    isDocumentEmpty: false,
    filter: 'all',
    onFilterChange: vi.fn(),
    sourceFilePath: 'D:\\docs\\notes.md',
    ...overrides,
  };
  return renderToStaticMarkup(
    <I18nProvider language={language}>
      <QualityPanelView {...props} />
    </I18nProvider>
  );
}

function renderPanel(
  content: string,
  language: 'zh-CN' | 'en-US' = 'zh-CN'
): string {
  return renderToStaticMarkup(
    <I18nProvider language={language}>
      <QualityPanel
        isOpen
        onClose={vi.fn()}
        content={content}
        sourceFilePath="D:\\docs\\notes.md"
        onLocate={vi.fn()}
      />
    </I18nProvider>
  );
}

describe('QualityPanel pure helpers', () => {
  it('summarizes every severity and filters without mutating input', () => {
    expect(summarizeQualityIssues(sampleIssues)).toEqual({
      total: 3,
      errors: 1,
      warnings: 1,
      infos: 1,
    });
    expect(summarizeQualityIssues([])).toEqual({
      total: 0,
      errors: 0,
      warnings: 0,
      infos: 0,
    });

    const errors = filterQualityIssues(sampleIssues, 'error');
    expect(errors.map((issue) => issue.rule)).toEqual(['unclosed-code-fence']);
    expect(filterQualityIssues(sampleIssues, 'warning')).toHaveLength(1);
    expect(filterQualityIssues(sampleIssues, 'info')).toHaveLength(1);
    expect(filterQualityIssues(sampleIssues, 'all')).toHaveLength(3);
    expect(sampleIssues).toHaveLength(3);
  });

  it('bounds error text, drops stack frames and shortens local paths', () => {
    expect(
      formatQualityError(new Error('读取失败 D:\\very\\long\\folder\\notes.md'))
    ).toBe('读取失败 notes.md');

    expect(
      formatQualityError(new Error('boom\n    at run (C:\\project\\src\\a.ts:1:2)'))
    ).toBe('boom');

    const long = formatQualityError('x'.repeat(500));
    expect(long.length).toBe(201);
    expect(long.endsWith('…')).toBe(true);

    expect(formatQualityError({})).toBe('未知错误');
    expect(formatQualityError(null, 'en-US')).toBe('Unknown error');
  });
});

describe('QualityPanel accessible dialog (SSR)', () => {
  it('renders a bounded, accessible loading state with a focusable close button', () => {
    const html = renderPanel('# Title');

    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toMatch(/aria-labelledby="([^"]+)"/);
    const labelledBy = /aria-labelledby="([^"]+)"/.exec(html)?.[1];
    expect(labelledBy).toBeTruthy();
    expect(html).toContain(`id="${labelledBy}"`);
    expect(html).toContain('aria-describedby=');

    expect(html).toContain('文档质量检查');
    expect(html).toContain('正在检查文档质量...');
    expect(html).toContain('大文档可能需要几秒钟');
    expect(html).toContain('仅提示，不会自动修改文档');
    expect(html).toContain('w-[820px]');
    expect(html).toContain('h-[70vh]');
    expect(html).toContain('max-h-[calc(100vh-2rem)]');
    // Refresh is disabled while the first check is running.
    expect(html).toMatch(/disabled=""[^>]*aria-label="检查中\.\.\."/);
  });

  it('renders a friendly error state with a retry action', () => {
    const html = renderView({
      status: 'error',
      issues: [],
      error: '资源检查服务不可用',
    });

    expect(html).toContain('role="alert"');
    expect(html).toContain('质量检查失败');
    expect(html).toContain('资源检查服务不可用');
    expect(html).toContain('请稍后重试；错误信息已截断');
    expect(html).toContain('重试');
    expect(html).not.toContain('正在检查文档质量');
  });

  it('renders summary counts, all filters, issue rows and the read-only hint', () => {
    const html = renderView();

    expect(html).toContain('共 3 项 · 错误 1 · 提醒 1 · 信息 1');
    expect(html).toContain('问题筛选');
    expect(html).toContain('全部');
    expect(html).toContain('错误');
    expect(html).toContain('提醒');
    expect(html).toContain('信息');
    expect(html).toContain('aria-pressed="true"');

    expect(html).toContain('文档：notes.md');
    expect(html).not.toContain('D:\\docs');

    expect(html).toContain('质量问题列表');
    expect(html).toContain('第 3 行，第 1 列');
    expect(html).toContain('代码块围栏未闭合');
    expect(html).toContain('标题层级跳跃：H1 之后直接出现 H3');
    expect(html).toContain('标题重复：“Intro”（首次出现于第 1 行）');
    expect(html).toContain('定位到第 3 行并关闭面板');
    expect(html).toContain('定位到第 5 行并关闭面板');
    expect(html).toContain('仅提示，不会自动修改文档');
  });

  it('shows only the selected severity while keeping the full summary', () => {
    const html = renderView({ filter: 'error' });

    expect(html).toContain('共 3 项 · 错误 1 · 提醒 1 · 信息 1');
    expect(html).toContain('代码块围栏未闭合');
    expect(html).not.toContain('标题层级跳跃：H1 之后直接出现 H3');
    expect(html).not.toContain('标题重复：“Intro”');
  });

  it('renders the healthy state when there are no issues', () => {
    const html = renderView({ issues: [] });

    expect(html).toContain('未发现问题');
    expect(html).toContain('文档结构与资源引用看起来都很好');
    expect(html).toContain('共 0 项 · 错误 0 · 提醒 0 · 信息 0');
  });

  it('renders the empty-document hint instead of an all-clear state', () => {
    const html = renderPanel('   \n\n  ');

    expect(html).toContain('文档为空');
    expect(html).toContain('输入内容后会自动检查文档质量');
    expect(html).not.toContain('未发现问题');
    expect(html).not.toContain('正在检查文档质量');
  });

  it('renders a no-matches hint for an empty filter result', () => {
    const infoOnly = sampleIssues.filter((issue) => issue.severity === 'info');
    const html = renderView({ issues: infoOnly, filter: 'error' });

    expect(html).toContain('当前筛选下没有问题');
    expect(html).toContain('切换到“全部”查看其他问题');
    expect(html).toContain('共 1 项 · 错误 0 · 提醒 0 · 信息 1');
  });

  it('renders English labels through the i18n fallback', () => {
    const html = renderView({}, 'en-US');

    expect(html).toContain('Document quality');
    expect(html).toContain('Document: notes.md');
    expect(html).toContain('Total 3 · Errors 1 · Warnings 1 · Info 1');
    expect(html).toContain('Line 3, column 1');
    expect(html).toContain('Reports only; your document is never changed');
    expect(html).toContain('Re-check');
    expect(html).not.toContain('quality.title');
  });

  it('renders nothing when closed', () => {
    expect(renderView({ isOpen: false })).toBe('');

    const closed = renderToStaticMarkup(
      <I18nProvider language="zh-CN">
        <QualityPanel
          isOpen={false}
          onClose={vi.fn()}
          content="# Title"
          onLocate={vi.fn()}
        />
      </I18nProvider>
    );
    expect(closed).toBe('');
  });
});
