import { describe, it, expect, vi } from 'vitest';
import { effectScope, nextTick, ref } from 'vue';
import Dexie from 'dexie';

vi.mock('~/core/hooks/useHooks', () => ({
    useHooks: () => ({
        addAction: vi.fn(),
        removeAction: vi.fn(),
        doAction: vi.fn(),
        applyFilters: vi.fn((_, value) => Promise.resolve(value)),
    }),
}));

const sessionDataRef = ref<{ session: any | null }>({ session: null });

// Mock useSessionContext to prevent fetch calls in test environment
vi.mock('~/composables/auth/useSessionContext', () => ({
    useSessionContext: () => ({
        data: sessionDataRef,
        pending: ref(false),
        error: ref(null),
        refresh: vi.fn(),
    }),
}));

import { setActiveWorkspaceDb, getDb, evictWorkspaceDb, createWorkspaceDb } from '~/db/client';
import { useNotifications } from '~/composables/notifications/useNotifications';
import { FALLBACK_NOTIFICATION_USER_ID } from '~/core/notifications/notification-user';

const mutedThreadsKey = `notification_muted_threads:${FALLBACK_NOTIFICATION_USER_ID}`;

async function waitFor(predicate: () => boolean): Promise<void> {
    for (let i = 0; i < 20; i++) {
        if (predicate()) return;
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
}

describe('useNotifications', () => {
    for (const action of ['muteThread', 'unmuteThread'] as const) {
        for (const transition of ['workspace', 'account', 'logout', 'workspace-return', 'unchanged'] as const) {
            it(`keeps suspended ${action} persistence in its origin across ${transition} transition`, async () => {
                const originId = `mute-origin-${crypto.randomUUID()}`;
                const destinationId = `mute-destination-${crypto.randomUUID()}`;
                const originDb = setActiveWorkspaceDb(originId);
                const originKey = 'notification_muted_threads:synthetic-origin-user';
                const destinationKey = 'notification_muted_threads:synthetic-destination-user';
                const initial = action === 'muteThread' ? ['origin-existing'] : ['origin-existing', 'identical-thread'];
                const expected = action === 'muteThread' ? [...initial, 'identical-thread'] : ['origin-existing'];
                const row = (id: string, value: string[]) => ({ id, name: id, value: JSON.stringify(value), deleted: false, created_at: 1, updated_at: 1, clock: 1 });
                await originDb.kv.put(row(originKey, initial));
                const separateDb = createWorkspaceDb(destinationId);
                await separateDb.kv.put(row(originKey, ['destination-existing']));
                sessionDataRef.value = { session: { authenticated: true, user: { id: 'synthetic-origin-user' }, workspace: { id: originId } } };
                const scope = effectScope();
                let release!: () => void;
                let entered!: () => void;
                const held = new Promise<void>((resolve) => { release = resolve; });
                const started = new Promise<void>((resolve) => { entered = resolve; });
                let restoreLookup: (() => void) | undefined;
                let pending: Promise<unknown> | undefined;
                try {
                    const state = scope.run(() => useNotifications());
                    if (!state) throw new Error('Missing notification state');
                    await vi.waitFor(() => expect(state.isThreadMuted('origin-existing')).toBe(true));
                    const originalGet = originDb.kv.get.bind(originDb.kv);
                    const lookup = vi.spyOn(originDb.kv, 'get').mockImplementation((...args: Parameters<typeof originalGet>) => {
                        const result = originalGet(...args);
                        if (!Dexie.currentTransaction || String(args[0]) !== originKey) return result;
                        entered();
                        return Dexie.Promise.resolve(Dexie.waitFor(held)).then(() => result);
                    });
                    restoreLookup = () => lookup.mockRestore();
                    pending = state[action]('identical-thread').then(() => ({ ok: true }), (error: unknown) => ({ ok: false, error }));
                    await started;
                    const switchesWorkspace = transition === 'workspace' || transition === 'workspace-return';
                    const destinationDb = switchesWorkspace ? setActiveWorkspaceDb(destinationId) : originDb;
                    if (transition !== 'unchanged') {
                        sessionDataRef.value = { session: transition === 'logout' ? null : { authenticated: true, user: { id: transition === 'account' ? 'synthetic-destination-user' : 'synthetic-origin-user' }, workspace: { id: switchesWorkspace ? destinationId : originId } } };
                        await nextTick();
                        if (transition === 'workspace-return') {
                            setActiveWorkspaceDb(originId);
                            sessionDataRef.value = { session: { authenticated: true, user: { id: 'synthetic-origin-user' }, workspace: { id: originId } } };
                            await nextTick();
                        }
                    }
                    release();
                    await pending;
                    lookup.mockRestore();
                    if (switchesWorkspace) expect((await destinationDb.kv.get(originKey))?.value).toBe(JSON.stringify(['destination-existing']));
                    expect(await destinationDb.kv.get(destinationKey)).toBeUndefined();
                    expect((await originDb.kv.get(originKey))?.value).toBe(JSON.stringify(expected));
                } finally {
                    release(); await pending; restoreLookup?.(); scope.stop();
                    sessionDataRef.value = { session: null }; setActiveWorkspaceDb(null);
                    for (const id of [originId, destinationId]) { evictWorkspaceDb(id); await Dexie.delete(`or3-db-${id}`); }
                }
            });
        }
    }

    it('rolls back a failed origin mute write and recovers without changing the destination', async () => {
        const originId = `mute-recovery-origin-${crypto.randomUUID()}`;
        const destinationId = `mute-recovery-destination-${crypto.randomUUID()}`;
        const originDb = setActiveWorkspaceDb(originId);
        const destinationDb = createWorkspaceDb(destinationId);
        const key = 'notification_muted_threads:synthetic-recovery-user';
        const row = (value: string[]) => ({ id: key, name: key, value: JSON.stringify(value), deleted: false, created_at: 1, updated_at: 1, clock: 1 });
        await originDb.kv.put(row(['origin-existing']));
        await destinationDb.kv.put(row(['destination-existing']));
        sessionDataRef.value = { session: { authenticated: true, user: { id: 'synthetic-recovery-user' }, workspace: { id: originId } } };
        const scope = effectScope();
        const put = vi.spyOn(originDb.kv, 'put');
        try {
            const state = scope.run(() => useNotifications());
            if (!state) throw new Error('Missing notification state');
            await vi.waitFor(() => expect(state.isThreadMuted('origin-existing')).toBe(true));
            put.mockRejectedValueOnce(new Error('synthetic preference write failure'));
            await expect(state.muteThread('identical-thread')).rejects.toThrow('synthetic preference write failure');
            expect((await originDb.kv.get(key))?.value).toBe(JSON.stringify(['origin-existing']));
            expect((await destinationDb.kv.get(key))?.value).toBe(JSON.stringify(['destination-existing']));
            await state.muteThread('identical-thread');
            expect((await originDb.kv.get(key))?.value).toBe(JSON.stringify(['origin-existing', 'identical-thread']));
            expect((await destinationDb.kv.get(key))?.value).toBe(JSON.stringify(['destination-existing']));
        } finally {
            put.mockRestore(); scope.stop(); sessionDataRef.value = { session: null }; setActiveWorkspaceDb(null);
            for (const id of [originId, destinationId]) { evictWorkspaceDb(id); await Dexie.delete(`or3-db-${id}`); }
        }
    });

    it('rebinds notifications to new workspace db on session workspace switch', async () => {
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

        const ws1Id = 'test-notifications-switch-ws1';
        const ws2Id = 'test-notifications-switch-ws2';
        const ws1Db = setActiveWorkspaceDb(ws1Id);
        sessionDataRef.value = {
            session: {
                authenticated: true,
                user: { id: 'user-1' },
                workspace: { id: ws1Id },
            },
        };
        await ws1Db.notifications.clear();
        await ws1Db.notifications.put({
            id: 'n-ws1',
            user_id: 'user-1',
            type: 'system.warning',
            title: 'Workspace 1',
            deleted: false,
            created_at: 1,
            updated_at: 1,
            clock: 1,
        });

        const scope = effectScope();
        const state = scope.run(() => useNotifications());
        if (!state) throw new Error('Failed to init useNotifications');

        await waitFor(() => state.notifications.value.length > 0);
        expect(state.notifications.value[0]?.id).toBe('n-ws1');

        const ws2Db = setActiveWorkspaceDb(ws2Id);
        await ws2Db.notifications.clear();
        await ws2Db.notifications.put({
            id: 'n-ws2',
            user_id: 'user-1',
            type: 'system.warning',
            title: 'Workspace 2',
            deleted: false,
            created_at: 2,
            updated_at: 2,
            clock: 2,
        });

        sessionDataRef.value = {
            session: {
                authenticated: true,
                user: { id: 'user-1' },
                workspace: { id: ws2Id },
            },
        };
        await nextTick();

        await waitFor(() => state.notifications.value.some((item) => item.id === 'n-ws2'));
        expect(state.notifications.value.find((item) => item.id === 'n-ws2')).toBeDefined();
        expect(
            errorSpy.mock.calls.some(
                (call) =>
                    String(call[0]).includes('[useNotifications] Query error') &&
                    String(call[1]).includes('DatabaseClosedError')
            )
        ).toBe(false);

        scope.stop();
        await ws2Db.delete();
        setActiveWorkspaceDb(null);
        sessionDataRef.value = { session: null };
        errorSpy.mockRestore();
    });

    it('orders notifications by newest first', async () => {
        const db = setActiveWorkspaceDb('test-notifications-order');
        sessionDataRef.value = { session: null };
        await db.notifications.clear();

        await db.notifications.bulkAdd([
            {
                id: 'n1',
                user_id: 'local-user',
                type: 'system.warning',
                title: 'First',
                deleted: false,
                created_at: 1,
                updated_at: 1,
                clock: 1,
            },
            {
                id: 'n2',
                user_id: 'local-user',
                type: 'system.warning',
                title: 'Second',
                deleted: false,
                created_at: 2,
                updated_at: 2,
                clock: 2,
            },
            {
                id: 'n3',
                user_id: 'local-user',
                type: 'system.warning',
                title: 'Third',
                deleted: false,
                created_at: 3,
                updated_at: 3,
                clock: 3,
            },
        ]);

        const scope = effectScope();
        const state = scope.run(() => useNotifications());
        if (!state) throw new Error('Failed to init useNotifications');

        await nextTick();
        for (let i = 0; i < 5 && state.notifications.value.length === 0; i++) {
            await new Promise((resolve) => setTimeout(resolve, 10));
        }

        expect(state.notifications.value.map((item) => item.id)).toEqual([
            'n3',
            'n2',
            'n1',
        ]);

        scope.stop();
        await getDb().delete();
        setActiveWorkspaceDb(null);
    });

    it('mutes and unmutes threads via kv store', async () => {
        const db = setActiveWorkspaceDb('test-notifications-mute');
        sessionDataRef.value = { session: null };
        await db.notifications.clear();
        await db.kv.clear();

        const scope = effectScope();
        const state = scope.run(() => useNotifications());
        if (!state) throw new Error('Failed to init useNotifications');

        await state.muteThread('thread-1');
        await waitFor(() => state.isThreadMuted('thread-1'));

        const kv = await db.kv.get(mutedThreadsKey);
        expect(kv?.value).toBe(JSON.stringify(['thread-1']));
        expect(state.isThreadMuted('thread-1')).toBe(true);

        await state.unmuteThread('thread-1');
        await waitFor(() => !state.isThreadMuted('thread-1'));

        const kvAfter = await db.kv.get(mutedThreadsKey);
        expect(kvAfter?.value).toBe(JSON.stringify([]));

        scope.stop();
        await getDb().delete();
        setActiveWorkspaceDb(null);
    });

    it('handles malformed muted threads data safely', async () => {
        const db = setActiveWorkspaceDb('test-notifications-mute-invalid');
        sessionDataRef.value = { session: null };
        await db.kv.put({
            id: mutedThreadsKey,
            name: mutedThreadsKey,
            value: JSON.stringify({ bad: true }),
            deleted: false,
            created_at: 1,
            updated_at: 1,
            clock: 1,
        });

        const scope = effectScope();
        const state = scope.run(() => useNotifications());
        if (!state) throw new Error('Failed to init useNotifications');

        await waitFor(() => state.isThreadMuted('thread-1') === false);
        expect(state.isThreadMuted('thread-1')).toBe(false);

        await state.muteThread('thread-1');
        await waitFor(() => state.isThreadMuted('thread-1'));

        const kvAfter = await db.kv.get(mutedThreadsKey);
        expect(kvAfter?.value).toBe(JSON.stringify(['thread-1']));

        scope.stop();
        await getDb().delete();
        setActiveWorkspaceDb(null);
    });

    it('tracks unread count reactively', async () => {
        const db = setActiveWorkspaceDb('test-notifications-unread');
        sessionDataRef.value = { session: null };
        await db.notifications.clear();

        await db.notifications.bulkAdd([
            {
                id: 'n1',
                user_id: 'local-user',
                type: 'system.warning',
                title: 'Unread',
                deleted: false,
                created_at: 1,
                updated_at: 1,
                clock: 1,
            },
            {
                id: 'n2',
                user_id: 'local-user',
                type: 'system.warning',
                title: 'Read',
                read_at: 2,
                deleted: false,
                created_at: 2,
                updated_at: 2,
                clock: 2,
            },
        ]);

        const scope = effectScope();
        const state = scope.run(() => useNotifications());
        if (!state) throw new Error('Failed to init useNotifications');

        await waitFor(() => state.unreadCount.value === 1);

        expect(state.unreadCount.value).toBe(1);

        scope.stop();
        await getDb().delete();
        setActiveWorkspaceDb(null);
    });
});
