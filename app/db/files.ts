/**
 * @module app/db/files
 *
 * Purpose:
 * Local file metadata and blob storage with deduplication and hook integration.
 *
 * Responsibilities:
 * - Deduplicate files by content hash
 * - Store file metadata and blobs in IndexedDB
 * - Emit hook actions and filters for file lifecycle events
 *
 * Non-responsibilities:
 * - Remote storage synchronization
 * - File rendering or UI workflows
 *
 * Hook Points:
 * - `db.files.create:filter:input`
 * - `db.files.create:action:before`
 * - `db.files.create:action:after`
 * - `db.files.get:filter:output`
 * - `db.files.refchange:action:after`
 * - `db.files.delete:action:soft:before`
 * - `db.files.delete:action:soft:after`
 * - `db.files.delete:action:hard:before`
 * - `db.files.delete:action:hard:after`
 * - `db.files.restore:action:before`
 * - `db.files.restore:action:after`
 *
 * @see docs/core-hook-map.md for hook conventions
 */
import Dexie from 'dexie';
import { getDb } from './client';
import { useHooks } from '../core/hooks/useHooks';
import { parseOrThrow, nowSec, nextClock, getWriteTxTableNames } from './util';
import { FileMetaCreateSchema, FileMetaSchema, type FileMeta } from './schema';
import { computeFileHash } from '../utils/hash';
import { reportError, err } from '../utils/errors';
import type {
    DbCreatePayload,
    DbDeletePayload,
    FileEntity,
} from '../core/hooks/hook-types';

// Default max file size (20MB) - can be overridden by config
const DEFAULT_MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024;

// Cached config value to avoid repeated dynamic imports
let cachedMaxFileSize: number | null = null;

// Get max file size from OR3 config
function getMaxFileSizeBytes(): number {
    // Return cached value if available
    if (cachedMaxFileSize !== null) {
        return cachedMaxFileSize;
    }
    // Default fallback - actual config is loaded via initMaxFileSize
    return DEFAULT_MAX_FILE_SIZE_BYTES;
}

// Initialize max file size from config (called once at module load on client)
async function initMaxFileSize(): Promise<void> {
    try {
        const { or3Config } = await import('~~/config.or3');
        cachedMaxFileSize = or3Config.limits.maxFileSizeBytes;
    } catch {
        cachedMaxFileSize = DEFAULT_MAX_FILE_SIZE_BYTES;
    }
}

// Eagerly initialize on client side
if (import.meta.client) {
    void initMaxFileSize();
}

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
    const db = getDb();
    await db.transaction('rw', getWriteTxTableNames(db, 'file_meta'), async () => {
        const meta = await db.file_meta.get(hash);
        if (!meta) return;
        const next = {
            ...meta,
            ref_count: Math.max(0, meta.ref_count + delta),
            updated_at: nowSec(),
            clock: nextClock(meta.clock),
        };
        await db.file_meta.put(next);
        const hooks = useHooks();
        await hooks.doAction('db.files.refchange:action:after', {
            before: toFileEntity(meta),
            after: toFileEntity(next),
            delta,
        });
    });
}

/**
 * Purpose:
 * Create a file entry or reference an existing entry by hash.
 *
 * Behavior:
 * Computes a hash, increments ref count if it exists, or stores metadata and
 * blob data if it is new. Emits hooks during creation.
 *
 * Constraints:
 * - Enforces max file size limit.
 * - Requires browser APIs for blob hashing and storage.
 *
 * Non-Goals:
 * - Does not upload to remote storage directly.
 */
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
    if (file.size > getMaxFileSizeBytes()) throw new Error('file too large');
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
    const db = getDb();
    await db.transaction(
        'rw',
        getWriteTxTableNames(db, 'file_meta', { include: ['file_blobs'] }),
        async () => {
        await hooks.doAction('db.files.create:action:before', actionPayload);
        const mergedMeta = parseOrThrow(
            FileMetaSchema,
            applyFileEntityToMeta(seededMeta, actionPayload.entity)
        );
        // Parallel writes for ~20% faster file creation
        await Promise.all([
            db.file_meta.put(mergedMeta),
            db.file_blobs.put({ hash: mergedMeta.hash, blob: file }),
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

/**
 * Purpose:
 * Fetch file metadata for a content hash.
 *
 * Behavior:
 * Reads metadata and applies output filters.
 *
 * Constraints:
 * - Returns undefined if the row is missing or filtered out.
 *
 * Non-Goals:
 * - Does not fetch blobs.
 */
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

/**
 * Purpose:
 * Retrieve the binary blob for a content hash.
 *
 * Behavior:
 * Returns the stored blob if present, otherwise attempts to ensure it exists.
 *
 * Constraints:
 * - May return undefined if blob is not available locally.
 *
 * Non-Goals:
 * - Does not guarantee a remote download.
 */
export async function getFileBlob(hash: string): Promise<Blob | undefined> {
    const row = await getDb().file_blobs.get(hash);
    if (row?.blob) return row.blob;
    return ensureFileBlob(hash);
}

/**
 * Purpose:
 * Ensure a blob exists locally, downloading if required.
 *
 * Behavior:
 * Checks local storage first, then uses the transfer queue when available.
 *
 * Constraints:
 * - Client-only. Returns undefined in non-browser contexts.
 *
 * Non-Goals:
 * - Does not force a download when the queue is unavailable.
 */
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

/**
 * Purpose:
 * Soft delete a single file metadata row.
 *
 * Behavior:
 * Marks the row as deleted and updates timestamps with hook emission.
 *
 * Constraints:
 * - No-op if the file metadata does not exist.
 *
 * Non-Goals:
 * - Does not remove blobs from storage.
 */
export async function softDeleteFile(hash: string): Promise<void> {
    const hooks = useHooks();
    const db = getDb();
    await db.transaction('rw', getWriteTxTableNames(db, 'file_meta'), async () => {
        const meta = await db.file_meta.get(hash);
        if (!meta) return;
        const payload = createFileDeletePayload(meta, hash);
        await hooks.doAction('db.files.delete:action:soft:before', payload);
        const now = nowSec();
        await db.file_meta.put({
            ...meta,
            deleted: true,
            deleted_at: now,
            updated_at: now,
            clock: nextClock(meta.clock),
        });
        await hooks.doAction('db.files.delete:action:soft:after', payload);
    });
}

/**
 * Purpose:
 * Soft delete multiple files in a single transaction.
 *
 * Behavior:
 * Updates deletion flags and timestamps for each unique hash and emits hooks.
 *
 * Constraints:
 * - Skips hashes that are missing or already deleted.
 *
 * Non-Goals:
 * - Does not remove blobs from storage.
 */
export async function softDeleteMany(hashes: string[]): Promise<void> {
    const unique = Array.from(new Set(hashes.filter(Boolean)));
    if (!unique.length) return;
    const hooks = useHooks();
    const db = getDb();
    await db.transaction('rw', getWriteTxTableNames(db, 'file_meta'), async () => {
        const metas = await db.file_meta.bulkGet(unique);
        const updates: FileMeta[] = [];
        const payloads: DbDeletePayload<FileEntity>[] = [];

        for (let i = 0; i < unique.length; i++) {
            const hash = unique[i]!;
            const meta = metas[i];
            if (!meta || meta.deleted) continue;
            const payload = createFileDeletePayload(meta, hash);
            await hooks.doAction('db.files.delete:action:soft:before', payload);

            const now = nowSec();
            updates.push({
                ...meta,
                deleted: true,
                deleted_at: now,
                updated_at: now,
                clock: nextClock(meta.clock),
            });
            payloads.push(payload);
        }

        if (updates.length > 0) {
            await db.file_meta.bulkPut(updates);
        }

        for (const payload of payloads) {
            await hooks.doAction('db.files.delete:action:soft:after', payload);
        }
    });
}

/**
 * Purpose:
 * Restore soft deleted file metadata rows.
 *
 * Behavior:
 * Clears deleted flags and emits restore hooks.
 *
 * Constraints:
 * - Only affects rows currently marked deleted.
 *
 * Non-Goals:
 * - Does not restore missing blobs.
 */
export async function restoreMany(hashes: string[]): Promise<void> {
    const unique = Array.from(new Set(hashes.filter(Boolean)));
    if (!unique.length) return;
    const hooks = useHooks();
    const db = getDb();
    await db.transaction('rw', getWriteTxTableNames(db, 'file_meta'), async () => {
        const metas = await db.file_meta.bulkGet(unique);
        const updates: FileMeta[] = [];

        for (let i = 0; i < unique.length; i++) {
            const meta = metas[i];
            if (!meta || meta.deleted !== true) continue;
            await Dexie.waitFor(
                hooks.doAction('db.files.restore:action:before', toFileEntity(meta))
            );
            updates.push({
                ...meta,
                deleted: false,
                updated_at: nowSec(),
                clock: nextClock(meta.clock),
            } as FileMeta);
        }

        if (updates.length > 0) {
            await db.file_meta.bulkPut(updates);
            for (const updatedMeta of updates) {
                await Dexie.waitFor(
                    hooks.doAction(
                        'db.files.restore:action:after',
                        toFileEntity(updatedMeta)
                    )
                );
            }
        }
    });
}

/**
 * Purpose:
 * Hard delete file metadata and blobs.
 *
 * Behavior:
 * Removes rows from file meta and blob tables in a transaction.
 *
 * Constraints:
 * - Deletes are permanent for local storage.
 *
 * Non-Goals:
 * - Does not delete remote storage objects.
 */
export async function hardDeleteMany(hashes: string[]): Promise<void> {
    const unique = Array.from(new Set(hashes.filter(Boolean)));
    if (!unique.length) return;
    const hooks = useHooks();
    const db = getDb();
    await db.transaction(
        'rw',
        getWriteTxTableNames(db, 'file_meta', {
            include: ['file_blobs'],
            includeTombstones: true,
        }),
        async () => {
        const metas = await db.file_meta.bulkGet(unique);
        for (let i = 0; i < unique.length; i++) {
            const hash = unique[i]!;
            const meta = metas[i];
            const payload = createFileDeletePayload(meta ?? undefined, hash);
            await hooks.doAction('db.files.delete:action:hard:before', payload);
            await db.file_meta.delete(hash);
            await db.file_blobs.delete(hash);
            await hooks.doAction('db.files.delete:action:hard:after', payload);
        }
    });
}

/**
 * Purpose:
 * Decrement a file reference count without deleting the file.
 *
 * Behavior:
 * Updates ref count and timestamps with hook emission.
 *
 * Constraints:
 * - Ref count is clamped to zero.
 *
 * Non-Goals:
 * - Does not garbage collect files when ref count reaches zero.
 */
export async function derefFile(hash: string): Promise<void> {
    await changeRefCount(hash, -1);
}

/**
 * Purpose:
 * Standardize file delete errors for reporting.
 *
 * Behavior:
 * Creates an `ERR_DB_WRITE_FAILED` error with file-specific tags.
 *
 * Constraints:
 * - Intended for internal error handling.
 *
 * Non-Goals:
 * - Does not report the error automatically.
 */
export function fileDeleteError(message: string, cause?: unknown) {
    return err('ERR_DB_WRITE_FAILED', message, {
        cause,
        tags: { domain: 'files', stage: 'delete' },
    });
}

/**
 * Purpose:
 * Internal API for adjusting file reference counts.
 *
 * Behavior:
 * Updates ref_count and emits ref change hooks inside a transaction.
 *
 * Constraints:
 * - Exported for composition and tests.
 *
 * Non-Goals:
 * - Does not validate file existence outside the transaction.
 */
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
