import { buildLineStarts, formatSearchSnippet, offsetToLineColumn, TOTAL_MATCH_LIMIT } from '@/lib/documentSearch';
import { resolveDocumentLink } from '@/lib/documentLinks';
import { normalizePathKey } from '@/lib/documentUtils';
import { relativeWorkspaceResource } from '@/lib/workspaceDocuments';
import { scanXmdReferences } from '@/lib/xmdPackage';
import { escapeMarkdownLabel } from '@/lib/clipboardMarkdown';

export interface ReferenceDocument {
  id: string;
  filePath: string | null;
  title: string;
  content: string;
}

export interface ChapterBacklink {
  document: Pick<ReferenceDocument, 'id' | 'filePath' | 'title'>;
  slug: string;
  line: number;
  from: number;
  to: number;
  snippet: string;
}

export function markdownChapterLink(
  source: string | null, target: string | null, label: string, slug: string, sameDocument: boolean
): string | null {
  if (!sameDocument && (!source || !target || source.startsWith('browser://'))) return null;
  const path = sameDocument ? '' : relativeWorkspaceResource(target!, source!);
  const encoded = (path + (slug ? '#' + encodeURIComponent(slug) : '')).replace(/[()]/g, (value) => value === '(' ? '%28' : '%29');
  if (!encoded) return null;
  const title = escapeMarkdownLabel(label.replace(/\s+/g, ' ').trim());
  return '[' + (title || slug) + '](' + encoded + ')';
}

function decodeFragment(value: string): string {
  try { return decodeURIComponent(value); } catch { return value; }
}

export function documentBacklinks(
  target: ReferenceDocument, sources: readonly ReferenceDocument[], limit = TOTAL_MATCH_LIMIT
): ChapterBacklink[] {
  if (limit <= 0) return [];
  const targetKey = normalizePathKey(target.filePath);
  const result: ChapterBacklink[] = [];
  for (const document of sources) {
    const identity = { id: document.id, title: document.title, filePath: document.filePath };
    const sameDocument = document.id === target.id || Boolean(targetKey && normalizePathKey(document.filePath) === targetKey);
    const lines = buildLineStarts(document.content);
    for (const reference of scanXmdReferences(document.content).references) {
      if (reference.image) continue;
      let anchor: string;
      if (reference.source.startsWith('#')) {
        if (!sameDocument) continue;
        anchor = reference.source.slice(1);
      } else {
        try {
          const resolved = resolveDocumentLink(reference.source, document.filePath);
          if (!resolved || !targetKey || normalizePathKey(resolved.path) !== targetKey) continue;
          anchor = resolved.anchor;
        } catch { continue; }
      }
      const { from, to } = reference.target;
      const definitionLine = offsetToLineColumn(document.content, lines, from).line;
      for (const line of new Set(reference.usageLines ?? [definitionLine])) {
        const start = line === definitionLine ? from : lines[line - 1] ?? from;
        const end = line === definitionLine ? to : start;
        const snippet = formatSearchSnippet(document.content, start, end);
        result.push({ document: identity, slug: decodeFragment(anchor), line, from: start, to: end,
          snippet: (snippet.before + snippet.match + snippet.after).replace(/\s+/g, ' ').trim() });
        if (result.length >= limit) return result;
      }
    }
  }
  return result;
}
