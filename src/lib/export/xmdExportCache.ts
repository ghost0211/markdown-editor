/**
 * Bounded LRU cache for already-generated XMD packages.
 *
 * The exporter keeps the previous ZIP so that a save which only changes the
 * Markdown body can reload the package and let JSZip reuse the compressed
 * `assets/*` entries instead of decoding every embedded image and DEFLATE
 * compressing it again. Only packages whose resources are all `data:` URLs are
 * ever cached (their bytes are fully determined by the URL), so local files and
 * network images are always read again and can never become stale.
 *
 * Memory tradeoff: the cached ZIP is held in the renderer together with the
 * exact cache key, which embeds the full `data:` URLs. Both are charged against
 * `maxBytes`; a single package larger than the budget is simply not cached.
 * The default therefore caps this optimization at 64 MiB, below the 128 MiB
 * maximum package size, and entries are evicted least-recently-used first.
 */

/** Default global budget for cached XMD packages. */
export const DEFAULT_XMD_EXPORT_CACHE_BYTES = 64 * 1024 * 1024;

/** Per-resource manifest metadata stored beside the cached ZIP bytes. */
export interface CachedXmdResource {
  path: string;
  mediaType: string;
  size: number;
}

export interface CachedXmdPackage {
  bytes: Uint8Array;
  resources: CachedXmdResource[];
}

export interface XmdExportCacheStats {
  entries: number;
  bytes: number;
  hits: number;
  misses: number;
}

export interface XmdExportCache {
  readonly maxBytes: number;
  readonly stats: XmdExportCacheStats;
  get(key: string): CachedXmdPackage | undefined;
  set(key: string, bytes: Uint8Array, resources: CachedXmdResource[], scope: string): void;
  delete(key: string): void;
  /** Releases every cached package belonging to one document. */
  deleteScope(scope: string): void;
  clear(): void;
}

interface CacheEntry extends CachedXmdPackage {
  key: string;
  scope: string;
  weight: number;
}

/** Rough UTF-16 + object overhead used to charge metadata against the budget. */
function metadataWeight(resources: readonly CachedXmdResource[]): number {
  let weight = 64;
  for (const resource of resources) {
    weight += (resource.path.length + resource.mediaType.length) * 2 + 48;
  }
  return weight;
}

export function createXmdExportCache(maxBytes = DEFAULT_XMD_EXPORT_CACHE_BYTES): XmdExportCache {
  if (!Number.isFinite(maxBytes) || maxBytes <= 0) {
    throw new Error('XMD export cache budget must be positive');
  }
  const entries = new Map<string, CacheEntry>();
  let usedBytes = 0;
  let hits = 0;
  let misses = 0;

  const remove = (entry: CacheEntry): void => {
    if (entries.get(entry.key) !== entry) return;
    entries.delete(entry.key);
    usedBytes -= entry.weight;
  };

  return {
    maxBytes,

    get stats(): XmdExportCacheStats {
      return { entries: entries.size, bytes: usedBytes, hits, misses };
    },

    get(key: string): CachedXmdPackage | undefined {
      const entry = entries.get(key);
      if (!entry) {
        misses++;
        return undefined;
      }
      // Refresh LRU position: Map iteration order is insertion order.
      entries.delete(key);
      entries.set(key, entry);
      hits++;
      return entry;
    },

    set(key: string, bytes: Uint8Array, resources: CachedXmdResource[], scope: string): void {
      const existing = entries.get(key);
      if (existing) remove(existing);
      const weight =
        bytes.byteLength + key.length * 2 + scope.length * 2 + metadataWeight(resources);
      // Never let one package exceed the whole budget: it would evict every
      // other entry and still leave no reusable room.
      if (weight > maxBytes || bytes.byteLength > maxBytes) return;

      const entry: CacheEntry = {
        key,
        scope,
        bytes,
        resources: resources.map((resource) => ({ ...resource })),
        weight,
      };
      entries.set(key, entry);
      usedBytes += weight;

      // Evict least-recently-used entries until the budget is respected.
      while (usedBytes > maxBytes) {
        const oldest = entries.values().next().value as CacheEntry | undefined;
        if (!oldest) break;
        remove(oldest);
      }
    },

    delete(key: string): void {
      const entry = entries.get(key);
      if (entry) remove(entry);
    },

    deleteScope(scope: string): void {
      for (const entry of [...entries.values()]) {
        if (entry.scope === scope) remove(entry);
      }
    },

    clear(): void {
      entries.clear();
      usedBytes = 0;
    },
  };
}
