import { useCallback, useEffect, useRef } from 'react';
import { DocumentTab, HeadingItem, ViewMode } from '@/types';
import type { EditorHandle } from '@/components/Editor';
import type { PreviewHandle } from '@/components/Preview';

export interface UsePaneScrollSyncOptions {
  tabs: DocumentTab[];
  activeTabId: string;
  viewMode: ViewMode;
  editorRef: React.RefObject<EditorHandle | null>;
  previewRef: React.RefObject<PreviewHandle | null>;
  updateScrollPositions: (tabId: string, editorScrollTop: number, previewScrollTop: number) => void;
  flushSession: () => void;
}

/**
 * Coordinates per-tab scroll position persistence/restoration, source-line
 * translation across view-mode switches, outline heading jumps, and
 * bidirectional split-pane scroll synchronization.
 */
export function usePaneScrollSync({
  tabs,
  activeTabId,
  viewMode,
  editorRef,
  previewRef,
  updateScrollPositions,
  flushSession,
}: UsePaneScrollSyncOptions) {
  const isSyncingScroll = useRef(false);

  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const activeTabIdRef = useRef(activeTabId);
  activeTabIdRef.current = activeTabId;

  const scrollPositionsRef = useRef(new Map<string, { editor: number; preview: number }>());
  const pendingLineSyncRef = useRef<{ tabId: string; line: number; fraction: number } | null>(null);
  const prevScrollTabIdRef = useRef<string | null>(null);

  const recordEditorScroll = useCallback((top: number) => {
    const id = activeTabIdRef.current;
    if (!id) return;
    const entry = scrollPositionsRef.current.get(id) ?? { editor: 0, preview: 0 };
    entry.editor = top;
    scrollPositionsRef.current.set(id, entry);
  }, []);

  const recordPreviewScroll = useCallback((top: number) => {
    const id = activeTabIdRef.current;
    if (!id) return;
    const entry = scrollPositionsRef.current.get(id) ?? { editor: 0, preview: 0 };
    entry.preview = top;
    scrollPositionsRef.current.set(id, entry);
  }, []);

  /**
   * Captures the top visible source line right before switching view modes so
   * the newly mounted pane continues from the exact reading position.
   */
  const prepareModeSwitchLineSync = useCallback(
    (nextMode: ViewMode) => {
      if (!activeTabId || nextMode === viewMode) return;
      const pos =
        viewMode === 'read' || (viewMode === 'split' && nextMode === 'read')
          ? previewRef.current?.getTopSourceLine()
          : editorRef.current?.getTopVisibleLine();
      pendingLineSyncRef.current = {
        tabId: activeTabId,
        line: pos?.line ?? 1,
        fraction: pos?.fraction ?? 0,
      };
    },
    [activeTabId, editorRef, previewRef, viewMode]
  );

  useEffect(() => {
    const prevTabId = prevScrollTabIdRef.current;

    if (prevTabId && prevTabId !== activeTabId) {
      const prev = scrollPositionsRef.current.get(prevTabId);
      if (prev) {
        updateScrollPositions(prevTabId, prev.editor, prev.preview);
      }
      const openIds = new Set(tabsRef.current.map((t) => t.id));
      for (const key of scrollPositionsRef.current.keys()) {
        if (!openIds.has(key)) {
          scrollPositionsRef.current.delete(key);
        }
      }
    }
    prevScrollTabIdRef.current = activeTabId;

    if (!activeTabId) return;

    const pending = pendingLineSyncRef.current;
    pendingLineSyncRef.current = null;
    if (pending && pending.tabId === activeTabId && prevTabId === activeTabId) {
      isSyncingScroll.current = true;
      const raf = requestAnimationFrame(() => {
        if (viewMode !== 'read') {
          editorRef.current?.scrollToLine(pending.line, pending.fraction);
        }
        if (viewMode !== 'edit') {
          previewRef.current?.scrollToSourceLine(pending.line, pending.fraction);
        }
        setTimeout(() => {
          isSyncingScroll.current = false;
        }, 100);
      });
      return () => cancelAnimationFrame(raf);
    }

    const fromMap = scrollPositionsRef.current.get(activeTabId);
    const tabRecord = tabsRef.current.find((t) => t.id === activeTabId);
    const editorTop = fromMap?.editor ?? tabRecord?.scrollPosition ?? 0;
    const previewTop = fromMap?.preview ?? tabRecord?.previewScrollPosition ?? 0;
    scrollPositionsRef.current.set(activeTabId, { editor: editorTop, preview: previewTop });

    isSyncingScroll.current = true;
    const raf = requestAnimationFrame(() => {
      if (viewMode !== 'read') {
        editorRef.current?.setScrollTop(editorTop);
      }
      if (viewMode !== 'edit') {
        previewRef.current?.setScrollTop(previewTop);
      }
      setTimeout(() => {
        isSyncingScroll.current = false;
      }, 100);
    });
    return () => cancelAnimationFrame(raf);
  }, [activeTabId, editorRef, previewRef, updateScrollPositions, viewMode]);

  useEffect(() => {
    const flush = () => {
      const id = activeTabIdRef.current;
      if (id) {
        const pos = scrollPositionsRef.current.get(id);
        if (pos) {
          updateScrollPositions(id, pos.editor, pos.preview);
        }
      }
      flushSession();
    };
    window.addEventListener('beforeunload', flush);
    window.addEventListener('pagehide', flush);
    return () => {
      window.removeEventListener('beforeunload', flush);
      window.removeEventListener('pagehide', flush);
    };
  }, [flushSession, updateScrollPositions]);

  const handleSelectHeading = useCallback(
    (heading: HeadingItem) => {
      isSyncingScroll.current = true;
      if (viewMode === 'edit' || viewMode === 'split') {
        editorRef.current?.jumpToLine(heading.line);
      }
      if (viewMode === 'read' || viewMode === 'split') {
        previewRef.current?.scrollToAnchor(heading.slug, heading.line);
      }
      setTimeout(() => {
        isSyncingScroll.current = false;
      }, 300);
    },
    [editorRef, previewRef, viewMode]
  );

  const handleEditorScroll = useCallback(
    (scrollTop: number) => {
      recordEditorScroll(scrollTop);
      if (viewMode !== 'split' || isSyncingScroll.current) return;
      const pos = editorRef.current?.getTopVisibleLine();
      if (pos) {
        isSyncingScroll.current = true;
        previewRef.current?.scrollToSourceLine(pos.line, pos.fraction);
        setTimeout(() => {
          isSyncingScroll.current = false;
        }, 50);
      }
    },
    [editorRef, previewRef, recordEditorScroll, viewMode]
  );

  const handlePreviewScroll = useCallback(
    (scrollTop: number) => {
      recordPreviewScroll(scrollTop);
      if (viewMode !== 'split' || isSyncingScroll.current) return;
      const pos = previewRef.current?.getTopSourceLine();
      if (pos) {
        isSyncingScroll.current = true;
        editorRef.current?.scrollToLine(pos.line, pos.fraction);
        setTimeout(() => {
          isSyncingScroll.current = false;
        }, 250);
      }
    },
    [editorRef, previewRef, recordPreviewScroll, viewMode]
  );

  return {
    prepareModeSwitchLineSync,
    handleSelectHeading,
    handleEditorScroll,
    handlePreviewScroll,
  };
}
