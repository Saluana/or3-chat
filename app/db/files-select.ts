import { db } from './client';
import type { FileMeta } from './schema';
import { nowSec } from './util';
import type { IndexableType } from 'dexie';

/**
 * Type helper for compound index key values.
 * Dexie's IndexableType doesn't include boolean, but IndexedDB converts
 * booleans to 0/1 internally, so this is valid at runtime.
 */
type CompoundKey = [string, boolean];
function toIndexableKey(key: CompoundKey): IndexableType {
    return key as unknown as IndexableType;
}

/**
 * List image FileMeta records, newest first, with simple paging.
 * Uses the compound index [kind+deleted] for efficient filtering,
 * then sorts by updated_at in memory for the filtered subset.
 * This is faster than scanning the entire table with .filter().
 */
export async function listImageMetasPaged(
    offset = 0,
    limit = 50
): Promise<FileMeta[]> {
    // Use compound index [kind+deleted] to get only non-deleted images
    // This leverages IndexedDB indexing instead of scanning all records
    const results = await db.file_meta
        .where('[kind+deleted]')
        .equals(toIndexableKey(['image', false]))
        .toArray();

    // Sort by updated_at descending in memory (only for filtered subset)
    results.sort((a, b) => b.updated_at - a.updated_at);

    // Apply pagination
    return results.slice(offset, offset + limit);
}

/**
 * List deleted image FileMeta records, newest first, with paging.
 * Uses the compound index [kind+deleted] for efficient filtering.
 */
export async function listDeletedImageMetasPaged(
    offset = 0,
    limit = 50
): Promise<FileMeta[]> {
    // Use compound index [kind+deleted] to get only deleted images
    const results = await db.file_meta
        .where('[kind+deleted]')
        .equals(toIndexableKey(['image', true]))
        .toArray();

    // Sort by updated_at descending in memory
    results.sort((a, b) => b.updated_at - a.updated_at);

    // Apply pagination
    return results.slice(offset, offset + limit);
}

// Update a file's display name and bump updated_at.
export async function updateFileName(
    hash: string,
    name: string
): Promise<void> {
    const meta = await db.file_meta.get(hash);
    if (!meta) return;
    await db.file_meta.put({ ...meta, name, updated_at: nowSec() });
}
