export type ViewMode = 'edit' | 'split' | 'read';
export type ThemeMode = 'light' | 'dark' | 'system';

export interface DocumentTab {
  id: string;
  title: string;
  filePath: string | null;
  content: string;
  savedContent: string;
  isDirty: boolean;
  cursorLine: number;
  cursorCol: number;
  scrollPosition?: number;
}

export interface HeadingItem {
  id: string;
  level: number;
  text: string;
  line: number;
  slug: string;
}

export interface TextStats {
  words: number;
  chars: number;
  charsNoSpaces: number;
  lines: number;
  readingTimeMinutes: number;
}

export type ToastType = 'info' | 'success' | 'warning' | 'error';

export interface ToastMessage {
  id: string;
  type: ToastType;
  message: string;
  duration?: number;
}

export interface ConfirmDialogState {
  isOpen: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'danger' | 'warning' | 'primary';
  onConfirm: () => void;
  onCancel?: () => void;
}

export interface OpenFileResult {
  path: string;
  name: string;
  content: string;
}
