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
    op_id?: string;
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
    opId = 'op-1',
}: {
    pk: string;
    op: 'put' | 'delete';
    clock: number;
    hlc: string;
    payload?: Record<string, unknown>;
    opId?: string;
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
            opId,
        },
    };
}

describe('ConflictResolver', () => {
    beforeEach(() => {
        hookState.doAction.mockClear();
        hookBridgeState.markSyncTransaction.mockClear();
    });

    it('never imports remote file ref_count authority and preserves a valid local cache', async () => {
        const hash = `sha256:${'a'.repeat(64)}`;
        const table = createMemoryTable<Record<string, unknown>>('hash');
        const tombstones = createMemoryTable<Record<string, unknown>>('id');
        await table.put({
            hash,
            name: 'local.png',
            mime_type: 'image/png',
            kind: 'image',
            size_bytes: 10,
            ref_count: 3,
            deleted: false,
            created_at: 1,
            updated_at: 1,
            clock: 1,
            hlc: '0000000000001:0000:local',
            op_id: 'local-op',
        });
        const db = createMockDb({ file_meta: table, tombstones });
        const resolver = new ConflictResolver(db as never);

        await resolver.applyChanges([{
            serverVersion: 2,
            tableName: 'file_meta',
            pk: hash,
            op: 'put',
            payload: {
                hash,
                name: 'remote.png',
                mime_type: 'image/png',
                kind: 'image',
                size_bytes: 10,
                ref_count: Number.NaN,
                deleted: false,
                created_at: 1,
                updated_at: 2,
                clock: 2,
            },
            stamp: {
                clock: 2,
                hlc: '0000000000002:0000:remote',
                deviceId: 'remote',
                opId: 'remote-op',
            },
        }]);

        expect(await table.get(hash)).toMatchObject({
            name: 'remote.png',
            ref_count: 3,
            clock: 2,
        });
    });

    it('seeds remotely discovered file metadata with a finite zero ref_count', async () => {
        const hash = `sha256:${'b'.repeat(64)}`;
        const table = createMemoryTable<Record<string, unknown>>('hash');
        const tombstones = createMemoryTable<Record<string, unknown>>('id');
        const db = createMockDb({ file_meta: table, tombstones });
        const resolver = new ConflictResolver(db as never);

        await resolver.applyChanges([{
            serverVersion: 1,
            tableName: 'file_meta',
            pk: hash,
            op: 'put',
            payload: {
                hash,
                name: 'remote.png',
                mime_type: 'image/png',
                kind: 'image',
                size_bytes: 10,
                ref_count: 999_999,
                deleted: false,
                created_at: 1,
                updated_at: 1,
                clock: 1,
            },
            stamp: {
                clock: 1,
                hlc: '0000000000001:0000:remote',
                deviceId: 'remote',
                opId: 'remote-op',
            },
        }]);

        expect(await table.get(hash)).toMatchObject({ ref_count: 0 });
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

    it('resolves repeated page keys against the preceding applied revision', async () => {
        const table = createMemoryTable<MessageRow>('id');
        const tombstones = createMemoryTable<never>('id');
        const db = createMockDb({ messages: table, tombstones });
        const resolver = new ConflictResolver(db as never);

        const newer = buildChange({
            pk: 'm1',
            op: 'put',
            clock: 2,
            hlc: '0000000000002:0000:node',
            payload: buildMessagePayload({ id: 'm1', text: 'newer', clock: 2 }),
        });
        const older = buildChange({
            pk: 'm1',
            op: 'put',
            clock: 1,
            hlc: '0000000000001:0000:node',
            payload: buildMessagePayload({ id: 'm1', text: 'older', clock: 1 }),
        });

        const result = await resolver.applyChanges([newer, older]);
        const stored = await table.get('m1') as MessageRow & { text?: string };

        expect(result.applied).toBe(1);
        expect(result.skipped).toBe(1);
        expect(stored.clock).toBe(2);
        expect(stored.text).toBe('newer');
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
            { id: 'm1', clock: 2, hlc: '0000000000002:0002:node', op_id: 'op-1' },
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

    it('treats equal HLC put as idempotent duplicate (not conflict)', async () => {
        const table = createMemoryTable<MessageRow>('id', [
            { id: 'm1', clock: 2, hlc: '0000000000002:0002:node', op_id: 'op-1' },
        ]);
        const tombstones = createMemoryTable<any>('id');
        const db = createMockDb({ messages: table, tombstones });
        const resolver = new ConflictResolver(db as any);

        const change = buildChange({
            pk: 'm1',
            op: 'put',
            clock: 2,
            hlc: '0000000000002:0002:node',
            payload: buildMessagePayload({ id: 'm1', text: 'duplicate', clock: 2 }),
        });

        const result = await resolver.applyChanges([change]);
        const stored = await table.get('m1');

        expect(result.applied).toBe(0);
        expect(result.conflicts).toBe(0);
        expect(stored?.hlc).toBe('0000000000002:0002:node');
        expect(hookState.doAction).not.toHaveBeenCalledWith(
            'sync.conflict:action:detected',
            expect.anything()
        );
    });

    it('treats equal HLC delete as idempotent duplicate (not conflict)', async () => {
        const table = createMemoryTable<MessageRow>('id', [
            { id: 'm1', clock: 2, hlc: '0000000000002:0002:node', op_id: 'op-1', deleted: false },
        ]);
        const tombstones = createMemoryTable<any>('id');
        const db = createMockDb({ messages: table, tombstones });
        const resolver = new ConflictResolver(db as any);

        const change = buildChange({
            pk: 'm1',
            op: 'delete',
            clock: 2,
            hlc: '0000000000002:0002:node',
        });

        const result = await resolver.applyChanges([change]);
        const stored = await table.get('m1');

        expect(result.applied).toBe(0);
        expect(result.conflicts).toBe(0);
        expect(stored?.deleted).toBe(false);
        expect(hookState.doAction).not.toHaveBeenCalledWith(
            'sync.conflict:action:detected',
            expect.anything()
        );
    });

    it('uses operation ID as the final equal-clock/equal-HLC tie-breaker', async () => {
        const table = createMemoryTable<MessageRow>('id', [
            { id: 'm1', clock: 2, hlc: '0000000000002:0002:node', op_id: 'op-a' },
        ]);
        const tombstones = createMemoryTable<any>('id');
        const resolver = new ConflictResolver(createMockDb({ messages: table, tombstones }) as any);

        const result = await resolver.applyChanges([buildChange({
            pk: 'm1', op: 'put', clock: 2, hlc: '0000000000002:0002:node', opId: 'op-b',
            payload: buildMessagePayload({ id: 'm1', text: 'op-id-winner', clock: 2 }),
        })]);

        expect(result.applied).toBe(1);
        expect(await table.get('m1')).toMatchObject({ op_id: 'op-b', text: 'op-id-winner' });
    });

    it('fails closed on ambiguous legacy tombstone ties but accepts a proven newer tuple', async () => {
        const table = createMemoryTable<MessageRow>('id');
        const tombstones = createMemoryTable<any>('id', [{
            id: 'messages:m1', tableName: 'messages', pk: 'm1', deletedAt: 1, clock: 2,
        }]);
        const resolver = new ConflictResolver(createMockDb({ messages: table, tombstones }) as any);
        const payload = buildMessagePayload({ id: 'm1', text: 'candidate', clock: 2 });

        const ambiguous = await resolver.applyChanges([buildChange({
            pk: 'm1', op: 'put', clock: 2, hlc: '0000000000002:0002:node', opId: 'op-z', payload,
        })]);
        expect(ambiguous.applied).toBe(0);
        expect(await table.get('m1')).toBeUndefined();

        await tombstones.put({
            id: 'messages:m1', tableName: 'messages', pk: 'm1', deletedAt: 1, clock: 2,
            hlc: '0000000000002:0002:node', opId: 'op-a',
        });
        const newer = await resolver.applyChanges([buildChange({
            pk: 'm1', op: 'put', clock: 2, hlc: '0000000000002:0002:node', opId: 'op-z', payload,
        })]);
        expect(newer.applied).toBe(1);
        expect(await table.get('m1')).toMatchObject({ op_id: 'op-z' });
    });
});
