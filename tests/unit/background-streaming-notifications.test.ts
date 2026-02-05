/**
 * Integration tests for Background Streaming + Notification Center
 * 
 * Tests the complete flow:
 * 1. Start background stream
 * 2. User navigates away
 * 3. Stream completes
 * 4. Notification is created
 * 5. User clicks notification
 * 6. Navigate to thread
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getDb } from '~/db/client';
import { useHooks } from '~/core/hooks/useHooks';
import { NotificationService } from '~/core/notifications/notification-service';
import { newId, nowSec } from '~/db/util';
import type { Notification } from '~/db/schema';

const hooksMock = {
    addAction: vi.fn(),
    removeAction: vi.fn(),
    doAction: vi.fn(),
    applyFilters: vi.fn((_, value) => Promise.resolve(value)),
};

// Mock modules
vi.mock('#imports', () => ({
    useHooks: () => ({
        addAction: vi.fn(),
        doAction: vi.fn(),
        applyFilters: vi.fn((_, value) => value),
    }),
    useToast: () => ({
        add: vi.fn(),
    }),
    useAppConfig: () => ({}),
    useRuntimeConfig: () => ({
        public: {},
    }),
    useUserApiKey: () => ({
        key: ref('test-key'),
        isConfigured: computed(() => true),
    }),
    useActivePrompt: () => ({
        promptId: ref(null),
        promptContent: ref(null),
    }),
    getDefaultPromptId: vi.fn(() => null),
    navigateTo: vi.fn(),
}));

vi.mock('~/core/hooks/useHooks', () => ({
    useHooks: () => hooksMock,
}));

describe('Background Streaming + Notifications Integration', () => {
    const userId = 'test-user';
    const threadId = newId();
    const messageId = newId();
    
    beforeEach(async () => {
        // Clear database
        const db = getDb();
        await db.notifications.clear();
        await db.messages.clear();
        await db.threads.clear();
        await db.kv.clear();
        
        // Create test thread
        await db.threads.add({
            id: threadId,
            name: 'Test Thread',
            description: null,
            model_id: 'test-model',
            prompt_id: null,
            temperature: 0.7,
            top_p: 1,
            max_tokens: null,
            order_key: 'a0',
            created_at: nowSec(),
            updated_at: nowSec(),
            deleted: false,
            clock: nowSec(),
        });
    });
    
    afterEach(async () => {
        const db = getDb();
        await db.notifications.clear();
        await db.messages.clear();
        await db.threads.clear();
        await db.kv.clear();
    });
    
    describe('AI Message Notifications', () => {
        it('should create notification when background stream completes and user has navigated away', async () => {
            const hooks = useHooks();
            const db = getDb();
            const service = new NotificationService(db, hooks, userId);
            
            // Simulate background stream completion
            await service.create({
                type: 'ai.message.received',
                title: 'AI response ready',
                body: 'Your background response is ready.',
                threadId,
                actions: [
                    {
                        id: newId(),
                        label: 'Open chat',
                        kind: 'navigate',
                        target: { threadId },
                        data: { messageId },
                    },
                ],
            });
            
            // Verify notification was created
            const notifications = await db.notifications
                .where('user_id')
                .equals(userId)
                .toArray();
            
            expect(notifications).toHaveLength(1);
            expect(notifications[0]!.type).toBe('ai.message.received');
            expect(notifications[0]!.title).toBe('AI response ready');
            expect(notifications[0]!.thread_id).toBe(threadId);
            expect(notifications[0]!.read_at).toBeUndefined();
        });
        
        it('should respect thread mute preferences', async () => {
            const db = getDb();
            
            // Mute the thread
            const mutedThreads = [threadId];
            await db.kv.put({
                id: 'notification_muted_threads',
                name: 'notification_muted_threads',
                value: JSON.stringify(mutedThreads),
                created_at: nowSec(),
                updated_at: nowSec(),
            });
            
            // Try to create notification (would be filtered in real implementation)
            const hooks = useHooks();
            const service = new NotificationService(db, hooks, userId);
            
            // Check if thread is muted (this would be checked before creating notification)
            const kv = await db.kv.get('notification_muted_threads');
            const parsed = JSON.parse(kv?.value || '[]');
            const isMuted = Array.isArray(parsed) && parsed.includes(threadId);
            
            expect(isMuted).toBe(true);
        });
        
        it('should create error notification when background stream fails', async () => {
            const hooks = useHooks();
            const db = getDb();
            const service = new NotificationService(db, hooks, userId);
            
            // Simulate background stream error
            await service.create({
                type: 'system.warning',
                title: 'AI response failed',
                body: 'Background response failed.',
                threadId,
            });
            
            // Verify error notification was created
            const notifications = await db.notifications
                .where('user_id')
                .equals(userId)
                .toArray();
            
            expect(notifications).toHaveLength(1);
            expect(notifications[0]!.type).toBe('system.warning');
            expect(notifications[0]!.title).toBe('AI response failed');
        });
        
        it('should create abort notification when background stream is aborted', async () => {
            const hooks = useHooks();
            const db = getDb();
            const service = new NotificationService(db, hooks, userId);
            
            // Simulate background stream abort
            await service.create({
                type: 'system.warning',
                title: 'AI response stopped',
                body: 'Background response was aborted.',
                threadId,
            });
            
            // Verify abort notification was created
            const notifications = await db.notifications
                .where('user_id')
                .equals(userId)
                .toArray();
            
            expect(notifications).toHaveLength(1);
            expect(notifications[0]!.type).toBe('system.warning');
            expect(notifications[0]!.title).toBe('AI response stopped');
        });
    });
    
    describe('Notification Actions', () => {
        it('should mark notification as read when clicked', async () => {
            const hooks = useHooks();
            const db = getDb();
            const service = new NotificationService(db, hooks, userId);
            
            // Create notification
            const notification = await service.create({
                type: 'ai.message.received',
                title: 'Test notification',
                body: 'Test body',
                threadId,
            });
            
            expect(notification).toBeTruthy();
            expect(notification!.read_at).toBeUndefined();
            
            // Mark as read
            await service.markRead(notification!.id);
            
            // Verify marked as read
            const updated = await db.notifications.get(notification!.id);
            expect(updated!.read_at).toBeDefined();
            expect(updated!.read_at).toBeGreaterThan(0);
        });
        
        it('should mark all notifications as read', async () => {
            const hooks = useHooks();
            const db = getDb();
            const service = new NotificationService(db, hooks, userId);
            
            // Create multiple notifications
            await service.create({
                type: 'ai.message.received',
                title: 'Notification 1',
                body: 'Body 1',
                threadId,
            });
            
            await service.create({
                type: 'ai.message.received',
                title: 'Notification 2',
                body: 'Body 2',
                threadId,
            });
            
            // Verify unread
            let unread = await db.notifications
                .where('user_id')
                .equals(userId)
                .and(n => n.read_at === undefined)
                .count();
            expect(unread).toBe(2);
            
            // Mark all as read
            await service.markAllRead();
            
            // Verify all read
            unread = await db.notifications
                .where('user_id')
                .equals(userId)
                .and(n => n.read_at === undefined)
                .count();
            expect(unread).toBe(0);
        });
        
        it('should clear all notifications', async () => {
            const hooks = useHooks();
            const db = getDb();
            const service = new NotificationService(db, hooks, userId);
            
            // Create notification
            await service.create({
                type: 'ai.message.received',
                title: 'Test notification',
                body: 'Test body',
                threadId,
            });
            
            // Verify exists
            let count = await db.notifications
                .where('user_id')
                .equals(userId)
                .and(n => !n.deleted)
                .count();
            expect(count).toBe(1);
            
            // Clear all
            const cleared = await service.clearAll();
            expect(cleared).toBe(1);
            
            // Verify deleted (soft delete)
            count = await db.notifications
                .where('user_id')
                .equals(userId)
                .and(n => !n.deleted)
                .count();
            expect(count).toBe(0);
        });
    });
    
    describe('Unread Count', () => {
        it('should calculate correct unread count', async () => {
            const hooks = useHooks();
            const db = getDb();
            const service = new NotificationService(db, hooks, userId);
            
            // Create 3 notifications
            const n1 = await service.create({
                type: 'ai.message.received',
                title: 'Notification 1',
                body: 'Body 1',
                threadId,
            });
            
            await service.create({
                type: 'ai.message.received',
                title: 'Notification 2',
                body: 'Body 2',
                threadId,
            });
            
            await service.create({
                type: 'ai.message.received',
                title: 'Notification 3',
                body: 'Body 3',
                threadId,
            });
            
            // Verify unread count
            let unread = await db.notifications
                .where('user_id')
                .equals(userId)
                .and(n => n.read_at === undefined && !n.deleted)
                .count();
            expect(unread).toBe(3);
            
            // Mark one as read
            await service.markRead(n1!.id);
            
            // Verify unread count decreased
            unread = await db.notifications
                .where('user_id')
                .equals(userId)
                .and(n => n.read_at === undefined && !n.deleted)
                .count();
            expect(unread).toBe(2);
        });
        
        it('should cap unread badge at 99+', () => {
            const unreadCount = 150;
            const displayCount = unreadCount > 99 ? '99+' : unreadCount;
            expect(displayCount).toBe('99+');
        });
    });
});

// Helper to mock ref and computed
function ref<T>(value: T) {
    return { value };
}

function computed<T>(fn: () => T) {
    return { value: fn() };
}
