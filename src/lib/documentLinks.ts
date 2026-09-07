import { defaultUrlTransform } from 'react-markdown';

/** Preserve local file destinations without allowing executable URL schemes. */
export function documentUrlTransform(url: string): string {
  if (/^(?:[a-z]:[/\\]|file:\/\/)/i.test(url)) return url;
  return defaultUrlTransform(url);
}

/** Resolve a Markdown destination against the source document, never the app URL. */
export function resolveDocumentLink(href: string, sourcePath?: string | null): { path: string; anchor: string } | null {
  if (/^[a-z][a-z\d+.-]*:/i.test(href) && !/^(?:[a-z]:[/\\]|file:\/\/)/i.test(href)) return null;
  if (href.startsWith('#')) return null;
  const normalized = href.replace(/\\/g, '/');
  let target: URL;
  if (/^file:\/\//i.test(normalized)) {
    target = new URL(normalized);
  } else {
    const absolute = /^(?:[a-z]:\/|\/)/i.test(normalized);
    if (!absolute && (!sourcePath || sourcePath.startsWith('browser://'))) {
      throw new Error('请先保存当前文档，再打开相对路径链接。 / Save this document before opening relative links.');
    }
    const source = (sourcePath || '/').replace(/\\/g, '/');
    const base = source.startsWith('//') ? `file:${source}` : `file:///${source.replace(/^\//, '')}`;
    // Encode the base path so literal # and % in directory names remain intact.
    const baseUrl = base.split('/').map((part, i) => i < 3 ? part : encodeURIComponent(part).replace(/%3A/gi, ':')).join('/');
    target = new URL(/^[a-z]:\//i.test(normalized) ? `file:///${normalized}` : normalized, baseUrl);
  }
  let path = decodeURIComponent(target.pathname);
  if (/^\/[a-z]:\//i.test(path)) path = path.slice(1);
  if (target.hostname && target.hostname !== 'localhost') path = `//${target.hostname}${path}`;
  return { path, anchor: target.hash.slice(1) };
}
