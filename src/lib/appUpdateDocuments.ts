import type { DocumentTab } from '@/types';

/** Re-read live documents after save dialogs before allowing the app to exit. */
export async function prepareDocumentsForUpdate(
  getTabs: () => readonly DocumentTab[],
  saveDirtyTabs: (ids: string[]) => Promise<boolean>,
  flushSession: () => void,
): Promise<boolean> {
  const ids = getTabs().filter(tab => tab.kind !== 'diff' && tab.isDirty).map(tab => tab.id);
  if (!await saveDirtyTabs(ids)) return false;
  if (getTabs().some(tab => tab.kind !== 'diff' && tab.isDirty)) return false;
  flushSession();
  return true;
}
