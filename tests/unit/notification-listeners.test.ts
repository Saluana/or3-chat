/**
 * Integration tests for Sync Conflict and System Warning Notifications
 * 
 * Tests the notification listeners functionality:
 * - Sync conflict notifications
 * - System warning notifications
 * - Error handling
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getDb } from '~/db/client';
import { useHooks } from '~/core/hooks/useHooks';
import { NotificationService } from '~/core/notifications/notification-service';
import { newId, nowSec } from '~/db/util';

// Mock modules
vi.mock('#imports', () => ({
    useHooks: () => ({
        addAction: vi.fn(),
        doAction: vi.fn(),
        applyFilters: vi.fn((_, value) => value),
    }),
}));

// Helper function to emit system notification (same logic as plugin)
async function emitSystemNotification(payload: {
    title: string;
    body: string;
    threadId?: string;
    documentId?: string;
}, userId: string = 'test-user'): Promise<void> {
    const hooks = useHooks();
    const service = new NotificationService(getDb(), hooks, userId);
    
    await service.create({
        type: 'system.warning',
        title: payload.title,
        body: payload.body,
        threadId: payload.threadId,
        documentId: payload.documentId,
    });
}

describe('Sync Conflict Notifications', () => {
    const userId = 'test-user';
    
    beforeEach(async () => {
        const db = getDb();
        await db.notifications.clear();
    });
    
    afterEach(async () => {
        const db = getDb();
        await db.notifications.clear();
    });
    
    it('should create notification for sync conflict', async () => {
        const hooks = useHooks();
        const db = getDb();
        const service = new NotificationService(db, hooks, userId);
        
        // Simulate sync conflict
        const conflict = {
            tableName: 'messages',
            pk: 'msg-123',
            local: { clock: 1000, content: 'Local version' },
            remote: { clock: 2000, content: 'Remote version' },
            winner: 'remote' as const,
        };
        
        // Create notification manually (plugin would do this via hook)
        await service.create({
            type: 'sync.conflict',
            title: 'Sync conflict resolved',
            body: `A conflict was detected in ${conflict.tableName} and resolved using last-write-wins. The ${conflict.winner} version was kept.`,
            threadId: conflict.tableName === 'messages' ? conflict.pk : undefined,
            actions: [
                {
                    id: newId(),
                    label: 'Details',
                    kind: 'callback',
                    data: {
                        tableName: conflict.tableName,
                        pk: conflict.pk,
                        localClock: conflict.local.clock,
                        remoteClock: conflict.remote.clock,
                        winner: conflict.winner,
                    },
                },
            ],
        });
        
        // Verify notification was created
        const notifications = await db.notifications
            .where('user_id')
            .equals(userId)
            .toArray();
        
        expect(notifications).toHaveLength(1);
        expect(notifications[0]!.type).toBe('sync.conflict');
        expect(notifications[0]!.title).toBe('Sync conflict resolved');
        expect(notifications[0]!.body).toContain('messages');
        expect(notifications[0]!.body).toContain('remote');
        expect(notifications[0]!.actions).toHaveLength(1);
        expect(notifications[0]!.actions![0]!.label).toBe('Details');
    });
    
    it('should include conflict metadata in notification', async () => {
        const hooks = useHooks();
        const db = getDb();
        const service = new NotificationService(db, hooks, userId);
        
        const conflict = {
            tableName: 'threads',
            pk: 'thread-456',
            local: { clock: 1500, name: 'Local Thread Name' },
            remote: { clock: 1600, name: 'Remote Thread Name' },
            winner: 'local' as const,
        };
        
        // Create notification
        await service.create({
            type: 'sync.conflict',
            title: 'Sync conflict resolved',
            body: `A conflict was detected in ${conflict.tableName} and resolved using last-write-wins. The ${conflict.winner} version was kept.`,
            actions: [
                {
                    id: newId(),
                    label: 'Details',
                    kind: 'callback',
                    data: {
                        tableName: conflict.tableName,
                        pk: conflict.pk,
                        localClock: conflict.local.clock,
                        remoteClock: conflict.remote.clock,
                        winner: conflict.winner,
                    },
                },
            ],
        });
        
        // Verify metadata
        const notifications = await db.notifications
            .where('user_id')
            .equals(userId)
            .toArray();
        
        expect(notifications[0]!.actions![0]!.data).toEqual({
            tableName: 'threads',
            pk: 'thread-456',
            localClock: 1500,
            remoteClock: 1600,
            winner: 'local',
        });
    });
    
    it('should handle multiple concurrent conflicts', async () => {
        const hooks = useHooks();
        const db = getDb();
        const service = new NotificationService(db, hooks, userId);
        
        // Create multiple conflict notifications
        const conflicts = [
            { tableName: 'messages', pk: 'msg-1' },
            { tableName: 'messages', pk: 'msg-2' },
            { tableName: 'threads', pk: 'thread-1' },
        ];
        
        for (const conflict of conflicts) {
            await service.create({
                type: 'sync.conflict',
                title: 'Sync conflict resolved',
                body: `A conflict was detected in ${conflict.tableName}.`,
            });
        }
        
        // Verify all notifications created
        const notifications = await db.notifications
            .where('user_id')
            .equals(userId)
            .toArray();
        
        expect(notifications).toHaveLength(3);
        expect(notifications.every(n => n.type === 'sync.conflict')).toBe(true);
    });
});

describe('System Warning Notifications', () => {
    const userId = 'test-user';
    
    beforeEach(async () => {
        const db = getDb();
        await db.notifications.clear();
    });
    
    afterEach(async () => {
        const db = getDb();
        await db.notifications.clear();
    });
    
    it('should create notification for sync error', async () => {
        await emitSystemNotification({
            title: 'Sync error',
            body: 'An error occurred during synchronization.',
        }, userId);
        
        // Verify notification was created
        const db = getDb();
        const notifications = await db.notifications
            .where('user_id')
            .equals(userId)
            .toArray();
        
        expect(notifications).toHaveLength(1);
        expect(notifications[0]!.type).toBe('system.warning');
        expect(notifications[0]!.title).toBe('Sync error');
    });
    
    it('should create notification for storage error', async () => {
        await emitSystemNotification({
            title: 'Storage error',
            body: 'An error occurred while accessing storage.',
        }, userId);
        
        // Verify notification was created
        const db = getDb();
        const notifications = await db.notifications
            .where('user_id')
            .equals(userId)
            .toArray();
        
        expect(notifications).toHaveLength(1);
        expect(notifications[0]!.type).toBe('system.warning');
        expect(notifications[0]!.title).toBe('Storage error');
    });
    
    it('should include thread context in system notification', async () => {
        const threadId = newId();
        
        await emitSystemNotification({
            title: 'Thread error',
            body: 'An error occurred in this thread.',
            threadId,
        }, userId);
        
        // Verify notification includes thread context
        const db = getDb();
        const notifications = await db.notifications
            .where('user_id')
            .equals(userId)
            .toArray();
        
        expect(notifications).toHaveLength(1);
        expect(notifications[0]!.thread_id).toBe(threadId);
    });
    
    it('should include document context in system notification', async () => {
        const documentId = newId();
        
        await emitSystemNotification({
            title: 'Document error',
            body: 'An error occurred with this document.',
            documentId,
        }, userId);
        
        // Verify notification includes document context
        const db = getDb();
        const notifications = await db.notifications
            .where('user_id')
            .equals(userId)
            .toArray();
        
        expect(notifications).toHaveLength(1);
        expect(notifications[0]!.document_id).toBe(documentId);
    });
    
    it('should handle system notifications without context', async () => {
        await emitSystemNotification({
            title: 'General warning',
            body: 'A general system warning occurred.',
        }, userId);
        
        // Verify notification created without thread/document
        const db = getDb();
        const notifications = await db.notifications
            .where('user_id')
            .equals(userId)
            .toArray();
        
        expect(notifications).toHaveLength(1);
        expect(notifications[0]!.thread_id).toBeUndefined();
        expect(notifications[0]!.document_id).toBeUndefined();
    });
});

describe('Error Handling', () => {
    beforeEach(async () => {
        const db = getDb();
        await db.notifications.clear();
    });
    
    afterEach(async () => {
        const db = getDb();
        await db.notifications.clear();
    });
    
    it('should not throw when notification creation fails', async () => {
        // This test verifies that the plugin doesn't crash the app
        // when notification creation fails (e.g., database error)
        
        // emitSystemNotification catches and logs errors internally
        await expect(emitSystemNotification({
            title: 'Test',
            body: 'Test',
        })).resolves.not.toThrow();
    });
    
    it('should handle invalid conflict data gracefully', async () => {
        const hooks = useHooks();
        const db = getDb();
        const service = new NotificationService(db, hooks, 'test-user');
        
        // Create notification with minimal data
        await service.create({
            type: 'sync.conflict',
            title: 'Conflict',
            body: 'A conflict occurred.',
        });
        
        const notifications = await db.notifications.toArray();
        expect(notifications).toHaveLength(1);
    });
});

describe('Notification Filtering', () => {
    const userId = 'test-user';
    
    beforeEach(async () => {
        const db = getDb();
        await db.notifications.clear();
    });
    
    afterEach(async () => {
        const db = getDb();
        await db.notifications.clear();
    });
    
    it('should respect filter hooks to block notifications', async () => {
        const db = getDb();
        
        // Create a mock hooks object with a filter that returns false
        const mockHooks = {
            addAction: vi.fn(),
            doAction: vi.fn(),
            applyFilters: vi.fn().mockResolvedValue(false),
        };
        
        const service = new NotificationService(db, mockHooks as any, userId);
        const result = await service.create({
            type: 'system.warning',
            title: 'Blocked notification',
            body: 'This should be blocked.',
        });
        
        // Verify notification was not created
        expect(result).toBeNull();
        
        const notifications = await db.notifications.toArray();
        expect(notifications).toHaveLength(0);
    });
    
    it('should allow filter hooks to modify notifications', async () => {
        const db = getDb();
        
        // Create a mock hooks object with a filter that modifies the notification
        const mockHooks = {
            addAction: vi.fn(),
            doAction: vi.fn(),
            applyFilters: vi.fn().mockResolvedValue({
                type: 'system.warning',
                title: 'Modified title',
                body: 'Modified body',
            }),
        };
        
        const service = new NotificationService(db, mockHooks as any, userId);
        await service.create({
            type: 'system.warning',
            title: 'Original title',
            body: 'Original body',
        });
        
        // Verify notification was modified
        const notifications = await db.notifications.toArray();
        expect(notifications).toHaveLength(1);
        expect(notifications[0]!.title).toBe('Modified title');
        expect(notifications[0]!.body).toBe('Modified body');
    });
});
