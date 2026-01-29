import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FileMeta } from '../schema';

const tableState = vi.hoisted(() => {
    const rows: FileMeta[] = [];
    return {
        rows,
        setRows(data: FileMeta[]) {
            rows.splice(0, rows.length, ...data.map((item) => ({ ...item })));
        },
    };
});

vi.mock('../client', () => {
    const rows = tableState.rows;
    const table = {
        __rows: rows,
        __setRows(data: FileMeta[]) {
            tableState.setRows(data);
        },
        async get(hash: string) {
            return rows.find((row) => row.hash === hash);
        },
        async put(meta: FileMeta) {
            const idx = rows.findIndex((row) => row.hash === meta.hash);
            if (idx >= 0) rows[idx] = meta;
            else rows.push(meta);
        },
        async bulkGet(hashes: string[]) {
            return hashes.map((h) => rows.find((r) => r.hash === h));
        },
        async bulkPut(metas: FileMeta[]) {
            for (const meta of metas) {
                const idx = rows.findIndex((row) => row.hash === meta.hash);
                if (idx >= 0) rows[idx] = meta;
                else rows.push(meta);
            }
        },
    };

    const mockDb = {
        file_meta: table,
        file_blobs: {
            async get() {
                return undefined;
            },
            async put() {},
            async delete() {},
        },
        transaction: async (
            _mode: string,
            _tables: unknown,
            fn: () => Promise<void>
        ) => {
            await fn();
        },
    };

    return { db: mockDb, getDb: () => mockDb };
});

const nowSecState = vi.hoisted(() => ({ value: 0 }));

vi.mock('../util', () => ({
    nowSec: vi.fn(() => nowSecState.value),
    nextClock: vi.fn((clock?: number) => (clock ?? 0) + 1),
    parseOrThrow: vi.fn((schema, data) => data),
}));

vi.mock('../../core/hooks/useHooks', () => ({
    useHooks: vi.fn(() => ({
        doAction: vi.fn(async () => {}),
        applyFilters: vi.fn(async (_, data) => data),
    })),
}));

import { softDeleteFile, softDeleteMany } from '../files';
import { db } from '../client';

const table = db.file_meta as unknown as {
    __rows: FileMeta[];
    __setRows: (data: FileMeta[]) => void;
    get: (hash: string) => Promise<FileMeta | undefined>;
    put: (meta: FileMeta) => Promise<void>;
    bulkGet: (hashes: string[]) => Promise<(FileMeta | undefined)[]>;
};

const baseMeta = (overrides: Partial<FileMeta>): FileMeta => ({
    hash: 'hash-' + Math.random().toString(16).slice(2),
    name: 'Image',
    kind: 'image',
    mime_type: 'image/png',
    size_bytes: 0,
    width: 1,
    height: 1,
    clock: 0,
    created_at: 1,
    updated_at: 1,
    deleted: false,
    page_count: undefined,
    ref_count: 1,
    ...overrides,
});

describe('files soft delete', () => {
    beforeEach(() => {
        table.__setRows([]);
        nowSecState.value = 1000;
    });

    describe('softDeleteFile', () => {
        it('sets deleted_at timestamp on soft delete', async () => {
            const meta = baseMeta({ hash: 'test-hash', deleted: false });
            table.__setRows([meta]);
            nowSecState.value = 12345;

            await softDeleteFile('test-hash');

            const stored = table.__rows.find((r) => r.hash === 'test-hash');
            expect(stored).toBeDefined();
            expect(stored!.deleted).toBe(true);
            expect(stored!.deleted_at).toBe(12345);
            expect(stored!.updated_at).toBe(12345);
        });

        it('does nothing when hash is not found', async () => {
            table.__setRows([]);

            await softDeleteFile('missing-hash');

            expect(table.__rows).toHaveLength(0);
        });
    });

    describe('softDeleteMany', () => {
        it('sets deleted_at timestamp on all soft-deleted files', async () => {
            const metas = [
                baseMeta({ hash: 'hash-1', deleted: false }),
                baseMeta({ hash: 'hash-2', deleted: false }),
                baseMeta({ hash: 'hash-3', deleted: false }),
            ];
            table.__setRows(metas);
            nowSecState.value = 99999;

            await softDeleteMany(['hash-1', 'hash-2', 'hash-3']);

            for (const hash of ['hash-1', 'hash-2', 'hash-3']) {
                const stored = table.__rows.find((r) => r.hash === hash);
                expect(stored).toBeDefined();
                expect(stored!.deleted).toBe(true);
                expect(stored!.deleted_at).toBe(99999);
            }
        });

        it('skips already deleted files', async () => {
            const metas = [
                baseMeta({ hash: 'already-deleted', deleted: true, deleted_at: 100 }),
                baseMeta({ hash: 'not-deleted', deleted: false }),
            ];
            table.__setRows(metas);
            nowSecState.value = 500;

            await softDeleteMany(['already-deleted', 'not-deleted']);

            // Already deleted should keep original deleted_at
            const alreadyDeleted = table.__rows.find(
                (r) => r.hash === 'already-deleted'
            );
            expect(alreadyDeleted!.deleted_at).toBe(100);

            // Not deleted should get new deleted_at
            const notDeleted = table.__rows.find((r) => r.hash === 'not-deleted');
            expect(notDeleted!.deleted).toBe(true);
            expect(notDeleted!.deleted_at).toBe(500);
        });

        it('handles empty and duplicate hashes', async () => {
            const metas = [baseMeta({ hash: 'single', deleted: false })];
            table.__setRows(metas);
            nowSecState.value = 1000;

            await softDeleteMany(['single', 'single', '', 'single']);

            const stored = table.__rows.find((r) => r.hash === 'single');
            expect(stored!.deleted).toBe(true);
            expect(stored!.deleted_at).toBe(1000);
        });
    });
});
