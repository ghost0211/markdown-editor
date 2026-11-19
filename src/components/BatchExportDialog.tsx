import { useEffect, useMemo, useRef, useState } from 'react';
import { FolderOpen } from 'lucide-react';
import { WorkflowDialog } from './WorkflowDialog';
import { useI18n } from '@/i18n';
import { loadExportPresets } from '@/lib/exportStyle';
import { chooseWorkspaceFolder, listWorkspace } from '@/lib/native';
import { getFileNameFromPath, normalizePathKey } from '@/lib/documentUtils';
import { workspaceEntryAbsolutePath } from '@/lib/workspace';
import { runBatchExport, type BatchExportFormat, type BatchExportResult, type BatchExportSource } from '@/lib/export/batchExport';
import type { DocumentTab, ExportStyle } from '@/types';

export function BatchExportDialog({ root, tabs, style, embedImages, onClose, onChooseWorkspace }: {
  root: string | null;
  tabs: readonly DocumentTab[];
  style?: ExportStyle;
  embedImages: boolean;
  onClose: () => void;
  onChooseWorkspace: () => Promise<void>;
}) {
  const { t, language } = useI18n();
  const [paths, setPaths] = useState<string[]>([]);
  const [selected, setSelected] = useState(new Set<string>());
  const [query, setQuery] = useState('');
  const [visible, setVisible] = useState(150);
  const [format, setFormat] = useState<BatchExportFormat>('pdf');
  const [preset, setPreset] = useState('');
  const [presets] = useState(loadExportPresets);
  const [destination, setDestination] = useState('');
  const [loading, setLoading] = useState(Boolean(root));
  const [truncated, setTruncated] = useState(false);
  const [error, setError] = useState('');
  const [progress, setProgress] = useState<{ total: number; results: BatchExportResult[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [stopping, setStopping] = useState(false);
  const job = useRef<AbortController | null>(null);
  useEffect(() => () => job.current?.abort(), []);

  useEffect(() => {
    if (!root) return;
    let current = true;
    setLoading(true);
    setPaths([]);
    setTruncated(false);
    setSelected(new Set());
    setError('');
    void listWorkspace(root).then((listing) => {
      if (!current) return;
      setPaths(listing.entries.filter((entry) => entry.kind === 'document').map((entry) => entry.path));
      setTruncated(listing.truncated);
    }).catch((reason: unknown) => {
      if (current) setError(String(reason));
    }).finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [root]);

  const filtered = useMemo(() => {
    const key = query.trim().toLocaleLowerCase();
    return paths.filter((path) => path.toLocaleLowerCase().includes(key));
  }, [paths, query]);

  const chooseDestination = async () => {
    try {
      const folder = await chooseWorkspaceFolder('export');
      if (folder) setDestination(folder);
    } catch (reason) { setError(String(reason)); }
  };

  const start = async () => {
    if (job.current || !root || !destination || !selected.size) return;
    const open = new Map(tabs.filter((tab) => tab.kind !== 'diff' && tab.filePath)
      .map((tab) => [normalizePathKey(tab.filePath), tab]));
    const sources: BatchExportSource[] = [];
    for (const relative of paths) {
      if (!selected.has(relative)) continue;
      const path = workspaceEntryAbsolutePath(root, relative);
      if (!path) continue;
      const tab = open.get(normalizePathKey(path));
      sources.push({ path, title: tab?.title ?? getFileNameFromPath(relative), content: tab?.content });
    }
    if (!sources.length) return;
    const controller = new AbortController();
    job.current = controller;
    setBusy(true);
    setStopping(false);
    setProgress({ total: sources.length, results: [] });
    setError('');
    try {
      await runBatchExport(sources, destination, format, {
        language,
        embedImages,
        style: presets.find((item) => item.id === preset)?.style ?? style,
      }, controller.signal, (result) => {
        setProgress((previous) => previous && { ...previous, results: [...previous.results, result] });
      });
    } finally {
      setBusy(false);
      job.current = null;
    }
  };

  const control = 'rounded border border-slate-200 bg-app px-2 py-1.5 text-xs dark:border-slate-700';
  const button = 'rounded px-2.5 py-1.5 text-xs hover:bg-panel disabled:opacity-45';
  const succeeded = progress?.results.filter((result) => !result.error).length ?? 0;

  return (
    <WorkflowDialog title={t('batchExport.title')} onClose={onClose} busy={busy}>
      <div className="min-h-0 space-y-3 overflow-y-auto p-4 text-xs">
        {!root ? (
          <button type="button" className={button} onClick={() => void onChooseWorkspace().catch((reason: unknown) => setError(String(reason)))}>
            {t('search.workspaceChooseHint')}
          </button>
        ) : (
          <>
            <p className="truncate text-slate-500" title={root}>{root}</p>
            <div className="flex flex-wrap items-center gap-2">
              <input className={control + ' min-w-40 flex-1'} aria-label={t('batchExport.search')} placeholder={t('batchExport.search')}
                value={query} disabled={busy} onChange={(event) => { setQuery(event.target.value); setVisible(150); }} />
              <button type="button" className={button} disabled={busy || !filtered.length}
                onClick={() => setSelected((previous) => new Set([...previous, ...filtered]))}>{t('batchExport.selectFiltered')}</button>
              <button type="button" className={button} disabled={busy || !selected.size}
                onClick={() => setSelected(new Set())}>{t('batchExport.clear')}</button>
            </div>
            <div className="max-h-52 overflow-y-auto rounded border border-slate-200 dark:border-slate-700">
              {!filtered.length && <p className="p-3 text-slate-500">{t(loading ? 'search.workspaceScanning' : 'search.noResults')}</p>}
              {filtered.slice(0, visible).map((path) => (
                <label key={path} className="flex cursor-pointer items-center gap-2 px-3 py-1.5 hover:bg-panel">
                  <input type="checkbox" checked={selected.has(path)} disabled={busy} onChange={(event) => {
                    const checked = event.target.checked;
                    setSelected((previous) => {
                      const next = new Set(previous);
                      if (checked) next.add(path);
                      else next.delete(path);
                      return next;
                    });
                  }} />
                  <span className="truncate" title={path}>{path}</span>
                </label>
              ))}
              {filtered.length > visible && <button type="button" className={button} onClick={() => setVisible((n) => n + 150)}>
                {t('search.showMore', { count: filtered.length - visible })}
              </button>}
            </div>
            {truncated && <p className="text-amber-700 dark:text-amber-400">{t('batchExport.limitedList')}</p>}
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-1.5">{t('batchExport.format')}
                <select className={control} value={format} disabled={busy} onChange={(event) => setFormat(event.target.value as BatchExportFormat)}>
                  <option value="pdf">PDF</option><option value="docx">Word (.docx)</option><option value="html">HTML</option>
                </select>
              </label>
              <label className="flex items-center gap-1.5">{t('batchExport.theme')}
                <select className={control} value={preset} disabled={busy} onChange={(event) => setPreset(event.target.value)}>
                  <option value="">{t('batchExport.currentTheme')}</option>
                  {presets.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select>
              </label>
              <button type="button" className={button + ' flex items-center gap-1.5'} disabled={busy} onClick={() => void chooseDestination()}>
                <FolderOpen className="h-4 w-4" />{t('batchExport.destination')}
              </button>
            </div>
            {destination && <p className="truncate text-slate-500" title={destination}>{destination}</p>}
          </>
        )}
        {error && <p role="alert" className="break-words text-red-600 dark:text-red-400">{error}</p>}
        {progress && (
          <div className="space-y-1 rounded border border-slate-200 p-2 dark:border-slate-700">
            <p role="status">{t('batchExport.summary', {
              done: progress.results.length, total: progress.total, success: succeeded, failed: progress.results.length - succeeded,
            })}</p>
            <ul className="max-h-32 space-y-1 overflow-y-auto text-[11px]">
              {progress.results.map((result) => (
                <li key={result.source.path} className={result.error ? 'break-words text-red-600 dark:text-red-400' : 'break-words text-slate-500'}>
                  {result.error ? getFileNameFromPath(result.source.path) + ' · ' + result.error : result.output}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
      <footer className="flex shrink-0 items-center justify-between gap-2 border-t border-slate-200 p-3 text-xs dark:border-slate-700">
        <span className="text-slate-500">{t('batchExport.selected', { count: selected.size })}</span>
        {busy ? (
          <button type="button" className={button} disabled={stopping}
            onClick={() => { setStopping(true); job.current?.abort(); }}>{t(stopping ? 'batchExport.stopping' : 'batchExport.stop')}</button>
        ) : (
          <button type="button" className="rounded bg-blue-600 px-4 py-1.5 text-white disabled:opacity-45"
            onClick={() => void start()} disabled={!destination || !selected.size || loading}>{t('batchExport.start')}</button>
        )}
      </footer>
    </WorkflowDialog>
  );
}
