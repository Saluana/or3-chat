/**
 * useNotifications - Reactive notification center composable
 * 
 * Provides reactive queries and actions for the notification center.
 * Integrates with NotificationService and hook system.
 */

import { ref, computed, onScopeDispose } from 'vue';
import { liveQuery, type Subscription } from 'dexie';
import { getDb } from '~/db/client';
import { NotificationService } from '~/core/notifications/notification-service';
import { useHooks } from '~/core/hooks/useHooks';
import type { Notification } from '~/db/schema';
import type { NotificationCreatePayload } from '~/core/hooks/hook-types';

// Hardcoded user ID for now - will be replaced with auth system
const TEMP_USER_ID = 'temp-user';

/**
 * Composable for accessing notification center functionality
 */
export function useNotifications() {
    if (!process.client) {
        // SSR-safe no-op
        return {
            notifications: computed(() => [] as Notification[]),
            unreadCount: computed(() => 0),
            loading: ref(false),
            markRead: () => Promise.resolve(),
            markAllRead: () => Promise.resolve(),
            clearAll: () => Promise.resolve(0),
            push: () => Promise.resolve(),
            isThreadMuted: () => false,
            muteThread: () => Promise.resolve(),
            unmuteThread: () => Promise.resolve(),
        };
    }

    const db = getDb();
    const hooks = useHooks();
    const userId = TEMP_USER_ID; // TODO: Replace with actual user from auth

    // Create service instance
    const service = new NotificationService(db, hooks, userId);

    // Reactive state
    const notifications = ref<Notification[]>([]);
    const unreadCount = ref<number>(0);
    const loading = ref(true);
    const mutedThreadsData = ref<string[]>([]);

    let notificationsSubscription: Subscription | null = null;
    let unreadCountSubscription: Subscription | null = null;
    let mutedThreadsSubscription: Subscription | null = null;

    // Live query for notifications (sorted by created_at desc)
    const notificationsObservable = liveQuery(async () => {
        try {
            const results = await db.notifications
                .where('user_id')
                .equals(userId)
                .and((n) => !n.deleted)
                .reverse()
                .sortBy('created_at');
            return results;
        } catch (err) {
            console.error('[useNotifications] Query error:', err);
            return [];
        }
    });

    // Live query for unread count
    const unreadCountObservable = liveQuery(async () => {
        try {
            const count = await db.notifications
                .where('user_id')
                .equals(userId)
                .and((n) => n.read_at === undefined && !n.deleted)
                .count();
            return count;
        } catch (err) {
            console.error('[useNotifications] Unread count error:', err);
            return 0;
        }
    });

    // Live query for muted threads
    const mutedThreadsObservable = liveQuery(async () => {
        try {
            const kvRecord = await db.kv.get('notification_muted_threads');
            if (!kvRecord?.value) return [];
            return JSON.parse(kvRecord.value) as string[];
        } catch (err) {
            console.error('[useNotifications] Muted threads error:', err);
            return [];
        }
    });

    // Subscribe to observables
    notificationsSubscription = notificationsObservable.subscribe({
        next: (result) => {
            notifications.value = result;
            loading.value = false;
        },
        error: (err) => {
            console.error('[useNotifications] Subscription error:', err);
            loading.value = false;
        },
    });

    unreadCountSubscription = unreadCountObservable.subscribe({
        next: (count) => {
            unreadCount.value = count;
        },
        error: (err) => {
            console.error('[useNotifications] Unread count subscription error:', err);
        },
    });

    mutedThreadsSubscription = mutedThreadsObservable.subscribe({
        next: (threads) => {
            mutedThreadsData.value = threads;
        },
        error: (err) => {
            console.error('[useNotifications] Muted threads subscription error:', err);
        },
    });

    // Cleanup subscriptions
    onScopeDispose(() => {
        notificationsSubscription?.unsubscribe();
        unreadCountSubscription?.unsubscribe();
        mutedThreadsSubscription?.unsubscribe();
    });

    /**
     * Check if a thread is muted
     */
    const isThreadMuted = (threadId: string): boolean => {
        return mutedThreadsData.value.includes(threadId);
    };

    /**
     * Mute notifications for a thread
     */
    const muteThread = async (threadId: string): Promise<void> => {
        const muted = [...mutedThreadsData.value];
        if (!muted.includes(threadId)) {
            muted.push(threadId);
            const now = Date.now();
            await db.kv.put({
                id: 'notification_muted_threads',
                name: 'notification_muted_threads',
                value: JSON.stringify(muted),
                deleted: false,
                created_at: now,
                updated_at: now,
                clock: now,
            });
        }
    };

    /**
     * Unmute notifications for a thread
     */
    const unmuteThread = async (threadId: string): Promise<void> => {
        const muted = mutedThreadsData.value.filter((id) => id !== threadId);
        const now = Date.now();
        await db.kv.put({
            id: 'notification_muted_threads',
            name: 'notification_muted_threads',
            value: JSON.stringify(muted),
            deleted: false,
            created_at: now,
            updated_at: now,
            clock: now,
        });
    };

    /**
     * Push a notification (convenience wrapper around hook)
     */
    const push = async (payload: NotificationCreatePayload): Promise<void> => {
        await hooks.doAction('notify:action:push', payload);
    };

    /**
     * Mark a notification as read
     */
    const markRead = async (id: string): Promise<void> => {
        await service.markRead(id);
    };

    /**
     * Mark all notifications as read
     */
    const markAllRead = async (): Promise<void> => {
        await service.markAllRead();
    };

    /**
     * Clear all notifications (soft delete)
     */
    const clearAll = async (): Promise<number> => {
        return await service.clearAll();
    };

    return {
        notifications: computed(() => notifications.value),
        unreadCount: computed(() => unreadCount.value),
        loading: computed(() => loading.value),
        markRead,
        markAllRead,
        clearAll,
        push,
        isThreadMuted,
        muteThread,
        unmuteThread,
    };
}
