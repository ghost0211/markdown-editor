import type { SearchTabInput } from '@/lib/documentSearch';
import { normalizeLineEndings, normalizePathKey } from '@/lib/documentUtils';
import { readWorkspaceSearchSources } from '@/lib/native';
import { workspaceEntryAbsolutePath, workspaceRelativeFromAbsolute } from '@/lib/workspace';

export interface WorkspaceSearchSourceListing {
  root: string;
  sources: { path: string; content?: string; archive?: number[] }[];
  skipped: number;
  truncated: boolean;
}

export interface WorkspaceSearchDocument extends SearchTabInput {
  filePath: string;
}

export interface WorkspaceSearchSnapshot {
  root: string;
  documents: WorkspaceSearchDocument[];
  skipped: number;
  truncated: boolean;
}

const XMD_SEARCH_BYTES = 2 * 1024 * 1024;
const SEARCH_TEXT_LIMIT = 24 * 1024 * 1024;

export async function loadWorkspaceSearch(root: string, signal: AbortSignal): Promise<WorkspaceSearchSnapshot> {
  const listing = await readWorkspaceSearchSources(root);
  const documents: WorkspaceSearchDocument[] = [];
  let remaining = SEARCH_TEXT_LIMIT;
  let skipped = listing.skipped;
  for (const source of listing.sources) {
    signal.throwIfAborted();
    const filePath = workspaceEntryAbsolutePath(listing.root, source.path);
    let content = source.content;
    if (filePath && source.archive && remaining > 0) {
      try {
        const { importXmd } = await import('@/lib/xmd');
        content = await importXmd(Uint8Array.from(source.archive), {
          maxEntryBytes: XMD_SEARCH_BYTES,
          maxTotalBytes: XMD_SEARCH_BYTES,
        });
      } catch {
        // Invalid or oversized archives count as skipped just like invalid UTF-8.
      }
    }
    if (!filePath || content === undefined || content.length > remaining) {
      skipped++;
      continue;
    }
    content = normalizeLineEndings(content);
    remaining -= content.length;
    documents.push({ id: normalizePathKey(filePath), title: source.path, content, filePath });
  }
  signal.throwIfAborted();
  return { root: listing.root, documents, skipped, truncated: listing.truncated };
}

export function workspaceSearchDocuments(
  snapshot: WorkspaceSearchSnapshot,
  tabs: readonly SearchTabInput[]
): WorkspaceSearchDocument[] {
  const documents = new Map(snapshot.documents.map((doc) => [doc.id, doc]));
  for (const tab of tabs) {
    if (tab.kind === 'diff' || !tab.filePath) continue;
    const relative = workspaceRelativeFromAbsolute(snapshot.root, tab.filePath);
    if (!relative) continue;
    const id = normalizePathKey(tab.filePath);
    documents.set(id, {
      id,
      filePath: tab.filePath,
      title: documents.get(id)?.title ?? relative,
      content: tab.content,
    });
  }
  return [...documents.values()];
}
