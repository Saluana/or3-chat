import type { PreviewCacheOptions } from '~/config/preview-cache';
import { resolvePreviewCacheOptions } from '~/config/preview-cache';

export type { PreviewCacheOptions } from '~/config/preview-cache';

export interface PreviewCacheMetrics {
    urls: number;
    bytes: number;
    hits: number;
    misses: number;
    evictions: number;
}

interface CacheEntry {
    url: string;
    bytes: number;
    lastAccess: number;
    pin: number;
}

type LoaderResult = { url: string; bytes?: number };
type Loader = () => Promise<unknown>;
function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object';
}

/**
 * `usePreviewCache`
 *
 * Purpose:
 * Manages preview object URLs with LRU eviction and pinning.
 *
 * Behavior:
 * Tracks hit and miss metrics, evicts unpinned entries by LRU, and revokes
 * object URLs when entries are removed.
 *
 * Constraints:
 * - Callers must release URLs via `drop` or `flushAll` when finished
 * - Loader results must include a non-empty `url`
 *
 * Non-Goals:
 * - Does not persist cache across reloads
 * - Does not handle cache partitioning by workspace
 *
 * @example
 * ```ts
 * const cache = usePreviewCache();
 * const url = await cache.ensure('thumb:abc', async () => {
 *   const blob = await fetch('/api/thumbs/abc').then((res) => res.blob());
 *   return { url: URL.createObjectURL(blob), bytes: blob.size };
 * });
 * ```
 */
export function usePreviewCache(opts: Partial<PreviewCacheOptions> = {}) {
    const options: PreviewCacheOptions = resolvePreviewCacheOptions(opts);

    const map = new Map<string, CacheEntry>();
    let totalBytes = 0;
    let hits = 0;
    let misses = 0;
    let evictions = 0;

    let accessCounter = 0;

    function metrics(): PreviewCacheMetrics {
        return {
            urls: map.size,
            bytes: totalBytes,
            hits,
            misses,
            evictions,
        };
    }

    function logMetrics(stage: string) {
        if (!import.meta.dev) return;
        const m = metrics();
        console.info('[preview-cache]', stage, {
            urls: m.urls,
            bytes: m.bytes,
            hits: m.hits,
            misses: m.misses,
            evictions: m.evictions,
            maxUrls: options.maxUrls,
            maxBytes: options.maxBytes,
        });
    }

    async function ensure(
        key: string,
        loader: Loader,
        pin = 0
    ): Promise<string | undefined> {
        const existing = map.get(key);
        if (existing) {
            existing.lastAccess = ++accessCounter;
            existing.pin = Math.max(existing.pin, pin);
            hits++;
            return existing.url;
        }

        misses++;
        
        try {
            const result = await loader();
            
            // Validate loader result
            if (!isRecord(result)) {
                throw new Error('Loader returned invalid result: expected object');
            }
            if (typeof result.url !== 'string' || !result.url) {
                throw new Error(
                    'Loader returned invalid url: expected non-empty string'
                );
            }
            
            const url = result.url;
            const normalizedBytes = Number.isFinite(result.bytes)
                ? Number(result.bytes)
                : 0;
            
            // Only mutate state after successful validation
            const entry: CacheEntry = {
                url,
                bytes: normalizedBytes,
                lastAccess: ++accessCounter,
                pin,
            };
            
            map.set(key, entry);
            totalBytes += normalizedBytes;
            evictIfNeeded();
            
            return entry.url;
        } catch (error) {
            // Decrement misses since this didn't result in a cache entry
            misses--;
            
            if (import.meta.dev) {
                console.error('[preview-cache] Loader failed for key:', key, error);
            }
            
            throw error;
        }
    }

    function promote(key: string, pin = 1) {
        const entry = map.get(key);
        if (!entry) return;
        entry.lastAccess = ++accessCounter;
        entry.pin = Math.max(entry.pin, pin);
    }

    function release(key: string) {
        const entry = map.get(key);
        if (!entry) return;
        entry.pin = Math.max(0, entry.pin - 1);
        entry.lastAccess = ++accessCounter;
    }

    function remove(key: string) {
        const entry = map.get(key);
        if (!entry) return undefined;
        map.delete(key);
        totalBytes -= entry.bytes;
        try {
            URL.revokeObjectURL(entry.url);
        } catch (error) {
            if (import.meta.dev) {
                console.error('[preview-cache] revoke failed', error);
            }
        }
        return entry;
    }

    function drop(key: string): boolean {
        const entry = remove(key);
        if (!entry) return false;
        logMetrics('drop');
        return true;
    }

    function evictIfNeeded(stage = 'evict'): string[] {
        if (map.size <= options.maxUrls && totalBytes <= options.maxBytes) {
            return [];
        }
        // Optimization: filter unpinned entries first, then sort
        // This is O(k) where k = unpinned count, rather than O(n) sorting all entries
        const unpinned: [string, CacheEntry][] = [];
        for (const [key, entry] of map) {
            if (entry.pin <= 0) {
                unpinned.push([key, entry]);
            }
        }
        // Sort only unpinned entries by LRU
        unpinned.sort((a, b) => a[1].lastAccess - b[1].lastAccess);

        const removed: string[] = [];
        for (const [key] of unpinned) {
            if (map.size <= options.maxUrls && totalBytes <= options.maxBytes) {
                break;
            }
            const entry = map.get(key);
            if (!entry) continue;
            remove(key);
            evictions++;
            removed.push(key);
        }
        if (removed.length) logMetrics(stage);
        return removed;
    }

    function flushAll(): string[] {
        const removed: string[] = [];
        for (const key of Array.from(map.keys())) {
            const entry = remove(key);
            if (entry) removed.push(key);
        }
        if (removed.length) logMetrics('flush');
        return removed;
    }

    function peek(key: string): string | undefined {
        return map.get(key)?.url;
    }

    return {
        ensure,
        promote,
        release,
        flushAll,
        evictIfNeeded,
        metrics,
        options,
        logMetrics,
        peek,
        drop,
    };
}

type PreviewCacheInstance = ReturnType<typeof usePreviewCache>;

let sharedCache: PreviewCacheInstance | null = null;
let sharedOptions: PreviewCacheOptions | null = null;

/**
 * `useSharedPreviewCache`
 *
 * Purpose:
 * Provides a shared preview cache instance for the app.
 *
 * Behavior:
 * Initializes once and reuses the same cache. In dev mode, logs when callers
 * attempt to change cache sizing after initialization.
 *
 * Constraints:
 * - Configuration is locked after the first call
 *
 * Non-Goals:
 * - Does not merge or reconcile options across callers
 *
 * @example
 * ```ts
 * const cache = useSharedPreviewCache({ maxUrls: 200 });
 * ```
 */
export function useSharedPreviewCache(
    overrides?: Partial<PreviewCacheOptions>
) {
    if (!sharedCache) {
        sharedCache = usePreviewCache(overrides);
        sharedOptions = sharedCache.options;
    } else if (
        import.meta.dev &&
        overrides &&
        Object.keys(overrides).length &&
        sharedOptions
    ) {
        const next = resolvePreviewCacheOptions(overrides);
        const mismatch =
            next.maxUrls !== sharedOptions.maxUrls ||
            next.maxBytes !== sharedOptions.maxBytes;
        if (mismatch) {
            console.info(
                '[preview-cache] shared cache already initialized; overrides ignored',
                {
                    current: sharedOptions,
                    requested: next,
                }
            );
        }
    }
    return sharedCache;
}

/**
 * `resetSharedPreviewCache`
 *
 * Purpose:
 * Clears the shared preview cache instance.
 *
 * Behavior:
 * Flushes entries and resets shared options.
 *
 * Constraints:
 * - Intended for tests or hot reload cleanup
 *
 * Non-Goals:
 * - Does not preserve any cached entries
 *
 * @example
 * ```ts
 * resetSharedPreviewCache();
 * ```
 */
export function resetSharedPreviewCache() {
    if (!sharedCache) return;
    sharedCache.flushAll();
    sharedCache = null;
    sharedOptions = null;
}
