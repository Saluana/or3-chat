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
type Loader = () => Promise<LoaderResult>;

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
        const { url, bytes } = await loader();
        const normalizedBytes = Number.isFinite(bytes) ? Number(bytes) : 0;
        map.set(key, {
            url,
            bytes: normalizedBytes,
            lastAccess: ++accessCounter,
            pin,
        });
        totalBytes += normalizedBytes;
        evictIfNeeded();
        return map.get(key)?.url;
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
        const entries = Array.from(map.entries());
        entries.sort((a, b) => {
            const pinDiff = (a[1].pin || 0) - (b[1].pin || 0);
            if (pinDiff !== 0) return pinDiff;
            return a[1].lastAccess - b[1].lastAccess;
        });
        const removed: string[] = [];
        for (const [key] of entries) {
            if (map.size <= options.maxUrls && totalBytes <= options.maxBytes) {
                break;
            }
            const entry = map.get(key);
            if (!entry || entry.pin > 0) continue;
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

export function resetSharedPreviewCache() {
    if (!sharedCache) return;
    sharedCache.flushAll();
    sharedCache = null;
    sharedOptions = null;
}
