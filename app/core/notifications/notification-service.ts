/**
 * Notification Service
 * 
 * Core service for managing in-app notifications.
 * Handles create, read, mark-read, and clear operations.
 * Integrates with hook system for extensibility.
 */

import type { Or3DB } from '~/app/db/client';
import type { Notification } from '~/app/db/schema';
import type { HookEngine } from '../hooks/hooks';
import type { NotificationCreatePayload } from '../hooks/hook-types';

export class NotificationService {
    private db: Or3DB;
    private hooks: HookEngine;
    private userId: string;

    constructor(db: Or3DB, hooks: HookEngine, userId: string) {
        this.db = db;
        this.hooks = hooks;
        this.userId = userId;
        this.setupListeners();
    }

    /**
     * Set up hook listeners for notification actions
     */
    private setupListeners(): void {
        // Listen for push events
        this.hooks.on('notify:action:push', async (payload: NotificationCreatePayload) => {
            await this.create(payload);
        });
    }

    /**
     * Create a new notification
     * Applies filter hooks before storage
     */
    async create(payload: NotificationCreatePayload): Promise<Notification | null> {
        // Apply filter hook to allow modifications or rejection
        const filtered = await this.hooks.applyFilters(
            'notify:filter:before_store',
            payload,
            { source: 'client' }
        );

        // If filter returns false, reject the notification
        if (filtered === false) {
            return null;
        }

        const now = Date.now();
        const notification: Notification = {
            id: crypto.randomUUID(),
            user_id: this.userId,
            type: filtered.type,
            title: filtered.title,
            body: filtered.body,
            thread_id: filtered.threadId,
            document_id: filtered.documentId,
            actions: filtered.actions,
            read_at: undefined,
            deleted: false,
            created_at: now,
            updated_at: now,
            clock: now,
        };

        await this.db.notifications.add(notification);
        return notification;
    }

    /**
     * Mark a single notification as read
     */
    async markRead(id: string): Promise<void> {
        const readAt = Date.now();
        await this.db.notifications.update(id, {
            read_at: readAt,
            updated_at: readAt,
            clock: readAt,
        });
        await this.hooks.doAction('notify:action:read', { id, readAt });
    }

    /**
     * Mark all unread notifications as read for current user
     */
    async markAllRead(): Promise<void> {
        const readAt = Date.now();
        await this.db.notifications
            .where('user_id')
            .equals(this.userId)
            .and((n) => n.read_at === undefined && !n.deleted)
            .modify({
                read_at: readAt,
                updated_at: readAt,
                clock: readAt,
            });
    }

    /**
     * Clear all notifications (soft delete)
     * Returns the count of notifications cleared
     */
    async clearAll(): Promise<number> {
        const deletedAt = Date.now();
        const count = await this.db.notifications
            .where('user_id')
            .equals(this.userId)
            .and((n) => !n.deleted)
            .modify({
                deleted: true,
                deleted_at: deletedAt,
                updated_at: deletedAt,
                clock: deletedAt,
            });
        await this.hooks.doAction('notify:action:cleared', { count });
        return count;
    }
}
