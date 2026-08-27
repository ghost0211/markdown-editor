import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { interpolate, t, tUnsafe, I18nProvider, getCurrentLanguage } from '../src/i18n';
import { zhCN } from '../src/i18n/locales/zh-CN';
import { enUS } from '../src/i18n/locales/en-US';
import { getWelcomeDocument, WELCOME_DOCUMENT_EN, WELCOME_DOCUMENT_ZH } from '../src/lib/defaultDocument';
import { SETTINGS_STORAGE_KEY } from '../src/lib/settings';
import { SettingsModal } from '../src/components/SettingsModal';
import { TitleBar } from '../src/components/TitleBar';
import { Toolbar } from '../src/components/Toolbar';
import { Sidebar } from '../src/components/Sidebar';
import { StatusBar } from '../src/components/StatusBar';
import { ShortcutsModal } from '../src/components/ShortcutsModal';
import { ConfirmModal } from '../src/components/ConfirmModal';
import { Preview } from '../src/components/Preview';
import { DEFAULT_SETTINGS } from '../src/lib/settings';

/**
 * Recursively collect all leaf key paths from a dictionary object.
 */
function collectLeafKeys(obj: Record<string, unknown>, prefix = ''): { path: string; value: string }[] {
  const result: { path: string; value: string }[] = [];
  for (const [key, value] of Object.entries(obj)) {
    const currentPath = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') {
      result.push({ path: currentPath, value });
    } else if (value && typeof value === 'object') {
      result.push(...collectLeafKeys(value as Record<string, unknown>, currentPath));
    }
  }
  return result;
}

/**
 * Extract all `{placeholder}` names from a string template.
 */
function extractPlaceholders(str: string): string[] {
  const matches = str.match(/\{([a-zA-Z0-9_]+)\}/g) || [];
  return matches.map((m) => m.slice(1, -1)).sort();
}

describe('Lightweight Typed i18n Architecture', () => {
  describe('Interpolation Helper (interpolate)', () => {
    it('should return original template if params are missing or empty', () => {
      expect(interpolate('Hello world')).toBe('Hello world');
      expect(interpolate('')).toBe('');
      expect(interpolate('Hello {name}')).toBe('Hello {name}');
      expect(interpolate('Hello {name}', {})).toBe('Hello {name}');
    });

    it('should interpolate single and multiple parameters', () => {
      expect(interpolate('Hello {name}!', { name: 'Alice' })).toBe('Hello Alice!');
      expect(
        interpolate('第 {line} 行, 第 {col} 列', { line: 42, col: 10 })
      ).toBe('第 42 行, 第 10 列');
    });

    it('should safely handle parameters containing regex special characters ($1, $&, etc.)', () => {
      expect(interpolate('Cost: {amount}', { amount: '$100.00' })).toBe('Cost: $100.00');
      expect(interpolate('{greeting}, $1 and $&!', { greeting: 'Welcome' })).toBe('Welcome, $1 and $&!');
    });

    it('should leave unknown placeholder tokens untouched', () => {
      expect(interpolate('{known} and {unknown}', { known: 'A' })).toBe('A and {unknown}');
    });
  });

  describe('Translation Completeness for both Locales (zh-CN & en-US)', () => {
    const zhLeaves = collectLeafKeys(zhCN);
    const enLeaves = collectLeafKeys(enUS);

    const zhKeyMap = new Map(zhLeaves.map((item) => [item.path, item.value]));
    const enKeyMap = new Map(enLeaves.map((item) => [item.path, item.value]));

    it('should have exact same number of translation keys in zh-CN and en-US', () => {
      expect(zhLeaves.length).toBeGreaterThan(50);
      expect(enLeaves.length).toBe(zhLeaves.length);
    });

    it('should ensure every key in zh-CN exists and is a non-empty string in en-US', () => {
      for (const [path, zhVal] of zhKeyMap.entries()) {
        expect(enKeyMap.has(path)).toBe(true);
        const enVal = enKeyMap.get(path);
        expect(typeof enVal).toBe('string');
        expect(enVal?.trim().length).toBeGreaterThan(0);
        expect(zhVal.trim().length).toBeGreaterThan(0);
      }
    });

    it('should ensure every key in en-US exists and is a non-empty string in zh-CN', () => {
      for (const [path] of enKeyMap.entries()) {
        expect(zhKeyMap.has(path)).toBe(true);
      }
    });

    it('should ensure placeholders match identically between zh-CN and en-US for every key', () => {
      for (const [path, zhVal] of zhKeyMap.entries()) {
        const enVal = enKeyMap.get(path) || '';
        const zhPlaceholders = extractPlaceholders(zhVal);
        const enPlaceholders = extractPlaceholders(enVal);
        expect(
          enPlaceholders,
          `Mismatch in placeholders for key "${path}": zh=[${zhPlaceholders.join(',')}], en=[${enPlaceholders.join(',')}]`
        ).toEqual(zhPlaceholders);
      }
    });
  });

  describe('Translation Lookup & Fallback (t & tUnsafe)', () => {
    it('should translate correctly in zh-CN', () => {
      expect(t('zh-CN', 'titleBar.newDoc')).toBe('新建');
      expect(t('zh-CN', 'settings.modalTitle')).toBe('偏好设置');
      expect(t('zh-CN', 'statusBar.cursorPos', { line: 5, col: 12 })).toBe('第 5 行, 第 12 列');
      expect(t('zh-CN', 'markdown.codeSnippet')).toBe('代码片段');
      expect(t('zh-CN', 'markdown.tableCol1')).toBe('列 1');
    });

    it('should translate correctly in en-US', () => {
      expect(t('en-US', 'titleBar.newDoc')).toBe('New');
      expect(t('en-US', 'settings.modalTitle')).toBe('Preferences');
      expect(t('en-US', 'statusBar.cursorPos', { line: 5, col: 12 })).toBe('Ln 5, Col 12');
      expect(t('en-US', 'markdown.codeSnippet')).toBe('Code Snippet');
      expect(t('en-US', 'markdown.tableCol1')).toBe('Column 1');
    });

    it('should fallback to zh-CN when key is missing or empty in target language via tUnsafe', () => {
      const fallbackResult = tUnsafe('en-US', 'common.nonExistentKey');
      expect(fallbackResult).toBe('common.nonExistentKey');
    });
  });

  describe('Welcome Document Localization (getWelcomeDocument)', () => {
    it('should return Chinese welcome title and content for zh-CN', () => {
      const doc = getWelcomeDocument('zh-CN');
      expect(doc.title).toBe('欢迎使用.md');
      expect(doc.content).toBe(WELCOME_DOCUMENT_ZH);
      expect(doc.content).toContain('# 欢迎使用 Markdown Editor');
      expect(doc.content).toContain('核心功能特性');
    });

    it('should return English welcome title and content for en-US', () => {
      const doc = getWelcomeDocument('en-US');
      expect(doc.title).toBe('Welcome.md');
      expect(doc.content).toBe(WELCOME_DOCUMENT_EN);
      expect(doc.content).toContain('# Welcome to Markdown Editor');
      expect(doc.content).toContain('Key Features');
    });
  });

  describe('Pure helper getCurrentLanguage persistence resolver', () => {
    let storageMock: Record<string, string> = {};

    beforeEach(() => {
      storageMock = {};
      const mockStorage = {
        getItem: vi.fn((key: string) => storageMock[key] ?? null),
        setItem: vi.fn((key: string, value: string) => {
          storageMock[key] = String(value);
        }),
        removeItem: vi.fn((key: string) => {
          delete storageMock[key];
        }),
        clear: vi.fn(() => {
          storageMock = {};
        }),
      };

      Object.defineProperty(globalThis, 'localStorage', {
        value: mockStorage,
        writable: true,
        configurable: true,
      });
    });

    afterEach(() => {
      delete (globalThis as unknown as { localStorage?: unknown }).localStorage;
      vi.restoreAllMocks();
    });

    it('should resolve language dynamically based on persisted localStorage setting', () => {
      expect(getCurrentLanguage()).toBe('zh-CN');

      storageMock[SETTINGS_STORAGE_KEY] = JSON.stringify({ language: 'en-US' });
      expect(getCurrentLanguage()).toBe('en-US');

      storageMock[SETTINGS_STORAGE_KEY] = JSON.stringify({ language: 'zh-CN' });
      expect(getCurrentLanguage()).toBe('zh-CN');

      storageMock[SETTINGS_STORAGE_KEY] = 'invalid-json';
      expect(getCurrentLanguage()).toBe('zh-CN');
    });
  });

  describe('Immediate Settings UI Language Rendering', () => {
    const mockOnClose = vi.fn();
    const mockOnUpdateSetting = vi.fn();
    const mockOnResetSettings = vi.fn();
    const mockShowToast = vi.fn();

    it('should immediately render Chinese Settings UI when language is zh-CN', () => {
      const html = renderToStaticMarkup(
        <I18nProvider language="zh-CN">
          <SettingsModal
            isOpen={true}
            onClose={mockOnClose}
            settings={{ ...DEFAULT_SETTINGS, language: 'zh-CN' }}
            onUpdateSetting={mockOnUpdateSetting}
            onResetSettings={mockOnResetSettings}
            showToast={mockShowToast}
          />
        </I18nProvider>
      );

      expect(html).toContain('偏好设置');
      expect(html).toContain('界面语言');
      expect(html).toContain('外观主题');
      expect(html).toContain('编辑器偏好');
      expect(html).toContain('启动与会话');
      expect(html).toContain('系统文件关联');
      expect(html).toContain('恢复默认设置');
      expect(html).toContain('完成');
      expect(html).toContain('跟随系统');
      expect(html).toContain('浅色模式');
      expect(html).toContain('深色模式');
      expect(html).toContain('自动折行');
      expect(html).toContain('显示行号');
      expect(html).toContain('恢复上次打开的文档');
    });

    it('should immediately render English Settings UI when language is en-US', () => {
      const html = renderToStaticMarkup(
        <I18nProvider language="en-US">
          <SettingsModal
            isOpen={true}
            onClose={mockOnClose}
            settings={{ ...DEFAULT_SETTINGS, language: 'en-US' }}
            onUpdateSetting={mockOnUpdateSetting}
            onResetSettings={mockOnResetSettings}
            showToast={mockShowToast}
          />
        </I18nProvider>
      );

      expect(html).toContain('Preferences');
      expect(html).toContain('Language');
      expect(html).toContain('Appearance Theme');
      expect(html).toContain('Editor Preferences');
      expect(html).toContain('Startup &amp; Session');
      expect(html).toContain('File Associations');
      expect(html).toContain('Reset to Defaults');
      expect(html).toContain('Done');
      expect(html).toContain('System');
      expect(html).toContain('Light');
      expect(html).toContain('Dark');
      expect(html).toContain('Word Wrap');
      expect(html).toContain('Line Numbers');
      expect(html).toContain('Restore Previous Session');
      expect(html).toContain('Font Size');
      expect(html).toContain('Line Height');
      expect(html).toContain('Tab Size');
      expect(html).toContain('Default Startup View');
      expect(html).toContain('Remember Last View');
    });
  });

  describe('Representative English Component Text Rendering', () => {
    it('should render TitleBar in English with proper labels and tooltips', () => {
      const mockProps = {
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
        onOpenShortcuts: vi.fn(),
        onOpenSettings: vi.fn(),
      };

      const html = renderToStaticMarkup(
        <I18nProvider language="en-US">
          <TitleBar {...mockProps} />
        </I18nProvider>
      );

      expect(html).toContain('New');
      expect(html).toContain('Open');
      expect(html).toContain('Save');
      expect(html).toContain('Save As');
      expect(html).toContain('Export');
      expect(html).toContain('Edit');
      expect(html).toContain('Split');
      expect(html).toContain('Preview');
      expect(html).toContain('Collapse Outline (Ctrl+Shift+O)');
      expect(html).toContain('New Document (Ctrl+N)');
      expect(html).toContain('Open File (Ctrl+O)');
      expect(html).toContain('Save Document (Ctrl+S)');
      expect(html).toContain('Preferences (Ctrl+,)');
      expect(html).toContain('Keyboard Shortcuts (F1 or Ctrl+/)');
    });

    it('should render Toolbar in English with proper tooltips', () => {
      const html = renderToStaticMarkup(
        <I18nProvider language="en-US">
          <Toolbar onAction={vi.fn()} disabled={false} />
        </I18nProvider>
      );

      expect(html).toContain('Heading 1 (# )');
      expect(html).toContain('Heading 2 (## )');
      expect(html).toContain('Heading 3 (### )');
      expect(html).toContain('Bold (**text**)');
      expect(html).toContain('Italic (*text*)');
      expect(html).toContain('Strikethrough (~~text~~)');
      expect(html).toContain('Blockquote (&gt; text)');
      expect(html).toContain('Inline Code (`code`)');
      expect(html).toContain('Code Block (```lang ... ```)');
      expect(html).toContain('Unordered List (- item)');
      expect(html).toContain('Ordered List (1. item)');
      expect(html).toContain('Task List (- [ ] task)');
      expect(html).toContain('Insert Link ([title](url))');
      expect(html).toContain('Insert Image (![alt](url))');
      expect(html).toContain('Insert Table');
      expect(html).toContain('Horizontal Rule (---)');
    });

    it('should render Sidebar in English with outline count and search placeholder', () => {
      const html = renderToStaticMarkup(
        <I18nProvider language="en-US">
          <Sidebar
            headings={[
              { id: '1', level: 1, text: 'Introduction', line: 1, slug: 'intro' },
              { id: '2', level: 2, text: 'Installation', line: 10, slug: 'install' },
            ]}
            isOpen={true}
            onClose={vi.fn()}
            onSelectHeading={vi.fn()}
            currentLine={1}
          />
        </I18nProvider>
      );

      expect(html).toContain('Document Outline (2)');
      expect(html).toContain('Search headings...');
      expect(html).toContain('Introduction');
      expect(html).toContain('Installation');
    });

    it('should render Sidebar in English with empty state when no headings exist', () => {
      const html = renderToStaticMarkup(
        <I18nProvider language="en-US">
          <Sidebar
            headings={[]}
            isOpen={true}
            onClose={vi.fn()}
            onSelectHeading={vi.fn()}
          />
        </I18nProvider>
      );

      expect(html).toContain('Document Outline (0)');
      expect(html).toContain('No Outline Available');
      expect(html).toContain('Use # Heading 1 in the document to generate outline');
    });

    it('should render StatusBar in English with stats and modes', () => {
      const html = renderToStaticMarkup(
        <I18nProvider language="en-US">
          <StatusBar
            stats={{ words: 120, chars: 800, charsNoSpaces: 650, lines: 45, readingTimeMinutes: 2 }}
            cursorLine={12}
            cursorCol={5}
            isDirty={false}
            viewMode="split"
          />
        </I18nProvider>
      );

      expect(html).toContain('120');
      expect(html).toContain('words');
      expect(html).toContain('800');
      expect(html).toContain('chars');
      expect(html).toContain('45');
      expect(html).toContain('lines');
      expect(html).toContain('~2 min read');
      expect(html).toContain('Ln 12, Col 5');
      expect(html).toContain('Saved');
      expect(html).toContain('Split Mode');
      expect(html).toContain('UTF-8');
    });

    it('should render ShortcutsModal in English with shortcuts list', () => {
      const html = renderToStaticMarkup(
        <I18nProvider language="en-US">
          <ShortcutsModal isOpen={true} onClose={vi.fn()} />
        </I18nProvider>
      );

      expect(html).toContain('Keyboard Shortcuts');
      expect(html).toContain('File Operations');
      expect(html).toContain('View &amp; Window');
      expect(html).toContain('Formatting &amp; Editing');
      expect(html).toContain('New blank document tab');
      expect(html).toContain('Open local Markdown / text file');
      expect(html).toContain('Save current file');
      expect(html).toContain('Save as new file');
      expect(html).toContain('Close active tab');
      expect(html).toContain('Switch to Editor Only mode');
      expect(html).toContain('Switch to Split View mode');
      expect(html).toContain('Switch to Preview Only mode');
      expect(html).toContain('Toggle Outline sidebar');
      expect(html).toContain('Open Preferences');
      expect(html).toContain('Open Keyboard Shortcuts guide');
      expect(html).toContain('Got it');
    });

    it('should render ConfirmModal in English with default labels', () => {
      const html = renderToStaticMarkup(
        <I18nProvider language="en-US">
          <ConfirmModal
            isOpen={true}
            title="Unsaved Changes"
            message="Document has unsaved changes. Discard?"
            onConfirm={vi.fn()}
            onCancel={vi.fn()}
          />
        </I18nProvider>
      );

      expect(html).toContain('Unsaved Changes');
      expect(html).toContain('Document has unsaved changes. Discard?');
      expect(html).toContain('Confirm');
      expect(html).toContain('Cancel');
    });

    it('should render Preview in English with code copy buttons', () => {
      const markdownCode = '```typescript\nconst a = 1;\n```\n';
      const html = renderToStaticMarkup(
        <I18nProvider language="en-US">
          <Preview content={markdownCode} />
        </I18nProvider>
      );

      expect(html).toContain('title="Copy Code"');
      expect(html).toContain('Copy');
    });
  });
});
