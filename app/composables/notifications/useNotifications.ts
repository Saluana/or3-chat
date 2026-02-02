/**
 * @module app/composables/notifications/useNotifications
 *
 * Purpose:
 * Provide a reactive notification center interface backed by Dexie and the
 * notification hook system.
 *
 * Responsibilities:
 * - Expose notification queries and derived state for the active user
 * - Route notification actions through NotificationService and hooks
 * - Manage subscriptions and cleanup within Vue component lifecycles
 *
 * Non-responsibilities:
 * - Rendering notification UI
 * - Enforcing authorization beyond server side gates
 * - Persisting notification preferences outside the local KV table
 */

import { ref, computed, onScopeDispose, watch, type ComputedRef } from 'vue';
import Dexie, { liveQuery, type Subscription } from 'dexie';
import { z } from 'zod';
import { useRuntimeConfig } from '#imports';
import { getDb } from '~/db/client';
import { NotificationService } from '~/core/notifications/notification-service';
import { useHooks } from '~/core/hooks/useHooks';
import { nowSec } from '~/db/util';
import type { Notification } from '~/db/schema';
import type { NotificationCreatePayload } from '~/core/hooks/hook-types';
import { useSessionContext } from '~/composables/auth/useSessionContext';
import {
    FALLBACK_NOTIFICATION_USER_ID,
    resolveNotificationUserId,
} from '~/core/notifications/notification-user';

// Zod schema for validating muted threads data from KV store
const mutedThreadsSchema = z.array(z.string());

// Singleton service state to prevent memory leaks from duplicate listeners
let sharedService: NotificationService | null = null;
let sharedServiceUserId: string | null = null;
let serviceCleanup: (() => void) | null = null;
let serviceRefCount = 0;

/**
 * Reactive notification state and actions returned by {@link useNotifications}.
 *
 * Purpose:
 * Provide a typed surface for notification queries and actions.
 *
 * Behavior:
 * Exposes computed state for notification lists and unread counts along with
 * mutation methods that flow through NotificationService and hooks.
 *
 * Constraints:
 * - Computed values update from Dexie liveQuery subscriptions
 * - Mutation methods are async and can run concurrently
 *
 * Non-Goals:
 * - Guaranteeing immediate persistence across devices
 */
export interface NotificationsComposable {
    /** Ordered list of notifications for the active user. */
    notifications: ComputedRef<Notification[]>;
    /** Count of unread notifications for the active user. */
    unreadCount: ComputedRef<number>;
    /** Whether the notification list is still loading. */
    loading: ComputedRef<boolean>;
    /** Mark a notification as read. */
    markRead: (id: string) => Promise<void>;
    /** Mark all notifications as read. */
    markAllRead: () => Promise<void>;
    /** Soft delete all notifications. */
    clearAll: () => Promise<number>;
    /** Push a notification through the hooks system. */
    push: (payload: NotificationCreatePayload) => Promise<void>;
    /** Check if a thread is muted for notifications. */
    isThreadMuted: (threadId: string) => boolean;
    /** Mute notifications for a thread. */
    muteThread: (threadId: string) => Promise<void>;
    /** Unmute notifications for a thread. */
    unmuteThread: (threadId: string) => Promise<void>;
}

/**
 * Access notification center functionality for the active user.
 *
 * Purpose:
 * Provide a lifecycle-safe notification API for Vue components.
 *
 * Behavior:
 * Subscribes to Dexie live queries, updates computed state, and cleans up
 * subscriptions when the calling scope is disposed.
 *
 * Constraints:
 * - Must be called during Vue setup to attach scope disposal handlers
 * - Returns a no-op implementation when IndexedDB is unavailable
 *
 * Non-Goals:
 * - Triggering network sync or push delivery
 */
export function useNotifications(): NotificationsComposable {
    const isClient = import.meta.client || typeof indexedDB !== 'undefined';
    if (!isClient) {
        // SSR-safe no-op
        return {
            notifications: computed(() => [] as Notification[]),
            unreadCount: computed(() => 0),
            loading: computed(() => false),
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
    const runtimeConfig = useRuntimeConfig();
    const ssrAuthEnabled = runtimeConfig.public.ssrAuthEnabled === true;
    const sessionContext = ssrAuthEnabled ? useSessionContext() : null;
    const userId = ref<string>(FALLBACK_NOTIFICATION_USER_ID);

    function ensureSharedService(nextUserId: string): NotificationService {
        if (sharedService && sharedServiceUserId === nextUserId) {
            return sharedService;
        }
        if (serviceCleanup) {
            serviceCleanup();
        }
        sharedService = new NotificationService(db, hooks, nextUserId);
        sharedServiceUserId = nextUserId;
        serviceCleanup = sharedService.startListening();
        return sharedService;
    }

    serviceRefCount++;

    let service = ensureSharedService(userId.value);

    // Reactive state
    const notifications = ref<Notification[]>([]);
    const unreadCount = ref<number>(0);
    const loading = ref(true);
    const mutedThreadsData = ref<string[]>([]);

    let notificationsSubscription: Subscription | null = null;
    let unreadCountSubscription: Subscription | null = null;
    let mutedThreadsSubscription: Subscription | null = null;

    function stopNotificationSubscriptions(): void {
        if (notificationsSubscription) notificationsSubscription.unsubscribe();
        if (unreadCountSubscription) unreadCountSubscription.unsubscribe();
        notificationsSubscription = null;
        unreadCountSubscription = null;
    }

    function startNotificationSubscriptions(currentUserId: string): void {
        loading.value = true;

        const notificationsObservable = liveQuery(async () => {
            try {
                return await db.notifications
                    .where('[user_id+created_at]')
                    .between(
                        [currentUserId, Dexie.minKey],
                        [currentUserId, Dexie.maxKey]
                    )
                    .reverse()
                    .and((n) => !n.deleted)
                    .toArray();
            } catch (err) {
                console.error('[useNotifications] Query error:', err);
                return [];
            }
        });

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

        // Live query for unread count
        // Note: Using compound index [user_id+read_at] would be more efficient,
        // but Dexie doesn't support querying for undefined in compound indexes well.
        // The .and() filter is acceptable for typical notification volumes (<1000).
        const unreadCountObservable = liveQuery(async () => {
            try {
                const count = await db.notifications
                    .where('user_id')
                    .equals(currentUserId)
                    .and((n) => n.read_at === undefined && !n.deleted)
                    .count();
                return count;
            } catch (err) {
                console.error('[useNotifications] Unread count error:', err);
                return 0;
            }
        });

        unreadCountSubscription = unreadCountObservable.subscribe({
            next: (count) => {
                unreadCount.value = count;
            },
            error: (err) => {
                console.error(
                    '[useNotifications] Unread count subscription error:',
                    err
                );
            },
        });
    }

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

    function syncUserId(): void {
        const nextUserId = resolveNotificationUserId(
            sessionContext?.data.value?.session
        );
        const needsResubscribe =
            nextUserId !== userId.value ||
            !notificationsSubscription ||
            !unreadCountSubscription;
        if (!needsResubscribe) return;
        userId.value = nextUserId;
        service = ensureSharedService(nextUserId);
        stopNotificationSubscriptions();
        startNotificationSubscriptions(nextUserId);
    }

    if (sessionContext) {
        watch(
            () => sessionContext.data.value?.session,
            () => {
                syncUserId();
            },
            { immediate: true }
        );
    } else {
        syncUserId();
    }

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
        stopNotificationSubscriptions();
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- guard handles async race between init and dispose
        if (mutedThreadsSubscription) mutedThreadsSubscription.unsubscribe();

        // Decrement service ref count and cleanup when no more users
        serviceRefCount--;
        if (serviceRefCount === 0 && serviceCleanup) {
            serviceCleanup();
            sharedService = null;
            sharedServiceUserId = null;
            serviceCleanup = null;
        }
    });

    const isThreadMuted = (threadId: string): boolean => {
        return mutedThreadsData.value.includes(threadId);
    };

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

    const push = async (payload: NotificationCreatePayload): Promise<void> => {
        await hooks.doAction('notify:action:push', payload);
    };

    const markRead = async (id: string): Promise<void> => {
        await service.markRead(id);
    };

    const markAllRead = async (): Promise<void> => {
        await service.markAllRead();
    };

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
