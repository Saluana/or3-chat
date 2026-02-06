/**
 * @module app/db/files-select
 *
 * Purpose:
 * Convenience query helpers for file metadata lists.
 *
 * Responsibilities:
 * - Provide simple paging for image file metadata
 * - Offer name update utility for file metadata
 *
 * Non-responsibilities:
 * - File upload or download logic
 * - Complex search or filtering semantics
 */
import { getDb } from './client';
import type { FileMeta } from './schema';
import { nowSec, nextClock, getWriteTxTableNames } from './util';

// List image FileMeta records, newest first, with simple paging.
// Filters: deleted !== true AND kind === 'image'.
// Uses the updated_at index for ordering, then filters in-collection for simplicity.
/**
 * Purpose:
 * List image file metadata with basic paging.
 *
 * Behavior:
 * Filters to non-deleted image records and orders by most recent updates.
 *
 * Constraints:
 * - Uses in-collection filtering after ordering.
 *
 * Non-Goals:
 * - Does not include non-image file types.
 */
export async function listImageMetasPaged(
    offset = 0,
    limit = 50
): Promise<FileMeta[]> {
    return getDb().file_meta
        .orderBy('updated_at')
        .reverse()
        .filter(
            (m) =>
                m.deleted !== true &&
                (m.kind === 'image' || m.mime_type.startsWith('image/'))
        )
        .offset(offset)
        .limit(limit)
        .toArray();
}

// List deleted image FileMeta records, newest first, with paging.
/**
 * Purpose:
 * List deleted image file metadata with basic paging.
 *
 * Behavior:
 * Filters to deleted image records and orders by most recent updates.
 *
 * Constraints:
 * - Uses in-collection filtering after ordering.
 *
 * Non-Goals:
 * - Does not return active files.
 */
export async function listDeletedImageMetasPaged(
    offset = 0,
    limit = 50
): Promise<FileMeta[]> {
    return getDb().file_meta
        .orderBy('updated_at')
        .reverse()
        .filter(
            (m) =>
                m.deleted === true &&
                (m.kind === 'image' || m.mime_type.startsWith('image/'))
        )
        .offset(offset)
        .limit(limit)
        .toArray();
}

// Update a file's display name and bump updated_at.
/**
 * Purpose:
 * Update a file metadata display name.
 *
 * Behavior:
 * Loads the file metadata row, updates the name, and bumps timestamps.
 *
 * Constraints:
 * - No-op if the hash does not exist.
 *
 * Non-Goals:
 * - Does not validate name uniqueness.
 */
export async function updateFileName(
    hash: string,
    name: string
): Promise<void> {
    const db = getDb();
    const meta = await db.file_meta.get(hash);
    if (!meta) return;
    if (typeof (db as { transaction?: unknown }).transaction !== 'function') {
        await db.file_meta.put({
            ...meta,
            name,
            updated_at: nowSec(),
            clock: nextClock(meta.clock),
        });
        return;
    }
    await db.transaction('rw', getWriteTxTableNames(db, 'file_meta'), async () => {
        await db.file_meta.put({
            ...meta,
            name,
            updated_at: nowSec(),
            clock: nextClock(meta.clock),
        });
    });
}
