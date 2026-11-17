import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import {
  fetchXmdImage, getFileSize, isTauri, readXmdResource, saveResourceDialog,
  showInFolder, writeResourceFile, settleCreatedResourceFiles,
} from '@/lib/native';
import { decodeDataUrl, MAX_XMD_RESOURCE_BYTES } from '@/lib/export/xmdExporter';
import { createImageAssetName, getImageAssetDestination } from '@/lib/imageAssets';
import {
  convertedImageExtension, replaceResourcePaths, scanDocumentResources, type DocumentResource,
} from '@/lib/documentResources';
import { useI18n } from '@/i18n';

export interface UseDocumentResourcesOptions {
  documentId: string;
  document: string;
  sourceFilePath?: string | null;
  enabled: boolean;
  updateContent: (id: string, content: string) => void;
  showToast: (message: string, type?: 'info' | 'success' | 'warning' | 'error') => void;
}

export function useDocumentResources({
  documentId, document, sourceFilePath, enabled, updateContent, showToast,
}: UseDocumentResourcesOptions) {
  const { t } = useI18n();
  const deferredDocument = useDeferredValue(document);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [metadata, setMetadata] = useState<Map<string, Pick<DocumentResource, 'status' | 'byteLength'>>>(new Map());
  const [busyId, setBusyId] = useState<string | null>(null);
  const operationRef = useRef(false);
  const documentRef = useRef(document);
  const documentIdRef = useRef(documentId);
  const pathRef = useRef(sourceFilePath);
  documentRef.current = document;
  documentIdRef.current = documentId;
  pathRef.current = sourceFilePath;

  const scan = useMemo(() => {
    if (!enabled) return { resources: [] as DocumentResource[], error: null };
    try {
      return { resources: scanDocumentResources(deferredDocument, sourceFilePath), error: null };
    } catch (error) {
      return { resources: [] as DocumentResource[], error: error instanceof Error ? error.message : String(error) };
    }
  }, [deferredDocument, enabled, sourceFilePath]);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const local = scan.resources.filter((resource) => resource.localPath);
    setMetadata(new Map(local.map((resource) => [resource.id, { status: 'loading' as const, byteLength: undefined }])));
    if (local.length === 0) return () => { cancelled = true; };
    void Promise.all(local.map(async (resource) => {
      try {
        if (!isTauri()) return [resource.id, { status: 'unknown', byteLength: undefined }] as const;
        const size = await getFileSize(resource.localPath!);
        return [resource.id, { status: 'ready', byteLength: size }] as const;
      } catch {
        return [resource.id, { status: 'missing', byteLength: undefined }] as const;
      }
    })).then((updates) => { if (!cancelled) setMetadata(new Map<string, Pick<DocumentResource, 'status' | 'byteLength'>>(updates)); });
    return () => { cancelled = true; };
  }, [enabled, refreshVersion, scan.resources]);

  const resources = useMemo(() => scan.resources.map((resource) => ({
    ...resource, ...metadata.get(resource.id),
  })), [metadata, scan.resources]);
  const isRefreshing = resources.some((resource) => resource.status === 'loading');
  const refresh = useCallback(() => setRefreshVersion((value) => value + 1), []);

  const isXmd = Boolean(sourceFilePath?.toLowerCase().endsWith('.xmd'));
  const canConvert = isTauri() && Boolean(sourceFilePath && !sourceFilePath.startsWith('browser://') && !isXmd);
  const convertReason = isXmd ? t('resources.xmdKeepBundled')
    : !isTauri() ? t('resources.desktopOnly')
    : !sourceFilePath ? t('resources.saveFirst') : '';
  const errorMessage = useCallback((error: unknown) => error instanceof Error ? error.message : String(error), []);

  const exportResource = useCallback(async (resource: DocumentResource) => {
    if (operationRef.current) return;
    operationRef.current = true;
    setBusyId(resource.id);
    try {
      if (resource.location === 'transient') throw new Error(t('resources.transientUnavailable'));
      if (resource.byteLength !== undefined && resource.byteLength > MAX_XMD_RESOURCE_BYTES) throw new Error(t('resources.resourceTooLarge'));
      const path = await saveResourceDialog(resource.name);
      if (!path) return;
      let bytes: Uint8Array;
      if (resource.location === 'embedded') bytes = decodeDataUrl(resource.source).bytes;
      else if (resource.localPath) bytes = await readXmdResource(resource.localPath);
      else if (/^https?:/i.test(resource.source)) bytes = (await fetchXmdImage(resource.source)).data;
      else throw new Error(t('resources.transientUnavailable'));
      if (bytes.byteLength > MAX_XMD_RESOURCE_BYTES) throw new Error(t('resources.resourceTooLarge'));
      await writeResourceFile(path, bytes);
      showToast(t('resources.exportSuccess', { name: resource.name }), 'success');
    } catch (error) {
      showToast(t('resources.exportFailed', { error: errorMessage(error) }), 'error');
    } finally { operationRef.current = false; setBusyId(null); }
  }, [errorMessage, showToast, t]);

  const revealResource = useCallback(async (resource: DocumentResource) => {
    if (!resource.localPath || operationRef.current) return;
    operationRef.current = true;
    setBusyId(resource.id);
    try { await showInFolder(resource.localPath); }
    catch (error) { showToast(t('resources.revealFailed', { error: errorMessage(error) }), 'error'); }
    finally { operationRef.current = false; setBusyId(null); }
  }, [errorMessage, showToast, t]);

  const convertResources = useCallback(async (selected: DocumentResource[], id: string) => {
    if (!canConvert || !sourceFilePath || operationRef.current) return;
    const originalDocumentId = documentId;
    const originalDocument = documentRef.current;
    const selectedSources = new Set(selected.map((resource) => resource.source));
    const current = scanDocumentResources(originalDocument, sourceFilePath)
      .filter((resource) => selectedSources.has(resource.source) && resource.kind === 'image' && resource.location === 'embedded');
    if (current.length === 0) {
      showToast(t('resources.nothingToConvert'), 'info');
      return;
    }
    operationRef.current = true;
    setBusyId(id);
    const receipts: string[] = [];
    let applied = false;
    try {
      // Pre-check the batch budget and types, then decode one image at a time.
      // Native receipts safely roll back files if a later image fails.
      const maximumBatchBytes = 128 * 1024 * 1024;
      const estimatedBytes = current.reduce((total, resource) => total + (resource.byteLength || 0), 0);
      if (estimatedBytes > maximumBatchBytes) throw new Error('单次转存总量不能超过 128 MiB / Conversion batch exceeds 128 MiB');
      for (const resource of current) convertedImageExtension(resource.mimeType);
      const pathsBySource = new Map<string, string>();
      let decodedBytes = 0;
      for (const resource of current) {
        const extension = convertedImageExtension(resource.mimeType);
        const data = decodeDataUrl(resource.source);
        decodedBytes += data.bytes.length;
        if (decodedBytes > maximumBatchBytes) throw new Error('单次转存总量不能超过 128 MiB / Conversion batch exceeds 128 MiB');
        const name = createImageAssetName({ name: resource.name, type: resource.mimeType }, new Date(), crypto.randomUUID());
        const fileName = name.replace(/\.[^.]+$/, `.${extension}`);
        const destination = getImageAssetDestination(sourceFilePath, fileName);
        const receipt = await writeResourceFile(destination.absolutePath, data.bytes, true);
        if (receipt) receipts.push(receipt);
        const fragment = resource.source.indexOf('#');
        pathsBySource.set(resource.source, destination.markdownPath + (fragment === -1 ? '' : resource.source.slice(fragment)));
      }
      // If another tab became active or the user kept typing, re-scan the
      // latest source before applying references; never edit a different tab.
      if (documentIdRef.current !== originalDocumentId || pathRef.current !== sourceFilePath) throw new Error(t('resources.documentChanged'));
      const latest = scanDocumentResources(documentRef.current, sourceFilePath);
      const paths = new Map(latest.filter((resource) => resource.kind === 'image' && pathsBySource.has(resource.source))
        .map((resource) => [resource.id, pathsBySource.get(resource.source)!]));
      const rewritten = replaceResourcePaths(documentRef.current, latest, paths);
      if (rewritten === documentRef.current) throw new Error(t('resources.documentChanged'));
      updateContent(originalDocumentId, rewritten);
      applied = true;
      showToast(t('resources.convertSuccess', { count: paths.size }), 'success');
    } catch (error) {
      showToast(t('resources.convertFailed', { error: errorMessage(error) }), 'error');
    } finally {
      try { if (receipts.length) await settleCreatedResourceFiles(receipts, !applied); }
      catch (error) { showToast(t('resources.convertFailed', { error: errorMessage(error) }), 'error'); }
      operationRef.current = false;
      setBusyId(null);
    }
  }, [canConvert, documentId, errorMessage, showToast, sourceFilePath, t, updateContent]);

  const convertResource = useCallback((resource: DocumentResource) => convertResources([resource], resource.id), [convertResources]);
  const convertAll = useCallback(() => convertResources(
    resources.filter((resource) => resource.kind === 'image' && resource.location === 'embedded'), 'all'
  ), [convertResources, resources]);

  return {
    resources, error: scan.error, isRefreshing, refresh,
    exportResource, revealResource, convertResource, convertAll,
    canConvert, convertReason, busyId,
  };
}
