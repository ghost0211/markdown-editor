import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Clock3, FileText, LoaderCircle, RefreshCw, RotateCcw, X } from 'lucide-react';
import { readDocumentHistory, readDocumentSnapshot, type DocumentHistoryEntry } from '@/lib/native';
import { formatResourceSize } from '@/lib/documentResources';
import { normalizeLineEndings } from '@/lib/documentUtils';
import { useI18n } from '@/i18n';
import { DiffView } from './DiffView';

interface DocumentHistoryProps {
  isOpen: boolean;
  onClose: () => void;
  sourceFilePath: string | null;
  content: string;
  title: string;
  isDark: boolean;
  onRestore: (content: string, expected: string) => boolean;
}

export function DocumentHistory({ isOpen, onClose, sourceFilePath, content, title, isDark, onRestore }: DocumentHistoryProps) {
  const { t, language } = useI18n();
  const [versions, setVersions] = useState<DocumentHistoryEntry[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingSnapshot, setLoadingSnapshot] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const modalRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  const restoreFocusRef = useRef(true);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!isOpen) return;
    restoreFocusRef.current = true;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const timer = window.setTimeout(() => closeRef.current?.focus(), 0);
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault(); event.stopImmediatePropagation(); onCloseRef.current(); return;
      }
      if (event.key !== 'Tab' || !modalRef.current) return;
      const controls = [...modalRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])')];
      if (!controls.length) { event.preventDefault(); return; }
      const first = controls[0]; const last = controls[controls.length - 1];
      if (event.shiftKey && (document.activeElement === first || !modalRef.current.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !modalRef.current.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', keydown);
    return () => {
      window.clearTimeout(timer); window.removeEventListener('keydown', keydown);
      if (restoreFocusRef.current) previous?.focus();
    };
  }, [isOpen, onClose]);

  useEffect(() => {
    if (!isOpen || !sourceFilePath) { setVersions([]); setLoading(false); setError(null); return; }
    let cancelled = false;
    setLoading(true); setError(null);
    void readDocumentHistory(sourceFilePath).then((items) => {
      if (cancelled) return;
      setVersions(items); setSelectedId((current) => items.some((item) => item.id === current) ? current : items[0]?.id || null);
    }).catch((reason: unknown) => {
      if (cancelled) return;
      setError(reason instanceof Error ? reason.message : String(reason)); setVersions([]); setSelectedId(null);
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [isOpen, sourceFilePath, retry]);

  useEffect(() => {
    if (!isOpen || !sourceFilePath || !selectedId) { setSnapshot(null); setLoadingSnapshot(false); return; }
    let cancelled = false;
    setSnapshot(null); setLoadingSnapshot(true); setError(null);
    void readDocumentSnapshot(sourceFilePath, selectedId).then((value) => { if (!cancelled) setSnapshot(value); })
      .catch((reason: unknown) => { if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason)); })
      .finally(() => { if (!cancelled) setLoadingSnapshot(false); });
    return () => { cancelled = true; };
  }, [isOpen, selectedId, sourceFilePath]);

  const selected = useMemo(() => versions.find((item) => item.id === selectedId), [versions, selectedId]);
  const currentText = useMemo(() => normalizeLineEndings(content), [content]);
  const snapshotText = useMemo(() => snapshot === null ? null : normalizeLineEndings(snapshot), [snapshot]);
  const hasChanges = snapshotText !== null && snapshotText !== currentText;
  const applyRestore = (next: string, expected: string) => {
    if (!onRestore(next, expected)) return false;
    restoreFocusRef.current = false;
    onClose();
    return true;
  };
  const formatTime = useCallback((timestamp: number) => new Date(timestamp).toLocaleString(language === 'zh-CN' ? 'zh-CN' : 'en-US', { hour12: false }), [language]);
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div ref={modalRef} role="dialog" aria-modal="true" aria-labelledby="document-history-title" aria-describedby="document-history-description" className="w-[1100px] max-w-[calc(100vw-2rem)] h-[75vh] max-h-[760px] min-h-[360px] bg-elevated rounded-lg shadow-xl border border-slate-200 dark:border-slate-700 flex flex-col overflow-hidden text-slate-800 dark:text-slate-100">
        <header className="flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-slate-700 shrink-0">
          <div className="min-w-0">
            <h2 id="document-history-title" className="flex items-center gap-2 text-sm font-medium"><Clock3 className="w-4 h-4 text-blue-500" />{t('history.title')}</h2>
            <p id="document-history-description" className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 truncate">{title}</p>
          </div>
          <button ref={closeRef} type="button" onClick={onClose} aria-label={t('history.close')} title={t('history.close')} className="p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-500 dark:text-slate-400"><X className="w-4 h-4" /></button>
        </header>

        {!sourceFilePath ? (
          <div className="flex-1 flex flex-col items-center justify-center px-6 text-center text-slate-500 dark:text-slate-400"><FileText className="w-10 h-10 mb-3 opacity-60" /><p className="text-sm font-medium">{t('history.saveFirst')}</p><p className="text-xs mt-2">{t('history.emptyHelp')}</p></div>
        ) : loading ? (
          <div className="flex-1 flex items-center justify-center gap-2 text-sm text-slate-500 dark:text-slate-400"><LoaderCircle className="w-5 h-5 animate-spin" />{t('history.loading')}</div>
        ) : error && versions.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center px-6 text-center"><AlertTriangle className="w-10 h-10 mb-3 text-red-500" /><p className="text-xs text-red-600 dark:text-red-400 max-w-xl break-words">{t('history.loadFailed', { error })}</p><button type="button" onClick={() => setRetry((value) => value + 1)} className="mt-4 px-3 py-1.5 rounded bg-blue-600 text-white text-xs hover:bg-blue-700 flex items-center gap-1.5"><RefreshCw className="w-3.5 h-3.5" />{t('history.retry')}</button></div>
        ) : versions.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center px-6 text-center text-slate-500 dark:text-slate-400"><Clock3 className="w-10 h-10 mb-3 opacity-60" /><p className="text-sm font-medium">{t('history.empty')}</p><p className="text-xs mt-2">{t('history.emptyHelp')}</p></div>
        ) : (
          <div className="flex flex-col sm:flex-row flex-1 min-h-0">
            <aside className="w-full sm:w-72 shrink-0 max-h-[35%] sm:max-h-none border-b sm:border-b-0 sm:border-r border-slate-200 dark:border-slate-700 overflow-y-auto p-2 space-y-1" aria-label={t('history.listLabel')}>
              {versions.map((version) => (
                <button key={version.id} type="button" onClick={() => setSelectedId(version.id)} aria-current={version.id === selectedId ? 'true' : undefined} className={`w-full text-left px-3 py-2 rounded border ${version.id === selectedId ? 'bg-blue-50 dark:bg-blue-950/40 border-blue-200 dark:border-blue-800' : 'border-transparent hover:bg-slate-100 dark:hover:bg-slate-800'}`}>
                  <span className="block text-xs font-medium text-slate-700 dark:text-slate-200">{formatTime(version.createdAt)}</span>
                  <span className="block text-[10px] text-slate-500 dark:text-slate-400 mt-1">{formatResourceSize(version.bytes)}</span>
                </button>
              ))}
            </aside>
            <section className="flex flex-col flex-1 min-w-0 min-h-0">
              <div className="flex items-center justify-between px-4 py-2 border-b border-slate-200 dark:border-slate-700 text-xs">
                <span className="text-slate-500 dark:text-slate-400">{t('history.compareTitle')}</span>
                {snapshot === content && <span className="text-slate-500 dark:text-slate-400">{t('history.sameAsCurrent')}</span>}
              </div>
              <div className="flex-1 min-h-0 overflow-hidden">
                {loadingSnapshot || snapshot === null ? (
                  <div className="h-full flex items-center justify-center gap-2 text-sm text-slate-500 dark:text-slate-400"><LoaderCircle className="w-4 h-4 animate-spin" />{error || t('history.loadingSnapshot')}</div>
                ) : (
                  <DiffView
                    key={selectedId}
                    leftTitle={`${t('history.snapshot')} · ${formatTime(selected?.createdAt || 0)}`}
                    rightTitle={t('history.current')}
                    leftDoc={snapshotText + '\n'}
                    rightDoc={currentText + '\n'}
                    leftReadOnly rightReadOnly isDark={isDark} collapseUnchanged={false} wordWrap
                    onRestoreChunk={(original, next) => original.endsWith('\n') && next.endsWith('\n') &&
                      applyRestore(next.slice(0, -1), original.slice(0, -1))}
                  />
                )}
              </div>
            </section>
          </div>
        )}
        <footer className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 border-t border-slate-200 dark:border-slate-700 shrink-0">
          <div className="text-[10px] text-slate-500 dark:text-slate-400">
            {hasChanges && <p>{t('history.restoreChunkHelp')}</p>}
            <p>{t('history.restoreHelp')}</p>
          </div>
          <button type="button" disabled={!selected || !hasChanges || loadingSnapshot} onClick={() => { if (snapshot !== null) applyRestore(snapshot, currentText); }} className="px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5"><RotateCcw className="w-3.5 h-3.5" />{t('history.restore')}</button>
        </footer>
      </div>
    </div>
  );
}
