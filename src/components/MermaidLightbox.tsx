import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Check,
  Download,
  Maximize,
  Minimize2,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { useI18n } from '@/i18n';
import { exportMermaidPng, exportMermaidSvg } from '@/lib/export/mermaidExporter';
import {
  MERMAID_MAX_ZOOM,
  MERMAID_MIN_ZOOM,
  MERMAID_PAN_KEY_STEP,
  MERMAID_ZOOM_STEP,
  MermaidViewport,
  computeActualSizeViewport,
  computeFitViewport,
  formatZoomPercent,
  panViewport,
  prepareSvgForLightbox,
  wheelDeltaToScale,
  zoomViewportAtPoint,
} from '@/lib/mermaidViewport';

export interface MermaidLightboxProps {
  isOpen: boolean;
  svg: string;
  isDark: boolean;
  onClose: () => void;
}

const TOOLBAR_BUTTON_CLASS =
  'inline-flex items-center justify-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-200/80 dark:hover:bg-slate-700/80 disabled:opacity-40 disabled:pointer-events-none transition-colors';

/**
 * Dialog body rendered inside a document.body portal (exported directly for
 * SSR/static markup unit tests).
 */
export const MermaidLightboxDialog: React.FC<Omit<MermaidLightboxProps, 'isOpen'>> = ({
  svg,
  isDark,
  onClose,
}) => {
  const { t } = useI18n();
  const dialogRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [exportedFormat, setExportedFormat] = useState<'svg' | 'png' | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const prepared = useMemo(() => prepareSvgForLightbox(svg), [svg]);
  const contentDimsRef = useRef({ width: prepared.width, height: prepared.height });
  contentDimsRef.current = { width: prepared.width, height: prepared.height };

  const [viewport, setViewport] = useState<MermaidViewport>(() => {
    if (typeof window === 'undefined') {
      return { scale: 1, x: 0, y: 0 };
    }
    return computeFitViewport(
      window.innerWidth,
      Math.max(200, window.innerHeight - 48),
      prepared.width,
      prepared.height
    );
  });

  const dragRef = useRef<{ pointerId: number; lastX: number; lastY: number } | null>(null);

  const getStageSize = useCallback(() => {
    const rect = stageRef.current?.getBoundingClientRect();
    if (rect && rect.width > 0 && rect.height > 0) {
      return { width: rect.width, height: rect.height };
    }
    if (typeof window !== 'undefined') {
      return { width: window.innerWidth, height: Math.max(200, window.innerHeight - 48) };
    }
    return { width: 1200, height: 750 };
  }, []);

  const fitToStage = useCallback(() => {
    const { width: vw, height: vh } = getStageSize();
    const { width: cw, height: ch } = contentDimsRef.current;
    setViewport(computeFitViewport(vw, vh, cw, ch));
  }, [getStageSize]);

  const setActualSize = useCallback(() => {
    const { width: vw, height: vh } = getStageSize();
    const { width: cw, height: ch } = contentDimsRef.current;
    setViewport(computeActualSizeViewport(vw, vh, cw, ch));
  }, [getStageSize]);

  const zoomByFactor = useCallback(
    (factor: number) => {
      const { width: vw, height: vh } = getStageSize();
      setViewport((prev) => zoomViewportAtPoint(prev, prev.scale * factor, vw / 2, vh / 2));
    },
    [getStageSize]
  );

  // Measure actual stage dimensions on mount / SVG change so initial fit is exact.
  useEffect(() => {
    fitToStage();
  }, [svg, fitToStage]);

  // Restore focus to previously active control on close.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const previousFocus = document.activeElement;
    dialogRef.current?.focus();
    return () => {
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) {
        previousFocus.focus();
      }
    };
  }, []);

  // Capture-phase keyboard shortcuts while viewer is open so app-level hotkeys
  // do not fire behind the fullscreen overlay.
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onClose();
        return;
      }

      if (event.key === '+' || event.key === '=') {
        event.preventDefault();
        event.stopPropagation();
        zoomByFactor(MERMAID_ZOOM_STEP);
        return;
      }

      if (event.key === '-' || event.key === '_') {
        event.preventDefault();
        event.stopPropagation();
        zoomByFactor(1 / MERMAID_ZOOM_STEP);
        return;
      }

      if (event.key === '0') {
        event.preventDefault();
        event.stopPropagation();
        fitToStage();
        return;
      }

      if (event.key === '1') {
        event.preventDefault();
        event.stopPropagation();
        setActualSize();
        return;
      }

      if (event.key === 'ArrowUp') {
        event.preventDefault();
        event.stopPropagation();
        setViewport((prev) => panViewport(prev, 0, MERMAID_PAN_KEY_STEP));
        return;
      }
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        event.stopPropagation();
        setViewport((prev) => panViewport(prev, 0, -MERMAID_PAN_KEY_STEP));
        return;
      }
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        event.stopPropagation();
        setViewport((prev) => panViewport(prev, MERMAID_PAN_KEY_STEP, 0));
        return;
      }
      if (event.key === 'ArrowRight') {
        event.preventDefault();
        event.stopPropagation();
        setViewport((prev) => panViewport(prev, -MERMAID_PAN_KEY_STEP, 0));
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [onClose, zoomByFactor, fitToStage, setActualSize]);

  // Non-passive wheel listener so cursor-anchored zoom prevents page scroll
  // and browser pinch-zoom seamlessly.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;

    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = stage.getBoundingClientRect();
      const anchorX = event.clientX - rect.left;
      const anchorY = event.clientY - rect.top;

      setViewport((prev) => {
        const nextScale = wheelDeltaToScale(prev.scale, event.deltaY, event.ctrlKey);
        return zoomViewportAtPoint(prev, nextScale, anchorX, anchorY);
      });
    };

    stage.addEventListener('wheel', handleWheel, { passive: false });
    return () => stage.removeEventListener('wheel', handleWheel);
  }, []);

  const handlePointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 && event.button !== 1) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      lastX: event.clientX,
      lastY: event.clientY,
    };
    setIsDragging(true);
  }, []);

  const handlePointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const dx = event.clientX - drag.lastX;
    const dy = event.clientY - drag.lastY;
    drag.lastX = event.clientX;
    drag.lastY = event.clientY;
    if (dx !== 0 || dy !== 0) {
      setViewport((prev) => panViewport(prev, dx, dy));
    }
  }, []);

  const finishDrag = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    setIsDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, []);

  const handleDoubleClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      const stage = stageRef.current;
      if (!stage) return;
      const rect = stage.getBoundingClientRect();
      const anchorX = event.clientX - rect.left;
      const anchorY = event.clientY - rect.top;
      const { width: cw, height: ch } = contentDimsRef.current;
      const fit = computeFitViewport(rect.width, rect.height, cw, ch);

      setViewport((prev) => {
        const isNearFit = Math.abs(prev.scale - fit.scale) < 0.05;
        if (isNearFit) {
          const targetScale = fit.scale < 0.95 ? 1 : Math.min(2, fit.scale * 1.6);
          return zoomViewportAtPoint(prev, targetScale, anchorX, anchorY);
        }
        return fit;
      });
    },
    []
  );

  const handleExportSvg = useCallback(async () => {
    try {
      const saved = await exportMermaidSvg(svg);
      if (saved) {
        setExportedFormat('svg');
        setTimeout(() => setExportedFormat((cur) => (cur === 'svg' ? null : cur)), 2000);
      }
    } catch (err) {
      console.warn('导出 Mermaid SVG 失败:', err);
    }
  }, [svg]);

  const handleExportPng = useCallback(async () => {
    try {
      const saved = await exportMermaidPng(svg, isDark);
      if (saved) {
        setExportedFormat('png');
        setTimeout(() => setExportedFormat((cur) => (cur === 'png' ? null : cur)), 2000);
      }
    } catch (err) {
      console.warn('导出 Mermaid PNG 失败:', err);
    }
  }, [svg, isDark]);

  const zoomPercentLabel = formatZoomPercent(viewport.scale);

  return (
    <div
      ref={dialogRef}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-label={t('preview.mermaidViewerTitle')}
      className="fixed inset-0 z-[75] flex flex-col bg-app text-slate-900 dark:text-slate-100 outline-none"
    >
      {/* Top Toolbar */}
      <div className="flex items-center justify-between gap-3 h-12 px-4 border-b border-slate-200 dark:border-slate-800 bg-chrome shrink-0 select-none">
        <div className="flex items-center gap-3 min-w-0">
          <span className="text-xs uppercase tracking-wider font-mono font-semibold text-slate-700 dark:text-slate-200">
            Mermaid
          </span>
          <span className="hidden sm:inline text-xs text-slate-500 dark:text-slate-400 truncate">
            {t('preview.mermaidViewerHint')}
          </span>
        </div>

        {/* Zoom Controls */}
        <div
          role="toolbar"
          aria-label={t('preview.mermaidViewerTitle')}
          className="flex items-center gap-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-elevated px-1.5 py-0.5 shadow-sm"
        >
          <button
            type="button"
            onClick={() => zoomByFactor(1 / MERMAID_ZOOM_STEP)}
            disabled={viewport.scale <= MERMAID_MIN_ZOOM + 0.001}
            title={t('preview.mermaidZoomOut')}
            aria-label={t('preview.mermaidZoomOut')}
            className={TOOLBAR_BUTTON_CLASS}
          >
            <ZoomOut className="w-3.5 h-3.5" />
          </button>

          <button
            type="button"
            onClick={setActualSize}
            title={t('preview.mermaidZoomReset')}
            aria-label={t('preview.mermaidZoomReset')}
            className="min-w-[52px] px-1.5 py-1 rounded text-center text-xs font-mono tabular-nums text-slate-700 dark:text-slate-200 hover:bg-slate-200/80 dark:hover:bg-slate-700/80 transition-colors"
          >
            {zoomPercentLabel}
          </button>

          <button
            type="button"
            onClick={() => zoomByFactor(MERMAID_ZOOM_STEP)}
            disabled={viewport.scale >= MERMAID_MAX_ZOOM - 0.001}
            title={t('preview.mermaidZoomIn')}
            aria-label={t('preview.mermaidZoomIn')}
            className={TOOLBAR_BUTTON_CLASS}
          >
            <ZoomIn className="w-3.5 h-3.5" />
          </button>

          <div className="w-px h-4 bg-slate-200 dark:bg-slate-700 mx-0.5" aria-hidden="true" />

          <button
            type="button"
            onClick={fitToStage}
            title={t('preview.mermaidZoomFit')}
            aria-label={t('preview.mermaidZoomFit')}
            className={TOOLBAR_BUTTON_CLASS}
          >
            <Maximize className="w-3.5 h-3.5" />
            <span className="hidden md:inline">{t('preview.mermaidZoomFitShort')}</span>
          </button>

          <button
            type="button"
            onClick={setActualSize}
            title={t('preview.mermaidZoomActual')}
            aria-label={t('preview.mermaidZoomActual')}
            className={TOOLBAR_BUTTON_CLASS}
          >
            <span className="font-mono">1:1</span>
          </button>
        </div>

        {/* Export & Close */}
        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={handleExportSvg}
            title={t('preview.exportSvg')}
            aria-label={t('preview.exportSvg')}
            className={TOOLBAR_BUTTON_CLASS}
          >
            {exportedFormat === 'svg' ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-500" />
                <span className="text-emerald-500">{t('preview.exportedLabel')}</span>
              </>
            ) : (
              <>
                <Download className="w-3.5 h-3.5" />
                <span>SVG</span>
              </>
            )}
          </button>

          <button
            type="button"
            onClick={handleExportPng}
            title={t('preview.exportPng')}
            aria-label={t('preview.exportPng')}
            className={TOOLBAR_BUTTON_CLASS}
          >
            {exportedFormat === 'png' ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-500" />
                <span className="text-emerald-500">{t('preview.exportedLabel')}</span>
              </>
            ) : (
              <>
                <Download className="w-3.5 h-3.5" />
                <span>PNG</span>
              </>
            )}
          </button>

          <div className="w-px h-4 bg-slate-200 dark:bg-slate-700 mx-1" aria-hidden="true" />

          <button
            type="button"
            onClick={onClose}
            title={t('preview.imageViewerClose')}
            aria-label={t('preview.imageViewerClose')}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/50 dark:hover:text-red-400 transition-colors"
          >
            <Minimize2 className="w-3.5 h-3.5 hidden sm:inline" />
            <X className="w-4 h-4 sm:hidden" />
            <span className="hidden sm:inline">{t('common.close')}</span>
          </button>
        </div>
      </div>

      {/* Interactive Zoom / Pan Stage */}
      <div
        ref={stageRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={finishDrag}
        onPointerCancel={finishDrag}
        onDoubleClick={handleDoubleClick}
        className={`md-mermaid-lightbox-stage relative flex-1 overflow-hidden select-none touch-none ${
          isDragging ? 'cursor-grabbing' : 'cursor-grab'
        }`}
      >
        <div
          className="md-mermaid-lightbox-svg absolute top-0 left-0 will-change-transform"
          style={{
            width: `${prepared.width}px`,
            height: `${prepared.height}px`,
            transform: `translate3d(${viewport.x}px, ${viewport.y}px, 0) scale(${viewport.scale})`,
            transformOrigin: '0 0',
          }}
          dangerouslySetInnerHTML={{ __html: prepared.svg }}
        />
      </div>
    </div>
  );
};

export const MermaidLightbox: React.FC<MermaidLightboxProps> = ({
  isOpen,
  svg,
  isDark,
  onClose,
}) => {
  if (!isOpen || !svg || typeof document === 'undefined') {
    return null;
  }

  return createPortal(
    <MermaidLightboxDialog svg={svg} isDark={isDark} onClose={onClose} />,
    document.body
  );
};
