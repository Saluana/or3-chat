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
import { useRuntimeConfig } from '#imports';
import {
    classifyFileBlob,
    classifyFileKind,
    normalizeFileMimeType,
    type FileKind,
} from '~~/shared/files/file-kind';

// Default max file size (20MB) - can be overridden by config
const DEFAULT_MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024;

// Cached config value to avoid repeated dynamic imports
let cachedMaxFileSize: number | null = null;

function resolveConfiguredMaxFileSize(): number {
    try {
        const runtimeConfig = useRuntimeConfig();
        const candidate = Number(
            (runtimeConfig.public as { or3?: { limits?: { maxFileSizeBytes?: number } } }).or3
                ?.limits?.maxFileSizeBytes
        );
        if (Number.isFinite(candidate) && candidate > 0) {
            return Math.floor(candidate);
        }
    } catch {
        // Runtime config unavailable; keep fallback.
    }
    return DEFAULT_MAX_FILE_SIZE_BYTES;
}

// Get max file size from OR3 config
function getMaxFileSizeBytes(): number {
    if (cachedMaxFileSize !== null) {
        return cachedMaxFileSize;
    }
    cachedMaxFileSize = resolveConfiguredMaxFileSize();
    return cachedMaxFileSize;
}

const FILE_TABLE = 'files';

/**
 * Metadata fields can be absent on rows created before the generic-file
 * rollout. Keep that legacy shape explicit so callers do not cast incomplete
 * records to the current FileMeta type.
 */
type LegacyFileMetaInput = {
    kind?: FileKind;
    mime_type?: string;
};

function toFileEntity(meta: FileMeta): FileEntity {
    return {
        hash: meta.hash,
        name: meta.name,
        mime: meta.mime_type,
        size: meta.size_bytes,
        // Rows written before the generic-file rollout have no `kind`. Derive
        // that legacy value from MIME metadata instead of defaulting them to
        // trusted image handling.
        kind: resolveStoredFileKind(meta),
        ref_count: meta.ref_count,
    };
}

function resolveStoredFileKind(meta: LegacyFileMetaInput): FileKind {
    return meta.kind ?? classifyFileKind(meta.mime_type);
}

function applyFileEntityToMeta<
    T extends Record<string, unknown> & LegacyFileMetaInput,
>(
    meta: T,
    entity: FileEntity
): T {
    return {
        ...meta,
        hash: entity.hash,
        name: entity.name,
        mime_type: entity.mime,
        size_bytes: entity.size,
        kind: entity.kind ?? resolveStoredFileKind(meta),
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
              kind: 'file' as const,
              ref_count: 0,
          };
    return {
        entity,
        id: entity.hash,
        tableName: FILE_TABLE,
    };
}

/** Internal helper to change ref_count and fire hook */
async function changeRefCount(
    hash: string,
    delta: number,
    db = getDb()
): Promise<FileMeta | undefined> {
    return db.transaction(
        'rw',
        getWriteTxTableNames(db, 'file_meta'),
        async () => {
            const meta = await db.file_meta.get(hash);
            if (!meta) return undefined;
            const next = {
                ...meta,
                kind: resolveStoredFileKind(meta),
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
            return next;
        }
    );
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
    const db = getDb();
    const assertCurrentDb = () => {
        if (getDb() !== db) {
            throw new Error('workspace changed while creating file');
        }
    };
    const dev = import.meta.dev;
    const hasPerf = typeof performance !== 'undefined';
    const markId =
        dev && hasPerf
            ? `filestore-${Date.now()}-${Math.random().toString(36).slice(2)}`
            : undefined;
    if (markId && hasPerf) performance.mark(`${markId}:start`);
    if (file.size > getMaxFileSizeBytes()) throw new Error('file too large');
    const hooks = useHooks();
    const declaredMime = normalizeFileMimeType(file.type);
    let kind: FileKind = classifyFileKind(declaredMime);
    let hash: string;
    if (kind === 'image') {
        const [computedHash, classification] = await Promise.all([
            computeFileHash(file),
            classifyFileBlob(file),
        ]);
        hash = computedHash;
        kind = classification.kind;
    } else {
        hash = await computeFileHash(file);
    }
    assertCurrentDb();
    const existing = await db.file_meta.get(hash);
    assertCurrentDb();
    if (existing) {
        const incremented = await changeRefCount(hash, 1, db);
        if (incremented) {
            assertCurrentDb();
            if (import.meta.dev) {
                console.debug('[files] ref existing', {
                    hash: hash.slice(0, 8),
                    size: incremented.size_bytes,
                    ref_count: incremented.ref_count,
                });
            }
            if (markId && hasPerf) finalizePerf(markId, 'ref', file.size);
            if (!incremented.storage_id) {
                assertCurrentDb();
                await enqueueUpload(hash, db);
                assertCurrentDb();
            }
            return incremented;
        }
    }
    const mime = declaredMime;
    assertCurrentDb();
    // Basic image dimension extraction if image
    let width: number | undefined;
    let height: number | undefined;
    if (kind === 'image') {
        try {
            const bmp = await blobImageSize(file);
            width = bmp?.width;
            height = bmp?.height;
        } catch {
            // Silently ignore image dimension extraction failures
        }
    }
    assertCurrentDb();
    const baseCreate = {
        hash,
        name,
        mime_type: mime,
        kind,
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
            kind,
            ref_count: 1,
        } as FileEntity
    );
    assertCurrentDb();
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
    let createdNew = false;
    assertCurrentDb();
    await db.transaction(
        'rw',
        getWriteTxTableNames(db, 'file_meta', { include: ['file_blobs'] }),
        async () => {
        // The initial lookup happens before image metadata/filter work. Recheck
        // under the write transaction so concurrent identical files increment
        // the single canonical row instead of overwriting each other at one.
        const concurrentExisting = await db.file_meta.get(hash);
        if (concurrentExisting) {
            const next = {
                ...concurrentExisting,
                kind: resolveStoredFileKind(concurrentExisting),
                ref_count: concurrentExisting.ref_count + 1,
                updated_at: nowSec(),
                clock: nextClock(concurrentExisting.clock),
            };
            assertCurrentDb();
            await db.file_meta.put(next);
            await hooks.doAction('db.files.refchange:action:after', {
                before: toFileEntity(concurrentExisting),
                after: toFileEntity(next),
                delta: 1,
            });
            storedMeta = next;
            return;
        }

        await hooks.doAction('db.files.create:action:before', actionPayload);
        assertCurrentDb();
        const mergedMeta = parseOrThrow(
            FileMetaSchema,
            applyFileEntityToMeta(seededMeta, actionPayload.entity)
        );
        // Parallel writes for ~20% faster file creation
        assertCurrentDb();
        await Promise.all([
            db.file_meta.put(mergedMeta),
            db.file_blobs.put({ hash: mergedMeta.hash, blob: file }),
        ]);
        storedMeta = mergedMeta;
        createdNew = true;
        actionPayload = {
            entity: toFileEntity(mergedMeta),
            tableName: FILE_TABLE,
        };
        await hooks.doAction('db.files.create:action:after', actionPayload);
    });
    assertCurrentDb();
    // storedMeta is always set within the transaction, but TypeScript doesn't track this
    // Use non-null assertion since the transaction guarantees the value is set
    const finalMeta = storedMeta!;
    if (import.meta.dev) {
        console.debug(createdNew ? '[files] created' : '[files] ref existing', {
            hash: finalMeta.hash.slice(0, 8),
            size: file.size,
            mime,
        });
    }
    if (markId && hasPerf) {
        finalizePerf(markId, createdNew ? 'create' : 'ref', file.size);
    }
    if (!finalMeta.storage_id) {
        assertCurrentDb();
        await enqueueUpload(finalMeta.hash, db);
        assertCurrentDb();
    }
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
    const db = getDb();
    const row = await db.file_blobs.get(hash);
    if (row?.blob) return row.blob;
    if (!import.meta.client) return undefined;
    try {
        const { getStorageTransferQueue } = await import(
            '~/core/storage/transfer-queue'
        );
        if (getDb() !== db) throw new Error('workspace changed while reading file');
        const queue = getStorageTransferQueue();
        if (!queue) return undefined;
        const workspaceId = queue.getWorkspaceId();
        if (!workspaceId || getDb() !== db) return undefined;
        return await queue.ensureDownloadedBlob(hash, { db, workspaceId });
    } catch (error) {
        const { isRecoverableTransferError } = await import(
            '~/core/storage/transfer-queue-support'
        );
        // Expected pre-commit / remote-gap races — no error telemetry.
        if (isRecoverableTransferError(error)) return undefined;
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
    await db.transaction(
        'rw',
        getWriteTxTableNames(db, 'file_meta', { includeTombstones: true }),
        async () => {
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
        }
    );
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
 *
 * @returns Hashes that were actually marked deleted.
 */
export async function softDeleteMany(hashes: string[]): Promise<string[]> {
    const unique = Array.from(new Set(hashes.filter(Boolean)));
    if (!unique.length) return [];
    const hooks = useHooks();
    const db = getDb();
    return db.transaction(
        'rw',
        getWriteTxTableNames(db, 'file_meta', { includeTombstones: true }),
        async () => {
        const metas = await db.file_meta.bulkGet(unique);
        const updates: FileMeta[] = [];
        const payloads: DbDeletePayload<FileEntity>[] = [];
        const removed: string[] = [];

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
            removed.push(hash);
        }

        if (updates.length > 0) {
            await db.file_meta.bulkPut(updates);
        }

        for (const payload of payloads) {
            await hooks.doAction('db.files.delete:action:soft:after', payload);
        }
        return removed;
        }
    );
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
 *
 * @returns Hashes that were actually restored.
 */
export async function restoreMany(hashes: string[]): Promise<string[]> {
    const unique = Array.from(new Set(hashes.filter(Boolean)));
    if (!unique.length) return [];
    const hooks = useHooks();
    const db = getDb();
    return db.transaction('rw', getWriteTxTableNames(db, 'file_meta'), async () => {
        const metas = await db.file_meta.bulkGet(unique);
        const updates: FileMeta[] = [];
        const restored: string[] = [];

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
            restored.push(unique[i]!);
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
        return restored;
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
 *
 * @returns The unique hashes whose local rows were removed.
 */
export async function hardDeleteMany(hashes: string[]): Promise<string[]> {
    const unique = Array.from(new Set(hashes.filter(Boolean)));
    if (!unique.length) return [];
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
        }
    );
    return unique;
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

async function enqueueUpload(hash: string, db = getDb()): Promise<void> {
    if (!import.meta.client) return;
    try {
        const { getStorageTransferQueue } = await import(
            '~/core/storage/transfer-queue'
        );
        if (getDb() !== db) throw new Error('workspace changed while enqueueing upload');
        const queue = getStorageTransferQueue();
        if (!queue) return;
        const workspaceId = queue.getWorkspaceId();
        if (!workspaceId) return;
        await queue.enqueue(hash, 'upload', { db, workspaceId });
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
