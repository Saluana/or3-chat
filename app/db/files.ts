import { getDb } from './client';
import { useHooks } from '../core/hooks/useHooks';
import { parseOrThrow, nowSec, nextClock } from './util';
import { FileMetaCreateSchema, FileMetaSchema, type FileMeta } from './schema';
import { computeFileHash } from '../utils/hash';
import { reportError, err } from '../utils/errors';
import type {
    DbCreatePayload,
    DbDeletePayload,
    FileEntity,
} from '../core/hooks/hook-types';

/**
 * File storage and deduplication layer with hook integration.
 *
 * Hook Points:
 * - `db.files.create:filter:input` - Transform FileMetaCreate before validation (line 86-89)
 * - `db.files.create:action:before` - Called before file metadata is written to DB (line 93)
 * - `db.files.create:action:after` - Called after file metadata and blob are persisted (line 96)
 * - `db.files.get:filter:output` - Transform FileMeta on retrieval (line 114)
 * - `db.files.refchange:action:after` - Called after ref_count changes (line 28-32)
 * - `db.files.delete:action:soft:before` - Called before soft delete (line 129, 150)
 * - `db.files.delete:action:soft:after` - Called after soft delete (line 135, 156)
 * - `db.files.delete:action:hard:before` - Called before hard delete (line 192-195)
 * - `db.files.delete:action:hard:after` - Called after hard delete (line 198)
 * - `db.files.restore:action:before` - Called before restoring soft-deleted file (line 171)
 * - `db.files.restore:action:after` - Called after restore (line 177)
 *
 * All hooks receive relevant metadata; filters can transform or veto (return false to reject).
 */

const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024; // 20MB cap

const FILE_TABLE = 'files';

function toFileEntity(meta: FileMeta): FileEntity {
    return {
        hash: meta.hash,
        name: meta.name,
        mime: meta.mime_type,
        size: meta.size_bytes,
        ref_count: meta.ref_count,
    };
}

function applyFileEntityToMeta<T extends Record<string, unknown>>(
    meta: T,
    entity: FileEntity
): T {
    return {
        ...meta,
        hash: entity.hash,
        name: entity.name,
        mime_type: entity.mime,
        size_bytes: entity.size,
        ref_count:
            entity.ref_count ?? (meta as { ref_count?: number }).ref_count,
    } as T;
}

function createFileDeletePayload(
    meta: FileMeta | undefined,
    hash: string
): DbDeletePayload<FileEntity> {
    const entity = meta
        ? toFileEntity(meta)
        : {
              hash,
              name: hash,
              mime: 'application/octet-stream',
              size: 0,
              ref_count: 0,
          };
    return {
        entity,
        id: entity.hash,
        tableName: FILE_TABLE,
    };
}

/** Internal helper to change ref_count and fire hook */
async function changeRefCount(hash: string, delta: number) {
    await getDb().transaction('rw', getDb().file_meta, async () => {
        const meta = await getDb().file_meta.get(hash);
        if (!meta) return;
        const next = {
            ...meta,
            ref_count: Math.max(0, meta.ref_count + delta),
            updated_at: nowSec(),
            clock: nextClock(meta.clock),
        };
        await getDb().file_meta.put(next);
        const hooks = useHooks();
        await hooks.doAction('db.files.refchange:action:after', {
            before: toFileEntity(meta),
            after: toFileEntity(next),
            delta,
        });
    });
}

/** Create or reference existing file by content hash (dedupe). */
export async function createOrRefFile(
    file: Blob,
    name: string
): Promise<FileMeta> {
    const dev = import.meta.dev;
    const hasPerf = typeof performance !== 'undefined';
    const markId =
        dev && hasPerf
            ? `filestore-${Date.now()}-${Math.random().toString(36).slice(2)}`
            : undefined;
    if (markId && hasPerf) performance.mark(`${markId}:start`);
    if (file.size > MAX_FILE_SIZE_BYTES) throw new Error('file too large');
    const hooks = useHooks();
    const hash = await computeFileHash(file);
    const existing = await getDb().file_meta.get(hash);
    if (existing) {
        await changeRefCount(hash, 1);
        if (import.meta.dev) {
            console.debug('[files] ref existing', {
                hash: hash.slice(0, 8),
                size: existing.size_bytes,
                ref_count: existing.ref_count + 1,
            });
        }
        if (markId && hasPerf) finalizePerf(markId, 'ref', file.size);
        if (!existing.storage_id) {
            await enqueueUpload(hash);
        }
        return existing;
    }
    const mime = file.type || 'application/octet-stream';
    // Basic image dimension extraction if image
    let width: number | undefined;
    let height: number | undefined;
    if (mime.startsWith('image/')) {
        try {
            const bmp = await blobImageSize(file);
            width = bmp?.width;
            height = bmp?.height;
        } catch {
            // Silently ignore image dimension extraction failures
        }
    }
    const baseCreate = {
        hash,
        name,
        mime_type: mime,
        kind: mime === 'application/pdf' ? 'pdf' : 'image',
        size_bytes: file.size,
        width,
        height,
        page_count: undefined,
    };
    const filteredEntity = await hooks.applyFilters(
        'db.files.create:filter:input',
        {
            hash,
            name,
            mime,
            size: file.size,
            ref_count: 1,
        } as FileEntity
    );
    const prepared = parseOrThrow(
        FileMetaCreateSchema,
        applyFileEntityToMeta(baseCreate, filteredEntity)
    );
    const meta = parseOrThrow(FileMetaSchema, prepared);
    const seededMeta = { ...meta, clock: nextClock(meta.clock) };

    let actionPayload: DbCreatePayload<FileEntity> = {
        entity: toFileEntity(seededMeta),
        tableName: FILE_TABLE,
    };

    let storedMeta: FileMeta | null = null;
    await getDb().transaction('rw', getDb().file_meta, getDb().file_blobs, async () => {
        await hooks.doAction('db.files.create:action:before', actionPayload);
        const mergedMeta = parseOrThrow(
            FileMetaSchema,
            applyFileEntityToMeta(seededMeta, actionPayload.entity)
        );
        // Parallel writes for ~20% faster file creation
        await Promise.all([
            getDb().file_meta.put(mergedMeta),
            getDb().file_blobs.put({ hash: mergedMeta.hash, blob: file }),
        ]);
        storedMeta = mergedMeta;
        actionPayload = {
            entity: toFileEntity(mergedMeta),
            tableName: FILE_TABLE,
        };
        await hooks.doAction('db.files.create:action:after', actionPayload);
    });
    // storedMeta is always set within the transaction, but TypeScript doesn't track this
    // Use non-null assertion since the transaction guarantees the value is set
    const finalMeta = storedMeta!;
    if (import.meta.dev) {
        console.debug('[files] created', {
            hash: finalMeta.hash.slice(0, 8),
            size: file.size,
            mime,
        });
    }
    if (markId && hasPerf) finalizePerf(markId, 'create', file.size);
    await enqueueUpload(finalMeta.hash);
    return finalMeta;
}

/** Get file metadata by hash */
export async function getFileMeta(hash: string): Promise<FileMeta | undefined> {
    const hooks = useHooks();
    const meta = await getDb().file_meta.get(hash);
    if (!meta) return undefined;
    const entity = await hooks.applyFilters(
        'db.files.get:filter:output',
        toFileEntity(meta)
    );
    if (!entity) return undefined;
    return parseOrThrow(FileMetaSchema, applyFileEntityToMeta(meta, entity));
}

/** Get binary Blob by hash */
export async function getFileBlob(hash: string): Promise<Blob | undefined> {
    const row = await getDb().file_blobs.get(hash);
    if (row?.blob) return row.blob;
    return ensureFileBlob(hash);
}

/** Ensure blob exists locally; attempt download if missing. */
export async function ensureFileBlob(
    hash: string
): Promise<Blob | undefined> {
    const row = await getDb().file_blobs.get(hash);
    if (row?.blob) return row.blob;
    if (!import.meta.client) return undefined;
    try {
        const { getStorageTransferQueue } = await import(
            '~/core/storage/transfer-queue'
        );
        const queue = getStorageTransferQueue();
        if (!queue) return undefined;
        return await queue.ensureDownloadedBlob(hash);
    } catch (error) {
        reportError(error, {
            silent: true,
            tags: { domain: 'storage', stage: 'download' },
        });
        return undefined;
    }
}

/** Soft delete file (mark deleted flag only) */
export async function softDeleteFile(hash: string): Promise<void> {
    const hooks = useHooks();
    await getDb().transaction('rw', getDb().file_meta, async () => {
        const meta = await getDb().file_meta.get(hash);
        if (!meta) return;
        const payload = createFileDeletePayload(meta, hash);
        await hooks.doAction('db.files.delete:action:soft:before', payload);
        const now = nowSec();
        await getDb().file_meta.put({
            ...meta,
            deleted: true,
            deleted_at: now,
            updated_at: now,
            clock: nextClock(meta.clock),
        });
        await hooks.doAction('db.files.delete:action:soft:after', payload);
    });
}

/** Soft delete multiple files in one transaction */
export async function softDeleteMany(hashes: string[]): Promise<void> {
    const unique = Array.from(new Set(hashes.filter(Boolean)));
    if (!unique.length) return;
    const hooks = useHooks();
    await getDb().transaction('rw', getDb().file_meta, async () => {
        const metas = await getDb().file_meta.bulkGet(unique);
        for (let i = 0; i < unique.length; i++) {
            const hash = unique[i]!;
            const meta = metas[i];
            if (!meta || meta.deleted) continue;
            const payload = createFileDeletePayload(meta, hash);
            await hooks.doAction('db.files.delete:action:soft:before', payload);
            const now = nowSec();
            await getDb().file_meta.put({
                ...meta,
                deleted: true,
                deleted_at: now,
                updated_at: now,
                clock: nextClock(meta.clock),
            });
            await hooks.doAction('db.files.delete:action:soft:after', payload);
        }
    });
}

/** Restore multiple files that were soft deleted */
export async function restoreMany(hashes: string[]): Promise<void> {
    const unique = Array.from(new Set(hashes.filter(Boolean)));
    if (!unique.length) return;
    const hooks = useHooks();
    await getDb().transaction('rw', getDb().file_meta, async () => {
        const metas = await getDb().file_meta.bulkGet(unique);
        for (let i = 0; i < unique.length; i++) {
            const meta = metas[i];
            if (!meta || meta.deleted !== true) continue;
            await hooks.doAction(
                'db.files.restore:action:before',
                toFileEntity(meta)
            );
            const updatedMeta = {
                ...meta,
                deleted: false,
                updated_at: nowSec(),
                clock: nextClock(meta.clock),
            } as FileMeta;
            await getDb().file_meta.put(updatedMeta);
            await hooks.doAction(
                'db.files.restore:action:after',
                toFileEntity(updatedMeta)
            );
        }
    });
}

/** Hard delete files (remove metadata + blob) */
export async function hardDeleteMany(hashes: string[]): Promise<void> {
    const unique = Array.from(new Set(hashes.filter(Boolean)));
    if (!unique.length) return;
    const hooks = useHooks();
    await getDb().transaction('rw', getDb().file_meta, getDb().file_blobs, async () => {
        const metas = await getDb().file_meta.bulkGet(unique);
        for (let i = 0; i < unique.length; i++) {
            const hash = unique[i]!;
            const meta = metas[i];
            const payload = createFileDeletePayload(meta ?? undefined, hash);
            await hooks.doAction('db.files.delete:action:hard:before', payload);
            await getDb().file_meta.delete(hash);
            await getDb().file_blobs.delete(hash);
            await hooks.doAction('db.files.delete:action:hard:after', payload);
        }
    });
}

/** Remove one reference to a file; if dropping to 0 we keep data (GC future) */
export async function derefFile(hash: string): Promise<void> {
    await changeRefCount(hash, -1);
}

export function fileDeleteError(message: string, cause?: unknown) {
    return err('ERR_DB_WRITE_FAILED', message, {
        cause,
        tags: { domain: 'files', stage: 'delete' },
    });
}

// Export internal for testing / tasks list mapping
export { changeRefCount };

async function enqueueUpload(hash: string): Promise<void> {
    if (!import.meta.client) return;
    try {
        const { getStorageTransferQueue } = await import(
            '~/core/storage/transfer-queue'
        );
        const queue = getStorageTransferQueue();
        if (!queue) return;
        await queue.enqueue(hash, 'upload');
    } catch (error) {
        reportError(error, {
            silent: true,
            tags: { domain: 'storage', stage: 'enqueue-upload' },
        });
    }
}

// Lightweight image dimension extraction with timeout to prevent hung operations
const IMAGE_SIZE_TIMEOUT_MS = 5000; // 5s timeout

// Type for the image-like object we create
interface ImageLike {
    src: string;
    naturalWidth: number;
    naturalHeight: number;
    onload: (() => void) | null;
    onerror: (() => void) | null;
}

type ImageConstructor = new () => ImageLike;

function getImageConstructor(value: unknown): ImageConstructor | null {
    return typeof value === 'function' ? (value as ImageConstructor) : null;
}

async function blobImageSize(
    blob: Blob
): Promise<{ width: number; height: number } | undefined> {
    // Guard for non-browser environments where Image constructor is unavailable
    const imageCtor = getImageConstructor((globalThis as { Image?: unknown }).Image);
    if (!imageCtor) {
        return undefined;
    }

    return new Promise((resolve) => {
        const img: ImageLike = new imageCtor();
        let resolved = false;

        // Timeout to prevent hung operations from malformed images
        const timer = setTimeout(() => {
            if (!resolved) {
                resolved = true;
                URL.revokeObjectURL(img.src);
                resolve(undefined);
            }
        }, IMAGE_SIZE_TIMEOUT_MS);

        img.onload = () => {
            if (resolved) return;
            resolved = true;
            clearTimeout(timer);
            const res = { width: img.naturalWidth, height: img.naturalHeight };
            URL.revokeObjectURL(img.src);
            resolve(res);
        };
        img.onerror = () => {
            if (resolved) return;
            resolved = true;
            clearTimeout(timer);
            URL.revokeObjectURL(img.src);
            resolve(undefined);
        };
        img.src = URL.createObjectURL(blob);
    });
}

function finalizePerf(id: string, kind: 'create' | 'ref', bytes: number) {
    try {
        performance.mark(`${id}:end`);
        performance.measure(
            `file:${kind}:bytes=${bytes}`,
            `${id}:start`,
            `${id}:end`
        );
        // Intentionally omit console logging to keep production console clean.
        // The measure is still recorded for performance profiling tools.
    } catch {
        // Perf metric finalize is best-effort only
        reportError(err('ERR_INTERNAL', 'file perf finalize failed'), {
            silent: true,
            tags: { domain: 'files', stage: 'perf_finalize' },
        });
    }
}
