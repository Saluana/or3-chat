import { subscribeActiveWorkspaceDb } from '~/db/client';
import {
    classifyFileBlob,
    isSupportedRasterMimeType,
} from '~~/shared/files/file-kind';

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
    epoch: number;
    pendingUrls: Set<string>;
    stopWorkspace?: () => void;
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
            epoch: 0,
            pendingUrls: new Set(),
        };
        const shared = g.__or3ThumbUrlCache;
        shared.stopWorkspace = subscribeActiveWorkspaceDb(() => {
            shared.epoch++;
            for (const timer of shared.cleanupTimers.values()) clearTimeout(timer);
            const urls = new Set(shared.pendingUrls);
            for (const state of shared.cache.values()) if (state.url) urls.add(state.url);
            for (const url of urls) {
                try { URL.revokeObjectURL(url); } catch { /* best-effort cleanup */ }
            }
            shared.pendingUrls.clear();
            shared.cache.clear();
            shared.inflight.clear();
            shared.refCounts.clear();
            shared.cleanupTimers.clear();
            shared.intrinsicSizes.clear();
        });
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
 * after a grace period to allow quick reuse within the current workspace.
 * Workspace changes revoke cached/pending URLs and discard old reads/decodes.
 *
 * Constraints:
 * - Object URLs are revoked when ref count drops to zero after the grace period
 *
 * Non-Goals:
 * - Does not persist thumbnails across reloads
 * - Only creates thumbnail URLs for verified raster image blobs
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
        if (!isSupportedRasterMimeType(blob.type) || typeof Image === 'undefined') {
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
        const epoch = globalCache.epoch;
        const current = () => epoch === globalCache.epoch;
        const cached = globalCache.cache.get(hash);
        if (cached) return cached;

        const inflight = globalCache.inflight.get(hash);
        if (inflight) {
            await inflight;
            return current() ? globalCache.cache.get(hash) : undefined;
        }

        const p = (async () => {
            let url: string | undefined;
            const discardUrl = () => {
                if (url && globalCache.pendingUrls.delete(url)) {
                    try { URL.revokeObjectURL(url); } catch { /* best-effort cleanup */ }
                }
            };
            try {
                const blob = await loader();
                if (!blob || !current()) return;
                url = URL.createObjectURL(blob);
                globalCache.pendingUrls.add(url);
                const classification = await classifyFileBlob(blob);
                if (!current()) { discardUrl(); return; }
                if (classification.kind !== 'image') {
                    discardUrl();
                    globalCache.cache.set(hash, { status: 'error' });
                    return;
                }
                await decodeImage(url, blob);
                if (!current()) { discardUrl(); return; }
                globalCache.pendingUrls.delete(url);
                const size = globalCache.intrinsicSizes.get(hash);
                globalCache.cache.set(hash, { status: 'ready', url, ...size });
            } catch {
                discardUrl();
                if (current()) globalCache.cache.set(hash, { status: 'error' });
            }
        })();

        globalCache.inflight.set(hash, p);
        await p;
        if (!current()) return undefined;
        // A discarded old load must not remove the next workspace's promise or
        // schedule cleanup against its current same-hash retention.
        if (globalCache.inflight.get(hash) === p) {
            globalCache.inflight.delete(hash);
            if ((globalCache.refCounts.get(hash) || 0) === 0) scheduleCleanup(hash);
        }
        return globalCache.cache.get(hash);
    };

    return { get, ensure, retain, release, setIntrinsicSize };
}
