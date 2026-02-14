/**
 * @module app/core/notifications/notification-service
 *
 * Purpose:
 * Core service for managing in-app notifications. Handles create, read,
 * mark-read, and clear-all operations against the local Dexie database.
 * Integrates with the hook system for extensibility.
 *
 * Responsibilities:
 * - Listen for `notify:action:push` hook events and auto-create notifications
 * - Apply `notify:filter:before_store` filter to allow modification or rejection
 * - Validate incoming payloads with Zod before storage
 * - Emit hooks on read and clear operations for observability
 *
 * Constraints:
 * - One active listener per service instance (call `startListening()` once)
 * - Notifications are soft-deleted (not removed from IndexedDB)
 * - Timestamps use seconds (via `nowSec()`) for consistency with sync layer
 * - Service must be explicitly started; constructor does not auto-listen
 *
 * Non-goals:
 * - Does not handle push notification delivery to native OS
 * - Does not sync notifications to remote (handled by sync layer)
 *
 * @see core/hooks/hook-types.ts for NotificationCreatePayload shape
 * @see db/schema for the Notification Dexie table schema
 */

import type { Or3DB } from '~/db/client';
import { NotificationActionSchema } from '~/db/schema';
import type { Notification } from '~/db/schema';
import type { TypedHookEngine } from '../hooks/typed-hooks';
import type { NotificationCreatePayload } from '../hooks/hook-types';
import { nowSec, getWriteTxTableNames } from '~/db/util';
import { z } from 'zod';

// Callback type for the push action handler
type PushActionCallback = (payload: unknown) => Promise<void>;

const NotificationCreatePayloadSchema = z.object({
    type: z.string().min(1),
    title: z.string().min(1),
    body: z.string().optional(),
    threadId: z.string().optional(),
    documentId: z.string().optional(),
    actions: z.array(NotificationActionSchema).optional(),
});

/**
 * Purpose:
 * Local notification service backed by Dexie.
 *
 * Behavior:
 * - `startListening()` registers a single hook listener for `notify:action:push`
 * - `create()` validates and stores a notification, applying filter hooks
 * - Read and clear operations emit corresponding hooks for observability
 *
 * Constraints:
 * - Instances are lightweight, but listeners are not; call `startListening()` once
 *   per session and use the returned cleanup function
 */
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
            const parsed = NotificationCreatePayloadSchema.safeParse(payload);
            if (!parsed.success) {
                console.warn(
                    '[NotificationService] Invalid notification payload',
                    parsed.error.message
                );
                return;
            }
            await this.create(parsed.data);
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

    private getNotificationWriteTxTables(): string[] {
        return getWriteTxTableNames(this.db, 'notifications');
    }

    private async runNotificationWriteTx<T>(fn: () => Promise<T>): Promise<T> {
        const tx = (this.db as { transaction?: unknown }).transaction;
        if (typeof tx !== 'function') {
            return await fn();
        }
        return await this.db.transaction(
            'rw',
            this.getNotificationWriteTxTables(),
            fn
        );
    }

    /**
     * Create a new notification
     * Applies filter hooks before storage
     */
    async create(payload: NotificationCreatePayload): Promise<Notification | null> {
        const parsedPayload = NotificationCreatePayloadSchema.safeParse(payload);
        if (!parsedPayload.success) {
            console.warn(
                '[NotificationService] Invalid notification payload',
                parsedPayload.error.message
            );
            return null;
        }
        // Apply filter hook to allow modifications or rejection
        const filtered = await this.hooks.applyFilters(
            'notify:filter:before_store',
            parsedPayload.data,
            { source: 'client' }
        );

        // If filter returns false or nullish, reject the notification
        if (!filtered) {
            return null;
        }

        const filteredPayload = NotificationCreatePayloadSchema.safeParse(filtered);
        if (!filteredPayload.success) {
            console.warn(
                '[NotificationService] Invalid filtered notification payload',
                filteredPayload.error.message
            );
            return null;
        }

        const now = nowSec();
        const notification: Notification = {
            id: crypto.randomUUID(),
            user_id: this.userId,
            type: filteredPayload.data.type,
            title: filteredPayload.data.title,
            body: filteredPayload.data.body,
            thread_id: filteredPayload.data.threadId,
            document_id: filteredPayload.data.documentId,
            actions: filteredPayload.data.actions,
            read_at: undefined,
            deleted: false,
            created_at: now,
            updated_at: now,
            clock: now,
        };

        await this.runNotificationWriteTx(async () => {
            await this.db.notifications.add(notification);
        });
        return notification;
    }

    /**
     * Mark a single notification as read
     */
    async markRead(id: string): Promise<void> {
        const readAt = nowSec();
        await this.runNotificationWriteTx(async () => {
            await this.db.notifications.update(id, {
                read_at: readAt,
                updated_at: readAt,
                clock: readAt,
            });
        });
        await this.hooks.doAction('notify:action:read', { id, readAt });
    }

    /**
     * Mark all unread notifications as read for current user
     */
    async markAllRead(): Promise<void> {
        const readAt = nowSec();
        await this.runNotificationWriteTx(async () => {
            await this.db.notifications
                .where('user_id')
                .equals(this.userId)
                .and((n: Notification) => n.read_at === undefined && !n.deleted)
                .modify({
                    read_at: readAt,
                    updated_at: readAt,
                    clock: readAt,
                });
        });
    }

    /**
     * Clear all notifications (soft delete)
     * Returns the count of notifications cleared
     */
    async clearAll(): Promise<number> {
        const deletedAt = nowSec();
        const result = await this.runNotificationWriteTx(async () => {
            return await this.db.notifications
                .where('user_id')
                .equals(this.userId)
                .and((n: Notification) => !n.deleted)
                .modify({
                    deleted: true,
                    deleted_at: deletedAt,
                    updated_at: deletedAt,
                    clock: deletedAt,
                });
        });
        // Dexie modify() returns number of modified records
        const count = typeof result === 'number' ? result : 0;
        await this.hooks.doAction('notify:action:cleared', { count });
        return count;
    }
}
