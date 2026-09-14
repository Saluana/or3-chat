/**
 * @module app/db/files-select
 *
 * Purpose:
 * Convenience query helpers for file metadata lists.
 *
 * Responsibilities:
 * - Provide simple paging for image file metadata
 * - Provide index-key image pages and compact summaries for the gallery
 * - Offer name update utility for file metadata
 *
 * Non-responsibilities:
 * - File upload or download logic
 * - Complex search or filtering semantics
 */
import Dexie from 'dexie';
import { getDb } from './client';
import type { FileMeta } from './schema';
import { nowSec, nextClock, getWriteTxTableNames } from './util';
import { isTrustedRasterMeta, type GalleryState } from './derived-indexes';

export { isTrustedRasterMeta };
export type { GalleryState };

/** Sort modes backed by ordered `[gallery_state+sort+hash]` indexes. */
export type ImagePageSort = 'newest' | 'oldest' | 'largest' | 'smallest';

/** Compact projection used for global counts, name ordering, and search. */
export interface ImageSummary {
    hash: string;
    name: string;
    mime_type: string;
    created_at: number;
    size_bytes: number;
    state: GalleryState;
}

/** Exclusive `(sortValue, hash)` continuation bound for a page query. */
export interface ImageIndexedCursor {
    sort: ImagePageSort;
    state: GalleryState;
    last: [number, string];
}

export interface ImagePage {
    items: FileMeta[];
    hasMore: boolean;
    nextCursor: ImageIndexedCursor | null;
    /** Rows selected from the index that disappeared before hydration. */
    missing: number;
}

const PAGE_SORT_INDEX: Record<
    ImagePageSort,
    { index: string; direction: 1 | -1 }
> = {
    newest: { index: '[gallery_state+created_at+hash]', direction: -1 },
    oldest: { index: '[gallery_state+created_at+hash]', direction: 1 },
    largest: { index: '[gallery_state+size_bytes+hash]', direction: -1 },
    smallest: { index: '[gallery_state+size_bytes+hash]', direction: 1 },
};

const SUMMARY_INDEX =
    '[gallery_state+name+mime_type+created_at+size_bytes+hash]';

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
            (m) => m.deleted !== true && isTrustedRasterMeta(m)
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
            (m) => m.deleted === true && isTrustedRasterMeta(m)
        )
        .offset(offset)
        .limit(limit)
        .toArray();
}

/**
 * List every image metadata row for library-wide search, filters, and counts.
 * Binary payloads remain lazy and are not read by this query.
 *
 * @deprecated Prefer `listImageSummaries` for the image library.
 */
export async function listAllImageMetas(deleted = false): Promise<FileMeta[]> {
    return getDb().file_meta
        .orderBy('updated_at')
        .reverse()
        .filter(
            (m) => m.deleted === deleted && isTrustedRasterMeta(m)
        )
        .toArray();
}

/**
 * Read the compact image corpus from the covering index. Only index keys are
 * visited; no `FileMeta` values are fetched.
 */
export async function listImageSummaries(): Promise<ImageSummary[]> {
    const summaries: ImageSummary[] = [];
    await getDb()
        .file_meta.orderBy(SUMMARY_INDEX)
        .eachKey((key) => {
            if (!Array.isArray(key) || key.length < 6) return;
            const [state, name, mime, createdAt, sizeBytes, hash] = key as [
                unknown,
                unknown,
                unknown,
                unknown,
                unknown,
                unknown,
            ];
            if (
                (state !== 'active' && state !== 'trash') ||
                typeof name !== 'string' ||
                typeof mime !== 'string' ||
                typeof createdAt !== 'number' ||
                typeof sizeBytes !== 'number' ||
                typeof hash !== 'string'
            ) {
                return;
            }
            summaries.push({
                hash,
                name,
                mime_type: mime,
                created_at: createdAt,
                size_bytes: sizeBytes,
                state,
            });
        });
    return summaries;
}

/**
 * Read one bounded page of full image metadata. Selection walks ordered index
 * keys with an exclusive `[sortValue, hash]` bound and hydrates at most `limit`
 * rows, returning a lookahead match count for `hasMore`.
 */
export async function listImagePage(input: {
    state: GalleryState;
    sort: ImagePageSort;
    limit: number;
    cursor?: ImageIndexedCursor | null;
    /** Optional membership restriction (view/search/used-in-docs). */
    hashes?: ReadonlySet<string> | null;
}): Promise<ImagePage> {
    if (!Number.isFinite(input.limit) || input.limit <= 0) {
        throw new Error('Image page limit must be a positive finite number.');
    }
    const limit = Math.floor(input.limit);
    const cursor = input.cursor ?? null;
    if (
        cursor &&
        (cursor.state !== input.state || cursor.sort !== input.sort)
    ) {
        throw new Error('Image page cursor does not match its query.');
    }

    const spec = PAGE_SORT_INDEX[input.sort];
    const collection = getDb().file_meta.where(spec.index);
    // Bound both ends to the requested partition so an empty active/trash
    // view never walks the opposite state's keys.
    const lower = [input.state, Dexie.minKey];
    const upper = [input.state, Dexie.maxKey];
    let ordered;
    if (spec.direction === 1) {
        ordered = cursor
            ? collection.between(
                  [input.state, cursor.last[0], cursor.last[1]],
                  upper,
                  false,
                  true
              )
            : collection.between(lower, upper, true, true);
    } else {
        const partition = cursor
            ? collection.between(
                  lower,
                  [input.state, cursor.last[0], cursor.last[1]],
                  true,
                  false
              )
            : collection.between(lower, upper, true, true);
        ordered = partition.reverse();
    }

    const scanned: Array<[number, string]> = [];
    const wanted = limit + 1;
    await ordered.eachKey((key, cursorHandle) => {
        if (!Array.isArray(key) || key.length < 3) return;
        const [state, sortValue, hash] = key as [unknown, unknown, unknown];
        if (
            state !== input.state ||
            typeof sortValue !== 'number' ||
            typeof hash !== 'string'
        ) {
            return;
        }
        if (input.hashes && !input.hashes.has(hash)) return;
        scanned.push([sortValue, hash]);
        if (scanned.length >= wanted) {
            (cursorHandle as unknown as { stop: () => void }).stop();
        }
    });

    const hasMore = scanned.length > limit;
    const selected = hasMore ? scanned.slice(0, limit) : scanned;
    const rows = await getDb().file_meta.bulkGet(
        selected.map(([, hash]) => hash)
    );
    const items: FileMeta[] = [];
    for (const row of rows) {
        if (!row) continue;
        if (!isTrustedRasterMeta(row)) continue;
        const rowState: GalleryState =
            row.deleted === true ? 'trash' : 'active';
        if (rowState !== input.state) continue;
        items.push(row);
    }

    const lastSelected = selected.at(-1);
    return {
        items,
        hasMore,
        nextCursor:
            hasMore && lastSelected
                ? {
                      state: input.state,
                      sort: input.sort,
                      last: lastSelected,
                  }
                : null,
        missing: selected.length - items.length,
    };
}

/** Hydrate specific image hashes preserving the requested order. */
export async function getImageMetasByHashes(
    hashes: readonly string[]
): Promise<FileMeta[]> {
    if (!hashes.length) return [];
    const rows = await getDb().file_meta.bulkGet([...hashes]);
    const items: FileMeta[] = [];
    for (const row of rows) {
        if (row && isTrustedRasterMeta(row)) items.push(row);
    }
    return items;
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
