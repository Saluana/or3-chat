import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Or3DB } from '~/db/client';
import { getWriteTxTableNames } from '~/db/util';
import { OutboxManager } from '../outbox-manager';
import { getHookBridge, _resetHookBridge } from '../hook-bridge';
import { FULL_HISTORY_PULL_RETENTION, type PendingOp, type PushBatch, type PushResult, type SyncProvider } from '~~/shared/sync/types';
import { testUuid } from './sync-test-utils';

vi.mock('~/core/hooks/useHooks', () => ({ useHooks: () => ({ doAction: vi.fn(async () => undefined) }) }));

function message(id: string, clock = 1, content = 'local content') {
    return { id, thread_id: 'thread-1', role: 'assistant' as const, index: 0,
        data: { content }, pending: false, error: null, file_hashes: null, deleted: false,
        created_at: 1, updated_at: clock, clock, hlc: `${clock}:0:local`, op_id: testUuid(`${id}-${clock}`) };
}
function op(id: string, clock = 1, content?: string): PendingOp {
    const payload = message(id, clock, content);
    return { id: `outbox-${id}-${clock}`, tableName: 'messages', operation: 'put', pk: id, payload,
        stamp: { clock, hlc: payload.hlc, deviceId: 'local', opId: payload.op_id },
        createdAt: clock, attempts: 0, status: 'pending' };
}
function accepted(ops: PendingOp[]): PushResult {
    return { results: ops.map((item) => ({ opId: item.stamp.opId, success: true, applied: true })), serverVersion: 1 };
}
function provider(push: SyncProvider['push']): SyncProvider {
    return {
        id: 'outbox-integration', mode: 'direct', push,
        pull: async () => ({ changes: [], nextCursor: 0, hasMore: false, ...FULL_HISTORY_PULL_RETENTION }),
        subscribe: async () => () => undefined,
        updateCursor: async () => undefined,
        dispose: async () => undefined,
    };
}
function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
}

describe('outbox durable recovery integration', () => {
    let db: Or3DB;
    const managers: OutboxManager[] = [];
    beforeEach(async () => {
        db = new Or3DB(`or3-outbox-recovery-${crypto.randomUUID()}`);
        await db.open();
        getHookBridge(db).start();
    });
    afterEach(async () => {
        for (const manager of managers.splice(0)) manager.stop();
        _resetHookBridge();
        vi.restoreAllMocks();
        db.close();
        await db.delete();
    });
    function manager(p: SyncProvider) {
        const result = new OutboxManager(db, p, { workspaceId: db.name }, { retryDelays: [0] });
        managers.push(result);
        return result;
    }
    async function remoteRows(write: () => Promise<unknown>) {
        await db.transaction('rw', db.messages, db.tombstones, (tx) => {
            getHookBridge(db).markSyncTransaction(tx);
            return write();
        });
    }

    it('automatically drains transient failures after the short retry schedule is exhausted', async () => {
        await db.pending_ops.put(op('outage'));
        let online = false;
        const push = vi.fn(async ({ ops }: PushBatch) => { if (!online) throw new Error('network unavailable'); return accepted(ops); });
        const outbox = manager(provider(push));
        await outbox.flush();
        online = true;
        const now = Date.now();
        vi.spyOn(Date, 'now').mockReturnValue(now + 120_000);
        await outbox.flush();
        expect(push).toHaveBeenCalledTimes(2);
        expect(await db.pending_ops.count()).toBe(0);
    });

    it('pushes a valid sibling while preserving a locally oversized operation for export', async () => {
        const huge = op('huge', 1, 'x'.repeat(300_000));
        await db.pending_ops.bulkPut([huge, op('healthy', 2)]);
        const push = vi.fn(async ({ ops }: PushBatch) => accepted(ops));
        const outbox = manager(provider(push));
        await outbox.flush();
        expect(push.mock.calls.flatMap(([request]) => request.ops.map((item) => item.pk))).toEqual(['healthy']);
        expect(await db.pending_ops.get('outbox-healthy-2')).toBeUndefined();
        expect(await db.pending_ops.get(huge.id)).toMatchObject({
            status: 'failed_permanent',
            failureKind: 'permanent',
            payload: huge.payload,
            lastError: 'This change exceeds sync limits. Reduce its size before trying again.',
            lastErrorDetails: { code: 'ERR_SYNC_PAYLOAD_TOO_LARGE', retryable: false },
        });
        await outbox.quarantineCorruptOps();
        const exported = JSON.parse(await outbox.exportQuarantined());
        expect(exported.entries.some((entry: { op: PendingOp }) => entry.op.id === huge.id &&
            (entry.op.payload as ReturnType<typeof message>).data.content.length === 300_000)).toBe(true);
    });

    it('commits large local messages with durable exportable failed sync intent', async () => {
        const content = 'z'.repeat(300_000);
        await db.transaction('rw', getWriteTxTableNames(db, 'messages'), () => db.messages.put(message('large-local', 1, content)));
        expect((await db.messages.get('large-local'))?.data).toMatchObject({ content });
        const outbox = manager(provider(async ({ ops }) => accepted(ops)));
        await outbox.quarantineCorruptOps();
        const exported = JSON.parse(await outbox.exportQuarantined());
        expect(exported.entries.some((entry: { localRow?: ReturnType<typeof message>; op: PendingOp }) =>
            entry.localRow?.data.content === content || (entry.op.payload as ReturnType<typeof message>)?.data.content === content)).toBe(true);
    });

    it('quarantines a malformed revision before coalescing and drains unrelated valid work', async () => {
        const bad = { ...op('corrupt'), stamp: undefined } as unknown as PendingOp;
        await db.pending_ops.bulkPut([bad, op('corrupt', 2), op('healthy', 3)]);
        const pushed: string[] = [];
        const outbox = manager(provider(async ({ ops }) => { pushed.push(...ops.map((item) => item.pk)); return accepted(ops); }));
        await outbox.flush();
        expect(pushed.sort()).toEqual(['corrupt', 'healthy']);
        expect((await outbox.getQuarantined()).some((entry) => entry.id === bad.id)).toBe(true);
    });

    it('keeps a newer tombstone when a stale push winner races a materialized soft delete', async () => {
        await remoteRows(async () => {
            await db.messages.put({ ...message('deleted', 2), deleted: true });
            await db.tombstones.put({ id: 'messages:deleted', tableName: 'messages', pk: 'deleted', deletedAt: 5, clock: 5, hlc: '5:0:remote', opId: testUuid('delete-five') });
        });
        const queued = op('deleted', 1);
        await db.pending_ops.put(queued);
        const winner = message('deleted', 3, 'stale server');
        await manager(provider(async () => ({ results: [{ opId: queued.stamp.opId, success: true, applied: false,
            winner: { kind: 'put', payload: winner, revision: { clock: 3, hlc: winner.hlc, opId: winner.op_id } } }], serverVersion: 1 }))).flush();
        expect((await db.messages.get('deleted'))?.deleted).toBe(true);
        expect((await db.tombstones.get('messages:deleted'))?.clock).toBe(5);
    });

    it('does not overwrite a newer tombstone arriving between a delete ACK read and write', async () => {
        const queued = { ...op('ack-delete', 2), operation: 'delete' as const, payload: { id: 'ack-delete', deleted: true, deleted_at: 2 } };
        const id = 'messages:ack-delete';
        await db.pending_ops.put(queued);
        await db.tombstones.put({ id, tableName: 'messages', pk: queued.pk, deletedAt: 1, clock: 1 });
        const other = new Or3DB(db.name);
        await other.open();
        const get = db.tombstones.get.bind(db.tombstones);
        let injected = false;
        let concurrentWrite: Promise<unknown> | undefined;
        vi.spyOn(db.tombstones, 'get').mockImplementation((...args) => get(...args).then(async (value) => {
            if (!injected) {
                injected = true;
                concurrentWrite = other.tombstones.put({ id, tableName: 'messages', pk: queued.pk, deletedAt: 9, clock: 9, hlc: '9:0:other', opId: testUuid('new-delete') });
                if (!Dexie.currentTransaction) await concurrentWrite;
            }
            return value;
        }));
        try {
            await manager(provider(async ({ ops }) => accepted(ops))).flush();
            await concurrentWrite;
            expect((await get(id))?.clock).toBe(9);
        } finally { other.close(); }
    });

    it('does not let a second manager steal a live push', async () => {
        await db.pending_ops.put(op('shared'));
        const response = deferred<PushResult>();
        const started = deferred<void>();
        const push = vi.fn(({ ops }: PushBatch) => { started.resolve(undefined); return response.promise.then(() => accepted(ops)); });
        const p = provider(push);
        const first = manager(p).flush();
        await started.promise;
        const second = manager(p).flush();
        await new Promise((resolve) => setTimeout(resolve, 20));
        response.resolve({ results: [], serverVersion: 1 });
        await Promise.all([first, second]);
        expect(push).toHaveBeenCalledTimes(1);
        expect(await db.pending_ops.count()).toBe(0);
    });

    it('ignores a suspended owner failure after another manager recovers and acknowledges its expired claim', async () => {
        await db.pending_ops.put(op('suspended'));
        const late = deferred<PushResult>();
        const started = deferred<void>();
        const first = manager(provider(() => { started.resolve(undefined); return late.promise; })).flush();
        await started.promise;
        const now = Date.now();
        vi.spyOn(Date, 'now').mockReturnValue(now + 120_000);
        await manager(provider(async ({ ops }) => accepted(ops))).flush();
        late.reject(new Error('late suspended network error'));
        await first;
        expect(await db.pending_ops.count()).toBe(0);
    });

    it('persists the same generated order key locally and in the finalized stream operation', async () => {
        await db.transaction('rw', getWriteTxTableNames(db, 'messages'), () => db.messages.put({ ...message('stream'), pending: true }));
        await db.transaction('rw', getWriteTxTableNames(db, 'messages'), () => db.messages.update('stream', { pending: false, clock: 2 }));
        const local = await db.messages.get('stream');
        const [queued] = await db.pending_ops.toArray();
        expect(local?.order_key).toBeTruthy();
        expect((queued?.payload as { order_key: string }).order_key).toBe(local?.order_key);
    });
});
