import React, { useEffect, useCallback, useState, useRef } from 'react';
import {
  X,
  Settings,
  Sun,
  Moon,
  Monitor,
  Sliders,
  Sparkles,
  RotateCcw,
  ExternalLink,
  Check,
  Minus,
  Plus,
  FileCheck,
  LoaderCircle,
} from 'lucide-react';
import clsx from 'clsx';
import { EditorSettings, ThemeMode, StartupViewMode, TabSizeOption } from '@/types';
import { SETTINGS_BOUNDS } from '@/lib/settings';
import { openWindowsDefaultAppsSettings, isTauri } from '@/lib/native';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  settings: EditorSettings;
  onUpdateSetting: <K extends keyof EditorSettings>(key: K, value: EditorSettings[K]) => void;
  onResetSettings: () => void;
  showToast: (msg: string, type: 'info' | 'success' | 'warning' | 'error') => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  settings,
  onUpdateSetting,
  onResetSettings,
  showToast,
}) => {
  const [isOpeningSettings, setIsOpeningSettings] = useState(false);
  const modalRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const previouslyFocusedElementRef = useRef<HTMLElement | null>(null);

  // Focus management, focus trap, and Escape key handling
  useEffect(() => {
    if (!isOpen) return;

    // Save previous activeElement to restore on close
    if (typeof document !== 'undefined' && document.activeElement instanceof HTMLElement) {
      previouslyFocusedElementRef.current = document.activeElement;
    }

    // Focus close button or first interactive element on open
    const focusTimer = setTimeout(() => {
      if (closeButtonRef.current) {
        closeButtonRef.current.focus();
      } else if (modalRef.current) {
        const focusable = modalRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        );
        if (focusable.length > 0) {
          focusable[0].focus();
        }
      }
    }, 0);

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }

      if (e.key === 'Tab') {
        if (!modalRef.current) return;
        const focusable = Array.from(
          modalRef.current.querySelectorAll<HTMLElement>(
            'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
          )
        );

        if (focusable.length === 0) {
          e.preventDefault();
          return;
        }

        const firstElement = focusable[0];
        const lastElement = focusable[focusable.length - 1];

        if (e.shiftKey) {
          if (document.activeElement === firstElement || !modalRef.current.contains(document.activeElement)) {
            e.preventDefault();
            lastElement.focus();
          }
        } else {
          if (document.activeElement === lastElement || !modalRef.current.contains(document.activeElement)) {
            e.preventDefault();
            firstElement.focus();
          }
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      clearTimeout(focusTimer);
      window.removeEventListener('keydown', handleKeyDown);
      // Restore prior focus on close
      if (
        previouslyFocusedElementRef.current &&
        typeof previouslyFocusedElementRef.current.focus === 'function'
      ) {
        previouslyFocusedElementRef.current.focus();
      }
    };
  }, [isOpen, onClose]);

  // Handler for opening Windows Default Apps settings
  const handleOpenWindowsSettings = useCallback(async () => {
    setIsOpeningSettings(true);
    try {
      await openWindowsDefaultAppsSettings();
      showToast('已打开 Windows 默认应用设置页面', 'info');
    } catch (err: unknown) {
      const msg = (err as Error)?.message || String(err);
      showToast(msg, 'warning');
    } finally {
      setIsOpeningSettings(false);
    }
  }, [showToast]);

  if (!isOpen) return null;

  const isDesktop = isTauri();

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4 animate-in fade-in duration-150"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-modal-title"
    >
      <div
        ref={modalRef}
        className="w-full max-w-lg bg-white dark:bg-[#182234] rounded-lg shadow-2xl border border-slate-200 dark:border-slate-700 overflow-hidden text-slate-800 dark:text-slate-100 max-h-[90vh] flex flex-col animate-in zoom-in-95 duration-100"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-200 dark:border-slate-700/80 bg-slate-50/60 dark:bg-[#141d2c]">
          <div className="flex items-center space-x-2">
            <div className="w-6 h-6 rounded bg-blue-100 dark:bg-blue-900/50 flex items-center justify-center text-blue-600 dark:text-blue-400">
              <Settings className="w-3.5 h-3.5" />
            </div>
            <h3 id="settings-modal-title" className="font-semibold text-sm">
              偏好设置
            </h3>
          </div>
          <button
            ref={closeButtonRef}
            onClick={onClose}
            aria-label="关闭设置"
            title="关闭 (Esc)"
            className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1 rounded-md hover:bg-slate-200/60 dark:hover:bg-slate-700/60 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Content / Sections */}
        <div className="p-5 overflow-y-auto space-y-5 text-xs">
          {/* Section 1: Appearance Theme */}
          <div className="space-y-2.5">
            <div className="flex items-center space-x-1.5 text-slate-700 dark:text-slate-300 font-semibold">
              <Sun className="w-3.5 h-3.5 text-amber-500" />
              <span>外观主题</span>
            </div>
            <div
              role="group"
              aria-label="外观主题选择"
              className="grid grid-cols-3 gap-2 bg-slate-50 dark:bg-[#111927] p-1.5 rounded-lg border border-slate-200/80 dark:border-slate-800"
            >
              {(
                [
                  { value: 'system', label: '跟随系统', icon: Monitor },
                  { value: 'light', label: '浅色模式', icon: Sun },
                  { value: 'dark', label: '深色模式', icon: Moon },
                ] as const
              ).map((opt) => {
                const IconComponent = opt.icon;
                const isSelected = settings.theme === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => onUpdateSetting('theme', opt.value as ThemeMode)}
                    aria-pressed={isSelected}
                    aria-label={opt.label}
                    className={clsx(
                      'flex items-center justify-center space-x-1.5 py-2 px-2.5 rounded-md font-medium transition-all text-xs',
                      isSelected
                        ? 'bg-white dark:bg-slate-700 text-blue-600 dark:text-blue-400 shadow-xs border border-slate-200/70 dark:border-slate-600'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 hover:bg-slate-200/50 dark:hover:bg-slate-800/60'
                    )}
                  >
                    <IconComponent className="w-3.5 h-3.5" />
                    <span>{opt.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Section 2: Editor Preferences */}
          <div className="space-y-3">
            <div className="flex items-center space-x-1.5 text-slate-700 dark:text-slate-300 font-semibold">
              <Sliders className="w-3.5 h-3.5 text-blue-500" />
              <span>编辑器偏好</span>
            </div>

            <div className="bg-slate-50 dark:bg-[#111927] rounded-lg p-3 border border-slate-200/80 dark:border-slate-800 space-y-3.5">
              {/* Font Size */}
              <div className="flex items-center justify-between">
                <div>
                  <label htmlFor="settings-font-size" className="font-medium text-slate-700 dark:text-slate-200 block">
                    编辑器字号
                  </label>
                  <span className="text-[11px] text-slate-400 dark:text-slate-500">
                    范围: {SETTINGS_BOUNDS.fontSize.min} ~ {SETTINGS_BOUNDS.fontSize.max} 像素
                  </span>
                </div>
                <div className="flex items-center space-x-2">
                  <button
                    type="button"
                    disabled={settings.fontSize <= SETTINGS_BOUNDS.fontSize.min}
                    onClick={() =>
                      onUpdateSetting(
                        'fontSize',
                        Math.max(SETTINGS_BOUNDS.fontSize.min, settings.fontSize - 1)
                      )
                    }
                    aria-label="缩小字号"
                    className="w-6 h-6 rounded bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 flex items-center justify-center hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    <Minus className="w-3 h-3 text-slate-600 dark:text-slate-300" />
                  </button>
                  <input
                    id="settings-font-size"
                    type="range"
                    aria-label="编辑器字号"
                    min={SETTINGS_BOUNDS.fontSize.min}
                    max={SETTINGS_BOUNDS.fontSize.max}
                    step={SETTINGS_BOUNDS.fontSize.step}
                    value={settings.fontSize}
                    onChange={(e) => onUpdateSetting('fontSize', Number(e.target.value))}
                    className="w-24 sm:w-28 accent-blue-600 cursor-pointer h-1.5 bg-slate-200 dark:bg-slate-700 rounded-lg"
                  />
                  <button
                    type="button"
                    disabled={settings.fontSize >= SETTINGS_BOUNDS.fontSize.max}
                    onClick={() =>
                      onUpdateSetting(
                        'fontSize',
                        Math.min(SETTINGS_BOUNDS.fontSize.max, settings.fontSize + 1)
                      )
                    }
                    aria-label="放大字号"
                    className="w-6 h-6 rounded bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 flex items-center justify-center hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    <Plus className="w-3 h-3 text-slate-600 dark:text-slate-300" />
                  </button>
                  <span className="w-12 text-center font-mono font-semibold text-[11px] px-1.5 py-0.5 rounded bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
                    {settings.fontSize}px
                  </span>
                </div>
              </div>

              {/* Line Height */}
              <div className="flex items-center justify-between">
                <div>
                  <label htmlFor="settings-line-height" className="font-medium text-slate-700 dark:text-slate-200 block">
                    行高比例
                  </label>
                  <span className="text-[11px] text-slate-400 dark:text-slate-500">
                    文本行间距 (默认 1.6)
                  </span>
                </div>
                <div className="flex items-center space-x-2">
                  <button
                    type="button"
                    disabled={settings.lineHeight <= SETTINGS_BOUNDS.lineHeight.min}
                    onClick={() =>
                      onUpdateSetting(
                        'lineHeight',
                        Math.round((settings.lineHeight - 0.1) * 10) / 10
                      )
                    }
                    aria-label="减小行高"
                    className="w-6 h-6 rounded bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 flex items-center justify-center hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    <Minus className="w-3 h-3 text-slate-600 dark:text-slate-300" />
                  </button>
                  <input
                    id="settings-line-height"
                    type="range"
                    aria-label="行高比例"
                    min={SETTINGS_BOUNDS.lineHeight.min}
                    max={SETTINGS_BOUNDS.lineHeight.max}
                    step={SETTINGS_BOUNDS.lineHeight.step}
                    value={settings.lineHeight}
                    onChange={(e) => onUpdateSetting('lineHeight', Number(e.target.value))}
                    className="w-24 sm:w-28 accent-blue-600 cursor-pointer h-1.5 bg-slate-200 dark:bg-slate-700 rounded-lg"
                  />
                  <button
                    type="button"
                    disabled={settings.lineHeight >= SETTINGS_BOUNDS.lineHeight.max}
                    onClick={() =>
                      onUpdateSetting(
                        'lineHeight',
                        Math.round((settings.lineHeight + 0.1) * 10) / 10
                      )
                    }
                    aria-label="增加行高"
                    className="w-6 h-6 rounded bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 flex items-center justify-center hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    <Plus className="w-3 h-3 text-slate-600 dark:text-slate-300" />
                  </button>
                  <span className="w-12 text-center font-mono font-semibold text-[11px] px-1.5 py-0.5 rounded bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
                    {settings.lineHeight.toFixed(1)}
                  </span>
                </div>
              </div>

              {/* Tab Size */}
              <div className="flex items-center justify-between pt-1 border-t border-slate-200/60 dark:border-slate-800">
                <div>
                  <span className="font-medium text-slate-700 dark:text-slate-200 block">
                    制表符缩进
                  </span>
                  <span className="text-[11px] text-slate-400 dark:text-slate-500">
                    Tab 键所占空格数量
                  </span>
                </div>
                <div
                  role="radiogroup"
                  aria-label="制表符缩进空格数"
                  className="flex items-center space-x-1 bg-white dark:bg-slate-800 p-0.5 rounded border border-slate-200 dark:border-slate-700"
                >
                  {([2, 4, 8] as const).map((size) => (
                    <button
                      key={size}
                      type="button"
                      role="radio"
                      aria-checked={settings.tabSize === size}
                      aria-label={`制表符 ${size} 空格`}
                      onClick={() => onUpdateSetting('tabSize', size as TabSizeOption)}
                      className={clsx(
                        'px-2 py-0.5 rounded font-mono font-medium text-[11px] transition-colors',
                        settings.tabSize === size
                          ? 'bg-blue-600 text-white shadow-xs'
                          : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700/60'
                      )}
                    >
                      {size} 空格
                    </button>
                  ))}
                </div>
              </div>

              {/* Word Wrapping */}
              <div className="flex items-center justify-between pt-1 border-t border-slate-200/60 dark:border-slate-800">
                <div>
                  <span className="font-medium text-slate-700 dark:text-slate-200 block">
                    自动折行
                  </span>
                  <span className="text-[11px] text-slate-400 dark:text-slate-500">
                    长行文本超出视口宽度时自动换行
                  </span>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-label="自动折行"
                  aria-checked={settings.wordWrap}
                  onClick={() => onUpdateSetting('wordWrap', !settings.wordWrap)}
                  className={clsx(
                    'w-9 h-5 rounded-full transition-colors relative flex items-center p-0.5 focus:outline-hidden',
                    settings.wordWrap ? 'bg-blue-600' : 'bg-slate-300 dark:bg-slate-700'
                  )}
                >
                  <span
                    className={clsx(
                      'w-4 h-4 rounded-full bg-white transition-transform transform shadow-xs',
                      settings.wordWrap ? 'translate-x-4' : 'translate-x-0'
                    )}
                  />
                </button>
              </div>

              {/* Line Numbers */}
              <div className="flex items-center justify-between pt-1 border-t border-slate-200/60 dark:border-slate-800">
                <div>
                  <span className="font-medium text-slate-700 dark:text-slate-200 block">
                    显示行号
                  </span>
                  <span className="text-[11px] text-slate-400 dark:text-slate-500">
                    在编辑器左侧显示行号栏
                  </span>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-label="显示行号"
                  aria-checked={settings.lineNumbers}
                  onClick={() => onUpdateSetting('lineNumbers', !settings.lineNumbers)}
                  className={clsx(
                    'w-9 h-5 rounded-full transition-colors relative flex items-center p-0.5 focus:outline-hidden',
                    settings.lineNumbers ? 'bg-blue-600' : 'bg-slate-300 dark:bg-slate-700'
                  )}
                >
                  <span
                    className={clsx(
                      'w-4 h-4 rounded-full bg-white transition-transform transform shadow-xs',
                      settings.lineNumbers ? 'translate-x-4' : 'translate-x-0'
                    )}
                  />
                </button>
              </div>
            </div>
          </div>

          {/* Section 3: Startup & Session */}
          <div className="space-y-3">
            <div className="flex items-center space-x-1.5 text-slate-700 dark:text-slate-300 font-semibold">
              <Sparkles className="w-3.5 h-3.5 text-indigo-500" />
              <span>启动与会话</span>
            </div>

            <div className="bg-slate-50 dark:bg-[#111927] rounded-lg p-3 border border-slate-200/80 dark:border-slate-800 space-y-3.5">
              {/* Restore Session */}
              <div className="flex items-center justify-between">
                <div>
                  <span className="font-medium text-slate-700 dark:text-slate-200 block">
                    恢复上次打开的文档
                  </span>
                  <span className="text-[11px] text-slate-400 dark:text-slate-500">
                    应用启动时自动加载上一次关闭时的标签页
                  </span>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-label="恢复上次打开的文档"
                  aria-checked={settings.restoreSession}
                  onClick={() => onUpdateSetting('restoreSession', !settings.restoreSession)}
                  className={clsx(
                    'w-9 h-5 rounded-full transition-colors relative flex items-center p-0.5 focus:outline-hidden',
                    settings.restoreSession ? 'bg-blue-600' : 'bg-slate-300 dark:bg-slate-700'
                  )}
                >
                  <span
                    className={clsx(
                      'w-4 h-4 rounded-full bg-white transition-transform transform shadow-xs',
                      settings.restoreSession ? 'translate-x-4' : 'translate-x-0'
                    )}
                  />
                </button>
              </div>

              {/* Startup View Preference */}
              <div className="flex items-center justify-between pt-1 border-t border-slate-200/60 dark:border-slate-800">
                <div>
                  <label htmlFor="settings-startup-view" className="font-medium text-slate-700 dark:text-slate-200 block">
                    默认启动视图
                  </label>
                  <span className="text-[11px] text-slate-400 dark:text-slate-500">
                    配置启动应用时的初始视图模式
                  </span>
                </div>
                <select
                  id="settings-startup-view"
                  aria-label="默认启动视图"
                  value={settings.startupView}
                  onChange={(e) =>
                    onUpdateSetting('startupView', e.target.value as StartupViewMode)
                  }
                  className="bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded px-2.5 py-1 text-slate-700 dark:text-slate-200 focus:outline-hidden focus:ring-1 focus:ring-blue-500 text-xs cursor-pointer"
                >
                  <option value="remember-last">记忆上次视图</option>
                  <option value="split">双栏分屏模式</option>
                  <option value="edit">纯编辑模式</option>
                  <option value="read">纯阅读模式</option>
                </select>
              </div>
            </div>
          </div>

          {/* Section 4: File Associations & Windows Defaults */}
          <div className="space-y-3">
            <div className="flex items-center space-x-1.5 text-slate-700 dark:text-slate-300 font-semibold">
              <FileCheck className="w-3.5 h-3.5 text-emerald-500" />
              <span>系统文件关联</span>
            </div>

            <div className="bg-slate-50 dark:bg-[#111927] rounded-lg p-3 border border-slate-200/80 dark:border-slate-800 space-y-2.5">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[11px] text-slate-500 dark:text-slate-400 mr-1">
                  已支持格式:
                </span>
                {SETTINGS_BOUNDS.supportedExtensions.map((ext) => (
                  <span
                    key={ext}
                    className="px-2 py-0.5 font-mono text-[10px] font-semibold bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 rounded border border-blue-200/80 dark:border-blue-800/80"
                  >
                    {ext}
                  </span>
                ))}
              </div>

              <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                在 Windows 10 / 11 中，可通过系统设置将本应用设为 Markdown 与文本文件的默认打开程序。
              </p>

              <div className="pt-1">
                <button
                  type="button"
                  onClick={handleOpenWindowsSettings}
                  disabled={!isDesktop || isOpeningSettings}
                  aria-disabled={!isDesktop || isOpeningSettings}
                  aria-label="打开 Windows 默认应用设置"
                  title={
                    isDesktop
                      ? '在 Windows 系统设置中配置文件默认打开程序'
                      : '当前为 Web 浏览器环境，仅在 Windows 桌面应用中支持打开系统默认应用设置'
                  }
                  className={clsx(
                    'w-full flex items-center justify-center space-x-2 py-2 px-3 rounded-md font-medium transition-colors shadow-xs',
                    !isDesktop
                      ? 'bg-slate-100 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-800 text-slate-400 dark:text-slate-500 cursor-not-allowed'
                      : 'bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200'
                  )}
                >
                  {isOpeningSettings ? (
                    <LoaderCircle className="w-3.5 h-3.5 text-blue-500 animate-spin" />
                  ) : (
                    <ExternalLink className="w-3.5 h-3.5 text-blue-500" />
                  )}
                  <span>
                    {isDesktop ? '打开 Windows 默认应用设置' : '打开默认应用设置 (仅桌面端)'}
                  </span>
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="flex items-center justify-between px-5 py-3 bg-slate-50 dark:bg-[#131b2a] border-t border-slate-200 dark:border-slate-700/80">
          <button
            type="button"
            onClick={onResetSettings}
            aria-label="恢复默认设置"
            title="恢复全部设置项为系统初始默认值"
            className="flex items-center space-x-1.5 px-3 py-1.5 rounded text-xs font-medium text-slate-600 dark:text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30 transition-colors"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>恢复默认设置</span>
          </button>

          <button
            type="button"
            onClick={onClose}
            aria-label="完成偏好设置"
            className="flex items-center space-x-1 px-4 py-1.5 rounded text-xs font-medium bg-blue-600 hover:bg-blue-700 text-white shadow-xs transition-colors"
          >
            <Check className="w-3.5 h-3.5" />
            <span>完成</span>
          </button>
        </div>
      </div>
    </div>
  );
};
