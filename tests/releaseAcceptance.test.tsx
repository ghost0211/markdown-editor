import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nProvider } from '../src/i18n';
import { ConfirmModal } from '../src/components/ConfirmModal';
import { ShortcutsModal } from '../src/components/ShortcutsModal';
import { SettingsModal } from '../src/components/SettingsModal';
import { TabBar } from '../src/components/TabBar';
import { TitleBar } from '../src/components/TitleBar';
import { Preview } from '../src/components/Preview';
import { ToastContainer } from '../src/components/ToastContainer';
import { DEFAULT_SETTINGS } from '../src/lib/settings';
import { openOrFocusDocumentState } from '../src/lib/documentUtils';
import { DocumentTab } from '../src/types';

describe('Release Acceptance & Quality Assurance (v1.3.1)', () => {
  describe('Consistent Release Version 1.3.1 across all Project Manifests', () => {
    const rootDir = resolve(__dirname, '..');

    it('package.json should have version 1.3.1', () => {
      const pkg = JSON.parse(readFileSync(resolve(rootDir, 'package.json'), 'utf-8'));
      expect(pkg.version).toBe('1.3.1');
    });

    it('package-lock.json should have root version 1.3.1', () => {
      const lock = JSON.parse(readFileSync(resolve(rootDir, 'package-lock.json'), 'utf-8'));
      expect(lock.version).toBe('1.3.1');
      expect(lock.packages[''].version).toBe('1.3.1');
    });

    it('Cargo.toml should have version 1.3.1', () => {
      const toml = readFileSync(resolve(rootDir, 'src-tauri/Cargo.toml'), 'utf-8');
      const match = /name\s*=\s*"markdown-editor"\s*\nversion\s*=\s*"([^"]+)"/.exec(toml);
      expect(match).not.toBeNull();
      expect(match![1]).toBe('1.3.1');
    });

    it('Cargo.lock should have markdown-editor package version 1.3.1', () => {
      const lock = readFileSync(resolve(rootDir, 'src-tauri/Cargo.lock'), 'utf-8');
      const match = /\[\[package\]\]\s*\nname\s*=\s*"markdown-editor"\s*\nversion\s*=\s*"([^"]+)"/.exec(lock);
      expect(match).not.toBeNull();
      expect(match![1]).toBe('1.3.1');
    });

    it('tauri.conf.json should have version 1.3.1', () => {
      const conf = JSON.parse(readFileSync(resolve(rootDir, 'src-tauri/tauri.conf.json'), 'utf-8'));
      expect(conf.version).toBe('1.3.1');
    });
  });

  describe('Modal Accessibility & ARIA Attributes', () => {
    it('ConfirmModal should have role="dialog", aria-modal="true" and labelledby attributes', () => {
      const html = renderToStaticMarkup(
        <I18nProvider language="zh-CN">
          <ConfirmModal
            isOpen={true}
            title="确认操作"
            message="这是确认提示信息"
            onConfirm={vi.fn()}
            onCancel={vi.fn()}
          />
        </I18nProvider>
      );

      expect(html).toContain('role="dialog"');
      expect(html).toContain('aria-modal="true"');
      expect(html).toContain('aria-labelledby="confirm-modal-title"');
      expect(html).toContain('aria-describedby="confirm-modal-message"');
      expect(html).toContain('id="confirm-modal-title"');
      expect(html).toContain('id="confirm-modal-message"');
    });

    it('ShortcutsModal should have role="dialog", aria-modal="true" and labelledby attributes', () => {
      const html = renderToStaticMarkup(
        <I18nProvider language="zh-CN">
          <ShortcutsModal isOpen={true} onClose={vi.fn()} />
        </I18nProvider>
      );

      expect(html).toContain('role="dialog"');
      expect(html).toContain('aria-modal="true"');
      expect(html).toContain('aria-labelledby="shortcuts-modal-title"');
      expect(html).toContain('id="shortcuts-modal-title"');
    });

    it('SettingsModal should have role="dialog", aria-modal="true" and proper labelledby attribute', () => {
      const html = renderToStaticMarkup(
        <I18nProvider language="zh-CN">
          <SettingsModal
            isOpen={true}
            onClose={vi.fn()}
            settings={DEFAULT_SETTINGS}
            onUpdateSetting={vi.fn()}
            onResetSettings={vi.fn()}
            showToast={vi.fn()}
          />
        </I18nProvider>
      );

      expect(html).toContain('role="dialog"');
      expect(html).toContain('aria-modal="true"');
      expect(html).toContain('aria-labelledby="settings-modal-title"');
      expect(html).toContain('id="settings-modal-title"');
    });
  });

  describe('TabBar & TitleBar Accessibility & Semantic Buttons', () => {
    it('TabBar should render with role="tablist", role="tab", aria-selected, and semantic buttons', () => {
      const tabs: DocumentTab[] = [
        {
          id: 'tab-1',
          title: 'Document1.md',
          filePath: 'C:/docs/Document1.md',
          content: 'test',
          savedContent: 'test',
          isDirty: false,
          cursorLine: 1,
          cursorCol: 1,
        },
        {
          id: 'tab-2',
          title: 'Document2.md',
          filePath: null,
          content: 'unsaved draft',
          savedContent: '',
          isDirty: true,
          cursorLine: 1,
          cursorCol: 1,
        },
      ];

      const html = renderToStaticMarkup(
        <I18nProvider language="en-US">
          <TabBar
            tabs={tabs}
            activeTabId="tab-1"
            onSelectTab={vi.fn()}
            onCloseTab={vi.fn()}
            onNewTab={vi.fn()}
          />
        </I18nProvider>
      );

      expect(html).toContain('role="tablist"');
      expect(html).toContain('role="tab"');
      expect(html).toContain('aria-selected="true"');
      expect(html).toContain('aria-selected="false"');
      expect(html).toContain('aria-label="Close Tab (Ctrl+W)"');
      expect(html).toContain('aria-label="Unsaved (Click to close)"');
      expect(html).toContain('aria-label="New Document (Ctrl+N)"');
    });

    it('TitleBar should render aria-expanded and aria-haspopup for dropdowns/sidebars', () => {
      const activeTab: DocumentTab = {
        id: 'tab-1',
        title: 'WorkPlan.md',
        filePath: 'C:/WorkPlan.md',
        content: '# Work Plan',
        savedContent: '# Work Plan',
        isDirty: false,
        cursorLine: 1,
        cursorCol: 1,
      };

      const html = renderToStaticMarkup(
        <I18nProvider language="zh-CN">
          <TitleBar
            activeTab={activeTab}
            viewMode="split"
            onSetViewMode={vi.fn()}
            theme="light"
            onSetTheme={vi.fn()}
            isSidebarOpen={true}
            onToggleSidebar={vi.fn()}
            onNew={vi.fn()}
            onOpen={vi.fn()}
            onSave={vi.fn()}
            onSaveAs={vi.fn()}
            onExportWord={vi.fn()}
            onExportPdf={vi.fn()}
            onExportHtml={vi.fn()}
            onOpenShortcuts={vi.fn()}
            onOpenSettings={vi.fn()}
          />
        </I18nProvider>
      );

      expect(html).toContain('aria-expanded="true"');
      expect(html).toContain('aria-haspopup="menu"');
      expect(html).toContain('aria-label="收起大纲 (Ctrl+Shift+O)"');
      expect(html).toContain('aria-label="偏好设置"');
      expect(html).toContain('aria-label="快捷键列表"');
    });

    it('ToastContainer should have role="status" and aria-live="polite"', () => {
      const html = renderToStaticMarkup(
        <ToastContainer
          toasts={[
            { id: '1', message: 'File saved successfully', type: 'success', duration: 3000 },
          ]}
          onDismiss={vi.fn()}
        />
      );

      expect(html).toContain('role="status"');
      expect(html).toContain('aria-live="polite"');
      expect(html).toContain('aria-label="Dismiss"');
    });
  });

  describe('User Content Integrity (Zero Accidental Translation)', () => {
    it('should keep document title and text unaltered regardless of selected UI language', () => {
      const customTitle = '我的个人工作周报_2025.md';
      const customContent = '# 周报\n本周完成了核心模块的重构与单元测试。';

      const zhHtml = renderToStaticMarkup(
        <I18nProvider language="zh-CN">
          <Preview content={customContent} />
        </I18nProvider>
      );

      const enHtml = renderToStaticMarkup(
        <I18nProvider language="en-US">
          <Preview content={customContent} />
        </I18nProvider>
      );

      // Markdown body must retain exact user content in both languages
      expect(zhHtml).toContain('周报');
      expect(zhHtml).toContain('本周完成了核心模块的重构与单元测试。');
      expect(enHtml).toContain('周报');
      expect(enHtml).toContain('本周完成了核心模块的重构与单元测试。');

      // Check openOrFocusDocumentState title
      const state = openOrFocusDocumentState([], 'C:/reports/' + customTitle, customContent, customTitle);
      expect(state.tab.title).toBe(customTitle);
      expect(state.tab.content).toBe(customContent);
    });
  });
});
