import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { restoreMany } from '../files';
import { getDb } from '../client';
import type { FileMeta } from '../schema';

const mocks = vi.hoisted(() => ({
    doAction: vi.fn(async () => {}),
    applyFilters: vi.fn(async (_: string, val: any) => val),
    nowSec: 1234567890,
}));

vi.mock('../../core/hooks/useHooks', () => ({
    useHooks: () => ({
        doAction: mocks.doAction,
        applyFilters: mocks.applyFilters,
    }),
}));

vi.mock('../util', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../util')>();
    return {
        ...actual,
        nowSec: () => mocks.nowSec,
    };
});

describe('restoreMany', () => {
    beforeEach(async () => {
        const db = getDb();
        await db.open();
        await db.file_meta.clear();
        mocks.doAction.mockClear();
    });

    it('restores deleted files', async () => {
        const db = getDb();
        const metas: FileMeta[] = [
            {
                hash: 'h1',
                name: 'f1',
                kind: 'image',
                mime_type: 'image/png',
                size_bytes: 10,
                deleted: true,
                deleted_at: 1000,
                clock: 1,
                created_at: 1000,
                updated_at: 1000,
                ref_count: 1
            },
            {
                hash: 'h2',
                name: 'f2',
                kind: 'image',
                mime_type: 'image/png',
                size_bytes: 20,
                deleted: true,
                deleted_at: 1000,
                clock: 2,
                created_at: 1000,
                updated_at: 1000,
                ref_count: 1
            }
        ];
        await db.file_meta.bulkPut(metas);

        await restoreMany(['h1', 'h2']);

        const restored = await db.file_meta.bulkGet(['h1', 'h2']);
        expect(restored[0]!.deleted).toBe(false);
        expect(restored[0]!.updated_at).toBe(mocks.nowSec);
        expect(restored[0]!.clock).toBeGreaterThan(1);

        expect(restored[1]!.deleted).toBe(false);
        expect(restored[1]!.updated_at).toBe(mocks.nowSec);

        expect(mocks.doAction).toHaveBeenCalledTimes(4); // 2 before, 2 after
    });

    it('ignores non-deleted files', async () => {
        const db = getDb();
        const metas: FileMeta[] = [
            {
                hash: 'h3',
                name: 'f3',
                kind: 'image',
                mime_type: 'image/png',
                size_bytes: 10,
                deleted: false, // Already active
                clock: 1,
                created_at: 1000,
                updated_at: 1000,
                ref_count: 1
            }
        ];
        await db.file_meta.put(metas[0]!);

        await restoreMany(['h3']);

        const meta = await db.file_meta.get('h3');
        expect(meta!.updated_at).toBe(1000); // Not changed
        expect(mocks.doAction).not.toHaveBeenCalled();
    });

    it('handles missing files gracefully', async () => {
        await restoreMany(['missing-hash']);
        expect(mocks.doAction).not.toHaveBeenCalled();
    });
});
