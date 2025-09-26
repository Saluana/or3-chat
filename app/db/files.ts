import { db } from './client';
import { useHooks } from '../composables/useHooks';
import { parseOrThrow } from './util';
import { nowSec } from './util';
import {
    FileMetaCreateSchema,
    FileMetaSchema,
    type FileMeta,
    type FileMetaCreate,
} from './schema';
import { computeFileHash } from '../utils/hash';
import { reportError, err } from '../utils/errors';

const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024; // 20MB cap

/** Internal helper to change ref_count and fire hook */
async function changeRefCount(hash: string, delta: number) {
    await db.transaction('rw', db.file_meta, async () => {
        const meta = await db.file_meta.get(hash);
        if (!meta) return;
        const next = {
            ...meta,
            ref_count: Math.max(0, meta.ref_count + delta),
            updated_at: nowSec(),
        };
        await db.file_meta.put(next);
        const hooks = useHooks();
        await hooks.doAction('db.files.refchange:action:after', {
            before: meta,
            after: next,
            delta,
        });
    });
}

/** Create or reference existing file by content hash (dedupe). */
export async function createOrRefFile(
    file: Blob,
    name: string
): Promise<FileMeta> {
    const dev = (import.meta as any).dev;
    const hasPerf = typeof performance !== 'undefined';
    const markId =
        dev && hasPerf
            ? `filestore-${Date.now()}-${Math.random().toString(36).slice(2)}`
            : undefined;
    if (markId && hasPerf) performance.mark(`${markId}:start`);
    if (file.size > MAX_FILE_SIZE_BYTES) throw new Error('file too large');
    const hooks = useHooks();
    const hash = await computeFileHash(file);
    const existing = await db.file_meta.get(hash);
    if (existing) {
        await changeRefCount(hash, 1);
        if ((import.meta as any).dev) {
            // eslint-disable-next-line no-console
            console.debug('[files] ref existing', {
                hash: hash.slice(0, 8),
                size: existing.size_bytes,
                ref_count: existing.ref_count + 1,
            });
        }
        if (markId && hasPerf) finalizePerf(markId, 'ref', file.size);
        return existing;
    }
    const mime = (file as any).type || 'application/octet-stream';
    // Basic image dimension extraction if image
    let width: number | undefined;
    let height: number | undefined;
    if (mime.startsWith('image/')) {
        try {
            const bmp = await blobImageSize(file);
            width = bmp?.width;
            height = bmp?.height;
        } catch {}
    }
    const base: FileMetaCreate = {
        hash,
        name,
        mime_type: mime,
        kind: mime === 'application/pdf' ? 'pdf' : 'image',
        size_bytes: file.size,
        width,
        height,
        page_count: undefined,
    } as any;
    const filtered = await hooks.applyFilters(
        'db.files.create:filter:input',
        base
    );
    const value = parseOrThrow(FileMetaCreateSchema, filtered);
    const meta = parseOrThrow(FileMetaSchema, value);
    await db.transaction('rw', db.file_meta, db.file_blobs, async () => {
        await hooks.doAction('db.files.create:action:before', meta);
        await db.file_meta.put(meta);
        await db.file_blobs.put({ hash, blob: file });
        await hooks.doAction('db.files.create:action:after', meta);
    });
    if ((import.meta as any).dev) {
        // eslint-disable-next-line no-console
        console.debug('[files] created', {
            hash: hash.slice(0, 8),
            size: file.size,
            mime,
        });
    }
    if (markId && hasPerf) finalizePerf(markId, 'create', file.size);
    return meta;
}

/** Get file metadata by hash */
export async function getFileMeta(hash: string): Promise<FileMeta | undefined> {
    const hooks = useHooks();
    const meta = await db.file_meta.get(hash);
    return hooks.applyFilters('db.files.get:filter:output', meta);
}

/** Get binary Blob by hash */
export async function getFileBlob(hash: string): Promise<Blob | undefined> {
    const row = await db.file_blobs.get(hash);
    return row?.blob;
}

/** Soft delete file (mark deleted flag only) */
export async function softDeleteFile(hash: string): Promise<void> {
    const hooks = useHooks();
    await db.transaction('rw', db.file_meta, async () => {
        const meta = await db.file_meta.get(hash);
        if (!meta) return;
        await hooks.doAction('db.files.delete:action:soft:before', meta);
        await db.file_meta.put({
            ...meta,
            deleted: true,
            updated_at: nowSec(),
        });
        await hooks.doAction('db.files.delete:action:soft:after', hash);
    });
}

/** Soft delete multiple files in one transaction */
export async function softDeleteMany(hashes: string[]): Promise<void> {
    const unique = Array.from(new Set(hashes.filter(Boolean)));
    if (!unique.length) return;
    const hooks = useHooks();
    await db.transaction('rw', db.file_meta, async () => {
        const metas = await db.file_meta.bulkGet(unique);
        for (let i = 0; i < unique.length; i++) {
            const hash = unique[i];
            const meta = metas[i];
            if (!meta || meta.deleted) continue;
            await hooks.doAction('db.files.delete:action:soft:before', meta);
            await db.file_meta.put({
                ...meta,
                deleted: true,
                updated_at: nowSec(),
            });
            await hooks.doAction('db.files.delete:action:soft:after', hash);
        }
    });
}

/** Restore multiple files that were soft deleted */
export async function restoreMany(hashes: string[]): Promise<void> {
    const unique = Array.from(new Set(hashes.filter(Boolean)));
    if (!unique.length) return;
    const hooks = useHooks();
    await db.transaction('rw', db.file_meta, async () => {
        const metas = await db.file_meta.bulkGet(unique);
        for (let i = 0; i < unique.length; i++) {
            const meta = metas[i];
            if (!meta || meta.deleted !== true) continue;
            await hooks.doAction('db.files.restore:action:before', meta);
            await db.file_meta.put({
                ...meta,
                deleted: false,
                updated_at: nowSec(),
            });
            await hooks.doAction('db.files.restore:action:after', meta.hash);
        }
    });
}

/** Hard delete files (remove metadata + blob) */
export async function hardDeleteMany(hashes: string[]): Promise<void> {
    const unique = Array.from(new Set(hashes.filter(Boolean)));
    if (!unique.length) return;
    const hooks = useHooks();
    await db.transaction('rw', db.file_meta, db.file_blobs, async () => {
        const metas = await db.file_meta.bulkGet(unique);
        for (let i = 0; i < unique.length; i++) {
            const hash = unique[i]!;
            const meta = metas[i];
            await hooks.doAction(
                'db.files.delete:action:hard:before',
                meta ?? hash
            );
            await db.file_meta.delete(hash);
            await db.file_blobs.delete(hash);
            await hooks.doAction('db.files.delete:action:hard:after', hash);
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

// Lightweight image dimension extraction without full decode (creates object URL)
async function blobImageSize(
    blob: Blob
): Promise<{ width: number; height: number } | undefined> {
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
            const res = { width: img.naturalWidth, height: img.naturalHeight };
            URL.revokeObjectURL(img.src);
            resolve(res);
        };
        img.onerror = () => {
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
        const entry = performance
            .getEntriesByName(`file:${kind}:bytes=${bytes}`)
            .slice(-1)[0];
        if (entry) {
            // eslint-disable-next-line no-console
            console.debug(
                '[perf] file store',
                kind,
                `${(bytes / 1024).toFixed(1)}KB`,
                `${entry.duration.toFixed(1)}ms`
            );
        }
    } catch (e) {
        // Perf metric finalize is best-effort only
        reportError(err('ERR_INTERNAL', 'file perf finalize failed'), {
            silent: true,
            tags: { domain: 'files', stage: 'perf_finalize' },
        });
    }
}
