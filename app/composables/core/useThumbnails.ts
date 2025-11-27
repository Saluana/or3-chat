/**
 * Efficient thumbnail loading with bulk prefetching and shared caching.
 *
 * Key optimizations:
 * - Uses getFileBlobsBulk and getFileMetaBulk for batch Dexie reads (2 transactions total)
 * - Deduplicates in-flight requests to prevent redundant DB hits
 * - Provides prefetch function for eager loading when thread opens
 * - Debounces prefetch queue to batch requests from multiple components
 */

import { getFileBlobsBulk, getFileMetaBulk } from '~/db/files';

export interface ThumbState {
    status: 'loading' | 'ready' | 'error';
    url?: string;
}

export interface PdfMeta {
    name?: string;
    kind: string;
}

// Global caches shared across all ChatMessage instances
const thumbCache = new Map<string, ThumbState>();
const thumbLoadPromises = new Map<string, Promise<void>>();
const thumbRefCounts = new Map<string, number>();
const thumbCleanupTimers = new Map<string, ReturnType<typeof setTimeout>>();
const pdfMetaCache = new Map<string, PdfMeta>();

// Batch prefetch queue - accumulates hashes for bulk loading
let prefetchQueue: Set<string> = new Set();
let prefetchTimer: ReturnType<typeof setTimeout> | null = null;
const PREFETCH_DEBOUNCE_MS = 16; // ~1 frame

/**
 * Retain a thumbnail reference to prevent cleanup.
 */
export function retainThumb(hash: string) {
    if (thumbCleanupTimers.has(hash)) {
        clearTimeout(thumbCleanupTimers.get(hash)!);
        thumbCleanupTimers.delete(hash);
    }
    const prev = thumbRefCounts.get(hash) || 0;
    thumbRefCounts.set(hash, prev + 1);
}

/**
 * Release a thumbnail reference. Schedules cleanup after grace period.
 */
export function releaseThumb(hash: string) {
    const prev = thumbRefCounts.get(hash) || 0;
    if (prev <= 1) {
        thumbRefCounts.set(hash, 0);
        if (!thumbCleanupTimers.has(hash)) {
            const timer = setTimeout(() => {
                thumbCleanupTimers.delete(hash);
                if ((thumbRefCounts.get(hash) || 0) > 0) return;

                thumbRefCounts.delete(hash);
                const state = thumbCache.get(hash);
                if (state?.url) {
                    try {
                        URL.revokeObjectURL(state.url);
                    } catch {
                        // Ignore revocation errors
                    }
                }
                thumbCache.delete(hash);
                thumbLoadPromises.delete(hash);
            }, 30000); // 30s grace period
            thumbCleanupTimers.set(hash, timer);
        }
    } else {
        thumbRefCounts.set(hash, prev - 1);
    }
}

/**
 * Get cached thumbnail state (does not trigger loading).
 */
export function peekThumb(hash: string): ThumbState | undefined {
    return thumbCache.get(hash);
}

/**
 * Get cached PDF metadata.
 */
export function peekPdfMeta(hash: string): PdfMeta | undefined {
    return pdfMetaCache.get(hash);
}

/**
 * Queue hashes for bulk prefetching. Actual fetch happens after debounce.
 * This allows multiple ChatMessage components mounting simultaneously
 * to batch their requests efficiently.
 */
export function queuePrefetch(hashes: string[]) {
    for (const h of hashes) {
        if (h && !thumbCache.has(h) && !pdfMetaCache.has(h)) {
            prefetchQueue.add(h);
        }
    }
    schedulePrefetchFlush();
}

function schedulePrefetchFlush() {
    if (prefetchTimer) return;
    prefetchTimer = setTimeout(flushPrefetch, PREFETCH_DEBOUNCE_MS);
}

async function flushPrefetch() {
    prefetchTimer = null;
    const hashes = Array.from(prefetchQueue);
    prefetchQueue = new Set();

    if (!hashes.length) return;

    // Filter out already loaded/loading
    const toLoad = hashes.filter(
        (h) =>
            !thumbCache.has(h) &&
            !pdfMetaCache.has(h) &&
            !thumbLoadPromises.has(h)
    );
    if (!toLoad.length) return;

    // Mark all as loading
    for (const h of toLoad) {
        thumbCache.set(h, { status: 'loading' });
    }

    // Create the loading promise
    const loadPromise = (async () => {
        try {
            // Batch load all blobs and metadata in parallel (2 bulk queries total)
            const [blobMap, metaMap] = await Promise.all([
                getFileBlobsBulk(toLoad),
                getFileMetaBulk(toLoad),
            ]);

            // Process each hash
            for (const h of toLoad) {
                const meta = metaMap.get(h);
                const blob = blobMap.get(h);

                // Check if it's a PDF
                if (meta?.kind === 'pdf' || blob?.type === 'application/pdf') {
                    pdfMetaCache.set(h, { name: meta?.name, kind: 'pdf' });
                    thumbCache.delete(h);
                    continue;
                }

                if (!blob) {
                    thumbCache.set(h, { status: 'error' });
                    continue;
                }

                // Create object URL for image
                const url = URL.createObjectURL(blob);
                thumbCache.set(h, { status: 'ready', url });
            }
        } catch (error) {
            // Mark all as error on batch failure
            for (const h of toLoad) {
                if (
                    !thumbCache.has(h) ||
                    thumbCache.get(h)?.status === 'loading'
                ) {
                    thumbCache.set(h, { status: 'error' });
                }
            }
            if (import.meta.dev) {
                console.warn('[useThumbnails] Batch prefetch failed:', error);
            }
        } finally {
            // Clean up promises
            for (const h of toLoad) {
                thumbLoadPromises.delete(h);
            }
        }
    })();

    // Store promise for deduplication
    for (const h of toLoad) {
        thumbLoadPromises.set(h, loadPromise);
    }

    await loadPromise;
}

/**
 * Ensure a single thumbnail is loaded. Used for on-demand loading
 * when prefetch wasn't used.
 */
export async function ensureThumb(
    hash: string,
    thumbnails: Record<string, ThumbState>,
    pdfMeta: Record<string, PdfMeta>
) {
    // Check PDF cache first
    const cachedPdf = pdfMetaCache.get(hash);
    if (cachedPdf) {
        pdfMeta[hash] = cachedPdf;
        return;
    }

    // Check thumb cache
    if (thumbnails[hash]?.status === 'ready') return;
    const cached = thumbCache.get(hash);
    if (cached) {
        if (cached.status === 'ready' || cached.status === 'error') {
            thumbnails[hash] = cached;
        }
        return;
    }

    // Wait for in-flight request
    if (thumbLoadPromises.has(hash)) {
        await thumbLoadPromises.get(hash);
        const after = thumbCache.get(hash);
        if (after) thumbnails[hash] = after;
        const afterPdf = pdfMetaCache.get(hash);
        if (afterPdf) pdfMeta[hash] = afterPdf;
        return;
    }

    // Single hash load
    thumbnails[hash] = { status: 'loading' };
    const p = (async () => {
        try {
            const [blobMap, metaMap] = await Promise.all([
                getFileBlobsBulk([hash]),
                getFileMetaBulk([hash]),
            ]);
            const blob = blobMap.get(hash);
            const meta = metaMap.get(hash);

            if (meta?.kind === 'pdf' || blob?.type === 'application/pdf') {
                pdfMetaCache.set(hash, { name: meta?.name, kind: 'pdf' });
                pdfMeta[hash] = { name: meta?.name, kind: 'pdf' };
                delete thumbnails[hash];
                return;
            }

            if (!blob) throw new Error('missing');

            const url = URL.createObjectURL(blob);
            const ready: ThumbState = { status: 'ready', url };
            thumbCache.set(hash, ready);
            thumbnails[hash] = ready;
        } catch {
            const err: ThumbState = { status: 'error' };
            thumbCache.set(hash, err);
            thumbnails[hash] = err;
        } finally {
            thumbLoadPromises.delete(hash);
        }
    })();

    thumbLoadPromises.set(hash, p);
    await p;
}

// Regex to extract file-hash references from markdown text
const FILE_HASH_RE = /file-hash:([a-f0-9]{6,})/gi;

/**
 * Prefetch all thumbnails for a thread's messages.
 * Call this when opening a thread to batch-load all images.
 * Extracts hashes from both file_hashes field and inline file-hash: references in content.
 */
export function prefetchThreadThumbnails(
    messages: Array<{
        file_hashes?: string | string[] | null;
        content?: string;
        text?: string;
        data?: { content?: string } | null;
    }>
) {
    const allHashes: string[] = [];

    for (const msg of messages) {
        // Extract from file_hashes field
        const hashes = msg.file_hashes;
        if (hashes) {
            if (typeof hashes === 'string') {
                // Parse comma-separated or JSON array
                try {
                    const parsed = JSON.parse(hashes);
                    if (Array.isArray(parsed)) {
                        allHashes.push(...parsed.filter(Boolean));
                    }
                } catch {
                    // Comma-separated fallback
                    allHashes.push(...hashes.split(',').filter(Boolean));
                }
            } else if (Array.isArray(hashes)) {
                allHashes.push(...hashes.filter(Boolean));
            }
        }

        // Also extract inline file-hash: references from text content
        // This catches any references that might be in the markdown but not in file_hashes
        const textContent = msg.text || msg.content || msg.data?.content || '';
        if (typeof textContent === 'string') {
            let match: RegExpExecArray | null;
            FILE_HASH_RE.lastIndex = 0; // Reset regex state
            while ((match = FILE_HASH_RE.exec(textContent)) !== null) {
                if (match[1]) {
                    allHashes.push(match[1]);
                }
            }
        }
    }

    if (allHashes.length > 0) {
        // Deduplicate before queueing
        const unique = [...new Set(allHashes)];
        queuePrefetch(unique);
    }
}

/**
 * Get the current thumb cache for synchronous access.
 */
export function getThumbCache(): Map<string, ThumbState> {
    return thumbCache;
}

/**
 * Clear all caches (for testing or memory pressure).
 */
export function clearAllThumbCaches() {
    // Revoke all URLs
    for (const state of thumbCache.values()) {
        if (state.url) {
            try {
                URL.revokeObjectURL(state.url);
            } catch {
                // Ignore
            }
        }
    }

    // Clear timers
    for (const timer of thumbCleanupTimers.values()) {
        clearTimeout(timer);
    }

    thumbCache.clear();
    thumbLoadPromises.clear();
    thumbRefCounts.clear();
    thumbCleanupTimers.clear();
    pdfMetaCache.clear();
    prefetchQueue.clear();
    if (prefetchTimer) {
        clearTimeout(prefetchTimer);
        prefetchTimer = null;
    }
}
