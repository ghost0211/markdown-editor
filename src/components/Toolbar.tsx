import React from 'react';
import {
  Bold,
  Code,
  CodeXml,
  Eye,
  FileCode,
  Italic,
  Link2,
  List,
  ListOrdered,
  ListTodo,
  Image as ImageIcon,
  Minus,
  Quote,
  Strikethrough,
  Table as TableIcon,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { MarkdownAction } from '@/lib/markdownCommands';
import { useI18n } from '@/i18n';
import type { TranslationKey } from '@/i18n';

export type ToolbarPresentation = 'source' | 'visual';

export interface ToolbarProps {
  onAction: (action: MarkdownAction) => void;
  disabled?: boolean;
  /** Current editor presentation; unavailable switches are disabled. */
  presentation?: ToolbarPresentation;
  onPresentationChange?: (value: ToolbarPresentation) => void;
  /** Formats reported by `getActiveMarkdownFormats` for the main selection. */
  activeFormats?: readonly MarkdownAction[];
}

interface ToolbarButtonConfig {
  action: MarkdownAction;
  labelKey: TranslationKey;
  icon: LucideIcon;
  /** Toggle buttons expose `aria-pressed` and highlight while active. */
  toggle: boolean;
}

const INLINE_BUTTONS: readonly ToolbarButtonConfig[] = [
  { action: 'bold', labelKey: 'toolbar.bold', icon: Bold, toggle: true },
  { action: 'italic', labelKey: 'toolbar.italic', icon: Italic, toggle: true },
  { action: 'strike', labelKey: 'toolbar.strike', icon: Strikethrough, toggle: true },
  { action: 'quote', labelKey: 'toolbar.quote', icon: Quote, toggle: true },
];

const CODE_BUTTONS: readonly ToolbarButtonConfig[] = [
  { action: 'inline-code', labelKey: 'toolbar.inlineCode', icon: Code, toggle: true },
  { action: 'code-block', labelKey: 'toolbar.codeBlock', icon: FileCode, toggle: true },
];

const LIST_BUTTONS: readonly ToolbarButtonConfig[] = [
  { action: 'ul', labelKey: 'toolbar.ul', icon: List, toggle: true },
  { action: 'ol', labelKey: 'toolbar.ol', icon: ListOrdered, toggle: true },
  { action: 'task', labelKey: 'toolbar.task', icon: ListTodo, toggle: true },
];

const INSERT_BUTTONS: readonly ToolbarButtonConfig[] = [
  { action: 'link', labelKey: 'toolbar.link', icon: Link2, toggle: false },
  { action: 'image', labelKey: 'toolbar.image', icon: ImageIcon, toggle: false },
  { action: 'table', labelKey: 'toolbar.table', icon: TableIcon, toggle: false },
  { action: 'hr', labelKey: 'toolbar.hr', icon: Minus, toggle: false },
];

const HEADING_OPTIONS: ReadonlyArray<{ value: MarkdownAction; labelKey: TranslationKey }> = [
  { value: 'paragraph', labelKey: 'toolbar.paragraph' },
  { value: 'h1', labelKey: 'toolbar.h1' },
  { value: 'h2', labelKey: 'toolbar.h2' },
  { value: 'h3', labelKey: 'toolbar.h3' },
  { value: 'h4', labelKey: 'toolbar.h4' },
  { value: 'h5', labelKey: 'toolbar.h5' },
  { value: 'h6', labelKey: 'toolbar.h6' },
];

const HEADING_ACTIONS: readonly MarkdownAction[] = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'];

export const Toolbar: React.FC<ToolbarProps> = ({
  onAction,
  disabled = false,
  presentation = 'source',
  onPresentationChange,
  activeFormats,
}) => {
  const { t } = useI18n();
  const btnBase =
    'h-7 w-7 inline-flex items-center justify-center rounded-md transition-colors disabled:opacity-40 disabled:pointer-events-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500';
  const btnClass = `${btnBase} text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700/80 hover:text-slate-900 dark:hover:text-white`;
  const activeBtnClass = `${btnBase} bg-blue-100 text-blue-700 dark:bg-blue-500/25 dark:text-blue-200 hover:bg-blue-200 dark:hover:bg-blue-500/40`;
  const modeBtnClass =
    'h-6 px-2 inline-flex shrink-0 items-center justify-center gap-1 rounded text-slate-500 dark:text-slate-400 transition-colors disabled:opacity-40 disabled:pointer-events-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500';
  const modeActiveClass = 'bg-white dark:bg-slate-800 text-blue-700 dark:text-blue-200 shadow-sm';

  const isActive = (action: MarkdownAction) => activeFormats?.includes(action) ?? false;
  const activeHeading = HEADING_ACTIONS.find((action) => isActive(action)) ?? 'paragraph';

  // Keep the editor selection and focus when a toolbar button is pressed.
  const keepEditorSelection = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
  };

  const renderButton = ({ action, labelKey, icon: Icon, toggle }: ToolbarButtonConfig) => {
    const active = toggle && isActive(action);
    const label = t(labelKey);
    return (
      <button
        key={action}
        type="button"
        onClick={() => onAction(action)}
        onMouseDown={keepEditorSelection}
        disabled={disabled}
        title={label}
        aria-label={label}
        aria-pressed={toggle ? active : undefined}
        className={active ? activeBtnClass : btnClass}
      >
        <Icon className="w-3.5 h-3.5" />
      </button>
    );
  };

  const renderModeButton = (
    mode: ToolbarPresentation,
    icon: LucideIcon,
    labelKey: TranslationKey
  ) => {
    const active = presentation === mode;
    const label = t(labelKey);
    return (
      <button
        key={mode}
        type="button"
        onClick={() => onPresentationChange?.(mode)}
        onMouseDown={keepEditorSelection}
        disabled={disabled || !onPresentationChange}
        title={label}
        aria-label={label}
        aria-pressed={active}
        className={active ? `${modeBtnClass} ${modeActiveClass}` : modeBtnClass}
      >
        {React.createElement(icon, { className: 'w-3 h-3' })}
        <span className="whitespace-nowrap">{label}</span>
      </button>
    );
  };

  return (
    <div
      className="h-10 bg-panel border-b border-slate-200 dark:border-slate-800 px-4 flex items-center space-x-1 select-none overflow-x-auto no-scrollbar shrink-0 text-xs"
      role="toolbar"
      aria-label={t('toolbar.ariaLabel')}
    >
      {/* Source / visual presentation switch */}
      <div
        className="flex items-center rounded-md border border-slate-200 dark:border-slate-700 p-0.5 space-x-0.5 shrink-0"
        role="group"
        aria-label={t('toolbar.presentationLabel')}
        title={presentation === 'visual' ? t('editor.visualHint') : undefined}
      >
        {renderModeButton('source', CodeXml, 'toolbar.sourceMode')}
        {renderModeButton('visual', Eye, 'toolbar.visualMode')}
      </div>

      <div className="h-4 w-[1px] bg-slate-300 dark:bg-slate-700 mx-1" />

      {/* Heading level (body text + H1-H6) */}
      <select
        value={activeHeading}
        onChange={(event) => onAction(event.target.value as MarkdownAction)}
        disabled={disabled}
        title={t('toolbar.headingStyle')}
        aria-label={t('toolbar.headingStyle')}
        className="h-7 shrink-0 rounded-md border border-slate-200 dark:border-slate-700 bg-transparent px-1 text-xs text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700/80 disabled:opacity-40 disabled:pointer-events-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
      >
        {HEADING_OPTIONS.map(({ value, labelKey }) => (
          <option key={value} value={value} title={t(labelKey)} className="text-slate-900 dark:text-slate-100">
            {t(labelKey)}
          </option>
        ))}
      </select>

      <div className="h-4 w-[1px] bg-slate-300 dark:bg-slate-700 mx-1" />

      {/* Inline styles */}
      <div className="flex items-center space-x-0.5">{INLINE_BUTTONS.map(renderButton)}</div>

      <div className="h-4 w-[1px] bg-slate-300 dark:bg-slate-700 mx-1" />

      {/* Code */}
      <div className="flex items-center space-x-0.5">{CODE_BUTTONS.map(renderButton)}</div>

      <div className="h-4 w-[1px] bg-slate-300 dark:bg-slate-700 mx-1" />

      {/* Lists */}
      <div className="flex items-center space-x-0.5">{LIST_BUTTONS.map(renderButton)}</div>

      <div className="h-4 w-[1px] bg-slate-300 dark:bg-slate-700 mx-1" />

      {/* Links, Media & Structure (insert-only, no toggle highlight) */}
      <div className="flex items-center space-x-0.5">{INSERT_BUTTONS.map(renderButton)}</div>
    </div>
  );
};
