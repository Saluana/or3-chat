/**
 * useNotifications - Reactive notification center composable
 * 
 * Provides reactive queries and actions for the notification center.
 * Integrates with NotificationService and hook system.
 */

import { ref, computed, onScopeDispose } from 'vue';
import Dexie, { liveQuery, type Subscription } from 'dexie';
import { z } from 'zod';
import { getDb } from '~/db/client';
import { NotificationService } from '~/core/notifications/notification-service';
import { useHooks } from '~/core/hooks/useHooks';
import { nowSec } from '~/db/util';
import type { Notification } from '~/db/schema';
import type { NotificationCreatePayload } from '~/core/hooks/hook-types';

/**
 * User ID for notifications.
 * TODO: Replace with actual user from auth system when multi-user is implemented.
 * Expected integration: const { session } = useSession(); userId = session.value?.user?.id ?? 'guest';
 */
const TEMP_USER_ID = 'temp-user';

// Zod schema for validating muted threads data from KV store
const mutedThreadsSchema = z.array(z.string());

// Singleton service state to prevent memory leaks from duplicate listeners
let sharedService: NotificationService | null = null;
let serviceCleanup: (() => void) | null = null;
let serviceRefCount = 0;

/**
 * Composable for accessing notification center functionality
 */
export function useNotifications() {
    const isClient = import.meta.client || typeof indexedDB !== 'undefined';
    if (!isClient) {
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
    const userId = TEMP_USER_ID;

    // Use singleton service pattern to prevent memory leaks
    if (!sharedService) {
        sharedService = new NotificationService(db, hooks, userId);
        serviceCleanup = sharedService.startListening();
    }
    serviceRefCount++;

    const service = sharedService;

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
            return await db.notifications
                .where('[user_id+created_at]')
                .between([userId, Dexie.minKey], [userId, Dexie.maxKey])
                .reverse()
                .and((n) => !n.deleted)
                .toArray();
        } catch (err) {
            console.error('[useNotifications] Query error:', err);
            return [];
        }
    });

    // Live query for unread count
    // Note: Using compound index [user_id+read_at] would be more efficient,
    // but Dexie doesn't support querying for undefined in compound indexes well.
    // The .and() filter is acceptable for typical notification volumes (<1000).
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

    // Live query for muted threads with Zod validation
    const mutedThreadsObservable = liveQuery(async () => {
        try {
            const kvRecord = await db.kv.get('notification_muted_threads');
            if (!kvRecord?.value) return [];
            
            // Parse and validate with Zod to prevent runtime crashes from malformed data
            const parseResult = mutedThreadsSchema.safeParse(JSON.parse(kvRecord.value));
            if (!parseResult.success) {
                console.warn('[useNotifications] Invalid muted threads data, resetting:', parseResult.error.message);
                return [];
            }
            return parseResult.data;
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

    // Cleanup subscriptions and service ref count
    onScopeDispose(() => {
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- guard handles async race between init and dispose
        if (notificationsSubscription) notificationsSubscription.unsubscribe();
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- guard handles async race between init and dispose
        if (unreadCountSubscription) unreadCountSubscription.unsubscribe();
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- guard handles async race between init and dispose
        if (mutedThreadsSubscription) mutedThreadsSubscription.unsubscribe();

        // Decrement service ref count and cleanup when no more users
        serviceRefCount--;
        if (serviceRefCount === 0 && serviceCleanup) {
            serviceCleanup();
            sharedService = null;
            serviceCleanup = null;
        }
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
            const now = nowSec();
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
        const now = nowSec();
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
