/**
 * Notification Listeners Plugin
 * 
 * Sets up listeners for system events that should create notifications:
 * - Sync conflicts (from conflict-resolver)
 * - System warnings and errors
 * 
 * Phase 5: Event Source Integration (Tasks 12 & 13)
 */

import { defineNuxtPlugin } from '#app';
import { useRuntimeConfig } from '#imports';
import { useHooks } from '~/core/hooks/useHooks';
import { NotificationService } from '~/core/notifications/notification-service';
import { resolveNotificationUserId } from '~/core/notifications/notification-user';
import { getDb } from '~/db/client';
import { newId } from '~/db/util';
import { useSessionContext } from '~/composables/auth/useSessionContext';
import { getGlobalMultiPaneApi } from '~/utils/multiPaneApi';
import { CONVEX_PROVIDER_ID } from '~~/shared/cloud/provider-ids';

/**
 * Create a notification for system warnings and errors
 * Task 13.2: Helper function for system notification emission
 */
function isClientRuntime(): boolean {
    const override = (globalThis as { __OR3_TEST_CLIENT?: boolean })
        ?.__OR3_TEST_CLIENT;
    if (typeof override === 'boolean') return override;
    return Boolean(import.meta.client);
}

export async function emitSystemNotification(payload: {
    title: string;
    body: string;
    threadId?: string;
    documentId?: string;
}): Promise<void> {
    if (!isClientRuntime()) return;
    
    const runtimeConfig = useRuntimeConfig();
    const sessionContext =
        runtimeConfig.public?.ssrAuthEnabled === true
            ? useSessionContext()
            : null;
    const hooks = useHooks();
    const userId = resolveNotificationUserId(
        sessionContext?.data.value?.session
    );
    const service = new NotificationService(getDb(), hooks, userId);
    
    await service.create({
        type: 'system.warning',
        title: payload.title,
        body: payload.body,
        threadId: payload.threadId,
        documentId: payload.documentId,
    });
}

export default defineNuxtPlugin(() => {
    if (!isClientRuntime()) return;
    
    const runtimeConfig = useRuntimeConfig();
    const sessionContext =
        runtimeConfig.public?.ssrAuthEnabled === true
            ? useSessionContext()
            : null;
    const hooks = useHooks();
    const syncConfig = runtimeConfig.public?.sync;
    const serverNotificationsEnabled =
        runtimeConfig.public?.ssrAuthEnabled === true &&
        syncConfig?.enabled === true &&
        syncConfig?.provider === CONVEX_PROVIDER_ID &&
        Boolean(syncConfig?.convexUrl);
    const getNotificationUserId = () =>
        resolveNotificationUserId(sessionContext?.data.value?.session);
    const conflictDedupe = new Map<string, number>();
    const errorDedupe = new Map<string, number>();
    const streamDedupe = new Map<string, number>();
    const DEDUPE_WINDOW_MS = 15_000;

    // Track bootstrap/rescan state to suppress notifications during initial sync
    let isInitialSyncing = false;

    // Listen for bootstrap/rescan start/complete to suppress notifications
    hooks.addAction('sync.bootstrap:action:start', () => {
        isInitialSyncing = true;
    });

    hooks.addAction('sync.bootstrap:action:complete', () => {
        isInitialSyncing = false;
    });

    hooks.addAction('sync.rescan:action:starting', () => {
        isInitialSyncing = true;
    });

    hooks.addAction('sync.rescan:action:completed', () => {
        isInitialSyncing = false;
    });

    function isThreadOpen(threadId?: string): boolean {
        if (!threadId) return false;
        const api = getGlobalMultiPaneApi();
        const panes = api?.panes?.value;
        if (!Array.isArray(panes)) return false;
        return panes.some(
            (pane) => pane?.mode === 'chat' && pane?.threadId === threadId
        );
    }

    function shouldDedupe(key: string): boolean {
        const now = Date.now();
        const lastSeen = streamDedupe.get(key);
        if (lastSeen && now - lastSeen < DEDUPE_WINDOW_MS) return true;
        streamDedupe.set(key, now);
        return false;
    }
    
    // Task 12.1 & 12.2: Listen for sync conflicts and create notifications
    hooks.addAction('sync.conflict:action:detected', async (conflict) => {
        try {
            // Skip conflict notifications during bootstrap/rescan to avoid noise
            if (isInitialSyncing) return;

            const { tableName, pk, local, remote, winner } = conflict;

            // Skip notifications for historical conflicts (older than 24 hours)
            // Historical conflicts are not actionable and create noise on first load
            const localClock = (local as { clock?: number })?.clock;
            const remoteClock = (remote as { clock?: number })?.clock;
            const conflictClock = Math.max(localClock ?? 0, remoteClock ?? 0);
            const ONE_DAY_MS = 24 * 60 * 60 * 1000;
            if (Date.now() - conflictClock * 1000 > ONE_DAY_MS) {
                if (import.meta.dev) {
                    console.debug('[notify] Skipping historical conflict notification', {
                        tableName,
                        pk,
                        ageHours: Math.round((Date.now() - conflictClock * 1000) / 1000 / 60 / 60),
                    });
                }
                return;
            }

            if (import.meta.dev) {
                console.debug('[notify] sync.conflict:detected', {
                    tableName,
                    pk,
                    winner,
                    localClock,
                    remoteClock,
                });
            }
            const conflictKey = `${tableName}:${pk}:${winner}`;
            const now = Date.now();
            const lastSeen = conflictDedupe.get(conflictKey);
            if (lastSeen && now - lastSeen < DEDUPE_WINDOW_MS) return;
            conflictDedupe.set(conflictKey, now);
            
            // Create a notification for the conflict
            const title = 'Sync conflict resolved';
            const body = `A conflict was detected in ${tableName} and resolved using last-write-wins. The ${winner} version was kept.`;
            
            const service = new NotificationService(
                getDb(),
                hooks,
                getNotificationUserId()
            );
            await service.create({
                type: 'sync.conflict',
                title,
                body,
                threadId: tableName === 'messages' || tableName === 'threads' ? pk : undefined,
                actions: [
                    {
                        id: newId(),
                        label: 'Details',
                        kind: 'callback',
                        data: {
                            tableName,
                            pk,
                            localClock: (local as { clock?: number })?.clock,
                            remoteClock: (remote as { clock?: number })?.clock,
                            winner,
                        },
                    },
                ],
            });
        } catch (err) {
            console.error('[notification-listeners] Failed to create sync conflict notification:', err);
        }
    });

    // Handle permanent sync errors with dedupe + noise filtering
    hooks.addAction('sync.error:action', async ({ op, error, permanent }) => {
        try {
            if (!permanent) return;

            // Skip error notifications during bootstrap/rescan to avoid noise
            if (isInitialSyncing) return;

            if (op.tableName === 'notifications' || op.tableName === 'pending_ops') {
                return;
            }
            const message =
                error instanceof Error ? error.message : String(error || 'Sync error');
            const errorKey = `${op.tableName}:${op.pk}:${message}`;
            const now = Date.now();
            const lastSeen = errorDedupe.get(errorKey);
            if (lastSeen && now - lastSeen < DEDUPE_WINDOW_MS) return;
            errorDedupe.set(errorKey, now);

            await emitSystemNotification({
                title: 'Sync error',
                body: message,
            });
        } catch (err) {
            console.error('[notification-listeners] Failed to create sync error notification:', err);
        }
    });
    
    // Task 13.1: Listen for sync errors
    hooks.addAction('sync:action:error', async (error) => {
        try {
            // Skip error notifications during bootstrap/rescan to avoid noise
            if (isInitialSyncing) return;

            await emitSystemNotification({
                title: 'Sync error',
                body: error?.message || 'An error occurred during synchronization.',
            });
        } catch (err) {
            console.error('[notification-listeners] Failed to create sync error notification:', err);
        }
    });
    
    // Listen for storage failures if such hooks exist
    hooks.addAction('storage:action:error', async (error) => {
        try {
            await emitSystemNotification({
                title: 'Storage error',
                body: error?.message || 'An error occurred while accessing storage.',
            });
        } catch (err) {
            console.error('[notification-listeners] Failed to create storage error notification:', err);
        }
    });

    // AI stream completion notifications (only when thread is not open)
    hooks.addAction('ai.chat.stream:action:complete', async (payload) => {
        try {
            if (serverNotificationsEnabled) return;
            if (!payload?.threadId) return;
            if (isThreadOpen(payload.threadId)) return;
            const dedupeKey = `complete:${payload.streamId || payload.assistantId}`;
            if (shouldDedupe(dedupeKey)) return;

            const service = new NotificationService(
                getDb(),
                hooks,
                getNotificationUserId()
            );
            await service.create({
                type: 'ai.message.received',
                title: 'AI response ready',
                body: 'Your background response is ready.',
                threadId: payload.threadId,
                actions: [
                    {
                        id: newId(),
                        label: 'Open chat',
                        kind: 'navigate',
                        target: { threadId: payload.threadId },
                        data: { messageId: payload.assistantId },
                    },
                ],
            });
        } catch (err) {
            console.error('[notification-listeners] Failed to create AI completion notification:', err);
        }
    });

    // AI stream error notifications (skip aborts)
    hooks.addAction('ai.chat.stream:action:error', async (payload) => {
        try {
            if (serverNotificationsEnabled) return;
            if (!payload?.threadId) return;
            if (payload.aborted) return;
            if (isThreadOpen(payload.threadId)) return;
            const dedupeKey = `error:${payload.streamId || payload.threadId}`;
            if (shouldDedupe(dedupeKey)) return;

            const service = new NotificationService(
                getDb(),
                hooks,
                getNotificationUserId()
            );
            await service.create({
                type: 'system.warning',
                title: 'AI response failed',
                body:
                    payload.error instanceof Error
                        ? payload.error.message
                        : 'Background response failed.',
                threadId: payload.threadId,
            });
        } catch (err) {
            console.error('[notification-listeners] Failed to create AI error notification:', err);
        }
    });
});
