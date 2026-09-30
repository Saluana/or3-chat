import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../utils/errors', () => ({
    reportError: vi.fn(),
    err: vi.fn((_code: string, _message: string, meta: any) => meta),
}));

vi.mock('../../core/sync/cursor-manager', () => ({
    cleanupCursorManager: vi.fn(),
    getCursorManager: vi.fn(() => ({})),
}));

type TableRecord = Record<string, any>;

const dbState = vi.hoisted(() => {
    const rows = new Map<string, TableRecord>();
    const tombstoneRows = new Map<string, TableRecord>();
    let onScan: (() => void) | undefined;
    let onRead: (() => void) | undefined;
    const table = {
        __rows: rows,
        async get(id: string) {
            return rows.get(id);
        },
        async put(row: TableRecord) {
            rows.set(String(row.id), { ...row });
        },
        async delete(id: string) {
            rows.delete(String(id));
        },
        where(field: string) {
            return {
                equals(value: string) {
                    return {
                        async first() {
                            onRead?.();
                            for (const row of rows.values()) {
                                if (String(row[field]) === value) return { ...row };
                            }
                            return undefined;
                        },
                    };
                },
                startsWith(prefix: string) {
                    return {
                        async toArray() {
                            onScan?.();
                            const out: TableRecord[] = [];
                            for (const row of rows.values()) {
                                if (String(row[field]).startsWith(prefix)) out.push({ ...row });
                            }
                            return out;
                        },
                    };
                },
            };
        },
    };
    const tombstoneTable = {
        __rows: tombstoneRows,
        async get(id: string) {
            return tombstoneRows.get(id);
        },
        async put(row: TableRecord) {
            tombstoneRows.set(String(row.id), { ...row });
        },
    };
    return {
        table,
        tombstoneTable,
        reset: () => {
            rows.clear();
            tombstoneRows.clear();
            onScan = undefined;
            onRead = undefined;
        },
        setOnScan: (fn: (() => void) | undefined) => {
            onScan = fn;
        },
        setOnRead: (fn: (() => void) | undefined) => {
            onRead = fn;
        },
    };
});

vi.mock('../client', async (original) => {
    const db = {
        kv: dbState.table,
        tombstones: dbState.tombstoneTable,
        tables: [{ name: 'kv' }, { name: 'tombstones' }],
        isOpen: () => true,
        async transaction(_mode: string, ...args: Array<unknown>) {
            const fn = args[args.length - 1];
            if (typeof fn === 'function') await (fn as () => Promise<void>)();
        },
    };
    return { ...await original<typeof import('../client')>(), getDb: () => db };
});

vi.mock('../../core/hooks/useHooks', () => ({
    useHooks: () => ({
        applyFilters: async (_name: string, value: unknown) => value,
        doAction: async () => {},
        _engine: { applyFiltersSync: (_name: string, value: unknown) => value },
    }),
}));

import { getKvRecordByName, setKvByName, tombstoneKvByName } from '../kv';
import { Or3DB } from '../client';
import { applySnapshotChain } from '../../core/sync/snapshot-applier';
import { getHookBridge, _resetHookBridge } from '../../core/sync/hook-bridge';

beforeEach(() => {
    dbState.reset();
});

describe('kv CAS guards', () => {
    it('rejects malformed revisions as invalid input', async () => {
        for (const ifClock of ['1', 1.5, Number.NaN, -1, Infinity]) {
            await expect(
                setKvByName('k', 'v', undefined, { ifClock: ifClock as number })
            ).rejects.toMatchObject({ rpcCode: 'invalid-input' });
        }
        expect(dbState.table.__rows.size).toBe(0);
    });

    it('delete preserves the revision chain so stale revisions cannot match a recreate', async () => {
        const first = await setKvByName('k', 'v1');
        expect(first.clock).toBe(1);
        await tombstoneKvByName('k');
        // Create-if-absent succeeds on the tombstoned key but continues the clock.
        const second = await setKvByName('k', 'v2', undefined, { ifClock: null });
        expect(second.clock).toBe(3);
        expect(second.deleted).toBe(false);
        await expect(
            setKvByName('k', 'stale', undefined, { ifClock: 1 })
        ).rejects.toMatchObject({ rpcCode: 'conflict', details: { currentRevision: 3 } });
    });

    it('refuses writes past the derived quota and frees quota on delete', async () => {
        const quota = { prefix: 's:', maxBytes: 10, maxKeys: 2 };
        await setKvByName('s:a', '"12345"', undefined, { quota });
        await expect(setKvByName('s:b', '"12345"', undefined, { quota })).rejects.toMatchObject({
            rpcCode: 'quota-exceeded',
        });
        await setKvByName('s:a', '"1"', undefined, { quota });
        await setKvByName('s:b', '"12"', undefined, { quota });
        await expect(setKvByName('s:c', '"1"', undefined, { quota })).rejects.toMatchObject({
            rpcCode: 'quota-exceeded',
        });
        await tombstoneKvByName('s:a');
        await setKvByName('s:c', '"1"', undefined, { quota });
        // Usage is derived from live rows; no synchronized counter row is written.
        expect([...dbState.table.__rows.values()].map((row) => row.name).sort()).toEqual([
            's:a',
            's:b',
            's:c',
        ]);
    });

    it('continues revision history from sync tombstones after snapshot recovery', async () => {
        // Snapshot application physically removes deleted rows and keeps the
        // revision chain only in `tombstones`.
        await dbState.tombstoneTable.put({
            id: 'kv:kv:k',
            tableName: 'kv',
            pk: 'kv:k',
            clock: 2,
        });
        const created = await setKvByName('k', 'v', undefined, { ifClock: null });
        expect(created.clock).toBe(3);
        expect(created.deleted).toBe(false);
        await expect(
            setKvByName('k', 'stale', undefined, { ifClock: 1 })
        ).rejects.toMatchObject({ rpcCode: 'conflict', details: { currentRevision: 3 } });
    });

    it('aborts the write when cancellation lands after the quota read', async () => {
        const quota = { prefix: 'p:', maxBytes: 100, maxKeys: 5 };
        const controller = new AbortController();
        dbState.setOnScan(() => controller.abort('revoked'));
        await expect(
            setKvByName('p:a', 'v', undefined, { signal: controller.signal, quota })
        ).rejects.toMatchObject({ rpcCode: 'cancelled' });
        expect(dbState.table.__rows.has('kv:p:a')).toBe(false);
    });

    it('aborts the delete when cancellation lands after the in-transaction re-read', async () => {
        await setKvByName('k', 'v');
        const controller = new AbortController();
        let reads = 0;
        dbState.setOnRead(() => {
            reads += 1;
            if (reads === 2) controller.abort('revoked');
        });
        await expect(
            tombstoneKvByName('k', undefined, { signal: controller.signal })
        ).rejects.toMatchObject({ rpcCode: 'cancelled' });
        expect(dbState.table.__rows.get('kv:k')!.deleted).toBe(false);
    });

    it('tombstone is a no-op when absent or already deleted', async () => {
        await tombstoneKvByName('missing');
        await setKvByName('k', 'v');
        await tombstoneKvByName('k');
        const clock = dbState.table.__rows.get('kv:k')!.clock;
        await tombstoneKvByName('k');
        expect(dbState.table.__rows.get('kv:k')!.clock).toBe(clock);
        expect(dbState.table.__rows.get('kv:k')!.deleted).toBe(true);
    });
});

describe('KV transactions with IndexedDB', () => {
    let db: Or3DB;
    const quota = { prefix: 'p:', maxBytes: 100, maxKeys: 2, maxRetainedKeys: 3 };
    beforeEach(async () => {
        db = new Or3DB('kv-cas-' + crypto.randomUUID());
        await db.open();
    });
    afterEach(async () => { _resetHookBridge(); await db.delete(); });

    it('accounts for existing/imported rows without a synchronized counter', async () => {
        await setKvByName('p:a', 'a', db);
        await setKvByName('p:b', 'b', db);
        getHookBridge(db).start();
        await expect(setKvByName('p:c', 'c', db, { quota })).rejects.toMatchObject({ rpcCode: 'quota-exceeded' });
        await setKvByName('p:a', 'updated', db, { quota });
        expect((await db.pending_ops.toArray()).map((row) => row.pk)).toEqual(['kv:p:a']);
    });

    it('serializes concurrent admission and repeated deletes', async () => {
        const outcomes = await Promise.allSettled(['a', 'b', 'c'].map((key) => setKvByName(`p:${key}`, key, db, { quota })));
        expect(outcomes.filter((result) => result.status === 'fulfilled')).toHaveLength(2);
        const live = await db.kv.toArray();
        const name = live[0]!.name;
        await Promise.all([tombstoneKvByName(name, db), tombstoneKvByName(name, db)]);
        expect(await db.kv.get(`kv:${name}`)).toMatchObject({ deleted: true, clock: 2 });
        expect((await db.kv.toArray()).filter((row) => !row.deleted)).toHaveLength(1);
    });

    it('rolls back a mutation cancelled before its transaction completes', async () => {
        const abort = new AbortController();
        const put = db.kv.put.bind(db.kv);
        vi.spyOn(db.kv, 'put').mockImplementation((row) => put(row).then((id) => {
            abort.abort();
            return id;
        }));
        await expect(setKvByName('p:a', 'a', db, { quota, signal: abort.signal })).rejects.toMatchObject({ rpcCode: 'cancelled' });
        expect(await db.kv.count()).toBe(0);
    });

    it('bounds distinct retained names while allowing existing keys to be reused', async () => {
        for (const key of ['a', 'b', 'c']) {
            await setKvByName(`p:${key}`, key, db, { quota });
            await tombstoneKvByName(`p:${key}`, db);
        }
        await expect(setKvByName('p:d', 'd', db, { quota })).rejects.toMatchObject({ rpcCode: 'quota-exceeded' });
        expect((await setKvByName('p:a', 'new', db, { quota })).clock).toBe(3);
    });

    it('preserves CAS and retained-name limits through a real sync snapshot', async () => {
        await applySnapshotChain(db, [{
            workspaceId: 'w', snapshotId: 's', highWatermark: 3, nextPageToken: null,
            items: ['a', 'b', 'c'].map((key) => ({
                kind: 'tombstone' as const, tableName: 'kv' as const, pk: `kv:p:${key}`,
                revision: { clock: 2, hlc: '2:0:device', opId: `delete-${key}` }, serverDeletedAt: 2,
            })),
        }], { workspaceId: 'w' }, 'device');
        const record = await getKvRecordByName('p:a', db);
        expect(record).toEqual({ row: undefined, revision: 2 });
        await expect(setKvByName('p:d', 'd', db, { quota })).rejects.toMatchObject({ rpcCode: 'quota-exceeded' });
        expect((await setKvByName('p:a', 'new', db, { quota, ifClock: record.revision })).clock).toBe(3);
        await expect(setKvByName('p:a', 'stale', db, { quota, ifClock: 1 })).rejects.toMatchObject({ rpcCode: 'conflict' });
    });
});
