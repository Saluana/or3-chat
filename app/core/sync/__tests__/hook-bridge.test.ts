import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HookBridge } from '../hook-bridge';

const hookState = vi.hoisted(() => ({
    doAction: vi.fn(async () => undefined),
    applyFiltersSync: vi.fn((_: string, blocklist: string[]) => blocklist),
}));

vi.mock('~/core/hooks/useHooks', () => ({
    useHooks: () => ({
        doAction: hookState.doAction as any,
        _engine: {
            applyFiltersSync: hookState.applyFiltersSync as any,
        },
    }),
}));

vi.mock('../hlc', () => ({
    generateHLC: () => '0000000000001:0000:device-1',
    getDeviceId: () => 'device-1',
    hlcToOrderKey: (hlc: string) => `order:${hlc}`,
}));

vi.mock('../recent-op-cache', () => ({
    markRecentOpId: vi.fn(),
}));

type TxTable = {
    add: ReturnType<typeof vi.fn>;
    put: ReturnType<typeof vi.fn>;
};

function makeTx(storeNames: string[]) {
    const pendingOps: unknown[] = [];
    const tombstones: unknown[] = [];
    const tableMap: Record<string, TxTable> = {
        pending_ops: {
            add: vi.fn((row: unknown) => {
                pendingOps.push(row);
            }),
            put: vi.fn(),
        },
        tombstones: {
            add: vi.fn(),
            put: vi.fn((row: unknown) => {
                tombstones.push(row);
            }),
        },
    };

    return {
        tx: {
            storeNames,
            table: (name: string) => tableMap[name],
        },
        pendingOps,
        tombstones,
    };
}

function makeDbWithHookableTable(tableNames: string[]) {
    const hookFns = new Map<string, (...args: unknown[]) => void>();
    const tables = tableNames.map((name) => ({ name }));

    const db = {
        name: 'test-db',
        tables,
        table: (name: string) => ({
            hook: (kind: string, fn: (...args: unknown[]) => void) => {
                hookFns.set(`${name}:${kind}`, fn);
            },
        }),
        pending_ops: { add: vi.fn() },
        tombstones: { put: vi.fn() },
    };

    return { db, hookFns };
}

describe('HookBridge', () => {
    beforeEach(() => {
        hookState.doAction.mockClear();
        hookState.applyFiltersSync.mockClear();
        hookState.applyFiltersSync.mockImplementation((_: string, blocklist: string[]) => blocklist);
    });

    it('captures put operations into pending_ops', () => {
        const { db } = makeDbWithHookableTable(['messages', 'pending_ops', 'tombstones']);
        const { tx, pendingOps } = makeTx(['messages', 'pending_ops', 'tombstones']);

        const bridge = new HookBridge(db as any);
        (bridge as any).captureWrite(tx, 'messages', 'put', 'm1', {
            id: 'm1',
            thread_id: 't1',
            role: 'user',
            index: 0,
            deleted: false,
            created_at: 1,
            updated_at: 1,
            clock: 1,
        });

        expect(pendingOps).toHaveLength(1);
        expect(pendingOps[0]).toEqual(expect.objectContaining({ tableName: 'messages', operation: 'put', pk: 'm1' }));
    });

    it('suppresses capture for marked sync transactions (including wrappers)', () => {
        const { db } = makeDbWithHookableTable(['messages', 'pending_ops', 'tombstones']);
        const bridge = new HookBridge(db as any);

        const nativeTransaction = {};
        const markedTx = { idbtrans: nativeTransaction } as any;
        const wrappedTx = { idbtrans: nativeTransaction } as any;

        bridge.markSyncTransaction(markedTx);

        const isSyncTransaction = (bridge as any).isSyncTransaction.bind(bridge);
        expect(isSyncTransaction(wrappedTx)).toBe(true);
    });

    it('start() tolerates missing synced tables without crashing', () => {
        const { db } = makeDbWithHookableTable(['messages', 'pending_ops', 'tombstones']);
        const bridge = new HookBridge(db as any);

        expect(() => bridge.start()).not.toThrow();
    });

    it('merges dotted update keys into nested payload structure', () => {
        const { db, hookFns } = makeDbWithHookableTable(['messages', 'pending_ops', 'tombstones']);
        const { tx, pendingOps } = makeTx(['messages', 'pending_ops', 'tombstones']);
        const bridge = new HookBridge(db as any);

        bridge.start();

        const updating = hookFns.get('messages:updating');
        expect(updating).toBeTypeOf('function');

        updating?.(
            { 'meta.nested.value': 42 },
            'm1',
            {
                id: 'm1',
                thread_id: 't1',
                role: 'user',
                index: 0,
                deleted: false,
                created_at: 1,
                updated_at: 1,
                clock: 1,
                meta: {},
            },
            tx
        );

        const payload = (pendingOps[0] as any).payload;
        expect(payload.meta.nested.value).toBe(42);
    });

    it('skips capture for empty primary keys', () => {
        const { db } = makeDbWithHookableTable(['messages', 'pending_ops', 'tombstones']);
        const { tx, pendingOps } = makeTx(['messages', 'pending_ops', 'tombstones']);
        const bridge = new HookBridge(db as any);

        (bridge as any).captureWrite(tx, 'messages', 'put', '', { id: '', thread_id: 't1', role: 'user', index: 0 });
        expect(pendingOps).toHaveLength(0);
    });

    it('applies kv sync blocklist defaults and hook-extended entries', () => {
        const { db } = makeDbWithHookableTable(['kv', 'pending_ops', 'tombstones']);
        const bridge = new HookBridge(db as any);

        const first = makeTx(['kv', 'pending_ops']);
        (bridge as any).captureWrite(first.tx, 'kv', 'put', 'kv:MODELS_CATALOG', {
            id: 'kv:MODELS_CATALOG',
            name: 'MODELS_CATALOG',
            value: '{}',
            created_at: 1,
            updated_at: 1,
            clock: 1,
        });
        expect(first.pendingOps).toHaveLength(0);

        hookState.applyFiltersSync.mockImplementation((_name, blocklist: string[]) => [
            ...blocklist,
            'custom_blocked',
        ]);

        const second = makeTx(['kv', 'pending_ops']);
        (bridge as any).captureWrite(second.tx, 'kv', 'put', 'kv:custom_blocked', {
            id: 'kv:custom_blocked',
            name: 'custom_blocked',
            value: '{}',
            created_at: 1,
            updated_at: 1,
            clock: 1,
        });
        expect(second.pendingOps).toHaveLength(0);
    });

    it('skips pending/corrupt message payloads and auto-generates order_key', () => {
        const { db } = makeDbWithHookableTable(['messages', 'pending_ops', 'tombstones']);
        const bridge = new HookBridge(db as any);

        const pendingTx = makeTx(['messages', 'pending_ops', 'tombstones']);
        (bridge as any).captureWrite(pendingTx.tx, 'messages', 'put', 'm1', {
            id: 'm1',
            pending: true,
            thread_id: 't1',
            role: 'assistant',
            index: 0,
            deleted: false,
            created_at: 1,
            updated_at: 1,
            clock: 1,
        });
        expect(pendingTx.pendingOps).toHaveLength(0);

        const corruptTx = makeTx(['messages', 'pending_ops', 'tombstones']);
        (bridge as any).captureWrite(corruptTx.tx, 'messages', 'put', 'm2', {
            id: 'm2',
            role: 'assistant',
            deleted: false,
            created_at: 1,
            updated_at: 1,
            clock: 1,
        });
        expect(corruptTx.pendingOps).toHaveLength(0);

        const validTx = makeTx(['messages', 'pending_ops', 'tombstones']);
        const msg: Record<string, unknown> = {
            id: 'm3',
            thread_id: 't1',
            role: 'assistant',
            index: 1,
            deleted: false,
            created_at: 1,
            updated_at: 1,
            clock: 1,
        };
        (bridge as any).captureWrite(validTx.tx, 'messages', 'put', 'm3', msg);

        expect(validTx.pendingOps).toHaveLength(1);
        expect((validTx.pendingOps[0] as any).payload.order_key).toBe('order:0000000000001:0000:device-1');
    });

    it('captures delete operations and writes tombstones', () => {
        const { db } = makeDbWithHookableTable(['messages', 'pending_ops', 'tombstones']);
        const { tx, pendingOps, tombstones } = makeTx(['messages', 'pending_ops', 'tombstones']);
        const bridge = new HookBridge(db as any);

        (bridge as any).captureWrite(tx, 'messages', 'delete', 'm1', {
            id: 'm1',
            clock: 2,
            deleted_at: 100,
        });

        expect(pendingOps).toHaveLength(1);
        expect((pendingOps[0] as any).operation).toBe('delete');
        expect(tombstones).toHaveLength(1);
        expect(tombstones[0]).toEqual(expect.objectContaining({ id: 'messages:m1', pk: 'm1' }));
    });

    it('throws non-atomic error when pending_ops/tombstones missing from tx scope', () => {
        const { db } = makeDbWithHookableTable(['messages', 'pending_ops', 'tombstones']);
        const bridge = new HookBridge(db as any);

        const { tx } = makeTx(['messages']);

        expect(() => {
            (bridge as any).captureWrite(tx, 'messages', 'put', 'm1', {
                id: 'm1',
                thread_id: 't1',
                role: 'assistant',
                index: 0,
                deleted: false,
                created_at: 1,
                updated_at: 1,
                clock: 1,
            });
        }).toThrow('[HookBridge] Non-atomic sync capture: pending_ops missing from transaction scope');

        expect(hookState.doAction).toHaveBeenCalledWith(
            'sync.capture:action:nonAtomic',
            expect.objectContaining({ tableName: 'messages', pk: 'm1' })
        );
    });
});
