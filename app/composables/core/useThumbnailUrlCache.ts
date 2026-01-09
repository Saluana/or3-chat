export interface ThumbState {
    status: 'ready' | 'error';
    url?: string;
}

type GlobalThumbCache = {
    cache: Map<string, ThumbState>;
    inflight: Map<string, Promise<void>>;
    refCounts: Map<string, number>;
    cleanupTimers: Map<string, ReturnType<typeof setTimeout>>;
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
            graceMs,
        };
    } else {
        g.__or3ThumbUrlCache.graceMs = graceMs;
    }
    return g.__or3ThumbUrlCache;
}

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
                globalCache.cache.set(hash, { status: 'ready', url });
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

    return { get, ensure, retain, release };
}
