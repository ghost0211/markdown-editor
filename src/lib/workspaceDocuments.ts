import type { DocumentTab } from '@/types';
import { getFileNameFromPath, normalizeLineEndings, normalizePathKey } from '@/lib/documentUtils';
import { scanDocumentResources, replaceResourcePaths } from '@/lib/documentResources';
import { getDocumentDirectory } from '@/lib/imageAssets';

export interface WorkspaceContentChange { id: string; original: string; content: string }

export function movedWorkspacePath(path: string, oldPath: string, newPath: string): string | null {
  const key = normalizePathKey(path); const from = normalizePathKey(oldPath); const to = normalizePathKey(newPath);
  if (!key || !from) return null;
  if (key === to) return path === newPath ? null : newPath;
  if (key === from) return newPath;
  return key.startsWith(`${from}/`) ? `${newPath.replace(/[\\/]$/, '')}/${path.slice(oldPath.length + 1)}` : null;
}

function encodedFileUrl(path: string): URL {
  const normalized = path.replace(/\\/g, '/');
  const prefix = normalized.startsWith('//') ? 'file:' : 'file:///';
  const encoded = (normalized.startsWith('//') ? normalized : normalized.replace(/^\//, '')).split('/').map(encodeURIComponent).join('/');
  return new URL(prefix + encoded);
}

/** Relative URL for a moved resource, preserving literal #, %, spaces and Unicode. */
export function relativeWorkspaceResource(resourcePath: string, documentPath: string): string {
  const target = encodedFileUrl(resourcePath);
  const base = encodedFileUrl(`${getDocumentDirectory(documentPath)}/`);
  if (target.host.toLowerCase() !== base.host.toLowerCase()) return target.href;
  const destination = target.pathname.split('/').filter(Boolean).map(decodeURIComponent);
  const directory = base.pathname.split('/').filter(Boolean).map(decodeURIComponent);
  if (destination[0]?.toLowerCase() !== directory[0]?.toLowerCase() && /^[a-z]:$/i.test(destination[0] || '')) return target.href;
  let common = 0;
  while (common < destination.length && common < directory.length && destination[common].toLowerCase() === directory[common].toLowerCase()) common++;
  return `${'../'.repeat(directory.length - common)}${destination.slice(common).map(encodeURIComponent).join('/')}`;
}

/** Compute all buffer changes before changing any tab, so a failed scan is all-or-nothing. */
export function renameWorkspaceDocuments(tabs: readonly DocumentTab[], oldPath: string, newPath: string): {
  tabs: DocumentTab[];
  changes: WorkspaceContentChange[];
} {
  const changes: WorkspaceContentChange[] = [];
  const next = tabs.map((tab) => {
    if (tab.kind === 'diff') return tab;
    const destination = tab.filePath ? movedWorkspacePath(tab.filePath, oldPath, newPath) : null;
    let content = tab.content;
    if (tab.filePath && !tab.filePath.startsWith('browser://')) {
      const resources = scanDocumentResources(content, tab.filePath);
      const replacements = new Map<string, string>();
      for (const resource of resources) {
        if (!resource.localPath) continue;
        const moved = movedWorkspacePath(resource.localPath, oldPath, newPath);
        if (!moved) continue;
        const path = relativeWorkspaceResource(moved, destination || tab.filePath);
        if (path === resource.source) continue;
        const fragment = resource.source.indexOf('#');
        replacements.set(resource.id, path + (fragment === -1 ? '' : resource.source.slice(fragment)));
      }
      content = replaceResourcePaths(content, resources, replacements);
    }
    if (content !== tab.content) changes.push({ id: tab.id, original: tab.content, content });
    return {
      ...tab,
      filePath: destination || tab.filePath,
      title: destination ? getFileNameFromPath(destination) : tab.title,
      content,
      isDirty: normalizeLineEndings(content) !== normalizeLineEndings(tab.savedContent),
    };
  });
  return { tabs: next, changes };
}
