import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactElement } from 'react';
import { I18nProvider } from '../src/i18n';
import {
  WorkspaceNameModal,
  WorkspacePanel,
  resolveWorkspaceEscapeAction,
  type WorkspacePanelProps,
} from '../src/components/WorkspacePanel';
import type { WorkspaceEntry } from '../src/lib/workspace';

const ROOT = 'C:\\workspace\\demo';

const ENTRIES: WorkspaceEntry[] = [
  { path: 'docs', name: 'docs', kind: 'directory' },
  { path: 'docs/guide', name: 'guide', kind: 'directory' },
  { path: 'docs/guide/intro.md', name: 'intro.md', kind: 'document' },
  { path: 'notes.md', name: 'notes.md', kind: 'document' },
];

function panelProps(overrides: Partial<WorkspacePanelProps> = {}): WorkspacePanelProps {
  return {
    isOpen: true,
    onClose: vi.fn(),
    rootPath: ROOT,
    entries: ENTRIES,
    activePath: null,
    onChoose: vi.fn(),
    onOpen: vi.fn(),
    onRefresh: vi.fn(),
    onCreateDocument: vi.fn(),
    onCreateFolder: vi.fn(),
    onRename: vi.fn(),
    ...overrides,
  };
}

function render(ui: ReactElement, language: 'zh-CN' | 'en-US' = 'zh-CN'): string {
  return renderToStaticMarkup(<I18nProvider language={language}>{ui}</I18nProvider>);
}

describe('WorkspacePanel rendering', () => {
  it('renders nothing while closed', () => {
    const html = render(<WorkspacePanel {...panelProps({ isOpen: false })} />);
    expect(html).toBe('');
  });

  it('prompts to choose a folder when no root is selected', () => {
    const html = render(<WorkspacePanel {...panelProps({ rootPath: null, entries: [] })} />);

    expect(html).toContain('工作区');
    expect(html).toContain('尚未选择工作区');
    expect(html).toContain('选择一个本地文件夹');
    expect(html).toContain('选择文件夹');
    expect(html).not.toContain('role="tree"');
    expect(html).not.toContain('位置：');
  });

  it('renders a tree with directories first and collapsed children hidden', () => {
    const html = render(<WorkspacePanel {...panelProps()} />);

    expect(html).toContain('role="tree"');
    expect(html).toContain('aria-label="工作区"');
    expect(html).toContain('docs');
    expect(html).toContain('notes.md');
    // `docs` starts collapsed, so nested entries are not in the markup yet.
    expect(html).not.toContain('guide');
    expect(html).not.toContain('intro.md');
    expect(html).toContain('aria-label="展开 docs"');
  });

  it('auto-expands the ancestors of the active document and marks it current', () => {
    const html = render(
      <WorkspacePanel
        {...panelProps({ activePath: `${ROOT}\\docs\\guide\\intro.md` })}
      />
    );

    expect(html).toContain('guide');
    expect(html).toContain('intro.md');
    expect(html).toContain('aria-current="page"');
    expect(html).toContain('bg-blue-50');
    expect(html).toContain('aria-label="收起 docs"');
    expect(html).toContain('aria-label="收起 guide"');
  });

  it('highlights the active document for a relative active path too', () => {
    const html = render(
      <WorkspacePanel {...panelProps({ activePath: 'docs/guide/intro.md' })} />
    );
    expect(html).toContain('aria-current="page"');
    expect(html).toContain('intro.md');
  });

  it('shows counts and the truncation warning at the cap', () => {
    const html = render(
      <WorkspacePanel {...panelProps({ truncated: true, entries: ENTRIES.slice(0, 3) })} />
    );

    expect(html).toContain('3 项');
    expect(html).toContain('role="status"');
    expect(html).toContain('文件过多，仅显示前 3 项。');
  });

  it('disables mutations and exposes aria-busy while a native call is running', () => {
    const html = render(<WorkspacePanel {...panelProps({ busy: true })} />);

    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('aria-label="正在处理…"');
    expect(html).toContain('disabled=""');
    expect(html).not.toContain('role="dialog"');
  });

  it('renders an empty-folder state for a selected but empty root', () => {
    const html = render(
      <WorkspacePanel {...panelProps({ rootPath: ROOT, entries: [] })} />
    );

    expect(html).toContain('此文件夹中没有可显示的文档或子文件夹。');
    expect(html).toContain('刷新');
    expect(html).not.toContain('role="tree"');
  });

  it('renders English copy when the locale is en-US', () => {
    const html = render(
      <WorkspacePanel {...panelProps({ activePath: `${ROOT}\\notes.md` })} />,
      'en-US'
    );

    expect(html).toContain('Workspace');
    expect(html).toContain('New Document');
    expect(html).toContain('New Folder');
    expect(html).toContain('4 items');
    expect(html).toContain('Workspace root');
    expect(html).toContain('aria-label="Expand docs"');
  });
});

describe('WorkspaceNameModal accessibility and copy', () => {
  const baseProps = {
    open: true,
    locationLabel: '位置：docs',
    title: '新建文档',
    onSubmit: vi.fn(),
    onClose: vi.fn(),
  };

  it('renders an accessible modal with a labelled name field', () => {
    const html = render(
      <WorkspaceNameModal {...baseProps} mode="create-document" initialName="todo" />
    );

    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('aria-labelledby=');
    expect(html).toContain('aria-describedby=');
    expect(html).toContain('新建文档');
    expect(html).toContain('名称');
    expect(html).toContain('value="todo"');
    expect(html).toContain('例如：笔记.md');
    expect(html).toContain('位置：docs');
    expect(html).toContain('取消');
    expect(html).toContain('创建');
  });

  it('uses folder copy, rename labels and a native error slot per mode', () => {
    const folder = render(<WorkspaceNameModal {...baseProps} mode="create-folder" title="新建文件夹" />);
    expect(folder).toContain('例如：笔记');
    expect(folder).toContain('创建');

    const rename = render(
      <WorkspaceNameModal
        {...baseProps}
        mode="rename"
        title="重命名 intro.md"
        initialName="intro.md"
        error="已存在同名文件或文件夹"
      />
    );
    expect(rename).toContain('重命名 intro.md');
    expect(rename).toContain('重命名');
    expect(rename).toContain('role="alert"');
    expect(rename).toContain('已存在同名文件或文件夹');
    expect(rename).toContain('aria-invalid="true"');
  });

  it('renders English copy and hides when closed', () => {
    const en = render(
      <WorkspaceNameModal
        {...baseProps}
        mode="create-folder"
        title="New Folder"
        locationLabel="Location: Workspace root"
      />,
      'en-US'
    );
    expect(en).toContain('Name');
    expect(en).toContain('e.g. Notes');
    expect(en).toContain('Cancel');
    expect(en).toContain('Create');

    const closed = render(<WorkspaceNameModal {...baseProps} mode="create-document" open={false} />);
    expect(closed).toBe('');
  });

  it('disables the submit button while busy', () => {
    const html = render(<WorkspaceNameModal {...baseProps} mode="create-document" busy />);
    expect(html).toContain('disabled=""');
    expect(html).toContain('animate-spin');
  });
});

describe('workspace Escape priority', () => {
  it('closes the name form first and only then the panel', () => {
    expect(resolveWorkspaceEscapeAction(true)).toBe('close-name');
    expect(resolveWorkspaceEscapeAction(false)).toBe('close-panel');
  });
});
