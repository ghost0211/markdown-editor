import React, {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  AlertTriangle,
  Archive,
  Check,
  Copy,
  Download,
  FileText,
  FolderOpen,
  Image as ImageIcon,
  Images,
  LoaderCircle,
  MapPin,
  Paperclip,
  RefreshCw,
  Search,
  X,
} from 'lucide-react';
import clsx from 'clsx';
import { useI18n } from '@/i18n';
import {
  formatResourceSize,
  type DocumentResource,
} from '@/lib/documentResources';
import { MAX_XMD_RESOURCE_BYTES } from '@/lib/export/xmdExporter';
import { LocalImage } from './LocalImage';

export type ResourceFilter = 'all' | 'image' | 'attachment' | 'missing';

export interface ResourceManagerProps {
  isOpen: boolean;
  onClose: () => void;
  documentTitle: string;
  resources: DocumentResource[];
  error?: string | null;
  isRefreshing?: boolean;
  onRefresh: () => void;
  onLocate: (resource: DocumentResource, line?: number) => void;
  onExport: (resource: DocumentResource) => Promise<void>;
  onReveal: (resource: DocumentResource) => Promise<void>;
  onConvert: (resource: DocumentResource) => Promise<void>;
  onConvertAll: () => Promise<void>;
  canConvert: boolean;
  convertReason: string;
  busyId?: string | null;
  /** Path of the Markdown document, used to resolve document-relative images. */
  sourceFilePath?: string | null;
}

export interface ResourceSummary {
  total: number;
  images: number;
  attachments: number;
  missing: number;
}

/** Counts used by the modal summary and exposed for focused unit tests. */
export function summarizeResources(
  resources: readonly DocumentResource[]
): ResourceSummary {
  let images = 0;
  let attachments = 0;
  let missing = 0;

  for (const resource of resources) {
    if (resource.kind === 'image') images += 1;
    else attachments += 1;
    if (resource.status === 'missing') missing += 1;
  }

  return { total: resources.length, images, attachments, missing };
}

function matchesFilter(
  resource: DocumentResource,
  filter: ResourceFilter
): boolean {
  if (filter === 'all') return true;
  if (filter === 'missing') return resource.status === 'missing';
  return resource.kind === filter;
}

// Embedded Base64 addresses can be megabytes long. Searching the first few KB
// keeps filtering responsive while still matching meaningful address prefixes.
const MAX_SEARCHABLE_ADDRESS_LENGTH = 4096;

/** Pure list filtering used by the component and by SSR tests. */
export function filterResources(
  resources: readonly DocumentResource[],
  query: string,
  filter: ResourceFilter
): DocumentResource[] {
  const needle = query.trim().toLowerCase();
  return resources.filter((resource) => {
    if (!matchesFilter(resource, filter)) return false;
    if (!needle) return true;

    const haystack = [
      resource.name,
      resource.displayAddress.slice(0, MAX_SEARCHABLE_ADDRESS_LENGTH),
      resource.localPath ?? '',
    ]
      .join('\n')
      .toLowerCase();
    return haystack.includes(needle);
  });
}

/** Human-readable byte size for the list/preview metadata. */
export function formatResourceByteLength(byteLength?: number): string | null {
  if (byteLength === undefined || !Number.isFinite(byteLength) || byteLength < 0) {
    return null;
  }
  return formatResourceSize(byteLength);
}

function formatShortAddress(address: string): string {
  if (/^data:/i.test(address)) {
    const comma = address.indexOf(',');
    const header = comma === -1 ? address.slice(0, 40) : address.slice(0, comma + 1);
    return `${header.length > 48 ? `${header.slice(0, 48)}…` : header} (Base64)`;
  }
  return address.length > 76 ? `${address.slice(0, 76)}…` : address;
}

/** Only explicit HTTP(S) URLs may be used as remote preview/export sources. */
export function isSafeHttpUrl(url: string): boolean {
  return /^https?:\/\/[^\s]+$/i.test(url);
}

/** Only raster/vector image data URLs may be rendered as embedded previews. */
export function isSafeDataImageUrl(url: string): boolean {
  return /^data:image\/[a-z0-9.+-]+(?:;[^,]*)?,/i.test(url);
}

/**
 * Full, copyable address for the selected resource. The scanner's
 * `displayAddress` is intentionally compact (Base64 payloads are elided), so
 * never copy or show that; use the original source or resolved local path.
 */
export function getResourceFullAddress(resource: DocumentResource): string {
  if (resource.location === 'local' && resource.localPath) {
    return resource.localPath;
  }
  return resource.source || resource.displayAddress;
}

export type ResourceExportBlockReason =
  | 'missing'
  | 'loading'
  | 'transient'
  | 'unsafe-remote'
  | 'unsafe-source'
  | 'too-large'
  | null;

/**
 * Whether the resource can be exported by the native hook. Missing/loading or
 * expired transient sources, non-HTTP remote URLs, unsafe embedded image data
 * and files above the 32 MiB native read limit are not exportable.
 */
export function getResourceExportBlockReason(
  resource: DocumentResource
): ResourceExportBlockReason {
  if (resource.status === 'missing') return 'missing';
  if (resource.status === 'loading') return 'loading';
  if (resource.location === 'transient') return 'transient';
  if (resource.location === 'remote' && !isSafeHttpUrl(resource.source)) {
    return 'unsafe-remote';
  }
  if (
    resource.kind === 'image' &&
    resource.location === 'embedded' &&
    !isSafeDataImageUrl(resource.source)
  ) {
    return 'unsafe-source';
  }
  if (
    resource.location === 'local' &&
    !isSafeLocalPreviewSource(resource)
  ) {
    return 'unsafe-source';
  }
  if (
    resource.byteLength !== undefined &&
    resource.byteLength > MAX_XMD_RESOURCE_BYTES
  ) {
    return 'too-large';
  }
  return null;
}

/**
 * Local previews may use a resolved local path or a scheme-less relative path.
 * Scheme URLs and protocol-relative values must never reach an <img src>.
 */
export function isSafeLocalPreviewSource(
  resource: DocumentResource
): boolean {
  if (resource.localPath) return true;
  const source = resource.source.trim();
  if (!source || source.startsWith('#') || source.startsWith('//')) {
    return false;
  }
  return !/^[a-z][a-z0-9+.-]*:/i.test(source);
}

/** Image preview policy: embedded `data:image`, HTTP(S) remote, or local file. */
export function canPreviewResourceImage(resource: DocumentResource): boolean {
  if (resource.kind !== 'image') return false;
  if (resource.location === 'embedded') {
    return isSafeDataImageUrl(resource.source);
  }
  if (resource.location === 'remote') {
    return isSafeHttpUrl(resource.source);
  }
  if (resource.location === 'local') {
    return isSafeLocalPreviewSource(resource);
  }
  return false;
}

export const ResourceManager: React.FC<ResourceManagerProps> = ({
  isOpen,
  onClose,
  documentTitle,
  resources,
  error,
  isRefreshing = false,
  onRefresh,
  onLocate,
  onExport,
  onReveal,
  onConvert,
  onConvertAll,
  canConvert,
  convertReason,
  busyId,
  sourceFilePath,
}) => {
  const { t } = useI18n();
  const titleId = useId();
  const descriptionId = useId();
  const listId = useId();
  const addressId = useId();
  const convertHintId = useId();
  const convertAllHintId = useId();
  const exportHintId = useId();

  const modalRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const previouslyFocusedElementRef = useRef<HTMLElement | null>(null);

  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<ResourceFilter>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [isConvertingAll, setIsConvertingAll] = useState(false);

  // Focus management, focus trap, and Escape handling mirror ConfirmModal.
  useEffect(() => {
    if (!isOpen) return;

    if (
      typeof document !== 'undefined' &&
      document.activeElement instanceof HTMLElement
    ) {
      previouslyFocusedElementRef.current = document.activeElement;
    }

    const focusTimer = setTimeout(() => {
      closeButtonRef.current?.focus();
    }, 0);

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }

      if (event.key !== 'Tab' || !modalRef.current) return;

      const focusable = Array.from(
        modalRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      );

      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }

      const firstElement = focusable[0];
      const lastElement = focusable[focusable.length - 1];

      if (event.shiftKey) {
        if (
          document.activeElement === firstElement ||
          !modalRef.current.contains(document.activeElement)
        ) {
          event.preventDefault();
          lastElement.focus();
        }
      } else if (
        document.activeElement === lastElement ||
        !modalRef.current.contains(document.activeElement)
      ) {
        event.preventDefault();
        firstElement.focus();
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      clearTimeout(focusTimer);
      window.removeEventListener('keydown', handleKeyDown);
      if (
        previouslyFocusedElementRef.current &&
        typeof previouslyFocusedElementRef.current.focus === 'function'
      ) {
        previouslyFocusedElementRef.current.focus();
      }
    };
  }, [isOpen, onClose]);

  const summary = useMemo(() => summarizeResources(resources), [resources]);
  const visibleResources = useMemo(
    () => filterResources(resources, query, filter),
    [resources, query, filter]
  );
  const activeResource = useMemo(
    () =>
      visibleResources.find((resource) => resource.id === selectedId) ??
      visibleResources[0] ??
      null,
    [visibleResources, selectedId]
  );
  const activeId = activeResource?.id ?? null;
  const activeAddress = activeResource
    ? getResourceFullAddress(activeResource)
    : '';

  useEffect(() => {
    setCopied(false);
    setCopyFailed(false);
  }, [activeId]);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const kindLabels: Record<DocumentResource['kind'], string> = {
    image: t('resources.kindImage'),
    attachment: t('resources.kindAttachment'),
  };
  const locationLabels: Record<DocumentResource['location'], string> = {
    embedded: t('resources.locationEmbedded'),
    local: t('resources.locationLocal'),
    remote: t('resources.locationRemote'),
    transient: t('resources.locationTransient'),
  };
  const statusLabels: Record<DocumentResource['status'], string> = {
    loading: t('resources.statusLoading'),
    ready: t('resources.statusReady'),
    missing: t('resources.statusMissing'),
    unknown: t('resources.statusUnknown'),
  };

  const isBusy = pendingId !== null || isConvertingAll || busyId != null;
  const isActiveBusy =
    (activeResource !== null && busyId === activeResource.id) ||
    (activeResource !== null && pendingId === activeResource.id);

  const runResourceAction = useCallback(
    async (
      resource: DocumentResource,
      action: (resource: DocumentResource) => Promise<void>
    ) => {
      if (pendingId !== null || isConvertingAll || busyId != null) return;
      setPendingId(resource.id);
      try {
        await action(resource);
      } finally {
        setPendingId(null);
      }
    },
    [busyId, isConvertingAll, pendingId]
  );

  const handleConvertAll = useCallback(async () => {
    if (!canConvert || pendingId !== null || isConvertingAll || busyId != null) {
      return;
    }
    setIsConvertingAll(true);
    try {
      await onConvertAll();
    } finally {
      setIsConvertingAll(false);
    }
  }, [busyId, canConvert, isConvertingAll, onConvertAll, pendingId]);

  const handleLocate = useCallback(
    (resource: DocumentResource, line?: number) => {
      if (isBusy) return;
      onLocate(resource, line);
    },
    [isBusy, onLocate]
  );

  const handleCopyAddress = useCallback(async () => {
    if (!activeAddress) return;
    try {
      if (
        typeof navigator !== 'undefined' &&
        navigator.clipboard &&
        typeof navigator.clipboard.writeText === 'function'
      ) {
        await navigator.clipboard.writeText(activeAddress);
      } else {
        throw new Error('clipboard-unavailable');
      }
      setCopyFailed(false);
      setCopied(true);
    } catch {
      setCopied(false);
      setCopyFailed(true);
    }
  }, [activeAddress]);

  if (!isOpen) return null;

  const filters: { id: ResourceFilter; label: string }[] = [
    { id: 'all', label: t('resources.filterAll') },
    { id: 'image', label: t('resources.filterImages') },
    { id: 'attachment', label: t('resources.filterAttachments') },
    { id: 'missing', label: t('resources.filterMissing') },
  ];

  const activeSize = activeResource
    ? formatResourceByteLength(activeResource.byteLength)
    : null;

  const canConvertActive =
    activeResource?.kind === 'image' &&
    activeResource.location === 'embedded';

  const exportBlockReason = activeResource
    ? getResourceExportBlockReason(activeResource)
    : null;
  const exportBlockedLabel = (() => {
    if (!activeResource || !exportBlockReason) return null;
    switch (exportBlockReason) {
      case 'missing':
        return t('resources.exportDisabledMissing');
      case 'loading':
        return t('resources.exportDisabledLoading');
      case 'transient':
        return t('resources.exportDisabledTransient');
      case 'unsafe-remote':
        return t('resources.exportDisabledUnsafeRemote');
      case 'unsafe-source':
        return t('resources.exportDisabledUnsafeSource');
      case 'too-large':
        return t('resources.exportDisabledTooLarge', {
          size: activeSize ?? '',
        });
    }
  })();

  const renderPreview = () => {
    if (!activeResource) {
      return (
        <div className="h-full flex flex-col items-center justify-center text-center px-6 py-10 text-slate-400 dark:text-slate-500">
          {resources.length === 0 ? (
            <>
              <Images className="w-10 h-10 mb-3 opacity-50" />
              <p className="text-sm font-medium text-slate-500 dark:text-slate-400">
                {t('resources.emptyTitle')}
              </p>
              <p className="text-xs mt-1 max-w-[280px]">{t('resources.emptyHelp')}</p>
            </>
          ) : (
            <>
              <Search className="w-10 h-10 mb-3 opacity-50" />
              <p className="text-sm font-medium text-slate-500 dark:text-slate-400">
                {t('resources.noMatches')}
              </p>
              <p className="text-xs mt-1 max-w-[280px]">{t('resources.noMatchesHelp')}</p>
            </>
          )}
        </div>
      );
    }

    const isMissing = activeResource.status === 'missing';
    const isImage = activeResource.kind === 'image';
    const isSafeImagePreview =
      isImage && canPreviewResourceImage(activeResource);

    let previewBody: React.ReactNode;
    if (isMissing) {
      previewBody = (
        <div className="flex flex-col items-center justify-center text-center px-4 py-8 text-red-500 dark:text-red-400">
          <AlertTriangle className="w-10 h-10 mb-3" />
          <p className="text-xs font-medium">{t('resources.previewMissing')}</p>
        </div>
      );
    } else if (isImage && !isSafeImagePreview) {
      previewBody = (
        <div
          data-resource-preview="unavailable"
          className="flex flex-col items-center justify-center text-center px-4 py-8 text-amber-600 dark:text-amber-400"
        >
          <AlertTriangle className="w-10 h-10 mb-3" />
          <p className="text-xs font-medium">
            {activeResource.location === 'transient'
              ? t('resources.transientUnavailable')
              : t('resources.previewUnavailable')}
          </p>
        </div>
      );
    } else if (isImage && activeResource.location === 'embedded') {
      previewBody = (
        <img
          src={activeResource.source}
          alt={activeResource.name}
          data-resource-preview="embedded"
          className="max-w-full max-h-[260px] object-contain rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
        />
      );
    } else if (isImage && activeResource.location === 'local') {
      previewBody = (
        <LocalImage
          src={activeResource.source}
          sourcePath={sourceFilePath}
          resolvedPath={activeResource.localPath}
          alt={activeResource.name}
          data-resource-preview="local"
          className="max-w-full max-h-[260px] object-contain rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
        />
      );
    } else if (isImage && activeResource.location === 'remote') {
      previewBody = (
        <img
          src={activeResource.source}
          alt={activeResource.name}
          referrerPolicy="no-referrer"
          data-resource-preview="remote"
          className="max-w-full max-h-[260px] object-contain rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
        />
      );
    } else if (isImage) {
      previewBody = <ImageIcon className="w-12 h-12 text-slate-300 dark:text-slate-600" />;
    } else {
      previewBody = (
        <div className="flex flex-col items-center text-center px-4">
          <div className="w-16 h-16 rounded-lg bg-slate-100 dark:bg-slate-800 flex items-center justify-center mb-3">
            <FileText className="w-8 h-8 text-slate-400 dark:text-slate-500" />
          </div>
          <p className="text-xs font-medium text-slate-600 dark:text-slate-300 break-all">
            {activeResource.name}
          </p>
          <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-1">
            {activeResource.mimeType || t('resources.unknownMimeType')}
            {activeSize ? ` · ${activeSize}` : ''}
          </p>
        </div>
      );
    }

    return (
      <div className="flex flex-col gap-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100 break-all">
              {activeResource.name}
            </h3>
            <div className="flex flex-wrap items-center gap-1.5 mt-1.5 text-[10px]">
              <span className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400">
                {kindLabels[activeResource.kind]}
              </span>
              <span className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400">
                {locationLabels[activeResource.location]}
              </span>
              <span className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400">
                {statusLabels[activeResource.status]}
              </span>
              {activeSize && (
                <span className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400">
                  {t('resources.sizeLabel', { size: activeSize })}
                </span>
              )}
              <span className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400">
                {t('resources.referenceCount', {
                  count: activeResource.referenceCount,
                })}
              </span>
            </div>
          </div>
        </div>

        <div
          className="h-[160px] sm:h-[220px] overflow-y-auto flex items-center justify-center rounded-md bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-700/80 p-3"
          aria-label={t('resources.previewAriaLabel')}
        >
          {previewBody}
        </div>

        <div>
          <div className="flex items-center justify-between gap-2 mb-1">
            <label
              htmlFor={addressId}
              className="text-[11px] font-medium text-slate-500 dark:text-slate-400"
            >
              {t('resources.fullAddress')}
            </label>
            <button
              type="button"
              onClick={handleCopyAddress}
              disabled={isBusy}
              className="flex items-center space-x-1 text-[11px] text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 disabled:opacity-45 disabled:cursor-not-allowed"
            >
              {copied ? (
                <Check className="w-3 h-3 text-emerald-500" />
              ) : (
                <Copy className="w-3 h-3" />
              )}
              <span>{copied ? t('resources.copied') : t('resources.copyAddress')}</span>
            </button>
          </div>
          <textarea
            id={addressId}
            readOnly
            rows={3}
            spellCheck={false}
            value={activeAddress}
            aria-label={t('resources.fullAddress')}
            className="w-full max-h-24 resize-none overflow-auto rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/70 px-2 py-1.5 font-mono text-[10px] leading-relaxed text-slate-600 dark:text-slate-300 whitespace-pre-wrap break-all"
          />
          {copyFailed && (
            <p role="status" className="mt-1 text-[10px] text-red-500">
              {t('resources.copyFailed')}
            </p>
          )}
        </div>

        <div>
          <h4 className="text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1.5">
            {t('resources.references')}
          </h4>
          {activeResource.references.length === 0 ? (
            <p className="text-[11px] text-slate-400 dark:text-slate-500">
              {t('resources.noReferences')}
            </p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {activeResource.references.map((reference, index) => (
                <button
                  key={`${reference.line}-${index}`}
                  type="button"
                  onClick={() => handleLocate(activeResource, reference.line)}
                  disabled={isBusy}
                  title={t('resources.locateAtLine', { line: reference.line })}
                  aria-label={t('resources.locateAtLine', { line: reference.line })}
                  className="px-2 py-1 rounded border border-slate-200 dark:border-slate-700 text-[10px] text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700/60 disabled:opacity-45 disabled:cursor-not-allowed"
                >
                  {t('resources.lineLabel', { line: reference.line })}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-slate-200 dark:border-slate-700/80 pt-3">
          <button
            type="button"
            onClick={() => handleLocate(activeResource, activeResource.references[0]?.line)}
            disabled={isBusy}
            className="flex items-center space-x-1 px-2.5 py-1.5 rounded text-[11px] font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700/60 disabled:opacity-45 disabled:cursor-not-allowed"
          >
            <MapPin className="w-3.5 h-3.5 text-blue-500" />
            <span>{t('resources.locate')}</span>
          </button>

          <button
            type="button"
            onClick={() => {
              if (activeResource && !exportBlockReason) {
                void runResourceAction(activeResource, onExport);
              }
            }}
            disabled={isBusy || exportBlockReason !== null}
            title={exportBlockedLabel ?? t('resources.exportTooltip')}
            aria-describedby={exportBlockedLabel ? exportHintId : undefined}
            className="flex items-center space-x-1 px-2.5 py-1.5 rounded text-[11px] font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700/60 disabled:opacity-45 disabled:cursor-not-allowed"
          >
            {isActiveBusy ? (
              <LoaderCircle className="w-3.5 h-3.5 text-blue-500 animate-spin" />
            ) : (
              <Download className="w-3.5 h-3.5 text-indigo-500" />
            )}
            <span>
              {isActiveBusy && pendingId ? t('resources.exportBusy') : t('resources.export')}
            </span>
          </button>

          {activeResource.location === 'local' && (
            <button
              type="button"
              onClick={() => {
                if (activeResource) void runResourceAction(activeResource, onReveal);
              }}
              disabled={isBusy}
              className="flex items-center space-x-1 px-2.5 py-1.5 rounded text-[11px] font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700/60 disabled:opacity-45 disabled:cursor-not-allowed"
            >
              <FolderOpen className="w-3.5 h-3.5 text-amber-500" />
              <span>{t('resources.reveal')}</span>
            </button>
          )}

          {canConvertActive && (
            <button
              type="button"
              onClick={() => {
                if (activeResource) void runResourceAction(activeResource, onConvert);
              }}
              disabled={isBusy || !canConvert}
              title={!canConvert ? convertReason : t('resources.convertTooltip')}
              aria-describedby={!canConvert ? convertHintId : undefined}
              className="flex items-center space-x-1 px-2.5 py-1.5 rounded text-[11px] font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700/60 disabled:opacity-45 disabled:cursor-not-allowed"
            >
              <Archive className="w-3.5 h-3.5 text-violet-500" />
              <span>{t('resources.convert')}</span>
            </button>
          )}
        </div>

        {exportBlockedLabel && (
          <p id={exportHintId} className="text-[10px] text-amber-600 dark:text-amber-400">
            {exportBlockedLabel}
          </p>
        )}

        {canConvertActive && !canConvert && (
          <p id={convertHintId} className="text-[10px] text-amber-600 dark:text-amber-400">
            {convertReason}
          </p>
        )}
      </div>
    );
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4 animate-in fade-in duration-150"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
    >
      <div
        ref={modalRef}
        className="w-[900px] max-w-[calc(100vw-2rem)] h-[min(75vh,650px)] bg-elevated rounded-lg shadow-xl border border-slate-200 dark:border-slate-700 overflow-hidden flex flex-col text-slate-800 dark:text-slate-100"
        onClick={(event) => event.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4 px-5 py-3 border-b border-slate-200 dark:border-slate-700/80 shrink-0">
          <div className="min-w-0">
            <h2
              id={titleId}
              className="flex items-center space-x-2 text-sm font-semibold text-slate-800 dark:text-slate-100"
            >
              <Images className="w-4 h-4 text-violet-500" />
              <span>{t('resources.title')}</span>
            </h2>
            <p
              className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400 truncate"
              title={documentTitle}
            >
              {documentTitle}
            </p>
            <p
              id={descriptionId}
              className="mt-1 text-[11px] text-slate-500 dark:text-slate-400"
            >
              {t('resources.summary', {
                total: summary.total,
                images: summary.images,
                attachments: summary.attachments,
                missing: summary.missing,
              })}
            </p>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            aria-label={t('resources.close')}
            title={t('resources.close')}
            className="p-1 rounded text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700/60 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {error && (
          <div
            role="alert"
            className="mx-4 mt-2 px-3 py-2 rounded border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/40 text-[11px] text-red-600 dark:text-red-400 shrink-0"
          >
            {error}
          </div>
        )}

        {/* Toolbar */}
        <div className="px-4 py-2 border-b border-slate-200 dark:border-slate-700/80 flex flex-wrap items-center gap-2 shrink-0">
          <div className="relative flex-1 min-w-[160px]">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('resources.searchPlaceholder')}
              aria-label={t('resources.searchPlaceholder')}
              className="w-full pl-7 pr-2 py-1 rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/70 text-[11px] text-slate-700 dark:text-slate-200 placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-blue-500/60"
            />
          </div>

          <div
            role="group"
            aria-label={t('resources.filterGroupLabel')}
            className="flex items-center bg-slate-100 dark:bg-slate-800 p-0.5 rounded-md"
          >
            {filters.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setFilter(item.id)}
                aria-pressed={filter === item.id}
                className={clsx(
                  'px-2 py-0.5 rounded text-[11px] font-medium transition-colors',
                  filter === item.id
                    ? 'bg-white dark:bg-slate-700 text-blue-600 dark:text-blue-400 shadow-sm'
                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
                )}
              >
                {item.label}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={onRefresh}
            disabled={isRefreshing || isBusy}
            title={isRefreshing ? t('resources.refreshing') : t('resources.refreshTooltip')}
            aria-label={isRefreshing ? t('resources.refreshing') : t('resources.refresh')}
            className="flex items-center space-x-1 px-2 py-1 rounded text-[11px] text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700/60 disabled:opacity-45 disabled:cursor-not-allowed"
          >
            <RefreshCw
              className={clsx('w-3.5 h-3.5', isRefreshing && 'animate-spin')}
            />
            <span>
              {isRefreshing ? t('resources.refreshing') : t('resources.refresh')}
            </span>
          </button>

          <button
            type="button"
            onClick={() => void handleConvertAll()}
            disabled={isConvertingAll || isBusy || !canConvert}
            title={!canConvert ? convertReason : t('resources.convertAllTooltip')}
            aria-describedby={!canConvert ? convertAllHintId : undefined}
            className="flex items-center space-x-1 px-2 py-1 rounded text-[11px] font-medium text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 hover:bg-slate-200 dark:hover:bg-slate-700/60 disabled:opacity-45 disabled:cursor-not-allowed"
          >
            {isConvertingAll ? (
              <LoaderCircle className="w-3.5 h-3.5 text-blue-500 animate-spin" />
            ) : (
              <Archive className="w-3.5 h-3.5 text-violet-500" />
            )}
            <span>
              {isConvertingAll ? t('resources.convertAllBusy') : t('resources.convertAll')}
            </span>
          </button>
        </div>
        {!canConvert && (
          <p
            id={convertAllHintId}
            className="px-4 py-1 text-[10px] text-amber-600 dark:text-amber-400 shrink-0"
          >
            {convertReason}
          </p>
        )}

        {/* Body: list + preview */}
        <div className="flex flex-col sm:flex-row flex-1 min-h-0">
          <div className="w-full sm:w-[330px] max-h-[30%] sm:max-h-none shrink-0 border-b sm:border-b-0 sm:border-r border-slate-200 dark:border-slate-700/80 flex flex-col min-h-0">
            <div className="px-3 py-1.5 text-[10px] uppercase tracking-wide text-slate-400 dark:text-slate-500 shrink-0">
              {t('resources.listAriaLabel')}
              {visibleResources.length !== resources.length
                ? ` · ${visibleResources.length}/${resources.length}`
                : ''}
            </div>
            <ul
              id={listId}
              aria-label={t('resources.listAriaLabel')}
              className="flex-1 overflow-y-auto px-2 pb-2 space-y-1"
            >
              {visibleResources.length === 0 ? (
                <li className="px-3 py-8 text-center text-[11px] text-slate-400 dark:text-slate-500">
                  {resources.length === 0
                    ? t('resources.emptyHelp')
                    : t('resources.noMatchesHelp')}
                </li>
              ) : (
                visibleResources.map((resource) => {
                  const size = formatResourceByteLength(resource.byteLength);
                  const isSelected = activeId === resource.id;
                  return (
                    <li key={resource.id}>
                      <button
                        type="button"
                        onClick={() => setSelectedId(resource.id)}
                        aria-current={isSelected ? 'true' : undefined}
                        title={resource.name}
                        className={clsx(
                          'w-full text-left px-2 py-1.5 rounded border transition-colors',
                          isSelected
                            ? 'bg-blue-50 dark:bg-blue-900/30 border-blue-200 dark:border-blue-800'
                            : 'border-transparent hover:bg-slate-100 dark:hover:bg-slate-800/70'
                        )}
                      >
                        <div className="flex items-center gap-1.5 min-w-0">
                          {resource.kind === 'image' ? (
                            <ImageIcon className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                          ) : (
                            <Paperclip className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                          )}
                          <span className="text-[11px] font-medium text-slate-700 dark:text-slate-200 truncate">
                            {resource.name}
                          </span>
                          {resource.status === 'missing' && (
                            <span className="ml-auto shrink-0 px-1 py-0 rounded bg-red-100 dark:bg-red-950/60 text-[9px] font-medium text-red-600 dark:text-red-400">
                              {t('resources.missingBadge')}
                            </span>
                          )}
                        </div>
                        <p className="mt-0.5 pl-5 text-[10px] text-slate-400 dark:text-slate-500 truncate">
                          {formatShortAddress(resource.displayAddress)}
                        </p>
                        <p className="mt-0.5 pl-5 text-[10px] text-slate-400 dark:text-slate-500 flex flex-wrap items-center gap-x-1.5">
                          <span>{kindLabels[resource.kind]}</span>
                          {size && <span>· {size}</span>}
                          <span>· {locationLabels[resource.location]}</span>
                          <span>
                            ·{' '}
                            {t('resources.referenceCount', {
                              count: resource.referenceCount,
                            })}
                          </span>
                        </p>
                      </button>
                    </li>
                  );
                })
              )}
            </ul>
          </div>

          <div className="flex-1 min-w-0 overflow-y-auto p-4">
            {renderPreview()}
          </div>
        </div>
      </div>
    </div>
  );
};
