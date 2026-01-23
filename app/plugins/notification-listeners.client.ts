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
import { useHooks } from '~/core/hooks/useHooks';
import { NotificationService } from '~/core/notifications/notification-service';
import { getDb } from '~/db/client';
import { newId } from '~/db/util';
import type { NotificationCreatePayload } from '~/core/hooks/hook-types';

/**
 * Create a notification for system warnings and errors
 * Task 13.2: Helper function for system notification emission
 */
export async function emitSystemNotification(payload: {
    title: string;
    body: string;
    threadId?: string;
    documentId?: string;
}): Promise<void> {
    if (!import.meta.client) return;
    
    const hooks = useHooks();
    const userId = 'local-user'; // TODO: Replace with actual user ID from auth
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
    if (!import.meta.client) return;
    
    const hooks = useHooks();
    const userId = 'local-user'; // TODO: Replace with actual user ID from auth system
    const service = new NotificationService(getDb(), hooks, userId);
    
    // Task 12.1 & 12.2: Listen for sync conflicts and create notifications
    hooks.addAction('sync.conflict:action:detected', async (conflict) => {
        try {
            const { tableName, pk, local, remote, winner } = conflict;
            
            // Create a notification for the conflict
            const title = 'Sync conflict resolved';
            const body = `A conflict was detected in ${tableName} and resolved using last-write-wins. The ${winner} version was kept.`;
            
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
    
    // Task 13.1: Listen for sync errors
    hooks.addAction('sync:action:error', async (error) => {
        try {
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
});
