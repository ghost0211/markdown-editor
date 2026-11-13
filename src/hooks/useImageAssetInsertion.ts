import { useCallback, useRef } from 'react';
import { DocumentTab } from '@/types';
import type { EditorHandle } from '@/components/Editor';
import { isTauri, writeBinaryFile } from '@/lib/native';
import {
  createImageAssetName,
  createImageMarkdown,
  getImageAltFromName,
  getImageAssetDestination,
} from '@/lib/imageAssets';
import { useI18n } from '@/i18n';

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('Failed to read image'));
    reader.readAsDataURL(file);
  });
}

export interface UseImageAssetInsertionOptions {
  tabs: DocumentTab[];
  activeTabId: string;
  editorRef: React.RefObject<EditorHandle | null>;
  updateContent: (tabId: string, content: string) => void;
  showToast: (msg: string, type: 'info' | 'success' | 'warning' | 'error') => void;
}

/**
 * Saves pasted/dropped images next to a saved desktop document and inserts
 * relative Markdown links. Unsaved documents and the browser build embed a
 * data URL instead, so the image never points at a transient clipboard file.
 */
export function useImageAssetInsertion({
  tabs,
  activeTabId,
  editorRef,
  updateContent,
  showToast,
}: UseImageAssetInsertionOptions) {
  const { t } = useI18n();

  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const activeTabIdRef = useRef(activeTabId);
  activeTabIdRef.current = activeTabId;

  const handleImageFiles = useCallback(
    async (files: File[], position: number) => {
      const docId = activeTabIdRef.current;
      const doc = tabsRef.current.find((tab) => tab.id === docId);
      if (!doc || doc.kind === 'diff' || files.length === 0) return;

      const canUseAssets =
        isTauri() && Boolean(doc.filePath) && !doc.filePath!.startsWith('browser://');
      const snippets: string[] = [];
      let lastError = '';

      for (const file of files) {
        try {
          const alt = getImageAltFromName(file.name, t('markdown.imageAlt'));
          if (canUseAssets) {
            const destination = getImageAssetDestination(
              doc.filePath!,
              createImageAssetName(file)
            );
            const bytes = new Uint8Array(await file.arrayBuffer());
            await writeBinaryFile(destination.absolutePath, bytes);
            snippets.push(createImageMarkdown(destination.markdownPath, alt));
          } else {
            snippets.push(createImageMarkdown(await readFileAsDataUrl(file), alt));
          }
        } catch (error) {
          lastError = error instanceof Error ? error.message : String(error);
        }
      }

      if (snippets.length > 0) {
        const latest = tabsRef.current.find((tab) => tab.id === docId);
        if (latest) {
          const at = Math.max(0, Math.min(position, latest.content.length));
          const prefix = at > 0 && latest.content[at - 1] !== '\n' ? '\n\n' : '';
          const suffix = at < latest.content.length && latest.content[at] !== '\n' ? '\n\n' : '';
          const insertion = `${prefix}${snippets.join('\n\n')}${suffix}`;

          if (activeTabIdRef.current === docId && editorRef.current) {
            editorRef.current.insertText(insertion, at);
          } else {
            updateContent(docId, latest.content.slice(0, at) + insertion + latest.content.slice(at));
          }
          showToast(t('toasts.imageInserted', { count: snippets.length }), 'success');
        }
      }

      if (lastError) {
        showToast(t('toasts.imageInsertFailed', { error: lastError }), 'error');
      }
    },
    [editorRef, showToast, t, updateContent]
  );

  const handleImageFilesForEditor = useCallback(
    (files: File[], position: number) => {
      void handleImageFiles(files, position);
    },
    [handleImageFiles]
  );

  return { handleImageFilesForEditor };
}
