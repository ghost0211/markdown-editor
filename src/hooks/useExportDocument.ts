import { useState, useCallback } from 'react';
import { DocumentTab, ToastType } from '@/types';
import { exportFileDialog, writeBinaryFile } from '@/lib/native';
import { getExportFilename } from '@/lib/documentUtils';
import { useI18n } from '@/i18n';

export interface UseExportDocumentResult {
  isExporting: boolean;
  exportingType: 'docx' | 'pdf' | null;
  exportWord: () => Promise<void>;
  exportPdf: () => Promise<void>;
}

export function useExportDocument(
  activeTab: DocumentTab | undefined,
  showToast: (message: string, type?: ToastType, duration?: number) => string
): UseExportDocumentResult {
  const { t } = useI18n();
  const [isExporting, setIsExporting] = useState(false);
  const [exportingType, setExportingType] = useState<'docx' | 'pdf' | null>(null);

  const exportWord = useCallback(async () => {
    if (!activeTab || isExporting) return;

    try {
      const defaultName = getExportFilename(activeTab.title, 'docx');
      const targetPath = await exportFileDialog('docx', defaultName);

      // User canceled dialog
      if (!targetPath) {
        return;
      }

      setIsExporting(true);
      setExportingType('docx');
      showToast(t('toasts.exportingWord'), 'info', 2000);

      const { exportMarkdownToDocx } = await import('@/lib/export/docxExporter');
      const docxBytes = await exportMarkdownToDocx(activeTab.content, activeTab.title);
      await writeBinaryFile(targetPath, docxBytes);

      if (targetPath.startsWith('browser://')) {
        showToast(t('toasts.wordDownloadStarted'), 'success', 3000);
      } else {
        showToast(t('toasts.wordExportSuccess', { path: targetPath }), 'success', 4000);
      }
    } catch (err: unknown) {
      const msg = typeof err === 'string' ? err : (err as Error)?.message || 'Export failed';
      showToast(t('toasts.wordExportFailed', { error: msg }), 'error', 5000);
    } finally {
      setIsExporting(false);
      setExportingType(null);
    }
  }, [activeTab, isExporting, showToast, t]);

  const exportPdf = useCallback(async () => {
    if (!activeTab || isExporting) return;

    try {
      const defaultName = getExportFilename(activeTab.title, 'pdf');
      const targetPath = await exportFileDialog('pdf', defaultName);

      // User canceled dialog
      if (!targetPath) {
        return;
      }

      setIsExporting(true);
      setExportingType('pdf');
      showToast(t('toasts.exportingPdf'), 'info', 3000);

      const { exportMarkdownToPdf } = await import('@/lib/export/pdfExporter');
      await exportMarkdownToPdf(
        activeTab.content,
        activeTab.title,
        targetPath,
        activeTab.filePath || undefined
      );

      if (targetPath.startsWith('browser://')) {
        showToast(t('toasts.pdfPreviewOpened'), 'success', 3000);
      } else {
        showToast(t('toasts.pdfExportSuccess', { path: targetPath }), 'success', 4000);
      }
    } catch (err: unknown) {
      const msg = typeof err === 'string' ? err : (err as Error)?.message || 'Export failed';
      showToast(t('toasts.pdfExportFailed', { error: msg }), 'error', 5000);
    } finally {
      setIsExporting(false);
      setExportingType(null);
    }
  }, [activeTab, isExporting, showToast, t]);

  return {
    isExporting,
    exportingType,
    exportWord,
    exportPdf,
  };
}
