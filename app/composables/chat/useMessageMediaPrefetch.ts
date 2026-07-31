import { getFileBlob, getFileMeta } from '~/db/files';
import { parseHashes } from '~/utils/files/attachments';
import { useThumbnailUrlCache } from '~/composables/core/useThumbnailUrlCache';

type MessageWithFiles = { file_hashes?: unknown };
type PrefetchRange = { startIndex: number; endIndex: number };

type ThumbnailCache = Pick<
    ReturnType<typeof useThumbnailUrlCache>,
    'get' | 'ensure' | 'retain' | 'release' | 'setIntrinsicSize'
>;

export interface MessageMediaPrefetchOptions {
    concurrency?: number;
    cache?: ThumbnailCache;
    loadMeta?: (hash: string) => Promise<
        | {
              kind?: string;
              mime_type?: string;
              width?: number;
              height?: number;
          }
        | undefined
    >;
    loadBlob?: (hash: string) => Promise<Blob | undefined>;
}

/**
 * Warms image blobs for a virtual range without mounting message rows.
 * Resources remain retained while their hashes are inside the latest range.
 */
export function createMessageMediaPrefetchController(
    options: MessageMediaPrefetchOptions = {}
) {
    const concurrency = Math.max(1, Math.floor(options.concurrency ?? 4));
    const cache = options.cache ?? useThumbnailUrlCache({ graceMs: 30_000 });
    const loadMeta = options.loadMeta ?? getFileMeta;
    const loadBlob = options.loadBlob ?? getFileBlob;
    let epoch = 0;
    let activeLoads = 0;
    let disposed = false;
    let desiredHashes = new Set<string>();
    const retainedHashes = new Set<string>();
    const queuedTokens = new Set<string>();
    const queue: Array<{ hash: string; epoch: number; token: string }> = [];
    const idleResolvers = new Set<() => void>();

    const notifyIdle = () => {
        if (activeLoads || queue.length) return;
        for (const resolve of idleResolvers) resolve();
        idleResolvers.clear();
    };

    const isImageMeta = (meta: Awaited<ReturnType<typeof loadMeta>>) => {
        if (!meta) return true;
        if (meta.kind) return meta.kind === 'image';
        return meta.mime_type?.startsWith('image/') ?? true;
    };

    const load = async (hash: string, taskEpoch: number) => {
        const meta = await loadMeta(hash).catch(() => undefined);
        if (
            disposed ||
            taskEpoch !== epoch ||
            !desiredHashes.has(hash) ||
            !isImageMeta(meta)
        ) {
            // Reset already releases the old epoch. Do not let a stale task
            // release a same-hash retention acquired by the current thread.
            if (
                taskEpoch === epoch &&
                retainedHashes.delete(hash)
            ) {
                cache.release(hash);
            }
            return;
        }
        cache.setIntrinsicSize(hash, meta?.width, meta?.height);
        await cache.ensure(hash, () => loadBlob(hash));
    };

    const pump = () => {
        while (!disposed && activeLoads < concurrency && queue.length) {
            const task = queue.shift();
            if (!task) break;
            queuedTokens.delete(task.token);
            if (task.epoch !== epoch || !desiredHashes.has(task.hash)) continue;
            activeLoads++;
            void load(task.hash, task.epoch).finally(() => {
                activeLoads--;
                pump();
                notifyIdle();
            });
        }
        notifyIdle();
    };

    const enqueue = (hash: string) => {
        if (cache.get(hash)?.status === 'ready') return;
        const token = `${epoch}:${hash}`;
        if (queuedTokens.has(token)) return;
        queuedTokens.add(token);
        queue.push({ hash, epoch, token });
    };

    const updateRange = (
        messages: readonly MessageWithFiles[],
        range: PrefetchRange
    ) => {
        if (disposed) return;
        const start = Math.max(0, Math.floor(range.startIndex));
        const end = Math.min(
            messages.length - 1,
            Math.max(start - 1, Math.floor(range.endIndex))
        );
        const next = new Set<string>();
        for (let index = start; index <= end; index++) {
            for (const hash of parseHashes(messages[index]?.file_hashes)) {
                next.add(hash);
            }
        }

        for (const hash of retainedHashes) {
            if (next.has(hash)) continue;
            retainedHashes.delete(hash);
            cache.release(hash);
        }
        desiredHashes = next;
        for (const hash of next) {
            if (!retainedHashes.has(hash)) {
                cache.retain(hash);
                retainedHashes.add(hash);
            }
            enqueue(hash);
        }
        pump();
    };

    const reset = () => {
        epoch++;
        desiredHashes.clear();
        queue.length = 0;
        queuedTokens.clear();
        for (const hash of retainedHashes) cache.release(hash);
        retainedHashes.clear();
        notifyIdle();
    };

    const dispose = () => {
        if (disposed) return;
        reset();
        disposed = true;
    };

    const whenIdle = () =>
        activeLoads === 0 && queue.length === 0
            ? Promise.resolve()
            : new Promise<void>((resolve) => idleResolvers.add(resolve));

    return { updateRange, reset, dispose, whenIdle };
}
