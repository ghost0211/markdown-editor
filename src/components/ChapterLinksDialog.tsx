import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ChevronRight, FileText, Link2 } from 'lucide-react';
import { useI18n } from '@/i18n';
import { WorkflowDialog } from './WorkflowDialog';
import { indexDocumentAnchors } from '@/lib/documentAnchors';
import { documentBacklinks, markdownChapterLink, type ChapterBacklink, type ReferenceDocument } from '@/lib/chapterLinks';
import { listWorkspace } from '@/lib/native';
import { normalizePathKey } from '@/lib/documentUtils';
import { TOTAL_MATCH_LIMIT } from '@/lib/documentSearch';
import { workspaceEntryAbsolutePath } from '@/lib/workspace';
import { loadWorkspaceSearch, workspaceSearchDocuments } from '@/lib/workspaceSearch';
import type { DocumentTab } from '@/types';

interface Candidate { id: string; path: string | null; title: string; current?: boolean }

interface ChapterLinksDialogProps {
  mode: 'insert' | 'incoming';
  source: DocumentTab;
  tabs: readonly DocumentTab[];
  root: string | null;
  renderHtml: boolean;
  readTarget: (path: string) => Promise<string>;
  onClose: () => void;
  onInsert: (link: string) => boolean;
  onLocate: (link: ChapterBacklink, expected: string) => Promise<boolean>;
}

const candidateButton = 'flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-panel focus-visible:ring-2 focus-visible:ring-blue-500';

export function ChapterLinksDialog({ mode, source, tabs, root, renderHtml, readTarget, onClose, onInsert, onLocate }: ChapterLinksDialogProps) {
  const { t } = useI18n();
  const [query, setQuery] = useState('');
  const [visible, setVisible] = useState(150);
  const [files, setFiles] = useState<Candidate[]>([]);
  const [target, setTarget] = useState<Candidate | null>(null);
  const [targetContent, setTargetContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(Boolean(root) || mode === 'incoming');
  const [error, setError] = useState('');
  const [partial, setPartial] = useState(false);
  const [incoming, setIncoming] = useState<ChapterBacklink[]>([]);
  const [referenceSources, setReferenceSources] = useState<ReferenceDocument[]>([]);
  const [locating, setLocating] = useState(false);
  const resultsRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const localSource = source.filePath && !source.filePath.startsWith('browser://') ? source.filePath : null;
  const sourceHeadings = useMemo(() => mode === 'incoming' ? indexDocumentAnchors(source.content, renderHtml).headings : [],
    [mode, source.content, renderHtml]);
  const [section, setSection] = useState(() => {
    if (mode !== 'incoming') return '';
    return [...sourceHeadings].reverse().find((heading) => heading.line <= source.cursorLine)?.slug ?? '';
  });
  const [searchTabs] = useState(() => tabs.filter((tab) => tab.kind !== 'diff'));
  const [searchSource] = useState(source);

  useEffect(() => {
    if (mode !== 'insert') return;
    if (!root || !localSource) { setLoading(false); return; }
    let live = true;
    setLoading(true);
    void listWorkspace(root).then((listing) => {
      if (!live) return;
      const candidates: Candidate[] = [];
      for (const entry of listing.entries) {
        if (entry.kind !== 'document') continue;
        const path = workspaceEntryAbsolutePath(listing.root, entry.path);
        if (path) candidates.push({ id: normalizePathKey(path), path, title: entry.path });
      }
      setFiles(candidates);
      setPartial(listing.truncated);
    }).catch((reason: unknown) => { if (live) setError(String(reason)); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [mode, root, localSource]);

  useEffect(() => {
    if (mode !== 'incoming') return;
    const controller = new AbortController();
    let worker: Worker | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const scan = async () => {
      let documents: ReferenceDocument[] = searchTabs;
      if (root) {
        try {
          const snapshot = await loadWorkspaceSearch(root, controller.signal);
          const workspaceDocuments = workspaceSearchDocuments(snapshot, searchTabs);
          const workspacePaths = new Set(workspaceDocuments.map((doc) => normalizePathKey(doc.filePath)));
          documents = [...workspaceDocuments, ...searchTabs.filter((tab) => !workspacePaths.has(normalizePathKey(tab.filePath)))];
          if (snapshot.truncated || snapshot.skipped) setPartial(true);
        } catch (reason) {
          if (!controller.signal.aborted) setError(String(reason));
        }
      }
      if (controller.signal.aborted) return;
      if (!documents.some((item) => item.id === searchSource.id ||
          (searchSource.filePath && normalizePathKey(item.filePath) === normalizePathKey(searchSource.filePath)))) {
        documents = [searchSource, ...documents];
      }
      setReferenceSources(documents);
      if (typeof Worker === 'undefined') {
        const matches: ChapterBacklink[] = [];
        for (const doc of documents) {
          if (controller.signal.aborted) return;
          matches.push(...documentBacklinks(searchSource, [doc], TOTAL_MATCH_LIMIT - matches.length));
          if (matches.length >= TOTAL_MATCH_LIMIT) break;
          await new Promise((resolve) => window.setTimeout(resolve, 0));
        }
        if (!controller.signal.aborted) setIncoming(matches);
        return;
      }
      const result = await new Promise<ChapterBacklink[]>((resolve, reject) => {
        worker = new Worker(new URL('../workers/chapterLinks.worker.ts', import.meta.url), { type: 'module' });
        const cancel = () => resolve([]);
        controller.signal.addEventListener('abort', cancel, { once: true });
        timer = setTimeout(() => reject(new Error(t('chapterLinks.timeout'))), 30_000);
        worker.onmessage = (event: MessageEvent<{ results?: ChapterBacklink[]; error?: string }>) => {
          if (event.data.error) reject(new Error(event.data.error));
          else resolve(event.data.results ?? []);
        };
        worker.onerror = (event) => reject(new Error(event.message));
        worker.postMessage({ target: searchSource, sources: documents });
      });
      if (!controller.signal.aborted) setIncoming(result);
    };
    void scan().catch((reason: unknown) => {
      if (!controller.signal.aborted) setError(String(reason));
    }).finally(() => {
      clearTimeout(timer);
      worker?.terminate();
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => { controller.abort(); worker?.terminate(); clearTimeout(timer); };
  }, [mode, root, searchSource, searchTabs, t]);

  const candidates = useMemo(() => {
    const self = { id: source.id, path: source.filePath, title: source.title, current: true };
    if (!localSource) return [self];
    const selfKey = normalizePathKey(localSource);
    const result = new Map(files.filter((item) => item.id !== selfKey).map((item) => [item.id, item]));
    for (const tab of tabs) {
      if (!tab.filePath || tab.filePath.startsWith('browser://') || tab.kind === 'diff') continue;
      const key = normalizePathKey(tab.filePath);
      if (key !== selfKey && !result.has(key)) result.set(key, { id: key, path: tab.filePath, title: tab.title });
    }
    return [self, ...result.values()];
  }, [files, source.id, source.filePath, source.title, localSource, tabs]);

  useEffect(() => {
    if (!target) return;
    let live = true;
    setTargetContent(null);
    setError('');
    const reading = target.current ? Promise.resolve(source.content) : readTarget(target.path!);
    void reading.then((content) => { if (live) setTargetContent(content); })
      .catch((reason: unknown) => { if (live) setError(String(reason)); });
    return () => { live = false; };
  }, [target, source.content, readTarget]);

  const key = query.trim().toLocaleLowerCase();
  const filteredFiles = candidates.filter((candidate) => candidate.title.toLocaleLowerCase().includes(key));
  const headings = useMemo(() => targetContent === null ? [] : indexDocumentAnchors(targetContent, renderHtml).headings,
    [targetContent, renderHtml]);
  const filteredHeadings = headings.filter((heading) => heading.text.toLocaleLowerCase().includes(key) || heading.slug.toLocaleLowerCase().includes(key));
  const filteredIncoming = incoming.filter((match) => (!section || match.slug === section) &&
    (!key || match.document.title.toLocaleLowerCase().includes(key) || match.snippet.toLocaleLowerCase().includes(key)));

  const insert = (label: string, slug: string) => {
    if (!target) return;
    const link = markdownChapterLink(localSource, target.path, label, slug, Boolean(target.current));
    if (!link || !onInsert(link)) setError(t('chapterLinks.stale'));
  };
  const locate = async (match: ChapterBacklink) => {
    const document = referenceSources.find((item) => item.id === match.document.id);
    if (!document || locating) return;
    setLocating(true);
    try {
      if (!(await onLocate(match, document.content))) setError(t('chapterLinks.locateFailed'));
    } catch (reason) { setError(String(reason)); }
    finally { setLocating(false); }
  };

  const count = mode === 'incoming' ? filteredIncoming.length : target ? filteredHeadings.length : filteredFiles.length;
  const pending = (!target && loading) || Boolean(target && targetContent === null && !error);
  return (
    <WorkflowDialog title={t(mode === 'incoming' ? 'chapterLinks.references' : 'chapterLinks.insert')} onClose={onClose}>
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-slate-200 px-4 py-2.5 text-xs dark:border-slate-700">
        {target && (
          <button type="button" className="rounded p-1 hover:bg-panel" aria-label={t('chapterLinks.back')}
            onClick={() => { setTarget(null); setQuery(''); setVisible(150); setError(''); }}><ArrowLeft className="h-4 w-4" /></button>
        )}
        {mode === 'incoming' && (
          <select value={section} aria-label={t('chapterLinks.section')} className="max-w-[45%] rounded border border-slate-200 bg-app px-2 py-1.5 dark:border-slate-700"
            onChange={(event) => { setSection(event.target.value); setVisible(150); }}>
            <option value="">{t('chapterLinks.allSections')}</option>
            {sourceHeadings.map((heading) => <option key={heading.slug} value={heading.slug}>{heading.text}</option>)}
          </select>
        )}
        <input
          ref={searchRef}
          value={query}
          aria-label={t(target ? 'chapterLinks.findHeading' : 'chapterLinks.findDocument')}
          placeholder={t(target ? 'chapterLinks.findHeading' : 'chapterLinks.findDocument')}
          onChange={(event) => { setQuery(event.target.value); setVisible(150); }}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing || (event.key !== 'ArrowDown' && event.key !== 'Enter')) return;
            const first = resultsRef.current?.querySelector<HTMLButtonElement>('button[data-reference-result]');
            if (!first) return;
            event.preventDefault();
            if (event.key === 'ArrowDown') first.focus();
            else first.click();
          }}
          className="min-w-28 flex-1 rounded border border-slate-200 bg-app px-2 py-1.5 dark:border-slate-700"
          autoFocus
        />
      </div>
      <div ref={resultsRef} className="min-h-0 space-y-1 overflow-y-auto p-3 text-xs">
        {target && <p className="truncate px-2 pb-1 text-slate-500" title={target.title}>{target.title}</p>}
        {target && !target.current && (
          <button type="button" className={candidateButton} onClick={() => insert(target.title, '')}>
            <Link2 className="h-4 w-4 text-blue-500" />{t('chapterLinks.documentOnly')}
          </button>
        )}
        {mode === 'insert' && !target && !localSource && <p className="px-2 text-slate-500">{t('chapterLinks.saveFirst')}</p>}
        {mode === 'incoming' && !root && <p className="px-2 text-slate-500">{t('chapterLinks.openOnly')}</p>}
        {error && <p role="alert" className="break-words px-2 text-red-600 dark:text-red-400">{error}</p>}
        {partial && <p className="px-2 text-amber-700 dark:text-amber-400">{t('batchExport.limitedList')}</p>}
        {incoming.length >= TOTAL_MATCH_LIMIT && (
          <p className="px-2 text-amber-700 dark:text-amber-400">{t('chapterLinks.limit', { count: TOTAL_MATCH_LIMIT })}</p>
        )}
        {pending && <p role="status" className="px-2 text-slate-500">{t('chapterLinks.loading')}</p>}
        {mode === 'incoming' ? filteredIncoming.slice(0, visible).map((match, index) => (
          <button key={match.document.id + ':' + match.from + ':' + index} type="button" disabled={locating} data-reference-result
            className={candidateButton} onClick={() => void locate(match)}>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">{match.document.title} · L{match.line}</span>
              <span className="block truncate text-slate-500">{match.snippet}</span>
            </span>
            <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" />
          </button>
        )) : target ? filteredHeadings.slice(0, visible).map((heading) => (
          <button key={heading.slug} type="button" className={candidateButton} data-reference-result onClick={() => insert(heading.text, heading.slug)}>
            <Link2 className="h-4 w-4 shrink-0 text-blue-500" /><span className="truncate">{heading.text}</span>
          </button>
        )) : filteredFiles.slice(0, visible).map((item) => (
          <button key={item.id} type="button" className={candidateButton} data-reference-result
            onClick={() => {
              setTarget(item);
              setQuery('');
              setVisible(150);
              searchRef.current?.focus();
            }}>
            <FileText className="h-4 w-4 shrink-0 text-blue-500" />
            <span className="min-w-0 flex-1 truncate">{item.title}</span>
            {item.current && <span className="text-slate-500">{t('search.scopeCurrent')}</span>}
            <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" />
          </button>
        ))}
        {!pending && !error && count === 0 && <p className="px-2 text-slate-500">{t(mode === 'incoming' ? 'chapterLinks.noReferences' : 'search.noResults')}</p>}
        {count > visible && (
          <button type="button" className="rounded px-2 py-1 hover:bg-panel" onClick={() => setVisible((n) => n + 150)}>
            {t('search.showMore', { count: count - visible })}
          </button>
        )}
      </div>
    </WorkflowDialog>
  );
}
