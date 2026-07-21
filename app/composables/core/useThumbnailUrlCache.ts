export interface ThumbState {
    status: 'ready' | 'error';
    url?: string;
    width?: number;
    height?: number;
}

export interface ThumbIntrinsicSize {
    width: number;
    height: number;
}

type GlobalThumbCache = {
    cache: Map<string, ThumbState>;
    inflight: Map<string, Promise<void>>;
    refCounts: Map<string, number>;
    cleanupTimers: Map<string, ReturnType<typeof setTimeout>>;
    intrinsicSizes: Map<string, ThumbIntrinsicSize>;
    graceMs: number;
};

type GlobalWithThumbCache = typeof globalThis & {
    __or3ThumbUrlCache?: GlobalThumbCache;
};

function getGlobalCache(graceMs: number): GlobalThumbCache {
    const g = globalThis as GlobalWithThumbCache;
    if (!g.__or3ThumbUrlCache) {
        g.__or3ThumbUrlCache = {
            cache: new Map<string, ThumbState>(),
            inflight: new Map<string, Promise<void>>(),
            refCounts: new Map<string, number>(),
            cleanupTimers: new Map<string, ReturnType<typeof setTimeout>>(),
            intrinsicSizes: new Map<string, ThumbIntrinsicSize>(),
            graceMs,
        };
    } else {
        g.__or3ThumbUrlCache.graceMs = graceMs;
    }
    return g.__or3ThumbUrlCache;
}

/**
 * `useThumbnailUrlCache`
 *
 * Purpose:
 * Provides a shared cache for thumbnail object URLs.
 *
 * Behavior:
 * Deduplicates inflight loads, tracks reference counts, and schedules cleanup
 * after a grace period to allow quick reuse.
 *
 * Constraints:
 * - Object URLs are revoked when ref count drops to zero after the grace period
 *
 * Non-Goals:
 * - Does not persist thumbnails across reloads
 * - Does not validate blob contents
 *
 * @example
 * ```ts
 * const cache = useThumbnailUrlCache();
 * cache.retain(hash);
 * const state = await cache.ensure(hash, () => fetch(url).then((r) => r.blob()));
 * cache.release(hash);
 * ```
 */
export function useThumbnailUrlCache(opts: { graceMs?: number } = {}) {
    const graceMs = opts.graceMs ?? 30_000;
    const globalCache = getGlobalCache(graceMs);

    const scheduleCleanup = (hash: string) => {
        if (globalCache.cleanupTimers.has(hash)) return;
        const timer = setTimeout(() => {
            globalCache.cleanupTimers.delete(hash);
            if ((globalCache.refCounts.get(hash) || 0) > 0) return;

            globalCache.refCounts.delete(hash);
            const state = globalCache.cache.get(hash);
            if (state?.url) {
                try {
                    URL.revokeObjectURL(state.url);
                } catch {
                    /* noop */
                }
            }
            globalCache.cache.delete(hash);
            globalCache.inflight.delete(hash);
            globalCache.intrinsicSizes.delete(hash);
        }, globalCache.graceMs);
        globalCache.cleanupTimers.set(hash, timer);
    };

    const retain = (hash: string) => {
        const timer = globalCache.cleanupTimers.get(hash);
        if (timer) {
            clearTimeout(timer);
            globalCache.cleanupTimers.delete(hash);
        }
        const prev = globalCache.refCounts.get(hash) || 0;
        globalCache.refCounts.set(hash, prev + 1);
    };

    const release = (hash: string) => {
        const prev = globalCache.refCounts.get(hash) || 0;
        if (prev <= 1) {
            globalCache.refCounts.set(hash, 0);
            scheduleCleanup(hash);
        } else {
            globalCache.refCounts.set(hash, prev - 1);
        }
    };

    const get = (hash: string): ThumbState | undefined =>
        globalCache.cache.get(hash);

    const setIntrinsicSize = (
        hash: string,
        width: number | undefined,
        height: number | undefined
    ) => {
        if (!width || !height || width <= 0 || height <= 0) return;
        const size = { width, height };
        globalCache.intrinsicSizes.set(hash, size);
        const state = globalCache.cache.get(hash);
        if (state) Object.assign(state, size);
    };

    const decodeImage = async (url: string, blob: Blob) => {
        if (!blob.type.startsWith('image/') || typeof Image === 'undefined') {
            return;
        }
        const image = new Image();
        image.src = url;
        if (typeof image.decode === 'function') await image.decode();
    };

    const ensure = async (
        hash: string,
        loader: () => Promise<Blob | null | undefined>
    ): Promise<ThumbState | undefined> => {
        const cached = globalCache.cache.get(hash);
        if (cached) return cached;

        const inflight = globalCache.inflight.get(hash);
        if (inflight) {
            await inflight;
            return globalCache.cache.get(hash);
        }

        const p = (async () => {
            try {
                const blob = await loader();
                if (!blob) return;
                const url = URL.createObjectURL(blob);
                try {
                    await decodeImage(url, blob);
                } catch {
                    URL.revokeObjectURL(url);
                    globalCache.cache.set(hash, { status: 'error' });
                    return;
                }
                const size = globalCache.intrinsicSizes.get(hash);
                globalCache.cache.set(hash, {
                    status: 'ready',
                    url,
                    ...size,
                });
            } catch {
                globalCache.cache.set(hash, { status: 'error' });
            } finally {
                globalCache.inflight.delete(hash);
                if ((globalCache.refCounts.get(hash) || 0) === 0) {
                    scheduleCleanup(hash);
                }
            }
        })();

        globalCache.inflight.set(hash, p);
        await p;
        return globalCache.cache.get(hash);
    };

    return { get, ensure, retain, release, setIntrinsicSize };
}
