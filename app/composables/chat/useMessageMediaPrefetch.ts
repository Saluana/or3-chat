import { resizePreview } from '~/utils/files/resizePreview';
import { subscribeActiveWorkspaceDb } from '~/db/client';
import { getFileBlob, getFileMeta } from '~/db/files';
import { parseHashes } from '~/utils/files/attachments';
import { useThumbnailUrlCache } from '~/composables/core/useThumbnailUrlCache';
import { isSupportedRasterMimeType } from '~~/shared/files/file-kind';

type MessageWithFiles = { role?: string; file_hashes?: unknown };
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
 * Workspace changes reset queued work even when thread/hash IDs are unchanged.
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
    type Task = { hash: string; epoch: number };
    const tasks = new Map<string, Task>();
    const queue: Task[] = [];
    const idleResolvers = new Set<() => void>();

    const notifyIdle = () => {
        if (activeLoads || queue.length) return;
        for (const resolve of idleResolvers) resolve();
        idleResolvers.clear();
    };

    const isImageMeta = (meta: Awaited<ReturnType<typeof loadMeta>>) => {
        if (!meta) return false;
        if (meta.kind) {
            return (
                meta.kind === 'image' &&
                (!meta.mime_type || isSupportedRasterMimeType(meta.mime_type))
            );
        }
        return isSupportedRasterMimeType(meta.mime_type ?? '');
    };

    const load = async (task: Task) => {
        const { hash: key, epoch: taskEpoch } = task;
        const thumbnail = key.startsWith('attachment-thumb:');
        const hash = thumbnail ? key.slice('attachment-thumb:'.length) : key;
        const meta = await loadMeta(hash).catch(() => undefined);
        if (
            disposed ||
            taskEpoch !== epoch ||
            tasks.get(key) !== task ||
            !desiredHashes.has(key) ||
            !isImageMeta(meta)
        ) {
            // Reset already releases the old epoch. Do not let a stale task
            // release a same-hash retention acquired by the current thread.
            if (
                taskEpoch === epoch &&
                tasks.get(key) === task &&
                retainedHashes.delete(key)
            ) {
                cache.release(key);
            }
            return;
        }
        cache.setIntrinsicSize(key, meta?.width, meta?.height);
        await cache.ensure(key, async (current, signal) => {
            const blob = await loadBlob(hash);
            return blob && thumbnail ? resizePreview(blob, 160, current, undefined, signal) : blob;
        });
    };

    const pump = () => {
        while (!disposed && activeLoads < concurrency && queue.length) {
            const task = queue.shift();
            if (!task) break;
            if (task.epoch !== epoch || tasks.get(task.hash) !== task || !desiredHashes.has(task.hash)) {
                continue;
            }
            activeLoads++;
            void load(task).finally(() => {
                activeLoads--;
                if (tasks.get(task.hash) === task) tasks.delete(task.hash);
                pump();
                notifyIdle();
            });
        }
        notifyIdle();
    };

    const enqueue = (hash: string) => {
        if (cache.get(hash)?.status === 'ready') return;
        if (tasks.has(hash)) return;
        const task = { hash, epoch };
        tasks.set(hash, task);
        queue.push(task);
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
            const message = messages[index];
            const hashes = parseHashes(message?.file_hashes);
            for (const hash of message?.role === 'assistant' ? hashes : hashes.slice(0, 4)) {
                next.add(message?.role === 'assistant' ? hash : `attachment-thumb:${hash}`);
            }
        }

        for (const hash of retainedHashes) {
            if (next.has(hash)) continue;
            retainedHashes.delete(hash);
            tasks.delete(hash);
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
        tasks.clear();
        for (const hash of retainedHashes) cache.release(hash);
        retainedHashes.clear();
        notifyIdle();
    };

    const stopWorkspace = subscribeActiveWorkspaceDb(() => {
        // The default shared cache cleared old references before this listener.
        // Releasing them now could decrement a consumer retained in the new DB.
        if (!options.cache) retainedHashes.clear();
        reset();
    });

    const dispose = () => {
        if (disposed) return;
        stopWorkspace();
        reset();
        disposed = true;
    };

    const whenIdle = () =>
        activeLoads === 0 && queue.length === 0
            ? Promise.resolve()
            : new Promise<void>((resolve) => idleResolvers.add(resolve));

    return { updateRange, reset, dispose, whenIdle };
}
