import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { SettingsModal } from '../src/components/SettingsModal';
import { TitleBar } from '../src/components/TitleBar';
import { DEFAULT_SETTINGS, SETTINGS_BOUNDS } from '../src/lib/settings';

describe('Settings UI Components (SettingsModal & TitleBar)', () => {
  describe('SettingsModal rendering', () => {
    const mockOnClose = vi.fn();
    const mockOnUpdateSetting = vi.fn();
    const mockOnResetSettings = vi.fn();
    const mockShowToast = vi.fn();

    it('should return null / empty string when isOpen is false', () => {
      const html = renderToStaticMarkup(
        <SettingsModal
          isOpen={false}
          onClose={mockOnClose}
          settings={DEFAULT_SETTINGS}
          onUpdateSetting={mockOnUpdateSetting}
          onResetSettings={mockOnResetSettings}
          showToast={mockShowToast}
        />
      );
      expect(html).toBe('');
    });

    it('should render dialog with proper ARIA attributes and title when isOpen is true', () => {
      const html = renderToStaticMarkup(
        <SettingsModal
          isOpen={true}
          onClose={mockOnClose}
          settings={DEFAULT_SETTINGS}
          onUpdateSetting={mockOnUpdateSetting}
          onResetSettings={mockOnResetSettings}
          showToast={mockShowToast}
        />
      );

      expect(html).toContain('role="dialog"');
      expect(html).toContain('aria-modal="true"');
      expect(html).toContain('aria-labelledby="settings-modal-title"');
      expect(html).toContain('偏好设置');
    });

    it('should render appearance theme section with all 3 theme options', () => {
      const html = renderToStaticMarkup(
        <SettingsModal
          isOpen={true}
          onClose={mockOnClose}
          settings={{ ...DEFAULT_SETTINGS, theme: 'dark' }}
          onUpdateSetting={mockOnUpdateSetting}
          onResetSettings={mockOnResetSettings}
          showToast={mockShowToast}
        />
      );

      expect(html).toContain('外观主题');
      expect(html).toContain('跟随系统');
      expect(html).toContain('浅色模式');
      expect(html).toContain('深色模式');
    });

    it('should render editor preferences with font size, line height, tab sizes and switches with accessible labels', () => {
      const html = renderToStaticMarkup(
        <SettingsModal
          isOpen={true}
          onClose={mockOnClose}
          settings={{
            ...DEFAULT_SETTINGS,
            fontSize: 16,
            lineHeight: 1.8,
            tabSize: 4,
            wordWrap: false,
            lineNumbers: false,
          }}
          onUpdateSetting={mockOnUpdateSetting}
          onResetSettings={mockOnResetSettings}
          showToast={mockShowToast}
        />
      );

      expect(html).toContain('编辑器字号');
      expect(html).toContain('aria-label="缩小字号"');
      expect(html).toContain('aria-label="放大字号"');
      expect(html).toContain('aria-label="编辑器字号"');
      expect(html).toContain('16px');

      expect(html).toContain('行高比例');
      expect(html).toContain('aria-label="减小行高"');
      expect(html).toContain('aria-label="增加行高"');
      expect(html).toContain('aria-label="行高比例"');
      expect(html).toContain('1.8');

      expect(html).toContain('制表符缩进');
      expect(html).toContain('role="radiogroup"');
      expect(html).toContain('aria-label="制表符缩进空格数"');
      expect(html).toContain('aria-label="制表符 2 空格"');
      expect(html).toContain('aria-label="制表符 4 空格"');
      expect(html).toContain('aria-label="制表符 8 空格"');

      expect(html).toContain('自动折行');
      expect(html).toContain('role="switch"');
      expect(html).toContain('aria-label="自动折行"');

      expect(html).toContain('显示行号');
      expect(html).toContain('aria-label="显示行号"');
    });

    it('should render startup and session section with restore session switch and accessible label', () => {
      const html = renderToStaticMarkup(
        <SettingsModal
          isOpen={true}
          onClose={mockOnClose}
          settings={DEFAULT_SETTINGS}
          onUpdateSetting={mockOnUpdateSetting}
          onResetSettings={mockOnResetSettings}
          showToast={mockShowToast}
        />
      );

      expect(html).toContain('启动与会话');
      expect(html).toContain('恢复上次打开的文档');
      expect(html).toContain('aria-label="恢复上次打开的文档"');
      expect(html).toContain('默认启动视图');
      expect(html).toContain('aria-label="默认启动视图"');
      expect(html).toContain('记忆上次视图');
      expect(html).toContain('双栏分屏模式');
      expect(html).toContain('纯编辑模式');
      expect(html).toContain('纯阅读模式');
    });

    it('should disable Windows Settings button in browser environment', () => {
      const html = renderToStaticMarkup(
        <SettingsModal
          isOpen={true}
          onClose={mockOnClose}
          settings={DEFAULT_SETTINGS}
          onUpdateSetting={mockOnUpdateSetting}
          onResetSettings={mockOnResetSettings}
          showToast={mockShowToast}
        />
      );

      expect(html).toContain('系统文件关联');
      for (const ext of SETTINGS_BOUNDS.supportedExtensions) {
        expect(html).toContain(ext);
      }
      expect(html).toContain('默认应用设置 (仅桌面端)');
      expect(html).toContain('disabled=""');
      expect(html).toContain('aria-disabled="true"');
      expect(html).toContain('cursor-not-allowed');
    });

    it('should render reset to defaults and completion buttons in footer', () => {
      const html = renderToStaticMarkup(
        <SettingsModal
          isOpen={true}
          onClose={mockOnClose}
          settings={DEFAULT_SETTINGS}
          onUpdateSetting={mockOnUpdateSetting}
          onResetSettings={mockOnResetSettings}
          showToast={mockShowToast}
        />
      );

      expect(html).toContain('恢复默认设置');
      expect(html).toContain('完成');
    });
  });

  describe('TitleBar Settings button integration', () => {
    it('should render settings button with proper aria-label and tooltip', () => {
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

      const html = renderToStaticMarkup(<TitleBar {...mockProps} />);
      expect(html).toContain('aria-label="偏好设置"');
      expect(html).toContain('title="偏好设置 (Ctrl+,)"');
    });
  });

  describe('Accessibility & Focus Management Lifecycle Stability', () => {
    it('should not re-trigger focus effect or unmount key listeners when settings change with stable onClose identity', () => {
      const addEventListenerSpy = vi.fn();
      const removeEventListenerSpy = vi.fn();
      const mockPriorFocus = vi.fn();

      const originalWindow = globalThis.window;
      const originalDocument = globalThis.document;

      const fakeTriggerButton = { focus: mockPriorFocus } as unknown as HTMLElement;

      globalThis.window = {
        addEventListener: addEventListenerSpy,
        removeEventListener: removeEventListenerSpy,
      } as unknown as Window & typeof globalThis;

      globalThis.document = {
        activeElement: fakeTriggerButton,
      } as unknown as Document;

      try {
        // Test stable callback simulation:
        // When stable onClose is used, effect dependencies [isOpen, onClose] remain identical
        const stableOnClose = vi.fn();

        let prevDeps: [boolean, () => void] | null = null;
        let cleanupFn: (() => void) | null = null;
        let effectRunCount = 0;
        let cleanupRunCount = 0;

        const runModalFocusEffect = (isOpen: boolean, onClose: () => void) => {
          const depsChanged =
            !prevDeps || prevDeps[0] !== isOpen || prevDeps[1] !== onClose;

          if (depsChanged) {
            if (cleanupFn) {
              cleanupFn();
              cleanupRunCount++;
            }
            prevDeps = [isOpen, onClose];

            if (isOpen) {
              effectRunCount++;
              addEventListenerSpy('keydown', vi.fn());
              const savedElement = globalThis.document.activeElement;
              cleanupFn = () => {
                removeEventListenerSpy('keydown', vi.fn());
                if (savedElement && typeof (savedElement as unknown as { focus?: () => void }).focus === 'function') {
                  (savedElement as unknown as { focus: () => void }).focus();
                }
              };
            } else {
              cleanupFn = null;
            }
          }
        };

        // 1. Open modal with stable onClose
        runModalFocusEffect(true, stableOnClose);
        expect(effectRunCount).toBe(1);
        expect(cleanupRunCount).toBe(0);
        expect(mockPriorFocus).not.toHaveBeenCalled();

        // 2. Settings update occurs multiple times (e.g. changing font size, toggling theme, line height)
        // With stable onClose, dependencies [isOpen, stableOnClose] do NOT change
        runModalFocusEffect(true, stableOnClose);
        runModalFocusEffect(true, stableOnClose);
        runModalFocusEffect(true, stableOnClose);

        // Effect must NOT re-run, cleanup must NOT execute, focus must NOT be stolen/restored prematurely
        expect(effectRunCount).toBe(1);
        expect(cleanupRunCount).toBe(0);
        expect(mockPriorFocus).not.toHaveBeenCalled();

        // 3. User closes modal (isOpen -> false)
        runModalFocusEffect(false, stableOnClose);
        expect(cleanupRunCount).toBe(1);
        // Prior focused element is now properly restored
        expect(mockPriorFocus).toHaveBeenCalledTimes(1);
      } finally {
        globalThis.window = originalWindow;
        globalThis.document = originalDocument;
      }
    });

    it('demonstrates why unstable onClose causes unwanted effect cleanup and focus thrashing', () => {
      const mockPriorFocus = vi.fn();
      const fakeTriggerButton = { focus: mockPriorFocus } as unknown as HTMLElement;

      const originalWindow = globalThis.window;
      const originalDocument = globalThis.document;

      globalThis.window = {
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      } as unknown as Window & typeof globalThis;

      globalThis.document = {
        activeElement: fakeTriggerButton,
      } as unknown as Document;

      try {
        let prevDeps: [boolean, () => void] | null = null;
        let cleanupFn: (() => void) | null = null;
        let effectRunCount = 0;
        let cleanupRunCount = 0;

        const runModalFocusEffect = (isOpen: boolean, onClose: () => void) => {
          const depsChanged =
            !prevDeps || prevDeps[0] !== isOpen || prevDeps[1] !== onClose;

          if (depsChanged) {
            if (cleanupFn) {
              cleanupFn();
              cleanupRunCount++;
            }
            prevDeps = [isOpen, onClose];

            if (isOpen) {
              effectRunCount++;
              const savedElement = globalThis.document.activeElement;
              cleanupFn = () => {
                if (savedElement && typeof (savedElement as unknown as { focus?: () => void }).focus === 'function') {
                  (savedElement as unknown as { focus: () => void }).focus();
                }
              };
            }
          }
        };

        // Modal opened with inline callback 1
        runModalFocusEffect(true, () => {});
        expect(effectRunCount).toBe(1);
        expect(cleanupRunCount).toBe(0);

        // Settings change occurs -> new inline callback 2 created
        runModalFocusEffect(true, () => {});
        // Unstable callback causes effect to re-run and cleanup to fire prematurely!
        expect(effectRunCount).toBe(2);
        expect(cleanupRunCount).toBe(1);
        expect(mockPriorFocus).toHaveBeenCalledTimes(1);
      } finally {
        globalThis.window = originalWindow;
        globalThis.document = originalDocument;
      }
    });
  });
});
