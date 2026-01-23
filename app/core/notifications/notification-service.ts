/**
 * Notification Service
 * 
 * Core service for managing in-app notifications.
 * Handles create, read, mark-read, and clear operations.
 * Integrates with hook system for extensibility.
 */

import type { Or3DB } from '~/db/client';
import type { Notification } from '~/db/schema';
import type { TypedHookEngine } from '../hooks/typed-hooks';
import type { NotificationCreatePayload } from '../hooks/hook-types';
import { nowSec } from '~/db/util';

// Callback type for the push action handler
type PushActionCallback = (payload: unknown) => Promise<void>;

export class NotificationService {
    private db: Or3DB;
    private hooks: TypedHookEngine;
    private userId: string;
    private actionHandler: PushActionCallback | null = null;
    private isListening = false;

    constructor(db: Or3DB, hooks: TypedHookEngine, userId: string) {
        this.db = db;
        this.hooks = hooks;
        this.userId = userId;
        // NOTE: Do NOT call setupListeners() here - use startListening() explicitly
        // to prevent memory leaks from multiple service instances
    }

    /**
     * Start listening for push events.
     * Call once per session, not per composable instance.
     * Returns a cleanup function to stop listening.
     */
    startListening(): () => void {
        if (this.isListening) {
            console.warn('[NotificationService] Already listening, skipping duplicate registration');
            return () => this.stopListening();
        }

        this.actionHandler = async (payload: unknown) => {
            await this.create(payload as NotificationCreatePayload);
        };

        this.hooks.addAction('notify:action:push', this.actionHandler);
        this.isListening = true;

        return () => this.stopListening();
    }

    /**
     * Stop listening for push events.
     * Cleans up the action handler to prevent memory leaks.
     */
    stopListening(): void {
        if (this.actionHandler && this.isListening) {
            this.hooks.removeAction('notify:action:push', this.actionHandler);
            this.actionHandler = null;
            this.isListening = false;
        }
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

        // If filter returns false or nullish, reject the notification
        if (!filtered) {
            return null;
        }

        const now = nowSec();
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
        const readAt = nowSec();
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
        const readAt = nowSec();
        await this.db.notifications
            .where('user_id')
            .equals(this.userId)
            .and((n: Notification) => n.read_at === undefined && !n.deleted)
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
        const deletedAt = nowSec();
        const result = await this.db.notifications
            .where('user_id')
            .equals(this.userId)
            .and((n: Notification) => !n.deleted)
            .modify({
                deleted: true,
                deleted_at: deletedAt,
                updated_at: deletedAt,
                clock: deletedAt,
            });
        // Dexie modify() returns number of modified records
        const count = typeof result === 'number' ? result : 0;
        await this.hooks.doAction('notify:action:cleared', { count });
        return count;
    }
}
