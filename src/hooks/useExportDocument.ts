import { useState, useCallback } from 'react';
import { DocumentTab, ToastType } from '@/types';
import { exportFileDialog, writeBinaryFile } from '@/lib/native';
import { getExportFilename } from '@/lib/documentUtils';

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
      showToast('正在生成 Word 文档...', 'info', 2000);

      const { exportMarkdownToDocx } = await import('@/lib/export/docxExporter');
      const docxBytes = await exportMarkdownToDocx(activeTab.content, activeTab.title);
      await writeBinaryFile(targetPath, docxBytes);

      if (targetPath.startsWith('browser://')) {
        showToast('Word 文档已开始下载', 'success', 3000);
      } else {
        showToast(`Word 文档已成功导出: ${targetPath}`, 'success', 4000);
      }
    } catch (err: unknown) {
      const msg = typeof err === 'string' ? err : (err as Error)?.message || '导出 Word 文档失败';
      showToast(`导出 Word 失败: ${msg}`, 'error', 5000);
    } finally {
      setIsExporting(false);
      setExportingType(null);
    }
  }, [activeTab, isExporting, showToast]);

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
      showToast('正在生成 PDF 文档...', 'info', 3000);

      const { exportMarkdownToPdf } = await import('@/lib/export/pdfExporter');
      await exportMarkdownToPdf(
        activeTab.content,
        activeTab.title,
        targetPath,
        activeTab.filePath || undefined
      );

      if (targetPath.startsWith('browser://')) {
        showToast('PDF 打印预览已打开', 'success', 3000);
      } else {
        showToast(`PDF 文档已成功导出: ${targetPath}`, 'success', 4000);
      }
    } catch (err: unknown) {
      const msg = typeof err === 'string' ? err : (err as Error)?.message || '导出 PDF 文档失败';
      showToast(`导出 PDF 失败: ${msg}`, 'error', 5000);
    } finally {
      setIsExporting(false);
      setExportingType(null);
    }
  }, [activeTab, isExporting, showToast]);

  return {
    isExporting,
    exportingType,
    exportWord,
    exportPdf,
  };
}
