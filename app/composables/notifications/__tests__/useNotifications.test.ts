import { describe, it, expect } from 'vitest';
import { effectScope, nextTick } from 'vue';
import { setActiveWorkspaceDb, getDb } from '~/db/client';
import { useNotifications } from '~/composables/notifications/useNotifications';

describe('useNotifications', () => {
    it('orders notifications by newest first', async () => {
        const db = setActiveWorkspaceDb('test-notifications-order');
        await db.notifications.clear();

        await db.notifications.bulkAdd([
            {
                id: 'n1',
                user_id: 'temp-user',
                type: 'system.warning',
                title: 'First',
                deleted: false,
                created_at: 1,
                updated_at: 1,
                clock: 1,
            },
            {
                id: 'n2',
                user_id: 'temp-user',
                type: 'system.warning',
                title: 'Second',
                deleted: false,
                created_at: 2,
                updated_at: 2,
                clock: 2,
            },
            {
                id: 'n3',
                user_id: 'temp-user',
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
});
