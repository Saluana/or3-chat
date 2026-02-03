/**
 * @module convex/notifications
 *
 * Purpose:
 * Stores and retrieves notification-center entries for a workspace.
 * This is a Convex-backed persistence layer for notifications that are synced
 * (or fetched) across devices.
 *
 * Behavior:
 * - `create` inserts a notification row with a stable `id` (UUID string)
 * - `getByUser` returns the newest notifications first and filters soft-deleted
 * - `markRead` sets `read_at` for a notification in a workspace
 *
 * Authorization:
 * This module currently does not call `ctx.auth.getUserIdentity()`.
 * Callers are responsible for enforcing access control.
 * In OR3 Cloud gateway mode, SSR endpoints should enforce authorization via
 * `can()` and only then call these functions.
 *
 * Constraints:
 * - Timestamps are stored in seconds since epoch (integer).
 * - "Deletion" is soft-delete via the `deleted` flag.
 *
 * Non-Goals:
 * - Complex notification routing or fan-out.
 * - Hard-delete retention policies (handled by other GC processes if needed).
 */

import { v } from 'convex/values';
import { mutation, query } from './_generated/server';

/**
 * `notifications.create` (mutation)
 *
 * Purpose:
 * Creates a single notification entry for a user in a workspace.
 *
 * Behavior:
 * - Generates a UUID string `id` (separate from Convex `_id`)
 * - Initializes `deleted` to `false`
 * - Sets `created_at`, `updated_at`, and `clock` to "now" in seconds
 *
 * Constraints:
 * - This mutation does not validate that `user_id` belongs to the workspace.
 *   Callers must enforce access control.
 */
export const create = mutation({
    args: {
        workspace_id: v.id('workspaces'),
        user_id: v.string(),
        thread_id: v.optional(v.string()),
        type: v.string(),
        title: v.string(),
        body: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const now = Math.floor(Date.now() / 1000);
        const id = crypto.randomUUID();

        await ctx.db.insert('notifications', {
            workspace_id: args.workspace_id,
            id,
            user_id: args.user_id,
            thread_id: args.thread_id,
            type: args.type,
            title: args.title,
            body: args.body,
            deleted: false,
            created_at: now,
            updated_at: now,
            clock: now,
        });

        return id;
    },
});

/**
 * `notifications.getByUser` (query)
 *
 * Purpose:
 * Lists recent notifications for a workspace user.
 *
 * Behavior:
 * - Orders newest-first via the `by_workspace_user` index and `.order('desc')`
 * - Returns at most `limit` (default 50)
 * - Filters out soft-deleted entries (`deleted === true`)
 *
 * Constraints:
 * - `limit` is caller-controlled. Callers should pass a reasonable cap.
 */
export const getByUser = query({
    args: {
        workspace_id: v.id('workspaces'),
        user_id: v.string(),
        limit: v.optional(v.number()),
    },
    handler: async (ctx, args) => {
        const notifications = await ctx.db
            .query('notifications')
            .withIndex('by_workspace_user', (q) =>
                q.eq('workspace_id', args.workspace_id).eq('user_id', args.user_id)
            )
            .order('desc')
            .take(args.limit ?? 50);

        return notifications.filter((n) => !n.deleted);
    },
});

/**
 * `notifications.markRead` (mutation)
 *
 * Purpose:
 * Marks a specific notification as read for a workspace.
 *
 * Behavior:
 * - Looks up by `(workspace_id, id)` (not by Convex `_id`)
 * - Returns `false` if the notification does not exist
 * - Sets `read_at` and bumps `updated_at`
 */
export const markRead = mutation({
    args: {
        workspace_id: v.id('workspaces'),
        notification_id: v.string(),
    },
    handler: async (ctx, args) => {
        const notification = await ctx.db
            .query('notifications')
            .withIndex('by_workspace_id', (q) =>
                q.eq('workspace_id', args.workspace_id).eq('id', args.notification_id)
            )
            .first();

        if (!notification) return false;

        const now = Math.floor(Date.now() / 1000);
        await ctx.db.patch(notification._id, {
            read_at: now,
            updated_at: now,
        });

        return true;
    },
});
