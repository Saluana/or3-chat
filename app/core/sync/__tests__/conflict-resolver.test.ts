import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SyncChange } from '~~/shared/sync/types';
import { ConflictResolver } from '../conflict-resolver';
import { createMemoryTable, createMockDb } from './sync-test-utils';

const hookState = vi.hoisted(() => ({
    doAction: vi.fn(),
}));

const hookBridgeState = vi.hoisted(() => ({
    markSyncTransaction: vi.fn(),
}));

vi.mock('~/core/hooks/useHooks', () => ({
    useHooks: () => ({
        doAction: hookState.doAction,
    }),
}));

vi.mock('~/core/sync/hook-bridge', () => ({
    getHookBridge: () => ({
        markSyncTransaction: hookBridgeState.markSyncTransaction,
    }),
}));

vi.mock('~/db/util', () => ({
    nowSec: vi.fn(() => 777),
}));

type MessageRow = {
    id: string;
    clock: number;
    hlc?: string;
    deleted?: boolean;
    deleted_at?: number;
    thread_id?: string;
    role?: string;
    index?: number;
    order_key?: string;
    created_at?: number;
    updated_at?: number;
};

/**
 * Build a complete message payload with all required fields
 */
function buildMessagePayload(partial: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        id: 'm1',
        thread_id: 't1',
        role: 'user',
        index: 0,
        order_key: '0000000000001:0000:node',
        deleted: false,
        created_at: 1000,
        updated_at: 1000,
        clock: 1,
        ...partial,
    };
}

function buildChange({
    pk,
    op,
    clock,
    hlc,
    payload,
}: {
    pk: string;
    op: 'put' | 'delete';
    clock: number;
    hlc: string;
    payload?: Record<string, unknown>;
}): SyncChange {
    return {
        serverVersion: 1,
        tableName: 'messages',
        pk,
        op,
        payload,
        stamp: {
            clock,
            hlc,
            deviceId: 'device-1',
            opId: 'op-1',
        },
    };
}

describe('ConflictResolver', () => {
    beforeEach(() => {
        hookState.doAction.mockClear();
        hookBridgeState.markSyncTransaction.mockClear();
    });

    it('applies remote put when local record is missing', async () => {
        const table = createMemoryTable<MessageRow>('id');
        const tombstones = createMemoryTable<any>('id');
        const db = createMockDb({ messages: table, tombstones });
        const resolver = new ConflictResolver(db as any);

        const change = buildChange({
            pk: 'm1',
            op: 'put',
            clock: 1,
            hlc: '0000000000001:0000:node',
            payload: buildMessagePayload({ id: 'm1', text: 'hello' }),
        });

        const result = await resolver.applyChanges([change]);

        const stored = await table.get('m1');
        expect(result.applied).toBe(1);
        expect(stored?.clock).toBe(1);
        expect(stored?.hlc).toBe(change.stamp.hlc);
    });

    it('applies remote delete when clock is higher', async () => {
        const table = createMemoryTable<MessageRow>('id', [
            { id: 'm1', clock: 1, hlc: '0000000000001:0000:node' },
        ]);
        const tombstones = createMemoryTable<any>('id');
        const db = createMockDb({ messages: table, tombstones });
        const resolver = new ConflictResolver(db as any);

        const change = buildChange({
            pk: 'm1',
            op: 'delete',
            clock: 2,
            hlc: '0000000000002:0000:node',
        });

        const result = await resolver.applyChanges([change]);
        const stored = await table.get('m1');

        expect(result.applied).toBe(1);
        expect(stored?.deleted).toBe(true);
        expect(stored?.clock).toBe(2);
        expect(stored?.deleted_at).toBe(777);
    });

    it('uses HLC tie-breaker and emits conflict hook', async () => {
        const table = createMemoryTable<MessageRow>('id', [
            { id: 'm1', clock: 2, hlc: '0000000000002:0001:node' },
        ]);
        const tombstones = createMemoryTable<any>('id');
        const db = createMockDb({ messages: table, tombstones });
        const resolver = new ConflictResolver(db as any);

        const change = buildChange({
            pk: 'm1',
            op: 'put',
            clock: 2,
            hlc: '0000000000002:0002:node',
            payload: buildMessagePayload({ id: 'm1', text: 'remote', clock: 2 }),
        });

        const result = await resolver.applyChanges([change]);
        const stored = await table.get('m1');

        expect(result.conflicts).toBe(1);
        expect(stored?.hlc).toBe(change.stamp.hlc);
        expect(hookState.doAction).toHaveBeenCalledWith(
            'sync.conflict:action:detected',
            expect.objectContaining({ winner: 'remote' })
        );
    });

    it('keeps local record when HLC tie-breaker favors local', async () => {
        const table = createMemoryTable<MessageRow>('id', [
            { id: 'm1', clock: 2, hlc: '0000000000002:0002:node' },
        ]);
        const tombstones = createMemoryTable<any>('id');
        const db = createMockDb({ messages: table, tombstones });
        const resolver = new ConflictResolver(db as any);

        const change = buildChange({
            pk: 'm1',
            op: 'put',
            clock: 2,
            hlc: '0000000000002:0001:node',
            payload: buildMessagePayload({ id: 'm1', text: 'remote', clock: 2 }),
        });

        const result = await resolver.applyChanges([change]);
        const stored = await table.get('m1');

        expect(result.applied).toBe(0);
        expect(stored?.hlc).toBe('0000000000002:0002:node');
        expect(hookState.doAction).toHaveBeenCalledWith(
            'sync.conflict:action:detected',
            expect.objectContaining({ winner: 'local' })
        );
    });
});
