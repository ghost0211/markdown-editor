import React, {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  FileText,
  Info,
  LoaderCircle,
  RefreshCw,
  ShieldCheck,
  X,
} from 'lucide-react';
import clsx from 'clsx';
import {
  interpolate,
  useI18n,
  type Language,
  type TranslationKey,
  type TranslationParams,
} from '@/i18n';
import {
  analyzeDocumentQuality,
  checkLocalDocumentResources,
  compareQualityIssues,
  type QualityIssue,
  type QualityLanguage,
  type QualitySeverity,
} from '@/lib/documentQuality';

export type QualityFilter = 'all' | 'error' | 'warning' | 'info';
export type QualityPanelStatus = 'loading' | 'ready' | 'error';

export interface QualityPanelProps {
  isOpen: boolean;
  onClose: () => void;
  content: string;
  sourceFilePath?: string | null;
  onLocate: (line: number) => void;
}

/**
 * Self-contained fallback copy for the `quality.*` namespace.
 *
 * `t('quality.…')` always wins as soon as these keys are added to the locale
 * files. Until then the fallback keeps the panel readable instead of showing
 * raw translation keys. The complete key list (with the same suggestions) is
 * reported with this change so the locale owner can copy it over unchanged.
 */
const QUALITY_FALLBACK_TEXT: Record<string, Record<Language, string>> = {
  'quality.title': {
    'zh-CN': '文档质量检查',
    'en-US': 'Document quality',
  },
  'quality.close': {
    'zh-CN': '关闭质量检查',
    'en-US': 'Close document quality',
  },
  'quality.sourceLabel': {
    'zh-CN': '文档：{name}',
    'en-US': 'Document: {name}',
  },
  'quality.refresh': {
    'zh-CN': '重新检查',
    'en-US': 'Re-check',
  },
  'quality.refreshing': {
    'zh-CN': '检查中...',
    'en-US': 'Checking...',
  },
  'quality.filterGroupLabel': {
    'zh-CN': '问题筛选',
    'en-US': 'Issue filters',
  },
  'quality.filterAll': {
    'zh-CN': '全部',
    'en-US': 'All',
  },
  'quality.filterError': {
    'zh-CN': '错误',
    'en-US': 'Errors',
  },
  'quality.filterWarning': {
    'zh-CN': '提醒',
    'en-US': 'Warnings',
  },
  'quality.filterInfo': {
    'zh-CN': '信息',
    'en-US': 'Info',
  },
  'quality.summary': {
    'zh-CN': '共 {total} 项 · 错误 {errors} · 提醒 {warnings} · 信息 {infos}',
    'en-US': 'Total {total} · Errors {errors} · Warnings {warnings} · Info {infos}',
  },
  'quality.loading': {
    'zh-CN': '正在检查文档质量...',
    'en-US': 'Checking document quality...',
  },
  'quality.loadingHint': {
    'zh-CN': '大文档可能需要几秒钟',
    'en-US': 'Large documents may take a moment',
  },
  'quality.errorTitle': {
    'zh-CN': '质量检查失败',
    'en-US': 'Quality check failed',
  },
  'quality.errorHint': {
    'zh-CN': '请稍后重试；错误信息已截断',
    'en-US': 'Try again later; the error message was shortened',
  },
  'quality.retry': {
    'zh-CN': '重试',
    'en-US': 'Retry',
  },
  'quality.emptyDocument': {
    'zh-CN': '文档为空',
    'en-US': 'The document is empty',
  },
  'quality.emptyDocumentHint': {
    'zh-CN': '输入内容后会自动检查文档质量',
    'en-US': 'Quality is checked automatically as you type',
  },
  'quality.allGood': {
    'zh-CN': '未发现问题',
    'en-US': 'No issues found',
  },
  'quality.allGoodHint': {
    'zh-CN': '文档结构与资源引用看起来都很好',
    'en-US': 'The document structure and resources look good',
  },
  'quality.noMatchesFilter': {
    'zh-CN': '当前筛选下没有问题',
    'en-US': 'No issues match this filter',
  },
  'quality.noMatchesFilterHint': {
    'zh-CN': '切换到“全部”查看其他问题',
    'en-US': 'Switch to All to see other issues',
  },
  'quality.listLabel': {
    'zh-CN': '质量问题列表',
    'en-US': 'Quality issue list',
  },
  'quality.position': {
    'zh-CN': '第 {line} 行，第 {column} 列',
    'en-US': 'Line {line}, column {column}',
  },
  'quality.locateAria': {
    'zh-CN': '定位到第 {line} 行并关闭面板',
    'en-US': 'Go to line {line} and close the panel',
  },
  'quality.noAutoFix': {
    'zh-CN': '仅提示，不会自动修改文档',
    'en-US': 'Reports only; your document is never changed',
  },
};

export interface QualitySummary {
  total: number;
  errors: number;
  warnings: number;
  infos: number;
}

/** Counts shown by the header summary and by each filter button. */
export function summarizeQualityIssues(
  issues: readonly QualityIssue[]
): QualitySummary {
  let errors = 0;
  let warnings = 0;
  let infos = 0;
  for (const issue of issues) {
    if (issue.severity === 'error') errors += 1;
    else if (issue.severity === 'warning') warnings += 1;
    else infos += 1;
  }
  return { total: issues.length, errors, warnings, infos };
}

/** Pure filter used by the panel and by SSR tests. */
export function filterQualityIssues(
  issues: readonly QualityIssue[],
  filter: QualityFilter
): QualityIssue[] {
  if (filter === 'all') return [...issues];
  return issues.filter((issue) => issue.severity === filter);
}

/**
 * Error text is deliberately bounded: no stack frames, no complete local
 * paths, and at most 200 characters. Unexpected objects never leak internals.
 */
export function formatQualityError(
  error: unknown,
  language: QualityLanguage = 'zh-CN'
): string {
  const raw =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : '';
  const firstMeaningfulLine =
    raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line.length > 0 && !/^at\s/.test(line)) ?? '';
  const withoutPaths = firstMeaningfulLine.replace(
    /(?:[A-Za-z]:[\\/]|\\\\)[^\s"'<>]+/g,
    (match) => {
      const parts = match.split(/[\\/]/).filter(Boolean);
      return parts[parts.length - 1] || '…';
    }
  );
  const compact = withoutPaths.replace(/\s+/g, ' ').trim();
  if (!compact) {
    return language === 'en-US' ? 'Unknown error' : '未知错误';
  }
  return compact.length > 200 ? `${compact.slice(0, 200)}…` : compact;
}

function useQualityText(): (
  key: string,
  params?: TranslationParams
) => string {
  const { t, language } = useI18n();
  return useCallback(
    (key: string, params?: TranslationParams) => {
      const translated = t(key as TranslationKey, params);
      if (translated !== key) return translated;
      const fallback =
        QUALITY_FALLBACK_TEXT[key]?.[language] ??
        QUALITY_FALLBACK_TEXT[key]?.['zh-CN'];
      return fallback ? interpolate(fallback, params) : key;
    },
    [t, language]
  );
}

function sourceDisplayName(sourceFilePath?: string | null): string | null {
  if (!sourceFilePath) return null;
  const normalized = sourceFilePath.replace(/\\/g, '/');
  const name = normalized.split('/').filter(Boolean).pop();
  if (!name) return null;
  return name.length > 80 ? `${name.slice(0, 80)}…` : name;
}

const SEVERITY_META: Record<
  QualitySeverity,
  {
    icon: React.ComponentType<{ className?: string }>;
    labelKey: string;
    iconClass: string;
    badgeClass: string;
  }
> = {
  error: {
    icon: AlertCircle,
    labelKey: 'quality.filterError',
    iconClass: 'text-red-500',
    badgeClass:
      'bg-red-100 text-red-700 dark:bg-red-950/60 dark:text-red-300',
  },
  warning: {
    icon: AlertTriangle,
    labelKey: 'quality.filterWarning',
    iconClass: 'text-amber-500',
    badgeClass:
      'bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300',
  },
  info: {
    icon: Info,
    labelKey: 'quality.filterInfo',
    iconClass: 'text-sky-500',
    badgeClass:
      'bg-sky-100 text-sky-700 dark:bg-sky-950/60 dark:text-sky-300',
  },
};

export interface QualityPanelViewProps {
  isOpen: boolean;
  onClose: () => void;
  onLocate: (line: number) => void;
  onRefresh: () => void;
  status: QualityPanelStatus;
  issues: readonly QualityIssue[];
  error?: string | null;
  isDocumentEmpty: boolean;
  filter: QualityFilter;
  onFilterChange: (filter: QualityFilter) => void;
  sourceFilePath?: string | null;
}

/**
 * Presentational panel. Exported separately so SSR tests can cover the
 * loading/error/empty/healthy states without a DOM or effects.
 */
export const QualityPanelView: React.FC<QualityPanelViewProps> = ({
  isOpen,
  onClose,
  onLocate,
  onRefresh,
  status,
  issues,
  error,
  isDocumentEmpty,
  filter,
  onFilterChange,
  sourceFilePath,
}) => {
  const t = useQualityText();
  const { language } = useI18n();
  const titleId = useId();
  const descriptionId = useId();
  const listId = useId();

  const modalRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const previouslyFocusedElementRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    if (
      typeof document !== 'undefined' &&
      typeof HTMLElement !== 'undefined' &&
      document.activeElement instanceof HTMLElement
    ) {
      previouslyFocusedElementRef.current = document.activeElement;
    }

    const focusTimer =
      typeof window !== 'undefined'
        ? window.setTimeout(() => closeButtonRef.current?.focus(), 0)
        : null;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab' || !modalRef.current) return;

      const focusable = Array.from(
        modalRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      );
      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }

      const firstElement = focusable[0];
      const lastElement = focusable[focusable.length - 1];
      if (event.shiftKey) {
        if (
          document.activeElement === firstElement ||
          !modalRef.current.contains(document.activeElement)
        ) {
          event.preventDefault();
          lastElement.focus();
        }
      } else if (
        document.activeElement === lastElement ||
        !modalRef.current.contains(document.activeElement)
      ) {
        event.preventDefault();
        firstElement.focus();
      }
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('keydown', handleKeyDown);
    }

    return () => {
      if (focusTimer !== null && typeof window !== 'undefined') {
        window.clearTimeout(focusTimer);
      }
      if (typeof window !== 'undefined') {
        window.removeEventListener('keydown', handleKeyDown);
      }
      if (
        previouslyFocusedElementRef.current &&
        typeof previouslyFocusedElementRef.current.focus === 'function'
      ) {
        previouslyFocusedElementRef.current.focus();
      }
    };
  }, [isOpen, onClose]);

  const summary = useMemo(() => summarizeQualityIssues(issues), [issues]);
  const visibleIssues = useMemo(
    () => filterQualityIssues(issues, filter),
    [issues, filter]
  );

  if (!isOpen) return null;

  const sourceName = sourceDisplayName(sourceFilePath);
  const filterItems: { id: QualityFilter; label: string; count: number }[] = [
    { id: 'all', label: t('quality.filterAll'), count: summary.total },
    { id: 'error', label: t('quality.filterError'), count: summary.errors },
    {
      id: 'warning',
      label: t('quality.filterWarning'),
      count: summary.warnings,
    },
    { id: 'info', label: t('quality.filterInfo'), count: summary.infos },
  ];

  const renderBody = () => {
    if (status === 'error') {
      return (
        <div
          role="alert"
          className="h-full flex flex-col items-center justify-center text-center px-6 py-10"
        >
          <AlertCircle className="w-10 h-10 text-red-500 mb-3" />
          <p className="text-sm font-medium text-red-600 dark:text-red-400">
            {t('quality.errorTitle')}
          </p>
          <p className="mt-1 max-w-[520px] text-xs text-slate-600 dark:text-slate-300 break-words">
            {error || formatQualityError(null, language)}
          </p>
          <p className="mt-1 text-[11px] text-slate-400 dark:text-slate-500">
            {t('quality.errorHint')}
          </p>
          <button
            type="button"
            onClick={onRefresh}
            className="mt-4 flex items-center space-x-1 px-3 py-1.5 rounded text-[11px] font-medium text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700/60"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>{t('quality.retry')}</span>
          </button>
        </div>
      );
    }

    if (isDocumentEmpty) {
      return (
        <div className="h-full flex flex-col items-center justify-center text-center px-6 py-10 text-slate-400 dark:text-slate-500">
          <FileText className="w-10 h-10 mb-3 opacity-50" />
          <p className="text-sm font-medium text-slate-500 dark:text-slate-400">
            {t('quality.emptyDocument')}
          </p>
          <p className="mt-1 text-xs max-w-[320px]">
            {t('quality.emptyDocumentHint')}
          </p>
        </div>
      );
    }

    if (status === 'loading') {
      return (
        <div
          role="status"
          className="h-full flex flex-col items-center justify-center text-center px-6 py-10"
        >
          <LoaderCircle className="w-8 h-8 text-blue-500 animate-spin" />
          <p className="mt-3 text-sm font-medium text-slate-600 dark:text-slate-300">
            {t('quality.loading')}
          </p>
          <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">
            {t('quality.loadingHint')}
          </p>
        </div>
      );
    }

    if (summary.total === 0) {
      return (
        <div
          role="status"
          className="h-full flex flex-col items-center justify-center text-center px-6 py-10"
        >
          <CheckCircle2 className="w-10 h-10 text-emerald-500 mb-3" />
          <p className="text-sm font-medium text-emerald-600 dark:text-emerald-400">
            {t('quality.allGood')}
          </p>
          <p className="mt-1 text-xs text-slate-400 dark:text-slate-500 max-w-[320px]">
            {t('quality.allGoodHint')}
          </p>
        </div>
      );
    }

    if (visibleIssues.length === 0) {
      return (
        <div className="h-full flex flex-col items-center justify-center text-center px-6 py-10 text-slate-400 dark:text-slate-500">
          <Info className="w-10 h-10 mb-3 opacity-50" />
          <p className="text-sm font-medium text-slate-500 dark:text-slate-400">
            {t('quality.noMatchesFilter')}
          </p>
          <p className="mt-1 text-xs max-w-[320px]">
            {t('quality.noMatchesFilterHint')}
          </p>
        </div>
      );
    }

    return (
      <ul
        id={listId}
        aria-label={t('quality.listLabel')}
        className="space-y-2"
      >
        {visibleIssues.map((issue) => {
          const meta = SEVERITY_META[issue.severity];
          const Icon = meta.icon;
          return (
            <li key={issue.id}>
              <button
                type="button"
                onClick={() => {
                  onLocate(issue.line);
                  onClose();
                }}
                aria-label={`${t('quality.locateAria', {
                  line: issue.line,
                })}: ${issue.message}`}
                title={`${t('quality.position', {
                  line: issue.line,
                  column: issue.column,
                })} · ${issue.message}`}
                className="w-full text-left flex items-start gap-2.5 rounded-md border border-slate-200 dark:border-slate-700/80 bg-slate-50/60 dark:bg-slate-900/40 px-3 py-2 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800/70 focus:outline-none focus:ring-1 focus:ring-blue-500/60"
              >
                <Icon className={clsx('w-4 h-4 mt-0.5 shrink-0', meta.iconClass)} />
                <span
                  className={clsx(
                    'shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium',
                    meta.badgeClass
                  )}
                >
                  {t(meta.labelKey)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[10px] font-mono text-slate-400 dark:text-slate-500">
                    {t('quality.position', {
                      line: issue.line,
                      column: issue.column,
                    })}
                  </span>
                  <span className="mt-0.5 block text-xs leading-relaxed break-words">
                    {issue.message}
                  </span>
                </span>
                <ChevronRight className="w-4 h-4 mt-0.5 shrink-0 text-slate-300 dark:text-slate-600" />
              </button>
            </li>
          );
        })}
      </ul>
    );
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4 animate-in fade-in duration-150"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
    >
      <div
        ref={modalRef}
        className="w-[820px] max-w-[calc(100vw-2rem)] h-[70vh] min-h-[420px] max-h-[calc(100vh-2rem)] bg-elevated rounded-lg shadow-xl border border-slate-200 dark:border-slate-700 overflow-hidden flex flex-col text-slate-800 dark:text-slate-100"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 px-5 py-3 border-b border-slate-200 dark:border-slate-700/80 shrink-0">
          <div className="min-w-0">
            <h2
              id={titleId}
              className="flex items-center space-x-2 text-sm font-semibold text-slate-800 dark:text-slate-100"
            >
              <ShieldCheck className="w-4 h-4 text-emerald-500" />
              <span>{t('quality.title')}</span>
            </h2>
            {sourceName && (
              <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400 truncate">
                {t('quality.sourceLabel', { name: sourceName })}
              </p>
            )}
            <p
              id={descriptionId}
              className="mt-1 text-[11px] text-slate-500 dark:text-slate-400"
            >
              {t('quality.summary', {
                total: summary.total,
                errors: summary.errors,
                warnings: summary.warnings,
                infos: summary.infos,
              })}
            </p>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            aria-label={t('quality.close')}
            title={t('quality.close')}
            className="p-1 rounded text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700/60 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-4 py-2 border-b border-slate-200 dark:border-slate-700/80 flex flex-wrap items-center gap-2 shrink-0">
          <div
            role="group"
            aria-label={t('quality.filterGroupLabel')}
            className="flex items-center bg-slate-100 dark:bg-slate-800 p-0.5 rounded-md"
          >
            {filterItems.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => onFilterChange(item.id)}
                aria-pressed={filter === item.id}
                className={clsx(
                  'px-2 py-0.5 rounded text-[11px] font-medium transition-colors',
                  filter === item.id
                    ? 'bg-white dark:bg-slate-700 text-blue-600 dark:text-blue-400 shadow-sm'
                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
                )}
              >
                <span>{item.label}</span>
                <span
                  aria-hidden="true"
                  className="ml-1 tabular-nums opacity-70"
                >
                  {item.count}
                </span>
              </button>
            ))}
          </div>

          <div className="flex-1" />

          <button
            type="button"
            onClick={onRefresh}
            disabled={status === 'loading'}
            title={
              status === 'loading'
                ? t('quality.refreshing')
                : t('quality.refresh')
            }
            aria-label={
              status === 'loading'
                ? t('quality.refreshing')
                : t('quality.refresh')
            }
            className="flex items-center space-x-1 px-2 py-1 rounded text-[11px] text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700/60 disabled:opacity-45 disabled:cursor-not-allowed"
          >
            <RefreshCw
              className={clsx(
                'w-3.5 h-3.5',
                status === 'loading' && 'animate-spin'
              )}
            />
            <span>
              {status === 'loading'
                ? t('quality.refreshing')
                : t('quality.refresh')}
            </span>
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto p-4">{renderBody()}</div>

        <div className="px-4 py-2 border-t border-slate-200 dark:border-slate-700/80 text-[10px] text-slate-400 dark:text-slate-500 shrink-0">
          {t('quality.noAutoFix')}
        </div>
      </div>
    </div>
  );
};

/**
 * Document quality panel.
 *
 * Opening the panel and every content edit schedule a deferred, debounced
 * check. Requests carry a monotonically increasing id, so a slow earlier
 * analysis can never overwrite the newest result. The panel never edits the
 * document.
 */
export const QualityPanel: React.FC<QualityPanelProps> = ({
  isOpen,
  onClose,
  content,
  sourceFilePath,
  onLocate,
}) => {
  const { language } = useI18n();
  const [issues, setIssues] = useState<QualityIssue[]>([]);
  const [status, setStatus] = useState<QualityPanelStatus>('loading');
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<QualityFilter>('all');
  const requestIdRef = useRef(0);

  useEffect(() => {
    if (isOpen) {
      // A panel reopened after being closed must not flash the previous
      // document's results while the debounced re-check is pending.
      setFilter('all');
      return;
    }
    setIssues([]);
    setStatus('loading');
    setError(null);
  }, [isOpen]);

  const runAnalysis = useCallback(
    async (requestId: number) => {
      try {
        const syntaxIssues = analyzeDocumentQuality(
          content,
          sourceFilePath,
          language
        );
        const resourceIssues = await checkLocalDocumentResources(
          content,
          sourceFilePath,
          undefined,
          language
        );
        if (requestId !== requestIdRef.current) return;
        setIssues(
          [...syntaxIssues, ...resourceIssues].sort(compareQualityIssues)
        );
        setStatus('ready');
        setError(null);
      } catch (caught) {
        if (requestId !== requestIdRef.current) return;
        setStatus('error');
        setError(formatQualityError(caught, language));
      }
    },
    [content, sourceFilePath, language]
  );

  useEffect(() => {
    if (!isOpen) return;

    const requestId = ++requestIdRef.current;

    if (!content.trim()) {
      setIssues([]);
      setStatus('ready');
      setError(null);
      return;
    }

    setIssues([]);
    setStatus('loading');
    setError(null);

    if (typeof window === 'undefined') return;
    const timer = window.setTimeout(() => {
      void runAnalysis(requestId);
    }, 250);

    return () => {
      window.clearTimeout(timer);
      // Invalidate any in-flight request so its result is ignored.
      requestIdRef.current += 1;
    };
  }, [isOpen, content, sourceFilePath, language, runAnalysis]);

  const handleRefresh = useCallback(() => {
    const requestId = ++requestIdRef.current;
    if (!content.trim()) {
      setIssues([]);
      setStatus('ready');
      setError(null);
      return;
    }
    setIssues([]);
    setStatus('loading');
    setError(null);
    void runAnalysis(requestId);
  }, [content, runAnalysis]);

  return (
    <QualityPanelView
      isOpen={isOpen}
      onClose={onClose}
      onLocate={onLocate}
      onRefresh={handleRefresh}
      status={status}
      issues={issues}
      error={error}
      isDocumentEmpty={content.trim().length === 0}
      filter={filter}
      onFilterChange={setFilter}
      sourceFilePath={sourceFilePath}
    />
  );
};

export default QualityPanel;
