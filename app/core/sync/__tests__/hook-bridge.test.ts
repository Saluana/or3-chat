import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HookBridge } from '../hook-bridge';

const hookState = vi.hoisted(() => ({
    doAction: vi.fn(async () => undefined),
    applyFiltersSync: vi.fn((_: string, blocklist: string[]) => blocklist),
}));

vi.mock('~/core/hooks/useHooks', () => ({
    useHooks: () => ({
        doAction: hookState.doAction,
        _engine: {
            applyFiltersSync: hookState.applyFiltersSync,
        },
    }),
}));

describe('HookBridge', () => {
    beforeEach(() => {
        hookState.doAction.mockClear();
        hookState.applyFiltersSync.mockClear();
    });

    it('throws when pending_ops is outside transaction scope', () => {
        const db = {
            name: 'test-db',
            tables: [{ name: 'pending_ops' }, { name: 'tombstones' }, { name: 'messages' }],
            pending_ops: {
                add: vi.fn(async () => undefined),
            },
            tombstones: {
                put: vi.fn(async () => undefined),
            },
        };

        const tx = {
            storeNames: ['messages'],
            on: vi.fn(),
            table: vi.fn(() => ({
                add: vi.fn(),
                put: vi.fn(),
            })),
        };

        const bridge = new HookBridge(db as any);
        expect(() =>
            (bridge as unknown as {
                captureWrite: (
                    tx: unknown,
                    tableName: string,
                    operation: 'put' | 'delete',
                    pk: unknown,
                    payload: unknown
                ) => void;
            }).captureWrite(tx, 'messages', 'put', 'm1', {
                id: 'm1',
                thread_id: 't1',
                role: 'user',
                index: 0,
                order_key: '0000000000001:0000:node',
                deleted: false,
                created_at: 1,
                updated_at: 1,
                clock: 1,
            })
        ).toThrowError(
            '[HookBridge] Non-atomic sync capture: pending_ops missing from transaction scope'
        );

        expect(
            hookState.doAction.mock.calls.some(
                (call) => (call as unknown[])[0] === 'sync.capture:action:nonAtomic'
            )
        ).toBe(true);
        expect(db.pending_ops.add).not.toHaveBeenCalled();
    });

    it('suppresses capture for equivalent Dexie transaction wrappers', () => {
        const db = {
            name: 'test-db',
            tables: [{ name: 'pending_ops' }, { name: 'messages' }],
            table: vi.fn(() => ({ hook: vi.fn() })),
        };

        const bridge = new HookBridge(db as any);
        const nativeTransaction = {};
        const markedTx = { idbtrans: nativeTransaction } as any;
        const wrappedTx = { idbtrans: nativeTransaction } as any;

        bridge.markSyncTransaction(markedTx);

        const isSyncTransaction = (
            bridge as unknown as {
                isSyncTransaction: (tx: unknown) => boolean;
            }
        ).isSyncTransaction.bind(bridge);

        expect(isSyncTransaction(wrappedTx)).toBe(true);
    });
});
