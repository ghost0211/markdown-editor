import { useCallback } from 'react';
import { ConfirmDialogState, DocumentTab } from '@/types';
import { getFileMtime, isTauri, readTextFile } from '@/lib/native';
import { decideExternalChangeAction } from '@/lib/documentUtils';
import { useI18n } from '@/i18n';

export interface UseExternalFileChangesOptions {
  tabsRef: React.MutableRefObject<DocumentTab[]>;
  confirmDialogRef: React.MutableRefObject<ConfirmDialogState>;
  setConfirmDialog: React.Dispatch<React.SetStateAction<ConfirmDialogState>>;
  reloadTabFromDisk: (tabId: string, content: string, mtime: number) => void;
  setTabMtimeBaseline: (tabId: string, mtime: number) => void;
  showToast: (msg: string, type: 'info' | 'success' | 'warning' | 'error') => void;
}

/**
 * Checks all open file-backed tabs for external modifications on disk.
 * - Unmodified tabs are reloaded automatically (with an info toast).
 * - Dirty tabs trigger a confirm dialog (reload vs keep local edits).
 */
export function useExternalFileChanges({
  tabsRef,
  confirmDialogRef,
  setConfirmDialog,
  reloadTabFromDisk,
  setTabMtimeBaseline,
  showToast,
}: UseExternalFileChangesOptions) {
  const { t } = useI18n();

  const checkExternalChanges = useCallback(async () => {
    if (!isTauri()) return;

    const snapshot = tabsRef.current;
    for (const tab of snapshot) {
      if (!tab.filePath || tab.filePath.startsWith('browser://')) continue;

      let mtime: number | null;
      try {
        mtime = await getFileMtime(tab.filePath);
      } catch {
        continue;
      }

      // Re-read the freshest tab state (may have changed during awaits)
      const fresh = tabsRef.current.find((item) => item.id === tab.id);
      if (!fresh || !fresh.filePath) continue;

      const needsContent =
        fresh.fileMtime !== undefined && mtime !== null && mtime !== fresh.fileMtime;

      let content: string | null = null;
      if (needsContent) {
        try {
          content = await readTextFile(fresh.filePath);
        } catch {
          continue;
        }
      }

      const action = decideExternalChangeAction(fresh, mtime, content);

      if (action === 'baseline' && mtime !== null) {
        setTabMtimeBaseline(fresh.id, mtime);
      } else if (action === 'reload' && content !== null && mtime !== null) {
        reloadTabFromDisk(fresh.id, content, mtime);
        showToast(t('toasts.externalReloaded', { title: fresh.title }), 'info');
      } else if (action === 'prompt' && content !== null && mtime !== null) {
        // Only one confirm dialog at a time; other dirty tabs wait for the next check round
        if (confirmDialogRef.current.isOpen) continue;

        const pendingContent = content;
        const pendingMtime = mtime;
        const tabId = fresh.id;
        const tabTitle = fresh.title;
        setConfirmDialog({
          isOpen: true,
          title: t('confirm.externalChangeTitle'),
          message: t('confirm.externalChangeMsg', { title: tabTitle }),
          confirmLabel: t('confirm.reloadFromDisk'),
          cancelLabel: t('confirm.keepMyChanges'),
          variant: 'warning',
          onConfirm: () => {
            reloadTabFromDisk(tabId, pendingContent, pendingMtime);
            setConfirmDialog((prev) => ({ ...prev, isOpen: false }));
            showToast(t('toasts.externalReloaded', { title: tabTitle }), 'info');
          },
          onCancel: () => {
            setTabMtimeBaseline(tabId, pendingMtime);
            setConfirmDialog((prev) => ({ ...prev, isOpen: false }));
          },
        });
      }
    }
  }, [confirmDialogRef, reloadTabFromDisk, setConfirmDialog, setTabMtimeBaseline, showToast, t, tabsRef]);

  return { checkExternalChanges };
}
