import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { effectScope, nextTick, onScopeDispose, ref } from 'vue';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setHookEngine } from '~/core/hooks/useHooks';
import { createHookEngine } from '~/core/hooks/hooks';
import { createTypedHookEngine } from '~/core/hooks/typed-hooks';
import { evictWorkspaceDb, getDb, getWorkspaceDb, setActiveWorkspaceDb, subscribeActiveWorkspaceDb } from '~/db/client';
import { setupSyncEngine } from '../client-sync-engine';
import { getWriteTxTableNames } from '~/db/util';

const state = vi.hoisted(() => ({
    session: null as unknown,
    workspace: null as unknown,
    starts: [] as string[],
    subscriptionStatus: 'connected' as 'connected' | 'error',
    dispose: async () => {},
}));
vi.mock('~/composables/auth/useSessionContext', () => ({
    useSessionContext: () => ({ data: state.session }),
    getCachedSessionPayload: () => (state.session as { value: unknown }).value,
    getCachedSessionContext: () => (state.session as { value: { session: unknown } }).value.session,
}));
vi.mock('~/composables/workspace/useWorkspaceManager', () => ({
    useWorkspaceManager: () => ({ activeWorkspaceId: state.workspace }),
}));
vi.mock('~/composables/auth/useAuthTokenBroker.client', () => ({ useAuthTokenBroker: () => ({}) }));
vi.mock('../sync-provider-registry', () => ({
    getActiveSyncProvider: () => ({ id: 'test-direct', mode: 'direct', capabilities: { historyIncarnation: 'v1' }, dispose: () => state.dispose() }),
    registerSyncProvider: vi.fn(), setActiveSyncProvider: vi.fn(),
}));
vi.mock('../subscription-manager', () => ({
    createSubscriptionManager: (_db: unknown, _provider: unknown, scope: { workspaceId: string }) => ({
        start: async () => { state.starts.push(scope.workspaceId); }, stop: async () => {},
        getStatus: () => state.subscriptionStatus,
    }),
    cleanupSubscriptionManager: vi.fn(), cleanupSubscriptionManagersByWorkspace: vi.fn(),
    getScopeKey: (scope: { workspaceId: string; principalId?: string }) => `${scope.workspaceId}:${scope.principalId ?? ''}`,
}));
vi.mock('../outbox-manager', () => ({ OutboxManager: class {
    start() {} stop() {}
} }));

afterEach(() => { vi.unstubAllGlobals(); setHookEngine(null); });

describe('sync lifecycle with real local write capture', () => {
    it('keeps a newer workspace when an explicit reconnect pause lookup finishes late', async () => {
        setHookEngine(createTypedHookEngine(createHookEngine()));
        const a = crypto.randomUUID(); const b = crypto.randomUUID();
        const db = getWorkspaceDb(a); const other = getWorkspaceDb(b);
        await db.open(); await other.open(); setActiveWorkspaceDb(a);
        const workspace = ref(a);
        state.workspace = workspace;
        state.session = ref({ session: { authenticated: true, user: { id: 'user-A' } } });
        state.starts = []; state.dispose = async () => {};
        let control!: { start(id: string): Promise<void>; stop(): Promise<void>; isRunning(): boolean };
        vi.stubGlobal('useRuntimeConfig', () => ({ public: { sync: { enabled: true }, ssrAuthEnabled: false } }));
        vi.stubGlobal('useNuxtApp', () => ({ vueApp: { onUnmount: onScopeDispose }, provide: (_key: string, value: typeof control) => { control = value; } }));
        vi.stubGlobal('useRouter', () => ({ currentRoute: ref({ path: '/' }) }));
        const scope = effectScope();
        let release!: () => void;
        const gate = new Promise<void>(resolve => { release = resolve; });
        let lookupStarted = false;
        let restoreLookup = () => {};
        try {
            await scope.run(() => setupSyncEngine());
            await vi.waitFor(() => expect(control.isRunning()).toBe(true));
            const get = db.sync_state.get.bind(db.sync_state);
            const lookup = vi.spyOn(db.sync_state, 'get').mockImplementation(key => {
                if (typeof key === 'string' && key.startsWith('["sync_protocol"')) {
                    lookupStarted = true;
                    return gate.then(() => get(key)) as ReturnType<typeof get>;
                }
                return get(key);
            });
            restoreLookup = () => { lookup.mockRestore(); };
            const staleReconnect = control.start(a);
            await vi.waitFor(() => expect(lookupStarted).toBe(true));
            workspace.value = b; setActiveWorkspaceDb(b); await nextTick();
            await vi.waitFor(() => expect(state.starts).toEqual([a, b]));
            release(); await staleReconnect;
            expect(state.starts).toEqual([a, b]);
            expect(getDb()).toBe(other);
            expect(control.isRunning()).toBe(true);
        } finally {
            release(); restoreLookup(); scope.stop(); await control?.stop(); setActiveWorkspaceDb(null);
            for (const [id, database] of [[a, db], [b, other]] as const) {
                evictWorkspaceDb(id); await Dexie.delete(database.name);
            }
        }
    });

    it('captures Free Local edits after startup, resumes on upgrade, and stops at expiry without another response', async () => {
        setHookEngine(createTypedHookEngine(createHookEngine()));
        const id = crypto.randomUUID(); const db = getWorkspaceDb(id);
        await db.open(); setActiveWorkspaceDb(id);
        const session = ref({ session: { authenticated: true, user: { id: 'local-user' } }, cloudAccess: { enabled: false, expiresAt: 0 } });
        state.session = session; state.workspace = ref(id); state.starts = []; state.dispose = async () => {};
        let control!: { stop(): Promise<void>; isRunning(): boolean };
        vi.stubGlobal('useRuntimeConfig', () => ({ public: { sync: { enabled: true }, ssrAuthEnabled: false, cloudAccessPolicyEnabled: true } }));
        vi.stubGlobal('useNuxtApp', () => ({ vueApp: { onUnmount: onScopeDispose }, provide: (_key: string, value: typeof control) => { control = value; } }));
        vi.stubGlobal('useRouter', () => ({ currentRoute: ref({ path: '/' }) }));
        const scope = effectScope();
        try {
            await scope.run(() => setupSyncEngine());
            expect(control.isRunning()).toBe(false);
            expect(state.starts).toEqual([]);
            const write = (value: string, clock: number) => db.transaction('rw', getWriteTxTableNames(db, 'kv'), () =>
                db.kv.put({ id: 'local-intent', name: 'local-intent', value, clock, deleted: false, created_at: 1, updated_at: 1 }));
            await write('before upgrade', 1);
            expect(await db.pending_ops.count()).toBe(1);
            session.value.cloudAccess = { enabled: true, expiresAt: Date.now() + 250 };
            await vi.waitFor(() => expect(control.isRunning()).toBe(true));
            await vi.waitFor(() => expect(control.isRunning()).toBe(false));
            await write('after expiry', 2);
            await write('latest edit', 3);
            expect(await db.pending_ops.count()).toBe(3);
            expect((await db.pending_ops.toArray()).map(op => op.payload)).toEqual(expect.arrayContaining([expect.objectContaining({ value: 'latest edit' })]));
            expect(state.starts).toEqual([id]);
        } finally {
            scope.stop(); await control?.stop(); setActiveWorkspaceDb(null); evictWorkspaceDb(id); await Dexie.delete(db.name);
        }
    });

    it('rebinds installed histories without navigation or relabeling old callbacks', async () => {
        setHookEngine(createTypedHookEngine(createHookEngine()));
        const id = crypto.randomUUID(); const unrelatedId = crypto.randomUUID();
        const original = getWorkspaceDb(id); const unrelated = getWorkspaceDb(unrelatedId);
        await original.open(); await unrelated.open(); setActiveWorkspaceDb(id);
        state.session = ref({ session: { authenticated: true, user: { id: 'user-A' } } });
        state.workspace = ref(id); state.starts = []; state.dispose = async () => {};
        const reload = vi.fn(); vi.stubGlobal('window', { location: { pathname: '/', reload } });
        let control!: { stop(): Promise<void>; isRunning(): boolean };
        vi.stubGlobal('useRuntimeConfig', () => ({ public: { sync: { enabled: true }, ssrAuthEnabled: false } }));
        vi.stubGlobal('useNuxtApp', () => ({ vueApp: { onUnmount: onScopeDispose }, provide: (_key: string, value: typeof control) => { control = value; } }));
        vi.stubGlobal('useRouter', () => ({ currentRoute: ref({ path: '/' }) }));
        const scope = effectScope();
        try {
            await scope.run(() => setupSyncEngine());
            await vi.waitFor(() => expect(control.isRunning()).toBe(true));
            for (const history of ['I', 'J']) {
                const old = getDb(); const origin = old.syncHistoryAtOpen;
                // The real snapshot owner commits this guard atomically with its data.
                let listenerWrite: Promise<unknown> | undefined;
                const stopListener = subscribeActiveWorkspaceDb(() => {
                    const replacement = getDb();
                    listenerWrite = replacement.transaction('rw', getWriteTxTableNames(replacement, 'kv'), () =>
                        replacement.kv.put({ id: `listener-${history}`, name: `listener-${history}`, value: 'during handoff', clock: 1, deleted: false, created_at: 1, updated_at: 1 }));
                });
                await old.sync_state.put({ id: 'sync_history', phase: 'ready', historyIncarnation: history,
                    resetTarget: null, cursor: 0, deviceId: '', lastSyncAt: 0 });
                await vi.waitFor(() => {
                    expect(getDb()).not.toBe(old);
                    expect(getDb().syncHistoryAtOpen).toBe(history);
                    expect(control.isRunning()).toBe(true);
                });
                stopListener();
                await listenerWrite;
                expect(await getDb().pending_ops.where('[tableName+pk]').equals(['kv', `listener-${history}`]).count()).toBe(1);
                expect(old.syncHistoryAtOpen).toBe(origin);
                await expect(old.transaction('rw', getWriteTxTableNames(old, 'kv'), () =>
                    old.kv.put({ id: 'stale', name: 'stale', value: 'late callback', clock: 1, deleted: false, created_at: 1, updated_at: 1 }))).rejects.toThrow();
                const current = getDb();
                await current.transaction('rw', getWriteTxTableNames(current, 'kv'), () =>
                    current.kv.put({ id: history, name: history, value: 'current edit', clock: 1, deleted: false, created_at: 1, updated_at: 1 }));
                expect(await current.kv.get('stale')).toBeUndefined();
                expect(await current.pending_ops.where('[tableName+pk]').equals(['kv', history]).count()).toBe(1);
                expect(unrelated.isOpen()).toBe(true);
                expect(getWorkspaceDb(unrelatedId)).toBe(unrelated);
            }
            expect(reload).not.toHaveBeenCalled();
            expect(state.starts).toEqual([id, id, id]);
        } finally {
            scope.stop(); await control?.stop(); setActiveWorkspaceDb(null);
            for (const workspace of [id, unrelatedId]) { evictWorkspaceDb(workspace); await Dexie.delete(`or3-db-${workspace}`); }
        }
    });

    it.each(['route', 'workspace', 'account', 'account only', 'authorization only'] as const)('reconciles the latest %s request after teardown and captures intervening writes', async transition => {
        setHookEngine(createTypedHookEngine(createHookEngine()));
        const a = crypto.randomUUID(); const b = crypto.randomUUID();
        const db = getWorkspaceDb(a); const other = getWorkspaceDb(b);
        await db.open(); await other.open(); setActiveWorkspaceDb(a);
        const workspace = ref(a);
        const session = ref<{ session: { authenticated: boolean; user: { id: string }; authorizationRevision?: number } }>(
            { session: { authenticated: true, user: { id: 'user-A' } } });
        const route = ref({ path: '/' });
        state.workspace = workspace; state.session = session; state.starts = [];
        state.dispose = async () => {};
        let control!: { start(id: string): Promise<void>; stop(): Promise<void>; isRunning(): boolean };
        vi.stubGlobal('useRuntimeConfig', () => ({ public: { sync: { enabled: true }, ssrAuthEnabled: false } }));
        vi.stubGlobal('useNuxtApp', () => ({ vueApp: { onUnmount: onScopeDispose }, provide: (_key: string, value: typeof control) => { control = value; } }));
        vi.stubGlobal('useRouter', () => ({ currentRoute: route }));
        const scope = effectScope();
        let release!: () => void;
        let disposing = false;
        const gate = new Promise<void>(resolve => { release = resolve; });
        try {
            await scope.run(() => setupSyncEngine());
            await vi.waitFor(() => expect(control.isRunning()).toBe(true));
            state.dispose = async () => { disposing = true; await gate; };
            if (transition === 'account only') session.value = { session: { authenticated: true, user: { id: 'user-B' } } };
            else if (transition === 'authorization only') session.value = { session: { authenticated: true, user: { id: 'user-A' }, authorizationRevision: 1 } };
            else route.value = { path: '/admin' };
            await nextTick(); await vi.waitFor(() => expect(disposing).toBe(true));
            // A route pause must not remove atomic write capture from the live DB.
            await db.transaction('rw', getWriteTxTableNames(db, 'messages'), () =>
                db.messages.put({ id: 'during-stop', thread_id: 'thread', role: 'user',
                    data: { content: 'durable intent' }, index: 1, clock: 1, created_at: 1, updated_at: 1, deleted: false }));
            if (transition === 'workspace') {
                workspace.value = b; setActiveWorkspaceDb(b); await nextTick();
                workspace.value = a; setActiveWorkspaceDb(a);
            }
            if (transition === 'account') session.value = { session: { authenticated: true, user: { id: 'user-B' } } };
            route.value = { path: '/' }; await nextTick();
            release();
            await vi.waitFor(() => expect(state.starts).toHaveLength(2));
            expect(control.isRunning()).toBe(true);
            await db.transaction('rw', getWriteTxTableNames(db, 'messages'), () =>
                db.messages.put({ id: 'after-stop', thread_id: 'thread', role: 'user',
                    data: { content: 'later intent' }, index: 2, clock: 1, created_at: 1, updated_at: 1, deleted: false }));
            expect((await db.pending_ops.toArray()).map(op => op.pk).sort()).toEqual(['after-stop', 'during-stop']);
            if (transition === 'route') {
                await control.stop(); await control.stop();
                await control.start(a);
                expect(control.isRunning()).toBe(true);
                expect(state.starts).toHaveLength(3);
                state.subscriptionStatus = 'error';
                await control.start(a);
                expect(state.starts).toHaveLength(4);
                state.subscriptionStatus = 'connected';
            }
        } finally {
            state.subscriptionStatus = 'connected';
            release(); scope.stop(); state.dispose = async () => {};
            await control?.stop(); setActiveWorkspaceDb(null);
            for (const [id, database] of [[a, db], [b, other]] as const) {
                evictWorkspaceDb(id); await Dexie.delete(database.name);
            }
        }
    });
});
