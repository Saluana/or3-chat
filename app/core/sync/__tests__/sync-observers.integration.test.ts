import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Or3DB } from '~/db/client';
import { createTypedHookEngine } from '~/core/hooks/typed-hooks';
import { createHookEngine } from '~~/shared/hooks/hook-engine-core';
import { createHookEngineV2 } from '~~/shared/hooks/hook-engine-v2';
import { setHookEngine } from '~/core/hooks/useHooks';
import { observeSyncAction } from '../sync-observers';
import { SubscriptionManager } from '../subscription-manager';
import { OutboxManager } from '../outbox-manager';
import { startCoordinatedSubscription } from '../subscription-coordinator';
import { _resetCursorManagers } from '../cursor-manager';
import { _resetHookBridge } from '../hook-bridge';
import { FULL_HISTORY_PULL_RETENTION, type PushBatch, type SyncChange, type SyncProvider } from '~~/shared/sync/types';

const scope = { workspaceId: 'observer-regression' };
const actions = [
    'sync.bootstrap:action:start', 'sync.bootstrap:action:progress',
    'sync.bootstrap:action:complete', 'sync.bootstrap:action:error',
    'sync.rescan:action:starting', 'sync.rescan:action:completed',
    'sync.pull:action:applied', 'sync.conflict:action:detected', 'sync.error:action',
] as const;

function within<T>(work: Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout>;
    return Promise.race([work, new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Observer stranded protocol work')), 1500);
    })]).finally(() => clearTimeout(timer));
}

function change(version: number): SyncChange {
    return { serverVersion: version, tableName: 'kv', pk: 'remote', op: 'put',
        payload: { id: 'remote', name: 'remote', value: version, created_at: 1, updated_at: 1, clock: version },
        stamp: { clock: version, hlc: `${version}:0:remote`, deviceId: 'remote', opId: crypto.randomUUID() } };
}

describe.each(['v1', 'v2'] as const)('sync observer liveness (%s engine)', version => {
    let db: Or3DB;
    let manager: SubscriptionManager | undefined;
    let release: (() => void) | undefined;
    let stop: (() => Promise<void>) | undefined;
    beforeEach(async () => {
        db = new Or3DB(`observer-${crypto.randomUUID()}`);
        await db.open();
    });
    afterEach(async () => {
        release?.(); release = undefined;
        await stop?.(); stop = undefined;
        await manager?.stop(); manager = undefined;
        setHookEngine(null);
        _resetCursorManagers(); _resetHookBridge();
        vi.unstubAllGlobals(); vi.restoreAllMocks();
        await db.delete();
    });

    it.each(actions.flatMap(action => ['throw', 'hang'].flatMap(fault =>
        (action.startsWith('sync.bootstrap') && action !== 'sync.bootstrap:action:error' ? [false, true] : [false])
            .map(snapshot => ({ action, fault, snapshot })))))(
        '$action ($fault, snapshot=$snapshot) cannot hold protocol/ownership', async ({ action, fault, snapshot }) => {
            const engine = version === 'v1' ? createHookEngine() : createHookEngineV2();
            setHookEngine(createTypedHookEngine(engine));
            const invoked = vi.fn(() => {
                if (fault === 'throw') throw new Error('injected observer failure');
                return new Promise<void>(resolve => { release = resolve; });
            });
            engine.addAction(action, invoked, 0);
            const later = vi.fn();
            engine.addAction(action, later, 20);
            let onChanges: ((changes: SyncChange[]) => void | Promise<void>) | undefined;
            const rescan = action.startsWith('sync.rescan');
            const incoming = action === 'sync.pull:action:applied' || action === 'sync.conflict:action:detected';
            if (rescan || incoming) await db.sync_state.put({ id: `sync_state:${scope.workspaceId}:default`, cursor: 10, lastSyncAt: Date.now(), deviceId: 'device' });
            if (action === 'sync.conflict:action:detected') await db.kv.put({ id: 'remote', name: 'remote', value: 'local', created_at: 1, updated_at: 1, clock: 11, hlc: '1:0:local', deleted: false });
            const provider: SyncProvider = {
                id: `observer-${crypto.randomUUID()}`, mode: 'direct',
                pull: vi.fn(async request => ({ ...FULL_HISTORY_PULL_RETENTION,
                    changes: request.cursor === 0 && action !== 'sync.bootstrap:action:error' ? [change(11)] : [],
                    nextCursor: request.cursor === 0 ? (action === 'sync.bootstrap:action:error' ? 0 : 11) : request.cursor,
                    hasMore: action === 'sync.bootstrap:action:error', requiresSnapshot: rescan && request.cursor === 10 })),
                subscribe: vi.fn(async (_scope, _tables, callback) => { onChanges = callback; return () => undefined; }),
                push: vi.fn(async (batch: PushBatch) => ({ serverVersion: 0, results: batch.ops.map(op => ({ opId: op.stamp.opId, success: false, errorCode: 'VALIDATION_ERROR' as const, error: 'invalid' })) })),
                updateCursor: vi.fn(async () => undefined), dispose: vi.fn(async () => undefined),
            };
            if (rescan || snapshot) provider.snapshot = vi.fn(async () => ({ workspaceId: scope.workspaceId, snapshotId: 'observed-snapshot', highWatermark: 11,
                items: [{ kind: 'row' as const, tableName: 'kv', pk: 'remote', payload: change(11).payload!, revision: { clock: 11, hlc: '11:0:remote', opId: 'snapshot-row' } }], nextPageToken: null }));
            if (action === 'sync.error:action') {
                await db.pending_ops.put({ id: 'pending', tableName: 'kv', pk: 'pending', operation: 'put', payload: { id: 'pending', name: 'pending', value: 1, created_at: 1, updated_at: 1, clock: 1 },
                    stamp: { clock: 1, hlc: '1:0:device', deviceId: 'device', opId: crypto.randomUUID() }, status: 'pending', attempts: 0, createdAt: Date.now() });
                const outbox = new OutboxManager(db, provider, scope);
                await within(outbox.flush());
                expect(await db.pending_ops.get('pending')).toMatchObject({ status: 'failed_permanent' });
                // A second op must be selectable after the previous flush released ownership.
                await db.pending_ops.put({ ...(await db.pending_ops.get('pending'))!, id: 'second', pk: 'second', stamp: { clock: 1, hlc: '2:0:device', deviceId: 'device', opId: crypto.randomUUID() }, status: 'pending' });
                await within(outbox.flush());
                expect(provider.push).toHaveBeenCalledTimes(2);
            } else {
                let ownership = Promise.resolve();
                let held = false;
                vi.stubGlobal('navigator', { onLine: true, locks: { request: (_name: string, _opts: unknown, callback: (lock: object) => Promise<void>) => {
                    held = true;
                    ownership = Promise.resolve().then(() => callback({})).finally(() => { held = false; });
                    return ownership;
                } } });
                manager = new SubscriptionManager(db, provider, scope, { tables: ['kv'] });
                stop = await within(startCoordinatedSubscription(db.name, manager));
                if (incoming) await within(Promise.resolve(onChanges!([change(11)])));
                if (action !== 'sync.bootstrap:action:error') {
                    expect(await db.kv.get('remote')).toMatchObject({ clock: 11 });
                    expect(await db.sync_state.get(`sync_state:${scope.workspaceId}:default`)).toMatchObject({ cursor: 11 });
                    expect(provider.updateCursor).toHaveBeenCalled();
                }
                await within(stop()); stop = undefined;
                await within(ownership);
                expect(held).toBe(false);
                // A real successor manager acquires the released Web Lock and subscribes.
                const successor = new SubscriptionManager(db, { ...provider, pull: async request => ({ ...FULL_HISTORY_PULL_RETENTION, changes: [], nextCursor: request.cursor, hasMore: false }) }, scope, { tables: ['kv'] });
                stop = await within(startCoordinatedSubscription(db.name, successor));
                expect(successor.getStatus()).toBe('connected');
                await within(stop()); stop = undefined;
            }
            expect(invoked).toHaveBeenCalledTimes(action === 'sync.error:action' && fault === 'throw' ? 2 : 1);
            expect(later).toHaveBeenCalled();
            expect(later.mock.invocationCallOrder[0]).toBeGreaterThan(invoked.mock.invocationCallOrder[0]!);
        }
    );
});


describe.each([createHookEngine, createHookEngineV2])('sync observer delivery isolation (%#)', factory => {
    afterEach(() => { vi.useRealTimers(); });

    it.each(['sync.pull:action:applied', 'sync.conflict:action:detected', 'sync.error:action'] as const)(
        'delivers every %s to ready listeners while only the slow listener coalesces', async name => {
            vi.useFakeTimers();
            const engine = factory();
            const hooks = createTypedHookEngine(engine);
            const seen: unknown[] = [];
            const slow = vi.fn(() => new Promise<void>(resolve => setTimeout(resolve, 300)));
            const fast = vi.fn(async (payload: unknown) => { await Promise.resolve(); seen.push(payload); });
            const sync = vi.fn();
            engine.addAction(name, slow, 0);
            engine.addAction(name, fast, 10);
            engine.addAction(name, sync, 20);
            const emit = (event: number) => observeSyncAction(hooks, name, { event } as never);
            const first = emit(1);
            await vi.advanceTimersByTimeAsync(250);
            await first;
            const second = emit(2);
            await vi.advanceTimersByTimeAsync(0);
            await second;
            expect(seen).toEqual([{ event: 1 }, { event: 2 }]);
            expect(sync.mock.calls).toEqual([[{ event: 1 }], [{ event: 2 }]]);
            expect(slow).toHaveBeenCalledTimes(1);
            await vi.advanceTimersByTimeAsync(50);
            expect(slow).toHaveBeenCalledTimes(1); // No late replay of event 2.
            const third = emit(3);
            await vi.advanceTimersByTimeAsync(300);
            await third;
            expect(slow).toHaveBeenCalledTimes(2);
            expect(seen).toEqual([{ event: 1 }, { event: 2 }, { event: 3 }]);
        }
    );

    it('keeps invocation priority, wildcard, once, argument and rejection contracts', async () => {
        const errors = vi.fn();
        const engine = factory({ logCallbackError: errors });
        const hooks = createTypedHookEngine(engine);
        const order: unknown[] = [];
        const name = 'sync.pull:action:applied';
        engine.addAction('sync.pull:*', () => { order.push('wildcard'); }, 0);
        engine.onceAction(name, async () => { order.push('once'); throw new Error('once rejection'); }, 5);
        engine.addAction(name, (...args) => { order.push(args); }, 10, 0);
        const emit = () => observeSyncAction(hooks, name, {} as never);
        await emit();
        await emit();
        expect(order).toEqual(['wildcard', 'once', [], 'wildcard', []]);
        expect(errors).toHaveBeenCalledTimes(1);
        expect(engine._diagnostics.errors[name]).toBe(1);
    });
});
