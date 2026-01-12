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
        orderBy(_field: string) {
            let reverse = false;
            let predicate: (meta: FileMeta) => boolean = () => true;
            let offset = 0;
            let limit: number | undefined;
            const chain = {
                reverse() {
                    reverse = !reverse;
                    return chain;
                },
                filter(fn: (meta: FileMeta) => boolean) {
                    predicate = fn;
                    return chain;
                },
                offset(v: number) {
                    offset = v;
                    return chain;
                },
                limit(v: number) {
                    limit = v;
                    return chain;
                },
                async toArray() {
                    let result = [...rows].sort(
                        (a, b) => (a.updated_at ?? 0) - (b.updated_at ?? 0)
                    );
                    if (reverse) result.reverse();
                    result = result.filter(predicate);
                    if (offset) result = result.slice(offset);
                    if (limit !== undefined) result = result.slice(0, limit);
                    return result;
                },
            };
            return chain;
        },
        async get(hash: string) {
            return rows.find((row) => row.hash === hash);
        },
        async put(meta: FileMeta) {
            const idx = rows.findIndex((row) => row.hash === meta.hash);
            if (idx >= 0) rows[idx] = meta;
            else rows.push(meta);
        },
    };
    return { db: { file_meta: table } };
});

const nowSecState = vi.hoisted(() => ({ value: 0 }));

vi.mock('../util', () => ({
    nowSec: vi.fn(() => nowSecState.value),
    nextClock: vi.fn((clock?: number) => (clock ?? 0) + 1),
}));

import { listImageMetasPaged, updateFileName } from '../files-select';
import { db } from '../client';

const table = db.file_meta as any;

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
    ref_count: 0,
    ...overrides,
});

describe('files-select helpers', () => {
    beforeEach(() => {
        table.__setRows([]);
        nowSecState.value = 1000;
    });

    describe('listImageMetasPaged', () => {
        it('filters non-image and deleted entries, returns newest first with paging', async () => {
            const metas = [
                baseMeta({ hash: 'keep-1', updated_at: 2 }),
                baseMeta({
                    hash: 'skip-deleted',
                    updated_at: 3,
                    deleted: true,
                }),
                baseMeta({ hash: 'keep-2', updated_at: 5 }),
                baseMeta({
                    hash: 'skip-kind',
                    updated_at: 6,
                    kind: 'pdf',
                    mime_type: 'application/pdf',
                }),
                baseMeta({
                    hash: 'keep-3',
                    updated_at: 4,
                    mime_type: 'image/jpeg',
                }),
            ];
            table.__setRows(metas);

            const firstPage = await listImageMetasPaged(0, 2);
            expect(firstPage.map((m) => m.hash)).toEqual(['keep-2', 'keep-3']);

            const secondPage = await listImageMetasPaged(2, 2);
            expect(secondPage.map((m) => m.hash)).toEqual(['keep-1']);
        });
    });

    describe('updateFileName', () => {
        it('updates the stored name and bumps updated_at', async () => {
            const original = baseMeta({
                hash: 'rename-me',
                name: 'Old',
                updated_at: 10,
            });
            table.__setRows([original]);
            nowSecState.value = 1234;

            await updateFileName('rename-me', 'New Name');

            const rows: FileMeta[] = table.__rows;
            expect(rows).toHaveLength(1);
            const stored = rows[0]!;
            expect(stored.name).toBe('New Name');
            expect(stored.updated_at).toBe(1234);
        });

        it('does nothing when the hash is unknown', async () => {
            table.__setRows([]);

            await updateFileName('missing', 'Name');

            expect(table.__rows).toHaveLength(0);
        });
    });
});
