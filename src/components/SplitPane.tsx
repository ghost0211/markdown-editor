import React, {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';
import clsx from 'clsx';
import {
  DEFAULT_MAX_RATIO,
  DEFAULT_MIN_RATIO,
  clampRatio,
  normalizeBounds,
  ratioFromKeyboard,
  ratioFromPointer,
  ratioToPercent,
} from '@/lib/splitPane';

export interface SplitPaneProps {
  left: React.ReactNode;
  right: React.ReactNode;
  /** Controlled split position, 0..1 (clamped to [minRatio, maxRatio]). */
  ratio: number;
  /** Called continuously while dragging and for every keyboard adjustment. */
  onRatioChange: (ratio: number) => void;
  /** Called once when a drag ends (or a keyboard adjustment is committed). */
  onRatioCommit?: (ratio: number) => void;
  minRatio?: number;
  maxRatio?: number;
  className?: string;
  separatorLabel?: string;
}

interface ActiveDrag {
  pointerId: number;
  containerLeft: number;
  containerWidth: number;
  minRatio: number;
  maxRatio: number;
  startRatio: number;
  lastRatio: number;
  pendingRatio: number | null;
  frame: number | null;
  captureTarget: HTMLElement;
  removeGlobalListeners: () => void;
  restoreBody: () => void;
}

/**
 * A self-contained, accessible two-pane split view.
 *
 * Layout is a plain flex row; the left pane gets an exact percentage basis and
 * the right pane consumes the remainder, so the separator's own width never
 * shifts the split position. Narrow containers are deliberately NOT collapsed
 * here — the parent decides when to render a single pane instead.
 */
export const SplitPane: React.FC<SplitPaneProps> = ({
  left,
  right,
  ratio,
  onRatioChange,
  onRatioCommit,
  minRatio = DEFAULT_MIN_RATIO,
  maxRatio = DEFAULT_MAX_RATIO,
  className,
  separatorLabel = 'Resize panels',
}) => {
  const paneId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const separatorRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<ActiveDrag | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  // Callbacks are read through a ref so a pointer drag that spans several
  // parent renders keeps invoking the latest handlers.
  const callbacksRef = useRef({ onRatioChange, onRatioCommit });
  useEffect(() => {
    callbacksRef.current = { onRatioChange, onRatioCommit };
  }, [onRatioChange, onRatioCommit]);

  const bounds = normalizeBounds(minRatio, maxRatio);
  const safeRatio = clampRatio(ratio, bounds.minRatio, bounds.maxRatio);
  const percent = ratioToPercent(safeRatio);

  /** Tear a drag down without emitting any callback (used on unmount). */
  const cancelDrag = useCallback(() => {
    const drag = dragRef.current;
    if (!drag) return;
    dragRef.current = null;

    if (drag.frame !== null) cancelAnimationFrame(drag.frame);
    drag.removeGlobalListeners();
    drag.restoreBody();

    if (drag.captureTarget.hasPointerCapture(drag.pointerId)) {
      drag.captureTarget.releasePointerCapture(drag.pointerId);
    }
  }, []);

  useEffect(() => () => cancelDrag(), [cancelDrag]);

  /**
   * End the active drag, flush the last coalesced frame and (optionally)
   * commit the final ratio. Safe to call more than once per gesture.
   */
  const finishDrag = useCallback((commit: boolean) => {
    const drag = dragRef.current;
    if (!drag) return;
    dragRef.current = null;

    if (drag.frame !== null) {
      cancelAnimationFrame(drag.frame);
      drag.frame = null;
    }

    // Flush a pending animation frame synchronously so the value committed is
    // exactly the ratio at the point of release.
    if (drag.pendingRatio !== null) {
      const pending = drag.pendingRatio;
      drag.pendingRatio = null;
      if (pending !== drag.lastRatio) {
        drag.lastRatio = pending;
        callbacksRef.current.onRatioChange(pending);
      }
    }

    drag.removeGlobalListeners();
    drag.restoreBody();

    if (drag.captureTarget.hasPointerCapture(drag.pointerId)) {
      drag.captureTarget.releasePointerCapture(drag.pointerId);
    }

    setIsDragging(false);

    if (commit && drag.lastRatio !== drag.startRatio) {
      callbacksRef.current.onRatioCommit?.(drag.lastRatio);
    }
  }, []);

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      // Ignore secondary mouse buttons and re-entrant gestures.
      if (dragRef.current) return;
      if (event.pointerType === 'mouse' && event.button !== 0) return;

      const container = containerRef.current;
      if (!container) return;

      const rect = container.getBoundingClientRect();
      if (!Number.isFinite(rect.width) || rect.width <= 0) return;

      // Prevent native text selection/drag and keep focus on the separator.
      event.preventDefault();
      separatorRef.current?.focus({ preventScroll: true });

      const captureTarget = event.currentTarget;
      try {
        captureTarget.setPointerCapture(event.pointerId);
      } catch {
        // Pointer capture can fail for synthetic/stale pointers; the window
        // pointerup listener below still guarantees a clean finish.
      }

      const previousUserSelect = document.body.style.userSelect;
      const previousCursor = document.body.style.cursor;
      document.body.style.userSelect = 'none';
      document.body.style.cursor = 'col-resize';

      const drag: ActiveDrag = {
        pointerId: event.pointerId,
        containerLeft: rect.left,
        containerWidth: rect.width,
        minRatio: bounds.minRatio,
        maxRatio: bounds.maxRatio,
        startRatio: safeRatio,
        lastRatio: safeRatio,
        pendingRatio: null,
        frame: null,
        captureTarget,
        removeGlobalListeners: () => undefined,
        restoreBody: () => undefined,
      };

      const handleWindowPointerUp = (nativeEvent: PointerEvent) => {
        if (nativeEvent.pointerId === drag.pointerId) finishDrag(true);
      };
      const handleWindowPointerCancel = (nativeEvent: PointerEvent) => {
        if (nativeEvent.pointerId === drag.pointerId) finishDrag(true);
      };
      // Losing window focus means we will not receive a reliable pointerup.
      const handleWindowBlur = () => finishDrag(true);

      window.addEventListener('pointerup', handleWindowPointerUp);
      window.addEventListener('pointercancel', handleWindowPointerCancel);
      window.addEventListener('blur', handleWindowBlur);

      drag.removeGlobalListeners = () => {
        window.removeEventListener('pointerup', handleWindowPointerUp);
        window.removeEventListener('pointercancel', handleWindowPointerCancel);
        window.removeEventListener('blur', handleWindowBlur);
      };
      drag.restoreBody = () => {
        document.body.style.userSelect = previousUserSelect;
        document.body.style.cursor = previousCursor;
      };

      dragRef.current = drag;
      setIsDragging(true);
    },
    [bounds.minRatio, bounds.maxRatio, finishDrag, safeRatio]
  );

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;

      event.preventDefault();

      const nextRatio = ratioFromPointer(
        event.clientX,
        drag.containerLeft,
        drag.containerWidth,
        drag.minRatio,
        drag.maxRatio
      );

      if (
        nextRatio === drag.lastRatio &&
        (drag.pendingRatio === null || drag.pendingRatio === nextRatio)
      ) {
        return;
      }
      if (drag.pendingRatio === nextRatio) return;
      drag.pendingRatio = nextRatio;

      // Coalesce pointermove bursts into one state update per frame; this is
      // what keeps the panes from flickering under high-frequency mice.
      if (drag.frame !== null) return;
      drag.frame = window.requestAnimationFrame(() => {
        const current = dragRef.current;
        if (!current || current !== drag) return;
        current.frame = null;

        const pending = current.pendingRatio;
        if (pending === null) return;
        current.pendingRatio = null;
        if (pending === current.lastRatio) return;

        current.lastRatio = pending;
        callbacksRef.current.onRatioChange(pending);
      });
    },
    []
  );

  const handlePointerUp = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      finishDrag(true);
    },
    [finishDrag]
  );

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.altKey || event.ctrlKey || event.metaKey) return;

      const nextRatio = ratioFromKeyboard(
        safeRatio,
        event.key,
        bounds.minRatio,
        bounds.maxRatio
      );
      if (nextRatio === null) return;

      // Arrow keys must not scroll the editor/preview behind the separator,
      // even when the ratio is already pinned at a boundary.
      event.preventDefault();
      if (nextRatio === safeRatio) return;

      callbacksRef.current.onRatioChange(nextRatio);
      callbacksRef.current.onRatioCommit?.(nextRatio);
    },
    [bounds.minRatio, bounds.maxRatio, safeRatio]
  );

  return (
    <div
      ref={containerRef}
      className={clsx(
        'flex h-full w-full min-w-0 overflow-hidden',
        isDragging && 'cursor-col-resize select-none',
        className
      )}
    >
      <div
        id={`${paneId}-left`}
        className="flex min-w-0 flex-col overflow-hidden"
        style={{ flex: `0 0 ${safeRatio * 100}%` }}
      >
        {left}
      </div>

      <div
        ref={separatorRef}
        role="separator"
        aria-orientation="vertical"
        aria-valuenow={percent}
        aria-valuemin={ratioToPercent(bounds.minRatio)}
        aria-valuemax={ratioToPercent(bounds.maxRatio)}
        aria-valuetext={`${percent}%`}
        aria-controls={`${paneId}-left ${paneId}-right`}
        aria-label={separatorLabel}
        tabIndex={0}
        className={clsx(
          'group relative z-10 flex w-1.5 shrink-0 cursor-col-resize touch-none select-none items-center justify-center bg-slate-200 outline-none transition-colors',
          'hover:bg-blue-400 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500',
          'dark:bg-slate-800 dark:hover:bg-blue-600',
          isDragging && 'bg-blue-500 dark:bg-blue-500'
        )}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onLostPointerCapture={handlePointerUp}
        onKeyDown={handleKeyDown}
        onDragStart={(event) => event.preventDefault()}
      >
        <span
          aria-hidden="true"
          className={clsx(
            'pointer-events-none h-8 w-[3px] rounded-full bg-slate-400/80 transition-colors',
            'group-hover:bg-blue-700 group-focus-visible:bg-blue-700 dark:bg-slate-600',
            isDragging && 'bg-blue-100 dark:bg-blue-100'
          )}
        />
      </div>

      <div
        id={`${paneId}-right`}
        className="flex min-w-0 flex-1 flex-col overflow-hidden"
      >
        {right}
      </div>
    </div>
  );
};
