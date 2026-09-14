import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    evictWorkspaceDb,
    setActiveWorkspaceDb,
    type Or3DB,
} from '~/db/client';
import type { FileMeta } from '../schema';

import {
    getImageMetasByHashes,
    listImagePage,
    listImageSummaries,
} from '../files-select';
import {
    orderImageSummariesByName,
    imageSummaryCounts,
} from '~/pages/images/image-library';

function meta(
    hash: string,
    overrides: Partial<FileMeta> = {}
): FileMeta {
    return {
        hash,
        name: `${hash}.png`,
        mime_type: 'image/png',
        kind: 'image',
        size_bytes: 100,
        ref_count: 0,
        created_at: 1,
        updated_at: 1,
        deleted: false,
        clock: 1,
        ...overrides,
    } as FileMeta;
}

describe('image gallery page queries', () => {
    let db: Or3DB;
    let workspaceId: string;
    let reads = 0;

    beforeEach(async () => {
        workspaceId = `gallery-pages-${crypto.randomUUID()}`;
        db = setActiveWorkspaceDb(workspaceId);
        await db.open();
        db.file_meta.hook('reading', (value) => {
            reads += 1;
            return value;
        });
    });

    afterEach(async () => {
        setActiveWorkspaceDb(null);
        evictWorkspaceDb(workspaceId);
        await Dexie.delete(db.name);
    });

    async function seed(rows: FileMeta[]): Promise<void> {
        await db.file_meta.bulkPut(rows);
    }

    it('reads the compact corpus from index keys without value reads', async () => {
        await seed([
            meta('h1', { created_at: 1, size_bytes: 10, name: 'one.png' }),
            meta('h2', { created_at: 2, size_bytes: 20, name: 'two.png' }),
            meta('h3', { deleted: true, name: 'tres.png' }),
            meta('h4', { kind: 'file', mime_type: 'image/png' }),
            meta('h5', { mime_type: 'application/pdf', kind: 'pdf' }),
        ]);
        reads = 0;
        const summaries = await listImageSummaries();
        expect(reads).toBe(0);
        expect(summaries.map((summary) => summary.hash)).toEqual(['h1', 'h2', 'h3']);
        expect(summaries.find((summary) => summary.hash === 'h3')?.state).toBe(
            'trash'
        );
    });

    it('pages timestamp orders with an exclusive cursor and no repeats', async () => {
        const rows = Array.from({ length: 120 }, (_, index) =>
            meta(`h${String(index).padStart(3, '0')}`, {
                created_at: 1000 + index,
                size_bytes: index,
            })
        );
        await seed(rows);

        const first = await listImagePage({
            state: 'active',
            sort: 'newest',
            limit: 50,
        });
        expect(first.items).toHaveLength(50);
        expect(first.hasMore).toBe(true);
        expect(first.nextCursor).not.toBeNull();
        expect(first.items[0]!.hash).toBe('h119');
        expect(first.items[49]!.hash).toBe('h070');

        const second = await listImagePage({
            state: 'active',
            sort: 'newest',
            limit: 50,
            cursor: first.nextCursor,
        });
        expect(second.items).toHaveLength(50);
        expect(second.items[0]!.hash).toBe('h069');
        expect(second.items[49]!.hash).toBe('h020');

        const third = await listImagePage({
            state: 'active',
            sort: 'newest',
            limit: 50,
            cursor: second.nextCursor,
        });
        expect(third.items).toHaveLength(20);
        expect(third.hasMore).toBe(false);
        expect(third.nextCursor).toBeNull();
        expect(third.items[19]!.hash).toBe('h000');

        const seen = new Set(
            [...first.items, ...second.items, ...third.items].map(
                (item) => item.hash
            )
        );
        expect(seen.size).toBe(120);
    });

    it('handles empty, exact-limit, and lookahead boundaries', async () => {
        expect(
            await listImagePage({ state: 'active', sort: 'newest', limit: 50 })
        ).toMatchObject({ items: [], hasMore: false, nextCursor: null });

        await seed(
            Array.from({ length: 50 }, (_, index) =>
                meta(`h${index}`, { created_at: index })
            )
        );
        const exact = await listImagePage({
            state: 'active',
            sort: 'newest',
            limit: 50,
        });
        expect(exact.items).toHaveLength(50);
        expect(exact.hasMore).toBe(false);
        expect(exact.nextCursor).toBeNull();

        await db.file_meta.put(meta('h50', { created_at: 50 }));
        const lookahead = await listImagePage({
            state: 'active',
            sort: 'newest',
            limit: 50,
        });
        expect(lookahead.items).toHaveLength(50);
        expect(lookahead.hasMore).toBe(true);
        expect(lookahead.nextCursor?.last).toEqual([1, 'h1']);
    });

    it('orders duplicate timestamps and sizes deterministically by hash', async () => {
        const rows = [
            meta('b', { created_at: 5, size_bytes: 9 }),
            meta('a', { created_at: 5, size_bytes: 9 }),
            meta('d', { created_at: 5, size_bytes: 9 }),
            meta('c', { created_at: 5, size_bytes: 9 }),
        ];
        await seed(rows);

        const newest = await listImagePage({
            state: 'active',
            sort: 'newest',
            limit: 3,
        });
        expect(newest.items.map((item) => item.hash)).toEqual(['d', 'c', 'b']);
        const next = await listImagePage({
            state: 'active',
            sort: 'newest',
            limit: 3,
            cursor: newest.nextCursor,
        });
        expect(next.items.map((item) => item.hash)).toEqual(['a']);

        const smallest = await listImagePage({
            state: 'active',
            sort: 'smallest',
            limit: 4,
        });
        expect(smallest.items.map((item) => item.hash)).toEqual([
            'a',
            'b',
            'c',
            'd',
        ]);
    });

    it('pages oldest, largest, and smallest orders', async () => {
        await seed([
            meta('h1', { created_at: 1, size_bytes: 30 }),
            meta('h2', { created_at: 2, size_bytes: 10 }),
            meta('h3', { created_at: 3, size_bytes: 20 }),
        ]);

        const oldest = await listImagePage({
            state: 'active',
            sort: 'oldest',
            limit: 2,
        });
        expect(oldest.items.map((item) => item.hash)).toEqual(['h1', 'h2']);

        const largest = await listImagePage({
            state: 'active',
            sort: 'largest',
            limit: 2,
        });
        expect(largest.items.map((item) => item.hash)).toEqual(['h1', 'h3']);

        const smallest = await listImagePage({
            state: 'active',
            sort: 'smallest',
            limit: 2,
        });
        expect(smallest.items.map((item) => item.hash)).toEqual(['h2', 'h3']);
    });

    it('filters by membership while preserving order and page size', async () => {
        await seed(
            Array.from({ length: 10 }, (_, index) =>
                meta(`h${index}`, { created_at: index })
            )
        );
        const allowed = new Set(['h1', 'h3', 'h5', 'h7', 'h9']);
        const page = await listImagePage({
            state: 'active',
            sort: 'newest',
            limit: 3,
            hashes: allowed,
        });
        expect(page.items.map((item) => item.hash)).toEqual(['h9', 'h7', 'h5']);
        expect(page.hasMore).toBe(true);
        const next = await listImagePage({
            state: 'active',
            sort: 'newest',
            limit: 3,
            cursor: page.nextCursor,
            hashes: allowed,
        });
        expect(next.items.map((item) => item.hash)).toEqual(['h3', 'h1']);
        expect(next.hasMore).toBe(false);
    });

    it('keeps active and trash views separate', async () => {
        await seed([
            meta('active-1'),
            meta('active-2', { deleted: false }),
            meta('trash-1', { deleted: true }),
            meta('trash-2', { deleted: true }),
        ]);
        const active = await listImagePage({
            state: 'active',
            sort: 'newest',
            limit: 50,
        });
        expect(active.items.map((item) => item.hash)).toEqual([
            'active-2',
            'active-1',
        ]);
        const trash = await listImagePage({
            state: 'trash',
            sort: 'newest',
            limit: 50,
        });
        expect(trash.items.map((item) => item.hash)).toEqual(['trash-2', 'trash-1']);
    });

    it('includes legacy raster rows and excludes generic image MIME files', async () => {
        await seed([
            meta('legacy', { kind: undefined }),
            meta('generic', { kind: 'file', mime_type: 'image/jpeg' }),
            meta('svg', { kind: 'file', mime_type: 'image/svg+xml' }),
            meta('pdf', { kind: 'pdf', mime_type: 'application/pdf' }),
        ]);
        const summaries = await listImageSummaries();
        expect(summaries.map((summary) => summary.hash)).toEqual(['legacy']);
        const page = await listImagePage({
            state: 'active',
            sort: 'newest',
            limit: 50,
        });
        expect(page.items.map((item) => item.hash)).toEqual(['legacy']);
    });

    it('bounds value reads during a page load', async () => {
        await seed(
            Array.from({ length: 120 }, (_, index) =>
                meta(`h${String(index).padStart(3, '0')}`, {
                    created_at: index,
                })
            )
        );
        reads = 0;
        await listImagePage({ state: 'active', sort: 'newest', limit: 50 });
        expect(reads).toBeLessThanOrEqual(51);
    });

    it('rejects invalid limits and mismatched cursors', async () => {
        await expect(
            listImagePage({ state: 'active', sort: 'newest', limit: 0 })
        ).rejects.toThrow('positive finite');
        await expect(
            listImagePage({ state: 'active', sort: 'newest', limit: Number.NaN })
        ).rejects.toThrow('positive finite');
        await expect(
            listImagePage({
                state: 'active',
                sort: 'newest',
                limit: 10,
                cursor: {
                    state: 'trash',
                    sort: 'newest',
                    last: [1, 'h1'],
                },
            })
        ).rejects.toThrow('does not match');
    });

    it('bounds every index scan to the requested partition', async () => {
        await seed([
            meta('active-1', { created_at: 1 }),
            meta('active-2', { created_at: 2 }),
            meta('trash-1', { created_at: 3, deleted: true }),
        ]);
        const betweenCalls: unknown[][] = [];
        const originalWhere = db.file_meta.where.bind(db.file_meta);
        const whereSpy = vi
            .spyOn(db.file_meta, 'where')
            .mockImplementation(((index: string) => {
                const clause = originalWhere(index) as unknown as {
                    between: (...args: unknown[]) => unknown;
                };
                const originalBetween = clause.between.bind(clause);
                clause.between = (...args: unknown[]) => {
                    betweenCalls.push(args);
                    return originalBetween(...args);
                };
                return clause;
            }) as never);
        try {
            // Empty partition: the first page must not walk the active keys.
            betweenCalls.length = 0;
            const emptyTrash = await listImagePage({
                state: 'trash',
                sort: 'newest',
                limit: 50,
            });
            expect(emptyTrash.items).toHaveLength(1);
            expect(betweenCalls).toHaveLength(1);
            expect(betweenCalls[0]![0]).toEqual(['trash', Dexie.minKey]);
            expect(betweenCalls[0]![1]).toEqual(['trash', Dexie.maxKey]);
            expect(betweenCalls[0]![2]).toBe(true);
            expect(betweenCalls[0]![3]).toBe(true);

            // Descending keyset continuation: exclusive upper cursor bound.
            const first = await listImagePage({
                state: 'active',
                sort: 'newest',
                limit: 1,
            });
            betweenCalls.length = 0;
            await listImagePage({
                state: 'active',
                sort: 'newest',
                limit: 1,
                cursor: first.nextCursor,
            });
            expect(betweenCalls).toHaveLength(1);
            expect(betweenCalls[0]![0]).toEqual(['active', Dexie.minKey]);
            expect(betweenCalls[0]![1]).toEqual([
                'active',
                first.nextCursor!.last[0],
                first.nextCursor!.last[1],
            ]);
            expect(betweenCalls[0]![2]).toBe(true);
            expect(betweenCalls[0]![3]).toBe(false);

            // Ascending keyset continuation: exclusive lower cursor bound.
            const oldest = await listImagePage({
                state: 'active',
                sort: 'oldest',
                limit: 1,
            });
            betweenCalls.length = 0;
            await listImagePage({
                state: 'active',
                sort: 'oldest',
                limit: 1,
                cursor: oldest.nextCursor,
            });
            expect(betweenCalls).toHaveLength(1);
            expect(betweenCalls[0]![0]).toEqual([
                'active',
                oldest.nextCursor!.last[0],
                oldest.nextCursor!.last[1],
            ]);
            expect(betweenCalls[0]![1]).toEqual(['active', Dexie.maxKey]);
            expect(betweenCalls[0]![2]).toBe(false);
            expect(betweenCalls[0]![3]).toBe(true);
        } finally {
            whereSpy.mockRestore();
        }
    });

    it('hydrates requested hashes in order and skips missing rows', async () => {
        await seed([meta('a'), meta('b'), meta('c')]);
        const items = await getImageMetasByHashes(['c', 'missing', 'a']);
        expect(items.map((item) => item.hash)).toEqual(['c', 'a']);
    });

    it('orders names with locale-aware comparison and hash tie-breakers', async () => {
        await seed([
            meta('h1', { name: 'apple.png' }),
            meta('h2', { name: 'Ápple.png' }),
            meta('h3', { name: 'banana.png' }),
        ]);
        const summaries = await listImageSummaries();
        const asc = orderImageSummariesByName(summaries, 'name-asc');
        expect(asc.slice(0, 2).sort()).toEqual(['h1', 'h2']);
        expect(asc[2]).toBe('h3');
        const desc = orderImageSummariesByName(summaries, 'name-desc');
        expect(desc[0]).toBe('h3');
        expect(desc.slice(1).sort()).toEqual(['h1', 'h2']);
    });

    it('computes global counts from the compact corpus', async () => {
        await seed([
            meta('gen-1', { name: 'gen-image-1.png' }),
            meta('upload-1', { name: 'photo.png' }),
            meta('used-1', { name: 'hero.png' }),
            meta('trash-1', { name: 'old.png', deleted: true }),
        ]);
        const summaries = await listImageSummaries();
        expect(
            imageSummaryCounts(summaries, new Set(['used-1', 'trash-1']))
        ).toEqual({
            all: 3,
            uploads: 2,
            generated: 1,
            'used-in-docs': 1,
            trash: 1,
        });
    });
});
