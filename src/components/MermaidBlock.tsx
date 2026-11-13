import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useI18n } from '@/i18n';
import { Check, Copy, AlertCircle, Eye, Code as CodeIcon, Download } from 'lucide-react';
import { exportMermaidPng, exportMermaidSvg } from '@/lib/export/mermaidExporter';

export interface MermaidBlockProps {
  className?: string;
  style?: React.CSSProperties;
  children?: React.ReactNode;
  /** Source line forwarded by PreRenderer for scroll synchronization. */
  dataLine?: number;
}

/**
 * Extracts raw text content recursively from React nodes / AST children.
 */
function extractText(node: React.ReactNode): string {
  if (typeof node === 'string') return node;
  if (typeof node === 'number') return String(node);
  if (!node) return '';
  if (Array.isArray(node)) return node.map(extractText).join('');
  if (React.isValidElement(node) && node.props && 'children' in (node.props as Record<string, unknown>)) {
    return extractText((node.props as { children?: React.ReactNode }).children);
  }
  return '';
}

/**
 * Hook to observe application theme changes on document.documentElement.
 * When the 'dark' class is added or removed, this hook updates seamlessly.
 */
export function useIsDarkMode(): boolean {
  const [isDark, setIsDark] = useState<boolean>(() => {
    if (typeof document === 'undefined') return false;
    return document.documentElement.classList.contains('dark');
  });

  useEffect(() => {
    if (typeof document === 'undefined') return;

    const updateTheme = () => {
      setIsDark(document.documentElement.classList.contains('dark'));
    };

    updateTheme();

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
          updateTheme();
        }
      }
    });

    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    });

    return () => {
      observer.disconnect();
    };
  }, []);

  return isDark;
}

let mermaidIdCounter = 0;
export function generateMermaidId(): string {
  mermaidIdCounter += 1;
  return `mermaid-${Date.now().toString(36)}-${mermaidIdCounter}`;
}

export function cleanupMermaidTempElements(id: string): void {
  if (typeof document === 'undefined') return;
  const tempSvg = document.getElementById(id);
  if (tempSvg) tempSvg.remove();
  const tempDiv = document.getElementById('d' + id);
  if (tempDiv) tempDiv.remove();
}

export function formatMermaidError(err: unknown): string {
  if (err instanceof Error) {
    return err.message.replace(/^Error:\s*/, '').trim();
  }
  if (typeof err === 'string') {
    return err.replace(/^Error:\s*/, '').trim();
  }
  return String(err);
}

export interface MermaidRenderState {
  status: 'idle' | 'loading' | 'success' | 'error';
  svg?: string;
  error?: string;
}

/**
 * Fenced code block component specifically dedicated to rendering Mermaid diagrams.
 *
 * Guarantees:
 * 1. Safe async rendering via mermaid with strict security level.
 * 2. Unconditional hook calls ensuring React's Rules of Hooks are strictly preserved.
 * 3. Race condition prevention using monotonic render IDs and cancellation checks.
 * 4. Automatic adaptation to light and dark theme switches without unmounting.
 * 5. Readable error display that never crashes the preview or document pipeline.
 */
export const MermaidBlock: React.FC<MermaidBlockProps> = ({
  children,
  dataLine,
}) => {
  const { t } = useI18n();
  const isDark = useIsDarkMode();
  const [copied, setCopied] = useState(false);
  const [exportedFormat, setExportedFormat] = useState<'svg' | 'png' | null>(null);
  const [showSource, setShowSource] = useState(false);

  const [renderState, setRenderState] = useState<MermaidRenderState>({ status: 'idle' });

  const rawCode = extractText(children).trim();
  const renderIdRef = useRef(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const bindFunctionsRef = useRef<((element: Element) => void) | undefined>(undefined);

  const handleCopy = useCallback(async () => {
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard) {
        await navigator.clipboard.writeText(rawCode);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    } catch {
      // ignore clipboard failures
    }
  }, [rawCode]);

  const handleExportSvg = useCallback(async () => {
    if (!renderState.svg) return;
    try {
      const saved = await exportMermaidSvg(renderState.svg);
      if (saved) {
        setExportedFormat('svg');
        setTimeout(() => setExportedFormat((cur) => (cur === 'svg' ? null : cur)), 2000);
      }
    } catch (err) {
      console.warn('导出 Mermaid SVG 失败:', err);
    }
  }, [renderState.svg]);

  const handleExportPng = useCallback(async () => {
    if (!renderState.svg) return;
    try {
      const saved = await exportMermaidPng(renderState.svg, isDark);
      if (saved) {
        setExportedFormat('png');
        setTimeout(() => setExportedFormat((cur) => (cur === 'png' ? null : cur)), 2000);
      }
    } catch (err) {
      console.warn('导出 Mermaid PNG 失败:', err);
    }
  }, [renderState.svg, isDark]);

  useEffect(() => {
    let isCancelled = false;
    const currentRenderId = ++renderIdRef.current;

    if (!rawCode) {
      setRenderState({ status: 'idle' });
      return;
    }

    // In SSR / non-browser test environment, remain in idle state without throwing
    if (typeof document === 'undefined') {
      return;
    }

    setRenderState((prev) => ({ ...prev, status: 'loading' }));

    const id = generateMermaidId();

    const doRender = async () => {
      try {
        // Mermaid is large and most documents do not contain diagrams. Load it
        // on demand instead of adding it to the editor's initial bundle.
        const mermaid = (await import('mermaid')).default;
        if (isCancelled || currentRenderId !== renderIdRef.current) return;

        mermaid.initialize({
          startOnLoad: false,
          securityLevel: 'strict',
          theme: isDark ? 'dark' : 'default',
          fontFamily: 'inherit',
        });

        const { svg, bindFunctions } = await mermaid.render(id, rawCode);

        // Discard result if cancelled or if a newer render request arrived
        if (isCancelled || currentRenderId !== renderIdRef.current) {
          return;
        }

        bindFunctionsRef.current = bindFunctions;
        setRenderState({
          status: 'success',
          svg,
        });
      } catch (err: unknown) {
        if (isCancelled || currentRenderId !== renderIdRef.current) {
          return;
        }

        bindFunctionsRef.current = undefined;
        setRenderState({
          status: 'error',
          error: formatMermaidError(err),
        });
      } finally {
        cleanupMermaidTempElements(id);
      }
    };

    doRender();

    return () => {
      isCancelled = true;
      cleanupMermaidTempElements(id);
    };
  }, [rawCode, isDark]);

  // Bind interactive elements created by mermaid if any
  useEffect(() => {
    if (renderState.status === 'success' && containerRef.current && bindFunctionsRef.current) {
      try {
        bindFunctionsRef.current(containerRef.current);
      } catch {
        // ignore binding error
      }
    }
  }, [renderState]);

  return (
    <div
      className="relative group my-4 rounded-lg overflow-hidden border shadow-sm md-mermaid-block"
      data-line={dataLine}
    >
      {/* Header bar */}
      <div className="md-mermaid-header">
        <div className="flex items-center space-x-2">
          <span className="text-[11px] uppercase tracking-wider font-semibold">
            Mermaid
          </span>
          {renderState.status === 'error' && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-100 text-red-700 dark:bg-red-950/60 dark:text-red-400 font-sans font-medium">
              {t('preview.mermaidSyntaxError')}
            </span>
          )}
          {renderState.status === 'loading' && (
            <span className="text-[10px] text-slate-400 dark:text-slate-500 animate-pulse font-sans">
              {t('preview.mermaidRendering')}
            </span>
          )}
        </div>
        <div className="flex items-center space-x-1">
          {renderState.status === 'success' && renderState.svg && (
            <>
              <button
                type="button"
                onClick={handleExportSvg}
                title={t('preview.exportSvg')}
                aria-label={t('preview.exportSvg')}
                className="flex items-center space-x-1 px-1.5 py-0.5 rounded hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 transition-colors text-[11px]"
              >
                {exportedFormat === 'svg' ? (
                  <>
                    <Check className="w-3 h-3 text-emerald-500" />
                    <span className="text-emerald-500">{t('preview.exportedLabel')}</span>
                  </>
                ) : (
                  <>
                    <Download className="w-3 h-3" />
                    <span>SVG</span>
                  </>
                )}
              </button>
              <button
                type="button"
                onClick={handleExportPng}
                title={t('preview.exportPng')}
                aria-label={t('preview.exportPng')}
                className="flex items-center space-x-1 px-1.5 py-0.5 rounded hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 transition-colors text-[11px]"
              >
                {exportedFormat === 'png' ? (
                  <>
                    <Check className="w-3 h-3 text-emerald-500" />
                    <span className="text-emerald-500">{t('preview.exportedLabel')}</span>
                  </>
                ) : (
                  <>
                    <Download className="w-3 h-3" />
                    <span>PNG</span>
                  </>
                )}
              </button>
            </>
          )}
          {renderState.status === 'success' && (
            <button
              type="button"
              onClick={() => setShowSource((prev) => !prev)}
              title={showSource ? t('preview.showDiagram') : t('preview.showSource')}
              aria-label={showSource ? t('preview.showDiagram') : t('preview.showSource')}
              className="flex items-center space-x-1 px-1.5 py-0.5 rounded hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 transition-colors text-[11px]"
            >
              {showSource ? <Eye className="w-3 h-3" /> : <CodeIcon className="w-3 h-3" />}
              <span>{showSource ? t('preview.diagram') : t('preview.source')}</span>
            </button>
          )}
          <button
            type="button"
            onClick={handleCopy}
            title={t('common.copyCode')}
            aria-label={t('common.copyCode')}
            className="flex items-center space-x-1 px-1.5 py-0.5 rounded hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 transition-colors text-[11px]"
          >
            {copied ? (
              <>
                <Check className="w-3 h-3 text-emerald-500" />
                <span className="text-emerald-500">{t('common.copied')}</span>
              </>
            ) : (
              <>
                <Copy className="w-3 h-3" />
                <span>{t('common.copy')}</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Main Body */}
      {renderState.status === 'error' ? (
        <div className="flex flex-col">
          <div className="md-mermaid-error">
            <div className="flex items-center space-x-1.5 font-semibold mb-1 text-xs">
              <AlertCircle className="w-3.5 h-3.5 text-red-500 shrink-0" />
              <span>Mermaid {t('preview.mermaidSyntaxError')}</span>
            </div>
            <pre className="font-mono text-xs whitespace-pre-wrap overflow-x-auto text-red-600 dark:text-red-400 !m-0 !p-0 !bg-transparent">
              {renderState.error}
            </pre>
          </div>
          <div className="p-3 bg-slate-900 text-slate-200 text-xs font-mono overflow-x-auto border-t border-slate-800">
            <pre className="!bg-transparent !p-0 !m-0">
              <code>{rawCode}</code>
            </pre>
          </div>
        </div>
      ) : showSource ? (
        <div className="p-3 bg-slate-900 text-slate-200 text-xs font-mono overflow-x-auto">
          <pre className="!bg-transparent !p-0 !m-0">
            <code>{rawCode}</code>
          </pre>
        </div>
      ) : renderState.status === 'success' && renderState.svg ? (
        <div
          ref={containerRef}
          className="md-mermaid-body"
          dangerouslySetInnerHTML={{ __html: renderState.svg }}
        />
      ) : (
        /* Loading / SSR initial state */
        <div className="md-mermaid-body">
          <pre className="text-xs font-mono text-slate-500 dark:text-slate-400 !bg-transparent !p-0 !m-0">
            <code>{rawCode}</code>
          </pre>
        </div>
      )}
    </div>
  );
};
