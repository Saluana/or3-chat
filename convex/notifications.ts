/**
 * Notifications Convex Functions
 *
 * Mutations and queries for managing user notifications.
 */

import { v } from 'convex/values';
import { mutation, query } from './_generated/server';

/**
 * Create a new notification
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
        const now = Date.now();
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
 * Get notifications for a user
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
 * Mark a notification as read
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

        await ctx.db.patch(notification._id, {
            read_at: Date.now(),
            updated_at: Date.now(),
        });

        return true;
    },
});
