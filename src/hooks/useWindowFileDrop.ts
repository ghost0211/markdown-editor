import { useEffect, useRef } from 'react';
import { drainPendingOpenFiles, isTauri, subscribeOpenFiles } from '@/lib/native';
import { createFileCoordinator } from '@/lib/fileCoordinator';
import { dragCarriesFiles, filterMarkdownFiles, MAX_DROPPED_FILE_BYTES } from '@/lib/dropFiles';
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

    const handleDrop = (event: DragEvent) => {
      if (event.defaultPrevented || !dragCarriesFiles(event.dataTransfer)) return;
      event.preventDefault();

      const files = filterMarkdownFiles(Array.from(event.dataTransfer?.files ?? []));
      void (async () => {
        for (const file of files) {
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

    window.addEventListener('dragover', handleDragOver);
    window.addEventListener('drop', handleDrop);
    return () => {
      window.removeEventListener('dragover', handleDragOver);
      window.removeEventListener('drop', handleDrop);
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
