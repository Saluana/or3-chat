import { db } from './client';
import type { FileMeta } from './schema';
import { nowSec } from './util';

// List image FileMeta records, newest first, with simple paging.
// Filters: deleted !== true AND kind === 'image'.
// Uses the updated_at index for ordering, then filters in-collection for simplicity.
export async function listImageMetasPaged(
    offset = 0,
    limit = 50
): Promise<FileMeta[]> {
    return db.file_meta
        .orderBy('updated_at')
        .reverse()
        .filter((m) => m.kind === 'image' && m.deleted !== true)
        .offset(offset)
        .limit(limit)
        .toArray();
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
