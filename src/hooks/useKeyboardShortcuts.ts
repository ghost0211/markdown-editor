import { useEffect } from 'react';
import { ViewMode } from '@/types';

interface KeyboardShortcutsOptions {
  onNew: () => void;
  onOpen: () => void;
  onSave: () => void;
  onSaveAs: () => void;
  onCloseTab: () => void;
  onSetViewMode: (mode: ViewMode) => void;
  onToggleSidebar: () => void;
  onToggleShortcutsModal: () => void;
  onToggleSettingsModal?: () => void;
  /**
   * When false, document-level shortcuts (Ctrl+N / Ctrl+W / ...) are ignored.
   * Used while a modal dialog owns the keyboard, so typing inside a dialog can
   * never trigger "new document" or "close tab".
   */
  enabled?: boolean;
}

export function useKeyboardShortcuts({
  onNew,
  onOpen,
  onSave,
  onSaveAs,
  onCloseTab,
  onSetViewMode,
  onToggleSidebar,
  onToggleShortcutsModal,
  onToggleSettingsModal,
  enabled = true,
}: KeyboardShortcutsOptions) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // A handler closer to the focused element already consumed this key
      // (e.g. Escape/Tab handling inside a dialog).
      if (e.defaultPrevented) return;

      const isCtrlOrMeta = e.ctrlKey || e.metaKey;

      // Help / preferences shortcuts stay available in every state: Ctrl+, is
      // the only way to close the settings dialog with the keyboard.
      if (isCtrlOrMeta && e.key === ',') {
        e.preventDefault();
        onToggleSettingsModal?.();
        return;
      }

      if ((isCtrlOrMeta && e.key === '/') || e.key === 'F1') {
        e.preventDefault();
        onToggleShortcutsModal();
        return;
      }

      // Everything below acts on the document itself and must not fire while a
      // modal dialog owns the keyboard.
      if (!enabled) return;

      // Ctrl + Shift + S: Save As
      if (isCtrlOrMeta && e.shiftKey && (e.key === 's' || e.key === 'S')) {
        e.preventDefault();
        onSaveAs();
        return;
      }

      // Ctrl + Shift + O: Toggle Sidebar Outline
      if (isCtrlOrMeta && e.shiftKey && (e.key === 'o' || e.key === 'O')) {
        e.preventDefault();
        onToggleSidebar();
        return;
      }

      // Ctrl + S: Save
      if (isCtrlOrMeta && !e.shiftKey && (e.key === 's' || e.key === 'S')) {
        e.preventDefault();
        onSave();
        return;
      }

      // Ctrl + N: New Tab
      if (isCtrlOrMeta && !e.shiftKey && (e.key === 'n' || e.key === 'N')) {
        e.preventDefault();
        onNew();
        return;
      }

      // Ctrl + O: Open File
      if (isCtrlOrMeta && !e.shiftKey && (e.key === 'o' || e.key === 'O')) {
        e.preventDefault();
        onOpen();
        return;
      }

      // Ctrl + W: Close Active Tab
      if (isCtrlOrMeta && !e.shiftKey && (e.key === 'w' || e.key === 'W')) {
        e.preventDefault();
        onCloseTab();
        return;
      }

      // Ctrl + 1: Edit Mode
      if (isCtrlOrMeta && e.key === '1') {
        e.preventDefault();
        onSetViewMode('edit');
        return;
      }

      // Ctrl + 2: Split Mode
      if (isCtrlOrMeta && e.key === '2') {
        e.preventDefault();
        onSetViewMode('split');
        return;
      }

      // Ctrl + 3: Read Mode
      if (isCtrlOrMeta && e.key === '3') {
        e.preventDefault();
        onSetViewMode('read');
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    onNew,
    onOpen,
    onSave,
    onSaveAs,
    onCloseTab,
    onSetViewMode,
    onToggleSidebar,
    onToggleShortcutsModal,
    onToggleSettingsModal,
    enabled,
  ]);
}
