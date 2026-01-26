/**
 * Notifications Convex Functions
 */

import { v } from 'convex/values';
import { mutation } from './_generated/server';

export const create = mutation({
    args: {
        user_id: v.string(), // Provider user ID (from session)
        type: v.string(),
        title: v.string(),
        body: v.optional(v.string()),
        thread_id: v.optional(v.string()),
        actions: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        // 1. Resolve internal user ID from auth_accounts
        // We iterate providers to find the user.
        // Ideally we should know the provider but here we just have the ID.
        // We'll search by provider_user_id.
        const authAccount = await ctx.db
            .query('auth_accounts')
            .filter(q => q.eq(q.field('provider_user_id'), args.user_id))
            .first();

        if (!authAccount) {
            console.warn('[notifications] User not found for notification', args.user_id);
            return;
        }

        const userId = authAccount.user_id;

        // 2. Find the workspace for the thread
        let workspaceId = null;

        if (args.thread_id) {
            // Get all workspaces the user is a member of
            const memberships = await ctx.db
                .query('workspace_members')
                .withIndex('by_user', q => q.eq('user_id', userId))
                .collect();

            // Check each workspace for the thread
            for (const membership of memberships) {
                const thread = await ctx.db
                    .query('threads')
                    .withIndex('by_workspace_id', q =>
                        q.eq('workspace_id', membership.workspace_id).eq('id', args.thread_id!)
                    )
                    .first();

                if (thread) {
                    workspaceId = membership.workspace_id;
                    break;
                }
            }
        }

        // Fallback to active workspace if thread not found or not provided
        if (!workspaceId) {
            const user = await ctx.db.get(userId);
            if (user?.active_workspace_id) {
                workspaceId = user.active_workspace_id;
            }
        }

        if (!workspaceId) {
            console.warn('[notifications] Could not determine workspace for notification');
            return;
        }

        // 3. Create the notification
        await ctx.db.insert('notifications', {
            workspace_id: workspaceId,
            id: crypto.randomUUID(),
            user_id: args.user_id, // Keep original provider ID as schema seems to use string?
                                   // Schema says `user_id: v.string()`.
                                   // In `threads`, `messages`, etc, user ids are strings (provider IDs).
                                   // But `workspace_members` uses `v.id('users')`.
                                   // Let's check schema again. `notifications.user_id` is `v.string()`.
                                   // This usually implies provider ID or client generated ID.
                                   // Given `client-side` useAi uses "local-user" or session ID, it matches.
            thread_id: args.thread_id,
            type: args.type,
            title: args.title,
            body: args.body,
            actions: args.actions,
            deleted: false,
            created_at: Date.now(),
            updated_at: Date.now(),
            clock: 0, // Initial clock
        });
    },
});
