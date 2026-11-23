import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { FileText, Search } from 'lucide-react';
import { useI18n } from '@/i18n';
import { WorkflowDialog } from './WorkflowDialog';
import { normalizePathKey } from '@/lib/documentUtils';
import { workspaceEntryAbsolutePath, type WorkspaceListing } from '@/lib/workspace';
import type { RecentFile } from '@/lib/recentFiles';
import type { DocumentTab } from '@/types';

export interface QuickOpenEntry {
  key: string;
  name: string;
  path?: string;
  detail?: string;
  tabId?: string;
}

export function quickOpenEntries(tabs: readonly DocumentTab[], recent: readonly RecentFile[], listing?: WorkspaceListing | null): QuickOpenEntry[] {
  const entries = new Map<string, QuickOpenEntry>();
  for (const file of recent) {
    const key = normalizePathKey(file.path);
    if (key) entries.set(key, { key, name: file.name, path: file.path, detail: file.path });
  }
  for (const tab of tabs) {
    if (tab.kind === 'diff') continue;
    const key = normalizePathKey(tab.filePath) || 'tab:' + tab.id;
    entries.set(key, { key, name: tab.title, path: tab.filePath ?? undefined, detail: tab.filePath ?? undefined, tabId: tab.id });
  }
  for (const file of listing?.entries ?? []) {
    if (!listing || file.kind !== 'document') continue;
    const path = workspaceEntryAbsolutePath(listing.root, file.path);
    const key = normalizePathKey(path);
    if (!path || !key) continue;
    const existing = entries.get(key);
    entries.set(key, { key, name: file.name, path, detail: file.path, tabId: existing?.tabId });
  }
  return [...entries.values()];
}

function filterEntries(entries: QuickOpenEntry[], query: string) {
  const terms = query.trim().toLowerCase().replaceAll('\\', '/').split(/\s+/).filter(Boolean);
  if (!terms.length) return entries.slice(0, 100);
  const matches = entries.flatMap((entry) => {
    const name = entry.name.toLowerCase();
    const path = (entry.detail ?? '').replaceAll('\\', '/').toLowerCase();
    if (!terms.every((term) => name.includes(term) || path.includes(term))) return [];
    const score = terms.reduce((sum, term) => sum + (name.startsWith(term) ? 0 : name.includes(term) ? 1 : 2), 0);
    return [{ entry, score }];
  });
  return matches.sort((a, b) => a.score - b.score).slice(0, 100).map(({ entry }) => entry);
}

export function QuickOpenDialog({ tabs, recent, listing, busy, onOpen, onClose }: {
  tabs: readonly DocumentTab[];
  recent: readonly RecentFile[];
  listing: WorkspaceListing | null;
  busy: boolean;
  onOpen: (entry: QuickOpenEntry) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const entries = useMemo(() => quickOpenEntries(tabs, recent, listing), [tabs, recent, listing]);
  const results = useMemo(() => filterEntries(entries, query), [entries, query]);
  const active = Math.min(index, Math.max(0, results.length - 1));
  const current = results[active];
  useEffect(() => { input.current?.focus(); }, []);
  useEffect(() => { list.current?.children[active]?.scrollIntoView({ block: 'nearest' }); }, [active, current?.key]);
  return (
    <WorkflowDialog title={t('quickOpen.title')} onClose={onClose}>
      <div className="flex items-center gap-2 border-b border-slate-200 px-4 dark:border-slate-700">
        <Search size={16} aria-hidden className="text-slate-400" />
        <input ref={input} role="combobox" aria-expanded="true" aria-controls={id} aria-autocomplete="list"
          aria-activedescendant={current ? id + '-' + active : undefined}
          aria-label={t('quickOpen.query')} placeholder={t('quickOpen.query')}
          className="w-full bg-transparent py-3 text-sm outline-none" value={query}
          onChange={(event) => { setQuery(event.target.value); setIndex(0); }}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return;
            if (event.key === 'Enter' && current) { event.preventDefault(); onOpen(current); }
            if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
              event.preventDefault();
              setIndex(Math.min(Math.max(0, active + (event.key === 'ArrowDown' ? 1 : -1)), Math.max(0, results.length - 1)));
            }
          }} />
      </div>
      <ul ref={list} id={id} role="listbox" aria-label={t('quickOpen.title')} className="min-h-24 max-h-[55vh] overflow-auto p-2">
        {results.map((entry, i) => (
          <li key={entry.key} id={id + '-' + i} role="option" aria-selected={i === active}
            className={'flex cursor-pointer items-center gap-2 rounded px-3 py-1.5 text-sm ' + (i === active ? 'bg-blue-100 dark:bg-blue-950' : 'hover:bg-panel')}
            onMouseDown={(event) => event.preventDefault()} onMouseMove={() => setIndex(i)} onClick={() => onOpen(entry)}>
            <FileText size={15} aria-hidden className="shrink-0 text-slate-500" />
            <span className="truncate">{entry.name}</span>
            {entry.detail && <span className="ml-auto truncate text-xs text-slate-500" title={entry.detail}>{entry.detail}</span>}
          </li>
        ))}
      </ul>
      {!results.length && <p role="status" className="px-4 pb-4 text-sm text-slate-500">{t(busy ? 'quickOpen.loading' : 'quickOpen.empty')}</p>}
      {listing?.truncated && <p className="px-4 pb-3 text-xs text-slate-500">{t('quickOpen.truncated')}</p>}
    </WorkflowDialog>
  );
}
