import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { effectScope, nextTick, ref } from 'vue';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setHookEngine } from '~/core/hooks/useHooks';
import { createHookEngine } from '~/core/hooks/hooks';
import { createTypedHookEngine } from '~/core/hooks/typed-hooks';
import { evictWorkspaceDb, getWorkspaceDb, setActiveWorkspaceDb } from '~/db/client';
import { setupSyncEngine } from '../client-sync-engine';
import { getWriteTxTableNames } from '~/db/util';

const state = vi.hoisted(() => ({
    session: null as unknown,
    workspace: null as unknown,
    starts: [] as string[],
    dispose: async () => {},
}));
vi.mock('~/composables/auth/useSessionContext', () => ({
    useSessionContext: () => ({ data: state.session }),
    getCachedSessionContext: () => (state.session as { value: { session: unknown } }).value.session,
}));
vi.mock('~/composables/workspace/useWorkspaceManager', () => ({
    useWorkspaceManager: () => ({ activeWorkspaceId: state.workspace }),
}));
vi.mock('~/composables/auth/useAuthTokenBroker.client', () => ({ useAuthTokenBroker: () => ({}) }));
vi.mock('../sync-provider-registry', () => ({
    getActiveSyncProvider: () => ({ id: 'test-direct', mode: 'direct', dispose: () => state.dispose() }),
    registerSyncProvider: vi.fn(), setActiveSyncProvider: vi.fn(),
}));
vi.mock('../subscription-manager', () => ({
    createSubscriptionManager: (_db: unknown, _provider: unknown, scope: { workspaceId: string }) => ({
        start: async () => { state.starts.push(scope.workspaceId); }, stop: async () => {},
    }),
    cleanupSubscriptionManager: vi.fn(), cleanupSubscriptionManagersByWorkspace: vi.fn(),
    getScopeKey: (scope: { workspaceId: string; principalId?: string }) => `${scope.workspaceId}:${scope.principalId ?? ''}`,
}));
vi.mock('../outbox-manager', () => ({ OutboxManager: class {
    start() {} stop() {}
} }));

afterEach(() => { vi.unstubAllGlobals(); setHookEngine(null); });

describe('sync lifecycle with real local write capture', () => {
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
        vi.stubGlobal('useNuxtApp', () => ({ provide: (_key: string, value: typeof control) => { control = value; } }));
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
            }
        } finally {
            release(); scope.stop(); state.dispose = async () => {};
            await control?.stop(); setActiveWorkspaceDb(null);
            for (const [id, database] of [[a, db], [b, other]] as const) {
                evictWorkspaceDb(id); await Dexie.delete(database.name);
            }
        }
    });
});
