import React, {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import clsx from 'clsx';
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  FilePlus2,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  LoaderCircle,
  Pencil,
  RefreshCw,
  X,
} from 'lucide-react';
import {
  interpolate,
  t,
  useI18n,
  type Language,
  type TranslationKey,
  type TranslationParams,
} from '@/i18n';
import {
  buildWorkspaceTree,
  defaultExpandedWorkspacePaths,
  isWorkspaceEntryActive,
  normalizeWorkspaceDocumentName,
  normalizeWorkspaceRelativePath,
  summarizeWorkspaceEntries,
  validateWorkspaceEntryName,
  workspaceEntryAbsolutePath,
  workspaceTreeRowId,
  type WorkspaceEntry,
  type WorkspaceNameError,
  type WorkspaceTreeNode,
} from '@/lib/workspace';

type WorkspaceKey = `workspace.${string}`;

/**
 * Fallback copy for the `workspace.*` keys.
 *
 * The locale files are owned elsewhere in this change, so the panel renders
 * readable text until the matching keys land in `zh-CN.ts` / `en-US.ts`.
 * `t()` is still consulted first: as soon as a locale defines the key, the
 * locale value wins and this table becomes dead weight.
 */
const WORKSPACE_FALLBACK_TRANSLATIONS: Record<Language, Record<WorkspaceKey, string>> = {
  'zh-CN': {
    'workspace.panelTitle': '工作区',
    'workspace.chooseFolder': '选择文件夹',
    'workspace.changeFolder': '更换文件夹',
    'workspace.refresh': '刷新',
    'workspace.closePanel': '关闭工作区面板',
    'workspace.emptyRootTitle': '尚未选择工作区',
    'workspace.emptyRootHint': '选择一个本地文件夹，即可浏览并打开其中的 Markdown 文档。',
    'workspace.emptyFolder': '此文件夹中没有可显示的文档或子文件夹。',
    'workspace.entryCount': '{count} 项',
    'workspace.truncated': '文件过多，仅显示前 {count} 项。',
    'workspace.newDocument': '新建文档',
    'workspace.newFolder': '新建文件夹',
    'workspace.rename': '重命名',
    'workspace.newDocumentTitle': '新建文档',
    'workspace.newFolderTitle': '新建文件夹',
    'workspace.renameTitle': '重命名 {name}',
    'workspace.nameLabel': '名称',
    'workspace.namePlaceholderDocument': '例如：笔记.md',
    'workspace.namePlaceholderFolder': '例如：笔记',
    'workspace.nameRequired': '请输入名称。',
    'workspace.invalidName': '名称不能包含路径分隔符或“..”，也不能以点或空格结尾。',
    'workspace.unsupportedDocumentExtension': '仅支持 .md、.markdown、.txt 文档。',
    'workspace.create': '创建',
    'workspace.location': '位置：{path}',
    'workspace.rootLabel': '工作区根目录',
    'workspace.expandFolder': '展开 {name}',
    'workspace.collapseFolder': '收起 {name}',
    'workspace.openDocument': '打开 {name}',
    'workspace.busy': '正在处理…',
  },
  'en-US': {
    'workspace.panelTitle': 'Workspace',
    'workspace.chooseFolder': 'Choose Folder',
    'workspace.changeFolder': 'Change Folder',
    'workspace.refresh': 'Refresh',
    'workspace.closePanel': 'Close workspace panel',
    'workspace.emptyRootTitle': 'No workspace yet',
    'workspace.emptyRootHint': 'Choose a local folder to browse and open the Markdown documents inside it.',
    'workspace.emptyFolder': 'No documents or subfolders to show in this folder.',
    'workspace.entryCount': '{count} items',
    'workspace.truncated': 'Too many entries; showing the first {count}.',
    'workspace.newDocument': 'New Document',
    'workspace.newFolder': 'New Folder',
    'workspace.rename': 'Rename',
    'workspace.newDocumentTitle': 'New Document',
    'workspace.newFolderTitle': 'New Folder',
    'workspace.renameTitle': 'Rename {name}',
    'workspace.nameLabel': 'Name',
    'workspace.namePlaceholderDocument': 'e.g. notes.md',
    'workspace.namePlaceholderFolder': 'e.g. Notes',
    'workspace.nameRequired': 'Enter a name.',
    'workspace.invalidName': 'A name cannot contain path separators or "..", or end with a dot or space.',
    'workspace.unsupportedDocumentExtension': 'Only .md, .markdown and .txt documents are supported.',
    'workspace.create': 'Create',
    'workspace.location': 'Location: {path}',
    'workspace.rootLabel': 'Workspace root',
    'workspace.expandFolder': 'Expand {name}',
    'workspace.collapseFolder': 'Collapse {name}',
    'workspace.openDocument': 'Open {name}',
    'workspace.busy': 'Working…',
  },
};

/** Typed `workspace.*` translation helper with a fallback until locales land. */
function useWorkspaceT() {
  const { language } = useI18n();
  return useCallback(
    (key: WorkspaceKey, params?: TranslationParams): string => {
      const translated = t(language, key as TranslationKey, params);
      if (translated !== key) return translated;
      return interpolate(WORKSPACE_FALLBACK_TRANSLATIONS[language][key] ?? key, params);
    },
    [language]
  );
}

/** Escape closes the name form first, and only then the panel itself. */
export function resolveWorkspaceEscapeAction(
  isNameModalOpen: boolean
): 'close-name' | 'close-panel' {
  return isNameModalOpen ? 'close-name' : 'close-panel';
}

export type WorkspaceNameMode = 'create-document' | 'create-folder' | 'rename';

export interface WorkspacePanelProps {
  isOpen: boolean;
  onClose: () => void;
  /** Canonical folder chosen through the native picker, or `null` before choosing. */
  rootPath: string | null;
  /** Flat listing from the native `list_workspace` command. */
  entries: WorkspaceEntry[];
  /** Native walk hit its entry/depth cap. */
  truncated?: boolean;
  /** Absolute path of the document shown in the editor (relative also accepted). */
  activePath?: string | null;
  /** A native mutation is in flight; interactive controls are disabled. */
  busy?: boolean;
  onChoose: () => void;
  /**
   * Open a document. The panel passes an **absolute** path (root joined with
   * the relative entry) when `rootPath` is known. Errors are surfaced by the
   * caller through its toast layer.
   */
  onOpen: (path: string) => void | Promise<void>;
  onRefresh: () => void | Promise<void>;
  /** `parent` is a root-relative directory path (`''` means the workspace root). */
  onCreateDocument: (parent: string, name: string) => void | Promise<void>;
  /** `parent` is a root-relative directory path (`''` means the workspace root). */
  onCreateFolder: (parent: string, name: string) => void | Promise<void>;
  /** Rename in place (same parent); the native side still validates everything. */
  onRename: (entry: WorkspaceEntry, newName: string) => void | Promise<void>;
  /**
   * Lets the host gate global shortcuts (e.g. Ctrl+N / Ctrl+W) while the name
   * dialog owns the keyboard. Fires with `false` when the dialog closes and
   * when the panel unmounts.
   */
  onDialogOpenChange?: (open: boolean) => void;
}

interface NameModalState {
  mode: WorkspaceNameMode;
  parent: string;
  entry: WorkspaceEntry | null;
  initialName: string;
  nativeError: string | null;
}

export interface WorkspaceNameModalProps {
  open: boolean;
  mode: WorkspaceNameMode;
  initialName?: string;
  /** Human readable destination shown under the input. */
  locationLabel: string;
  title: string;
  busy?: boolean;
  /** Native error (e.g. "already exists"), shown below the input. */
  error?: string | null;
  onSubmit: (name: string) => void | Promise<void>;
  onClose: () => void;
  onClearError?: () => void;
}

function describeNameError(
  error: WorkspaceNameError | 'unsupportedExtension',
  tw: ReturnType<typeof useWorkspaceT>
): string {
  if (error === 'empty') return tw('workspace.nameRequired');
  if (error === 'unsupportedExtension') return tw('workspace.unsupportedDocumentExtension');
  return tw('workspace.invalidName');
}

/**
 * Accessible single-field dialog used for create/rename.
 *
 * Focus moves to the name input when opened, Tab is trapped inside the dialog
 * (the surrounding panel is intentionally *not* trapped), and focus returns to
 * the previously focused element on close.
 */
export const WorkspaceNameModal: React.FC<WorkspaceNameModalProps> = ({
  open,
  mode,
  initialName = '',
  locationLabel,
  title,
  busy = false,
  error = null,
  onSubmit,
  onClose,
  onClearError,
}) => {
  const tw = useWorkspaceT();
  const { language } = useI18n();
  const [value, setValue] = useState(initialName);
  const [localError, setLocalError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  const inputId = useId();
  const descriptionId = useId();

  useEffect(() => {
    if (!open) return;
    setValue(initialName);
    setLocalError(null);
  }, [open, initialName]);

  useEffect(() => {
    if (!open) return;
    if (typeof document !== 'undefined' && document.activeElement instanceof HTMLElement) {
      previouslyFocusedRef.current = document.activeElement;
    }
    const focusTimer = setTimeout(() => inputRef.current?.focus(), 0);

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      );
      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey) {
        if (document.activeElement === first || !dialogRef.current.contains(document.activeElement)) {
          event.preventDefault();
          last.focus();
        }
      } else if (
        document.activeElement === last ||
        !dialogRef.current.contains(document.activeElement)
      ) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      clearTimeout(focusTimer);
      window.removeEventListener('keydown', handleKeyDown);
      previouslyFocusedRef.current?.focus?.();
    };
  }, [open]);

  if (!open) return null;

  const isCreatingDocument = mode === 'create-document';
  const submitLabel =
    mode === 'rename' ? tw('workspace.rename') : tw('workspace.create');
  const isBusy = busy || submitting;

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (isBusy) return;

    const raw = value.trim();
    const nameError = validateWorkspaceEntryName(raw);
    if (nameError) {
      setLocalError(describeNameError(nameError, tw));
      return;
    }
    const finalName = isCreatingDocument ? normalizeWorkspaceDocumentName(raw) : raw;
    if (!finalName) {
      setLocalError(describeNameError('unsupportedExtension', tw));
      return;
    }

    setLocalError(null);
    setSubmitting(true);
    try {
      await onSubmit(finalName);
    } catch (submitError) {
      // The panel shows native failures (already exists, permissions, ...)
      // inline so the user can correct the name without losing the dialog.
      setLocalError(
        submitError instanceof Error ? submitError.message : String(submitError)
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${inputId}-title`}
        aria-describedby={descriptionId}
        className="w-full max-w-xs bg-elevated rounded-lg border border-slate-200 dark:border-slate-700 shadow-xl text-slate-800 dark:text-slate-100"
      >
        <form onSubmit={handleSubmit} className="p-4 space-y-3">
          <div className="flex items-start justify-between space-x-2">
            <h2 id={`${inputId}-title`} className="text-sm font-semibold">
              {title}
            </h2>
            <button
              type="button"
              onClick={onClose}
              aria-label={tw('workspace.closePanel')}
              className="p-1 -mr-1 -mt-1 rounded text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="space-y-1.5">
            <label htmlFor={inputId} className="block text-xs font-medium text-slate-600 dark:text-slate-300">
              {tw('workspace.nameLabel')}
            </label>
            <input
              id={inputId}
              ref={inputRef}
              type="text"
              value={value}
              disabled={isBusy}
              autoFocus
              spellCheck={false}
              autoComplete="off"
              placeholder={
                isCreatingDocument
                  ? tw('workspace.namePlaceholderDocument')
                  : tw('workspace.namePlaceholderFolder')
              }
              aria-invalid={Boolean(localError || error)}
              aria-describedby={descriptionId}
              onChange={(event) => {
                setValue(event.target.value);
                setLocalError(null);
                onClearError?.();
              }}
              className="w-full rounded-md border border-slate-300 dark:border-slate-600 bg-app px-2.5 py-1.5 text-xs text-slate-800 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-60"
            />
          </div>

          <p id={descriptionId} className="text-[11px] text-slate-500 dark:text-slate-400 break-all">
            {locationLabel}
          </p>

          {(localError || error) && (
            <p role="alert" className="text-[11px] text-red-600 dark:text-red-400 break-words">
              {localError || error}
            </p>
          )}

          <div className="flex items-center justify-end space-x-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 rounded text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700"
            >
              {t(language, 'common.cancel')}
            </button>
            <button
              type="submit"
              disabled={isBusy}
              className="px-3 py-1.5 rounded text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed inline-flex items-center space-x-1"
            >
              {isBusy && <LoaderCircle className="w-3.5 h-3.5 animate-spin" />}
              <span>{submitLabel}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Folder workspace sidebar: a bounded native tree plus create/rename actions.
 *
 * Path handling is delegated to `@/lib/workspace`; the panel never builds a
 * path by hand except through those helpers, so unsafe names (`..`, separators,
 * absolute paths) cannot reach the native commands from this component.
 */
export const WorkspacePanel: React.FC<WorkspacePanelProps> = ({
  isOpen,
  onClose,
  rootPath,
  entries,
  truncated = false,
  activePath = null,
  busy = false,
  onChoose,
  onOpen,
  onRefresh,
  onCreateDocument,
  onCreateFolder,
  onRename,
  onDialogOpenChange,
}) => {
  const tw = useWorkspaceT();
  const panelRef = useRef<HTMLElement>(null);
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(defaultExpandedWorkspacePaths(activePath, rootPath))
  );
  const [selectedDir, setSelectedDir] = useState('');
  const [modal, setModal] = useState<NameModalState | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const tree = useMemo(() => buildWorkspaceTree(entries), [entries]);
  const summary = useMemo(() => summarizeWorkspaceEntries(entries), [entries]);
  const isBusy = busy || submitting;

  // A newly opened document reveals its ancestor folders.
  useEffect(() => {
    const ancestors = defaultExpandedWorkspacePaths(activePath, rootPath);
    if (ancestors.length === 0) return;
    setExpanded((previous) => {
      if (ancestors.every((path) => previous.has(path))) return previous;
      const next = new Set(previous);
      for (const path of ancestors) next.add(path);
      return next;
    });
  }, [activePath, rootPath]);

  // Switching the workspace root drops a stale folder selection.
  useEffect(() => {
    setSelectedDir('');
  }, [rootPath]);

  useEffect(() => {
    if (!isOpen) {
      setModal(null);
      setSubmitting(false);
    }
  }, [isOpen]);

  // Host shortcut gating: keep the latest callback in a ref so an inline
  // `onDialogOpenChange` from the root does not re-run this effect on every
  // render, and report `false` when the panel goes away.
  const onDialogOpenChangeRef = useRef(onDialogOpenChange);
  useEffect(() => {
    onDialogOpenChangeRef.current = onDialogOpenChange;
  }, [onDialogOpenChange]);
  useEffect(() => {
    onDialogOpenChangeRef.current?.(Boolean(modal));
  }, [modal]);
  useEffect(
    () => () => {
      onDialogOpenChangeRef.current?.(false);
    },
    []
  );

  // Escape closes the name form first; otherwise it closes the panel. Events
  // are only handled while focus is inside the panel (or its dialog), so an
  // unrelated modal keeps ownership of Escape.
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      const activeElement = typeof document !== 'undefined' ? document.activeElement : null;
      const panelFocused =
        !activeElement ||
        activeElement === document.body ||
        panelRef.current?.contains(activeElement) === true;
      if (!panelFocused) return;

      event.preventDefault();
      event.stopPropagation();
      if (resolveWorkspaceEscapeAction(Boolean(modal)) === 'close-name') {
        setModal(null);
      } else {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [isOpen, modal, onClose]);

  const toggleDirectory = useCallback((path: string) => {
    setSelectedDir(path);
    setExpanded((previous) => {
      const next = new Set(previous);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const openNameModal = useCallback(
    (mode: WorkspaceNameMode, entry: WorkspaceEntry | null = null, parentOverride?: string) => {
      const parent =
        mode === 'rename'
          ? entry
            ? normalizeWorkspaceRelativePath(entry.path)?.split('/').slice(0, -1).join('/') ?? ''
            : ''
          : parentOverride ?? selectedDir;
      setModal({
        mode,
        parent,
        entry,
        initialName: mode === 'rename' ? entry?.name ?? '' : '',
        nativeError: null,
      });
    },
    [selectedDir]
  );

  const handleOpenDocument = useCallback(
    (entry: WorkspaceEntry) => {
      const absolute =
        (rootPath && workspaceEntryAbsolutePath(rootPath, entry.path)) || entry.path;
      // The caller owns error reporting (toast); swallow the rejection here so
      // an async handler does not produce an unhandled promise rejection.
      void Promise.resolve(onOpen(absolute)).catch(() => {});
    },
    [onOpen, rootPath]
  );

  const handleRefresh = useCallback(() => {
    void Promise.resolve(onRefresh()).catch(() => {});
  }, [onRefresh]);

  const handleSubmitName = useCallback(
    async (name: string) => {
      if (!modal) return;
      setSubmitting(true);
      try {
        if (modal.mode === 'create-document') {
          await onCreateDocument(modal.parent, name);
        } else if (modal.mode === 'create-folder') {
          await onCreateFolder(modal.parent, name);
        } else if (modal.entry) {
          await onRename(modal.entry, name);
        }
        setModal(null);
      } catch (error) {
        setModal((previous) =>
          previous ? { ...previous, nativeError: errorMessage(error) } : previous
        );
      } finally {
        setSubmitting(false);
      }
    },
    [modal, onCreateDocument, onCreateFolder, onRename]
  );

  if (!isOpen) return null;

  const renderNode = (node: WorkspaceTreeNode, level: number): React.ReactNode => {
    const { entry } = node;
    const isDirectory = entry.kind === 'directory';
    const isExpanded = expanded.has(entry.path);
    const isActive = !isDirectory && isWorkspaceEntryActive(entry.path, activePath, rootPath);
    const isSelected = isDirectory && selectedDir === entry.path;
    const depthPadding = 6 + level * 12;
    const rowId = workspaceTreeRowId(entry.path);

    return (
      <li key={entry.path} role="treeitem" aria-expanded={isDirectory ? isExpanded : undefined}>
        <div
          id={rowId}
          className={clsx(
            'group flex items-center rounded text-xs',
            isActive
              ? 'bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 font-medium'
              : isSelected
              ? 'bg-slate-200/70 dark:bg-slate-800/70 text-slate-900 dark:text-slate-100'
              : 'text-slate-600 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-slate-800/60'
          )}
        >
          <button
            type="button"
            onClick={() =>
              isDirectory ? toggleDirectory(entry.path) : handleOpenDocument(entry)
            }
            aria-label={
              isDirectory
                ? tw(isExpanded ? 'workspace.collapseFolder' : 'workspace.expandFolder', {
                    name: entry.name,
                  })
                : tw('workspace.openDocument', { name: entry.name })
            }
            aria-current={isActive ? 'page' : undefined}
            title={entry.path}
            style={{ paddingLeft: depthPadding }}
            className="flex min-w-0 flex-1 items-center space-x-1.5 py-1 pr-1 text-left focus:outline-none focus-visible:ring-1 focus-visible:ring-blue-500 rounded"
          >
            {isDirectory ? (
              isExpanded ? (
                <ChevronDown className="w-3 h-3 shrink-0 text-slate-400" />
              ) : (
                <ChevronRight className="w-3 h-3 shrink-0 text-slate-400" />
              )
            ) : (
              <span className="w-3 shrink-0" aria-hidden="true" />
            )}
            {isDirectory ? (
              <Folder className="w-3.5 h-3.5 shrink-0 text-amber-500" />
            ) : (
              <FileText className="w-3.5 h-3.5 shrink-0 text-blue-500" />
            )}
            <span className="truncate">{entry.name}</span>
          </button>

          <div className="flex shrink-0 items-center space-x-0.5 pr-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
            {isDirectory && (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedDir(entry.path);
                    openNameModal('create-document', null, entry.path);
                  }}
                  disabled={isBusy}
                  title={`${tw('workspace.newDocument')}: ${entry.name}`}
                  aria-label={`${tw('workspace.newDocument')}: ${entry.name}`}
                  className="p-1 rounded text-slate-400 hover:text-blue-600 hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-40"
                >
                  <FilePlus2 className="w-3 h-3" />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedDir(entry.path);
                    openNameModal('create-folder', null, entry.path);
                  }}
                  disabled={isBusy}
                  title={`${tw('workspace.newFolder')}: ${entry.name}`}
                  aria-label={`${tw('workspace.newFolder')}: ${entry.name}`}
                  className="p-1 rounded text-slate-400 hover:text-amber-600 hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-40"
                >
                  <FolderPlus className="w-3 h-3" />
                </button>
              </>
            )}
            <button
              type="button"
              onClick={() => openNameModal('rename', entry)}
              disabled={isBusy}
              title={`${tw('workspace.rename')}: ${entry.name}`}
              aria-label={`${tw('workspace.rename')}: ${entry.name}`}
              className="p-1 rounded text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-40"
            >
              <Pencil className="w-3 h-3" />
            </button>
          </div>
        </div>

        {isDirectory && isExpanded && node.children.length > 0 && (
          <ul role="group" className="space-y-0.5">
            {node.children.map((child) => renderNode(child, level + 1))}
          </ul>
        )}
      </li>
    );
  };

  const headerButtonClass =
    'p-1.5 rounded text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-100 hover:bg-slate-200 dark:hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed';

  return (
    <aside
      ref={panelRef}
      role="complementary"
      aria-label={tw('workspace.panelTitle')}
      aria-busy={isBusy}
      className="w-80 shrink-0 h-full flex flex-col border-r border-slate-200 dark:border-slate-800 bg-panel text-xs select-none"
    >
      <div className="h-9 px-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between shrink-0">
        <div className="flex items-center space-x-1.5 font-medium text-slate-700 dark:text-slate-200 min-w-0">
          <FolderOpen className="w-4 h-4 text-blue-500 shrink-0" />
          <span className="truncate">{tw('workspace.panelTitle')}</span>
          {isBusy && (
            <LoaderCircle
              className="w-3.5 h-3.5 animate-spin text-blue-500 shrink-0"
              aria-label={tw('workspace.busy')}
            />
          )}
        </div>
        <div className="flex items-center space-x-0.5 shrink-0">
          <button
            type="button"
            onClick={() => void onChoose()}
            disabled={isBusy}
            title={tw(rootPath ? 'workspace.changeFolder' : 'workspace.chooseFolder')}
            aria-label={tw(rootPath ? 'workspace.changeFolder' : 'workspace.chooseFolder')}
            className={headerButtonClass}
          >
            <FolderPlus className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={handleRefresh}
            disabled={!rootPath || isBusy}
            title={tw('workspace.refresh')}
            aria-label={tw('workspace.refresh')}
            className={headerButtonClass}
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => openNameModal('create-document')}
            disabled={!rootPath || isBusy}
            title={tw('workspace.newDocument')}
            aria-label={tw('workspace.newDocument')}
            className={headerButtonClass}
          >
            <FilePlus2 className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => openNameModal('create-folder')}
            disabled={!rootPath || isBusy}
            title={tw('workspace.newFolder')}
            aria-label={tw('workspace.newFolder')}
            className={headerButtonClass}
          >
            <FolderPlus className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={onClose}
            title={tw('workspace.closePanel')}
            aria-label={tw('workspace.closePanel')}
            className={headerButtonClass}
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {rootPath ? (
        <div className="px-3 py-1.5 border-b border-slate-200 dark:border-slate-800 shrink-0">
          <p
            className="truncate text-[11px] text-slate-500 dark:text-slate-400"
            title={rootPath}
          >
            <span className="sr-only">{tw('workspace.rootLabel')}: </span>
            {rootPath}
          </p>
        </div>
      ) : null}

      <div className="flex-1 overflow-y-auto p-1.5">
        {!rootPath ? (
          <div className="flex h-full flex-col items-center justify-center px-4 text-center text-slate-400 dark:text-slate-500">
            <FolderOpen className="w-8 h-8 mb-2 opacity-50 stroke-[1.5]" />
            <p className="font-medium text-xs text-slate-600 dark:text-slate-300">
              {tw('workspace.emptyRootTitle')}
            </p>
            <p className="text-[11px] mt-1 leading-relaxed">{tw('workspace.emptyRootHint')}</p>
            <button
              type="button"
              onClick={() => void onChoose()}
              disabled={isBusy}
              className="mt-3 inline-flex items-center space-x-1.5 px-3 py-1.5 rounded text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-60"
            >
              <FolderPlus className="w-3.5 h-3.5" />
              <span>{tw('workspace.chooseFolder')}</span>
            </button>
          </div>
        ) : entries.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center px-4 text-center text-slate-400 dark:text-slate-500">
            <FileText className="w-8 h-8 mb-2 opacity-50 stroke-[1.5]" />
            <p className="text-[11px] leading-relaxed">{tw('workspace.emptyFolder')}</p>
            <button
              type="button"
              onClick={handleRefresh}
              disabled={isBusy}
              className="mt-3 inline-flex items-center space-x-1.5 px-3 py-1.5 rounded text-xs font-medium text-slate-700 dark:text-slate-200 border border-slate-300 dark:border-slate-600 hover:bg-slate-200 dark:hover:bg-slate-800 disabled:opacity-60"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>{tw('workspace.refresh')}</span>
            </button>
          </div>
        ) : (
          <ul role="tree" aria-label={tw('workspace.panelTitle')} className="space-y-0.5">
            {tree.map((node) => renderNode(node, 0))}
          </ul>
        )}
      </div>

      {rootPath ? (
        <div className="border-t border-slate-200 dark:border-slate-800 px-3 py-1.5 shrink-0 space-y-1">
          <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
            <span>{tw('workspace.entryCount', { count: summary.total })}</span>
            <span aria-hidden="true">
              {summary.directories} / {summary.documents}
            </span>
          </div>
          {truncated && (
            <p
              role="status"
              className="flex items-start space-x-1 text-[11px] text-amber-600 dark:text-amber-400"
            >
              <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
              <span>{tw('workspace.truncated', { count: entries.length })}</span>
            </p>
          )}
        </div>
      ) : null}

      <WorkspaceNameModal
        open={Boolean(modal)}
        mode={modal?.mode ?? 'create-document'}
        initialName={modal?.initialName ?? ''}
        title={
          modal?.mode === 'rename'
            ? tw('workspace.renameTitle', { name: modal?.entry?.name ?? '' })
            : modal?.mode === 'create-folder'
            ? tw('workspace.newFolderTitle')
            : tw('workspace.newDocumentTitle')
        }
        locationLabel={tw('workspace.location', {
          path: modal?.parent
            ? modal.parent
            : modal?.mode === 'rename'
            ? modal?.entry?.path ?? ''
            : tw('workspace.rootLabel'),
        })}
        busy={isBusy}
        error={modal?.nativeError ?? null}
        onClearError={() =>
          setModal((previous) =>
            previous && previous.nativeError
              ? { ...previous, nativeError: null }
              : previous
          )
        }
        onSubmit={handleSubmitName}
        onClose={() => setModal(null)}
      />
    </aside>
  );
};

export default WorkspacePanel;
