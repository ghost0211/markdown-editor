import { useEffect, useRef } from 'react';
import { drainPendingOpenFiles, isTauri, subscribeOpenFiles } from '@/lib/native';
import { createFileCoordinator } from '@/lib/fileCoordinator';
import { dragCarriesFiles, filterMarkdownFiles, MAX_DROPPED_FILE_BYTES } from '@/lib/dropFiles';
import { filterImageFiles } from '@/lib/imageAssets';
import { useI18n } from '@/i18n';

export interface UseWindowFileDropOptions {
  openFilesByPaths: (paths: string[]) => Promise<void>;
  openDroppedDocument: (name: string, content: string) => void;
  showToast: (msg: string, type: 'info' | 'success' | 'warning' | 'error') => void;
}

/**
 * Coordinates external file entry points for the window:
 * 1. Drag-and-drop of Markdown/text files onto the window.
 * 2. Cold-start CLI arguments & single-instance file association wake-ups.
 */
export function useWindowFileDrop({
  openFilesByPaths,
  openDroppedDocument,
  showToast,
}: UseWindowFileDropOptions): void {
  const { t } = useI18n();

  const openFilesByPathsRef = useRef(openFilesByPaths);
  openFilesByPathsRef.current = openFilesByPaths;

  const openDroppedDocumentRef = useRef(openDroppedDocument);
  openDroppedDocumentRef.current = openDroppedDocument;

  const showToastRef = useRef(showToast);
  showToastRef.current = showToast;

  const tRef = useRef(t);
  tRef.current = t;

  useEffect(() => {
    const handleDragOver = (event: DragEvent) => {
      if (dragCarriesFiles(event.dataTransfer)) event.preventDefault();
    };

    // Registered in capture phase so Markdown / text files dropped directly onto
    // the CodeMirror editor surface are opened as clean document tabs instead of
    // being intercepted by CodeMirror's built-in FileReader text-insertion handler
    // (which would paste the file into the active buffer and mark it dirty).
    const handleDropCapture = (event: DragEvent) => {
      if (event.defaultPrevented || !dragCarriesFiles(event.dataTransfer)) return;

      const allFiles = Array.from(event.dataTransfer?.files ?? []);
      const mdFiles = filterMarkdownFiles(allFiles);
      const imageFiles = filterImageFiles(allFiles);

      if (mdFiles.length === 0) {
        // Let image-only drops reach CodeMirror's drop handler so images insert
        // at the drop cursor; block unknown non-image file drops here so
        // CodeMirror never dumps binary/raw files into the active document.
        if (imageFiles.length === 0 && allFiles.length > 0) {
          event.preventDefault();
        }
        return;
      }

      // If no images accompany the Markdown drop, mark defaultPrevented now so
      // CodeMirror's runHandlers skips its built-in drop handler.
      if (imageFiles.length === 0) {
        event.preventDefault();
      }

      void (async () => {
        for (const file of mdFiles) {
          if (file.size > MAX_DROPPED_FILE_BYTES) {
            showToastRef.current(tRef.current('toasts.dropTooLarge', { name: file.name }), 'warning');
            continue;
          }
          try {
            openDroppedDocumentRef.current(file.name, await file.text());
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            showToastRef.current(
              tRef.current('toasts.dropFailed', { name: file.name, error: message }),
              'error'
            );
          }
        }
      })();
    };

    // Bubble-phase guard: if an image file was dropped outside the editor (e.g.
    // onto the Preview or TitleBar), prevent the WebView from navigating to it.
    const handleDropBubble = (event: DragEvent) => {
      if (!event.defaultPrevented && dragCarriesFiles(event.dataTransfer)) {
        event.preventDefault();
      }
    };

    window.addEventListener('dragover', handleDragOver);
    window.addEventListener('drop', handleDropCapture, true);
    window.addEventListener('drop', handleDropBubble);
    return () => {
      window.removeEventListener('dragover', handleDragOver);
      window.removeEventListener('drop', handleDropCapture, true);
      window.removeEventListener('drop', handleDropBubble);
    };
  }, []);

  useEffect(() => {
    const coordinator = createFileCoordinator({
      drainPendingFiles: drainPendingOpenFiles,
      onFilesReceived: (paths) => openFilesByPathsRef.current(paths),
      isTauri,
      subscribeOpenFiles,
      pollIntervalMs: 2000,
    });

    coordinator.start();

    return () => {
      coordinator.stop();
    };
  }, []);
}
