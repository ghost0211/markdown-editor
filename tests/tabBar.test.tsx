import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { TabBar } from '../src/components/TabBar';
import { DocumentTab } from '../src/types';
import { I18nProvider } from '../src/i18n';
import { zhCN } from '../src/i18n/locales/zh-CN';
import { enUS } from '../src/i18n/locales/en-US';

describe('TabBar & Tab Context Menu (TabBar.tsx)', () => {
  const mockTabs: DocumentTab[] = [
    {
      id: 'tab-1',
      title: 'Doc 1.md',
      filePath: 'C:/docs/Doc 1.md',
      content: '# Doc 1',
      savedContent: '# Doc 1',
      isDirty: false,
      cursorLine: 1,
      cursorCol: 1,
    },
    {
      id: 'tab-2',
      title: 'Unsaved Note.md',
      filePath: null,
      content: '# Draft',
      savedContent: '',
      isDirty: true,
      cursorLine: 1,
      cursorCol: 1,
    },
    {
      id: 'tab-3',
      title: 'Doc 3.md',
      filePath: 'C:/docs/Doc 3.md',
      content: '# Doc 3',
      savedContent: '# Doc 3',
      isDirty: false,
      cursorLine: 1,
      cursorCol: 1,
    },
  ];

  it('renders tab list with proper active tab and dirty indicators', () => {
    const html = renderToStaticMarkup(
      <I18nProvider language="zh-CN">
        <TabBar
          tabs={mockTabs}
          activeTabId="tab-1"
          onSelectTab={vi.fn()}
          onCloseTab={vi.fn()}
          onNewTab={vi.fn()}
          onCloseOthers={vi.fn()}
          onCloseToTheRight={vi.fn()}
          onCloseSaved={vi.fn()}
          onCloseAll={vi.fn()}
          onReloadTab={vi.fn()}
          onSaveTabAs={vi.fn()}
          onRevealInFolder={vi.fn()}
          onOpenFile={vi.fn()}
          showToast={vi.fn()}
        />
      </I18nProvider>
    );

    expect(html).toContain('role="tablist"');
    expect(html).toContain('Doc 1.md');
    expect(html).toContain('Unsaved Note.md');
    expect(html).toContain('Doc 3.md');
    expect(html).toContain('aria-selected="true"');
    expect(html).toContain('未保存（点击关闭）');
  });

  it('renders English locale tooltips correctly in en-US', () => {
    const html = renderToStaticMarkup(
      <I18nProvider language="en-US">
        <TabBar
          tabs={mockTabs}
          activeTabId="tab-2"
          onSelectTab={vi.fn()}
          onCloseTab={vi.fn()}
          onNewTab={vi.fn()}
        />
      </I18nProvider>
    );

    expect(html).toContain('role="tablist"');
    expect(html).toContain('Unsaved (Click to close)');
    expect(html).toContain('New Document (Ctrl+N)');
  });

  it('defines comprehensive context menu dictionary in zh-CN and en-US', () => {
    // Verify all menu keys exist in Chinese locale
    expect(zhCN.tabBar.contextMenu.close).toBe('关闭');
    expect(zhCN.tabBar.contextMenu.closeOthers).toBe('关闭其他标签页');
    expect(zhCN.tabBar.contextMenu.closeToTheRight).toBe('关闭右侧标签页');
    expect(zhCN.tabBar.contextMenu.closeSaved).toBe('关闭已保存标签页');
    expect(zhCN.tabBar.contextMenu.closeAll).toBe('关闭全部标签页');
    expect(zhCN.tabBar.contextMenu.revealInFolder).toBe('在文件资源管理器中显示');
    expect(zhCN.tabBar.contextMenu.copyPath).toBe('复制完整文件路径');
    expect(zhCN.tabBar.contextMenu.copyFileName).toBe('复制文件名');
    expect(zhCN.tabBar.contextMenu.reloadFromDisk).toBe('从磁盘重新载入');
    expect(zhCN.tabBar.contextMenu.saveAs).toBe('另存为...');
    expect(zhCN.tabBar.contextMenu.newTab).toBe('新建标签页');
    expect(zhCN.tabBar.contextMenu.openFile).toBe('打开文件...');

    // Verify all menu keys exist in English locale
    expect(enUS.tabBar.contextMenu.close).toBe('Close');
    expect(enUS.tabBar.contextMenu.closeOthers).toBe('Close Others');
    expect(enUS.tabBar.contextMenu.closeToTheRight).toBe('Close to the Right');
    expect(enUS.tabBar.contextMenu.closeSaved).toBe('Close Saved');
    expect(enUS.tabBar.contextMenu.closeAll).toBe('Close All');
    expect(enUS.tabBar.contextMenu.revealInFolder).toBe('Reveal in File Explorer');
    expect(enUS.tabBar.contextMenu.copyPath).toBe('Copy Full Path');
    expect(enUS.tabBar.contextMenu.copyFileName).toBe('Copy File Name');
    expect(enUS.tabBar.contextMenu.reloadFromDisk).toBe('Reload from Disk');
    expect(enUS.tabBar.contextMenu.saveAs).toBe('Save As...');
    expect(enUS.tabBar.contextMenu.newTab).toBe('New Tab');
    expect(enUS.tabBar.contextMenu.openFile).toBe('Open File...');
  });
});
