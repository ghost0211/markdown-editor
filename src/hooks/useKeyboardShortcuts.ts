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
}: KeyboardShortcutsOptions) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isCtrlOrMeta = e.ctrlKey || e.metaKey;

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

      // Ctrl + / or F1: Shortcuts Modal
      if ((isCtrlOrMeta && e.key === '/') || e.key === 'F1') {
        e.preventDefault();
        onToggleShortcutsModal();
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
  ]);
}
