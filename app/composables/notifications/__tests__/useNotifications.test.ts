import { describe, it, expect, vi } from 'vitest';
import { effectScope, nextTick, ref } from 'vue';

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

import { setActiveWorkspaceDb, getDb } from '~/db/client';
import { useNotifications } from '~/composables/notifications/useNotifications';

async function waitFor(predicate: () => boolean): Promise<void> {
    for (let i = 0; i < 20; i++) {
        if (predicate()) return;
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
}

describe('useNotifications', () => {
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

        const kv = await db.kv.get('notification_muted_threads');
        expect(kv?.value).toBe(JSON.stringify(['thread-1']));
        expect(state.isThreadMuted('thread-1')).toBe(true);

        await state.unmuteThread('thread-1');
        await waitFor(() => !state.isThreadMuted('thread-1'));

        const kvAfter = await db.kv.get('notification_muted_threads');
        expect(kvAfter?.value).toBe(JSON.stringify([]));

        scope.stop();
        await getDb().delete();
        setActiveWorkspaceDb(null);
    });

    it('handles malformed muted threads data safely', async () => {
        const db = setActiveWorkspaceDb('test-notifications-mute-invalid');
        sessionDataRef.value = { session: null };
        await db.kv.put({
            id: 'notification_muted_threads',
            name: 'notification_muted_threads',
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

        const kvAfter = await db.kv.get('notification_muted_threads');
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
