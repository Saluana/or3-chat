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

import { ref, computed, onScopeDispose, watch, type ComputedRef, getCurrentScope } from 'vue';
import Dexie, { liveQuery, type Subscription } from 'dexie';
import { z } from 'zod';
import { useRuntimeConfig } from '#imports';
import { getActiveWorkspaceId, getDb } from '~/db/client';
import { NotificationService } from '~/core/notifications/notification-service';
import { useHooks } from '~/core/hooks/useHooks';
import { nowSec, getWriteTxTableNames } from '~/db/util';
import type { Notification } from '~/db/schema';
import type { NotificationCreatePayload } from '~/core/hooks/hook-types';
import { useSessionContext } from '~/composables/auth/useSessionContext';
import {
    FALLBACK_NOTIFICATION_USER_ID,
    resolveNotificationUserId,
} from '~/core/notifications/notification-user';

// Zod schema for validating muted threads data from KV store
const mutedThreadsSchema = z.array(z.string());
const mutedThreadsKeyForUser = (currentUserId: string) =>
    `notification_muted_threads:${currentUserId}`;
const legacyMutedThreadsKey = 'notification_muted_threads';

// Singleton service state to prevent memory leaks from duplicate listeners
let sharedService: NotificationService | null = null;
let sharedServiceUserId: string | null = null;
let sharedServiceWorkspaceId: string | null = null;
let serviceCleanup: (() => void) | null = null;
let serviceRefCount = 0;
const BG_STREAM_NOTIF_LOG_PREFIX = '[bg-stream & notifications]';

function logBgNotification(
    stage: string,
    details?: Record<string, unknown>
): void {
    if (!import.meta.dev) return;
    if (details) {
        console.debug(BG_STREAM_NOTIF_LOG_PREFIX, stage, details);
        return;
    }
    console.debug(BG_STREAM_NOTIF_LOG_PREFIX, stage);
}

function warnBgNotification(
    stage: string,
    details?: Record<string, unknown>
): void {
    if (!import.meta.dev) return;
    if (details) {
        console.warn(BG_STREAM_NOTIF_LOG_PREFIX, stage, details);
        return;
    }
    console.warn(BG_STREAM_NOTIF_LOG_PREFIX, stage);
}

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

    let db = getDb();
    const hooks = useHooks();
    const runtimeConfig = useRuntimeConfig();
    const ssrAuthEnabled = runtimeConfig.public.ssrAuthEnabled === true;
    const sessionContext = ssrAuthEnabled ? useSessionContext() : null;
    const userId = ref<string>(FALLBACK_NOTIFICATION_USER_ID);
    const workspaceId = ref<string | null>(getActiveWorkspaceId());

    function isDatabaseClosedError(error: unknown): boolean {
        if (!error || typeof error !== 'object') return false;
        const name = (error as { name?: unknown }).name;
        if (name === 'DatabaseClosedError') return true;
        const message = (error as { message?: unknown }).message;
        return typeof message === 'string' && message.includes('Database has been closed');
    }

    function ensureSharedService(nextUserId: string, nextWorkspaceId: string | null): NotificationService {
        if (
            sharedService &&
            sharedServiceUserId === nextUserId &&
            sharedServiceWorkspaceId === nextWorkspaceId
        ) {
            logBgNotification('notifications-service-reuse', {
                userId: nextUserId,
                workspaceId: nextWorkspaceId,
            });
            return sharedService;
        }
        if (serviceCleanup) {
            serviceCleanup();
        }
        logBgNotification('notifications-service-create', {
            userId: nextUserId,
            workspaceId: nextWorkspaceId,
        });
        sharedService = new NotificationService(db, hooks, nextUserId);
        sharedServiceUserId = nextUserId;
        sharedServiceWorkspaceId = nextWorkspaceId;
        serviceCleanup = sharedService.startListening();
        return sharedService;
    }

    serviceRefCount++;
    logBgNotification('notifications-service-ref-increment', {
        serviceRefCount,
        userId: userId.value,
        workspaceId: workspaceId.value,
    });

    let service = ensureSharedService(userId.value, workspaceId.value);

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
        logBgNotification('notifications-subscribe-start', {
            userId: currentUserId,
        });

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
                if (!isDatabaseClosedError(err)) {
                    console.error('[useNotifications] Query error:', err);
                }
                return [];
            }
        });

        notificationsSubscription = notificationsObservable.subscribe({
            next: (result) => {
                notifications.value = result;
                loading.value = false;
                logBgNotification('notifications-subscribe-next', {
                    userId: currentUserId,
                    count: result.length,
                });
            },
            error: (err) => {
                if (!isDatabaseClosedError(err)) {
                    console.error('[useNotifications] Subscription error:', err);
                    warnBgNotification('notifications-subscribe-error', {
                        userId: currentUserId,
                        error: err instanceof Error ? err.message : String(err),
                    });
                }
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
                if (!isDatabaseClosedError(err)) {
                    console.error('[useNotifications] Unread count error:', err);
                }
                return 0;
            }
        });

        unreadCountSubscription = unreadCountObservable.subscribe({
            next: (count) => {
                unreadCount.value = count;
                logBgNotification('notifications-unread-next', {
                    userId: currentUserId,
                    unread: count,
                });
            },
            error: (err) => {
                if (!isDatabaseClosedError(err)) {
                    console.error(
                        '[useNotifications] Unread count subscription error:',
                        err
                    );
                    warnBgNotification('notifications-unread-error', {
                        userId: currentUserId,
                        error: err instanceof Error ? err.message : String(err),
                    });
                }
            },
        });
    }

    function stopMutedThreadsSubscription(): void {
        if (mutedThreadsSubscription) mutedThreadsSubscription.unsubscribe();
        mutedThreadsSubscription = null;
    }

    function startMutedThreadsSubscription(currentUserId: string): void {
        logBgNotification('notifications-muted-subscribe-start', {
            userId: currentUserId,
        });
        const scopedMutedThreadsKey = mutedThreadsKeyForUser(currentUserId);
        const mutedThreadsObservable = liveQuery(async () => {
            try {
                const kvRecord =
                    (await db.kv.get(scopedMutedThreadsKey)) ||
                    (await db.kv.get(legacyMutedThreadsKey));
                if (!kvRecord?.value) return [];

                // Parse and validate with Zod to prevent runtime crashes from malformed data
                const parseResult = mutedThreadsSchema.safeParse(JSON.parse(kvRecord.value));
                if (!parseResult.success) {
                    console.warn('[useNotifications] Invalid muted threads data, resetting:', parseResult.error.message);
                    warnBgNotification('notifications-muted-invalid-data', {
                        userId: currentUserId,
                        error: parseResult.error.message,
                    });
                    return [];
                }
                return parseResult.data;
            } catch (err) {
                if (!isDatabaseClosedError(err)) {
                    console.error('[useNotifications] Muted threads error:', err);
                    warnBgNotification('notifications-muted-query-error', {
                        userId: currentUserId,
                        error: err instanceof Error ? err.message : String(err),
                    });
                }
                return [];
            }
        });

        mutedThreadsSubscription = mutedThreadsObservable.subscribe({
            next: (threads) => {
                mutedThreadsData.value = threads;
                logBgNotification('notifications-muted-next', {
                    userId: currentUserId,
                    mutedCount: threads.length,
                });
            },
            error: (err) => {
                if (!isDatabaseClosedError(err)) {
                    console.error('[useNotifications] Muted threads subscription error:', err);
                    warnBgNotification('notifications-muted-subscribe-error', {
                        userId: currentUserId,
                        error: err instanceof Error ? err.message : String(err),
                    });
                }
            },
        });
    }

    function syncUserId(): void {
        db = getDb();
        const nextUserId = resolveNotificationUserId(
            sessionContext?.data.value?.session
        );
        const nextWorkspaceId = sessionContext?.data.value?.session?.workspace?.id
            ?? getActiveWorkspaceId();
        const needsResubscribe =
            nextUserId !== userId.value ||
            nextWorkspaceId !== workspaceId.value ||
            !notificationsSubscription ||
            !unreadCountSubscription ||
            !mutedThreadsSubscription;
        if (!needsResubscribe) return;
        logBgNotification('notifications-sync-user', {
            prevUserId: userId.value,
            nextUserId,
            prevWorkspaceId: workspaceId.value,
            nextWorkspaceId,
            needsResubscribe,
        });
        userId.value = nextUserId;
        workspaceId.value = nextWorkspaceId;
        service = ensureSharedService(nextUserId, nextWorkspaceId);
        stopNotificationSubscriptions();
        stopMutedThreadsSubscription();
        startNotificationSubscriptions(nextUserId);
        startMutedThreadsSubscription(nextUserId);
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

    // Cleanup subscriptions and service ref count
    if (getCurrentScope()) {
        onScopeDispose(() => {
            stopNotificationSubscriptions();
            stopMutedThreadsSubscription();

            // Decrement service ref count and cleanup when no more users
            serviceRefCount--;
            logBgNotification('notifications-service-ref-decrement', {
                serviceRefCount,
                userId: userId.value,
                workspaceId: workspaceId.value,
            });
            if (serviceRefCount === 0 && serviceCleanup) {
                serviceCleanup();
                sharedService = null;
                sharedServiceUserId = null;
                sharedServiceWorkspaceId = null;
                serviceCleanup = null;
                logBgNotification('notifications-service-cleanup-final', {
                    userId: userId.value,
                    workspaceId: workspaceId.value,
                });
            }
        });
    }

    const isThreadMuted = (threadId: string): boolean => {
        return mutedThreadsData.value.includes(threadId);
    };

    const persistMutedThreads = async (muted: string[]): Promise<void> => {
        const key = mutedThreadsKeyForUser(userId.value);
        await db.transaction('rw', getWriteTxTableNames(db, 'kv'), async () => {
            const existing = await db.kv.get(key);
            const now = nowSec();
            await db.kv.put({
                id: key,
                name: key,
                value: JSON.stringify(muted),
                deleted: false,
                created_at: existing?.created_at ?? now,
                updated_at: now,
                clock: now,
            });
        });
    };

    const muteThread = async (threadId: string): Promise<void> => {
        const muted = [...mutedThreadsData.value];
        if (!muted.includes(threadId)) {
            muted.push(threadId);
            await persistMutedThreads(muted);
        }
    };

    const unmuteThread = async (threadId: string): Promise<void> => {
        const muted = mutedThreadsData.value.filter((id) => id !== threadId);
        await persistMutedThreads(muted);
    };

    const push = async (payload: NotificationCreatePayload): Promise<void> => {
        logBgNotification('notifications-push-action', {
            userId: userId.value,
            type: payload.type,
            threadId: payload.threadId || null,
            title: payload.title,
        });
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
