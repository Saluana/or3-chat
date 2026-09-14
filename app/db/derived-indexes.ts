/**
 * @module app/db/derived-indexes
 *
 * Purpose:
 * Derive local-only index fields from canonical rows at the Dexie write boundary.
 *
 * Responsibilities:
 * - Compute sparse `posts.document_reference_key` for active document rows.
 * - Compute sparse `file_meta.gallery_state` for verified raster rows.
 * - Compute `pending_ops.readyAt` (`nextAttemptAt ?? 0`) for due-time scheduling.
 * - Install deterministic creating/updating hooks on every `Or3DB` instance.
 *
 * Non-responsibilities:
 * - Content parsing or blob access.
 * - Sync capture or sanitization (see `shared/sync/sanitize.ts`).
 */
import type { Or3DB } from './client';
import type { FileMeta } from './schema';
import { isSupportedRasterMimeType } from '~~/shared/files/file-kind';

export type GalleryState = 'active' | 'trash';

/**
 * Image-library rows must carry trusted raster metadata. Keep accepting old
 * rows without a `kind` field when their MIME is one of the supported raster
 * formats, while generic files remain inert even if their MIME looks like an
 * image.
 */
export function isTrustedRasterMeta(
    meta: Pick<FileMeta, 'mime_type'> & { kind?: string }
): boolean {
    return (
        isSupportedRasterMimeType(meta.mime_type) &&
        (meta.kind === 'image' || meta.kind === undefined)
    );
}

type Row = Record<string, unknown>;

function toRow(value: unknown): Row {
    return value && typeof value === 'object' ? (value as Row) : {};
}

/**
 * Canonical rule for the sparse document reference key.
 * Only active `doc` posts with a nonempty serialized `file_hashes` string are
 * indexed. `deleted` rows and other post types are intentionally omitted.
 */
export function computeDocumentReferenceKey(
    row: Row
): [string, string] | undefined {
    if (row.postType !== 'doc') return undefined;
    if (row.deleted === true) return undefined;
    const fileHashes = row.file_hashes;
    if (typeof fileHashes !== 'string' || fileHashes.length === 0) {
        return undefined;
    }
    const id = row.id;
    if (typeof id !== 'string' || id.length === 0) return undefined;
    return [fileHashes, id];
}

/**
 * Canonical rule for the sparse gallery state. `deleted === true` maps to
 * `trash`; legacy rows without the flag are treated as active, matching
 * `listImageMetasPaged`.
 */
export function computeGalleryState(row: Row): GalleryState | undefined {
    if (!isTrustedRasterMeta(row as Pick<FileMeta, 'mime_type'>)) {
        return undefined;
    }
    return row.deleted === true ? 'trash' : 'active';
}

/** Apply the document reference key to a row being created (mutates `row`). */
export function applyDocumentReferenceKey(row: Row): void {
    const key = computeDocumentReferenceKey(row);
    if (key === undefined) {
        delete row.document_reference_key;
    } else {
        row.document_reference_key = key;
    }
}

/** Apply the gallery state to a row being created (mutates `row`). */
export function applyGalleryState(row: Row): void {
    const state = computeGalleryState(row);
    if (state === undefined) {
        delete row.gallery_state;
    } else {
        row.gallery_state = state;
    }
}

/**
 * Canonical rule for the outbox due-time projection.
 * `0` preserves the existing meaning of an absent retry time: immediately
 * eligible. Non-finite values are treated as absent so legacy rows stay
 * discoverable instead of falling outside the scheduling index.
 */
export function computeReadyAt(row: Row): number {
    const nextAttemptAt = row.nextAttemptAt;
    return typeof nextAttemptAt === 'number' && Number.isFinite(nextAttemptAt)
        ? nextAttemptAt
        : 0;
}

/** Apply the due-time projection to a row being created (mutates `row`). */
export function applyReadyAt(row: Row): void {
    row.readyAt = computeReadyAt(row);
}

/**
 * Merge top-level update modifications over the existing row so derived keys
 * reflect the effective committed state. Nested dotted modifications cannot
 * affect the derived fields, which are all top-level scalars.
 */
function mergeEffectiveRow(existing: Row, modifications: unknown): Row {
    const effective = { ...existing };
    for (const [key, value] of Object.entries(toRow(modifications))) {
        if (key.includes('.')) continue;
        effective[key] = value;
    }
    return effective;
}

type DexieHookTable = {
    hook: (
        event: 'creating' | 'updating',
        fn?: (...args: never[]) => unknown
    ) => unknown;
};

const installed = new WeakSet<object>();

/**
 * Install deterministic derived-key hooks on an `Or3DB` instance. Unlike the
 * sync `HookBridge`, these hooks always run: remote-applied rows and restored
 * rows still need local indexes.
 */
export function installDerivedIndexHooks(db: Or3DB): void {
    if (installed.has(db)) return;
    installed.add(db);

    const posts = db.table('posts') as unknown as DexieHookTable;
    posts.hook('creating', ((_pk: unknown, obj: unknown) => {
        applyDocumentReferenceKey(toRow(obj));
    }) as (...args: never[]) => unknown);
    posts.hook(
        'updating',
        ((modifications: unknown, _pk: unknown, obj: unknown) => ({
            document_reference_key: computeDocumentReferenceKey(
                mergeEffectiveRow(toRow(obj), modifications)
            ),
        })) as (...args: never[]) => unknown
    );

    const fileMeta = db.table('file_meta') as unknown as DexieHookTable;
    fileMeta.hook('creating', ((_pk: unknown, obj: unknown) => {
        applyGalleryState(toRow(obj));
    }) as (...args: never[]) => unknown);
    fileMeta.hook(
        'updating',
        ((modifications: unknown, _pk: unknown, obj: unknown) => ({
            gallery_state: computeGalleryState(
                mergeEffectiveRow(toRow(obj), modifications)
            ),
        })) as (...args: never[]) => unknown
    );

    const pendingOps = db.table('pending_ops') as unknown as DexieHookTable;
    pendingOps.hook('creating', ((_pk: unknown, obj: unknown) => {
        applyReadyAt(toRow(obj));
    }) as (...args: never[]) => unknown);
    pendingOps.hook(
        'updating',
        ((modifications: unknown, _pk: unknown, obj: unknown) => ({
            // Recompute from the effective committed row so a supplied
            // projection (including a stale value when nextAttemptAt is
            // cleared) can never make a row invisible to the due index.
            readyAt: computeReadyAt(
                mergeEffectiveRow(toRow(obj), modifications)
            ),
        })) as (...args: never[]) => unknown
    );
}
