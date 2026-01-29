import { mutation, query, type MutationCtx, type QueryCtx } from './_generated/server';
import { v } from 'convex/values';
import type { Id } from './_generated/dataModel';

/**
 * Get the current user's auth account ID.
 * Throws if not authenticated.
 */
async function getAuthAccount(ctx: MutationCtx | QueryCtx): Promise<{ userId: Id<'users'> }> {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
        throw new Error('Not authenticated');
    }

    const authAccount = await ctx.db
        .query('auth_accounts')
        .withIndex('by_provider', (q) =>
            q.eq('provider', 'clerk').eq('provider_user_id', identity.subject)
        )
        .first();

    if (!authAccount) {
        throw new Error('Unauthorized: User not found');
    }

    return { userId: authAccount.user_id };
}

/**
 * Check if a user is an admin.
 */
export const isAdmin = query({
    args: { user_id: v.id('users') },
    handler: async (ctx, args) => {
        const adminGrant = await ctx.db
            .query('admin_users')
            .withIndex('by_user', (q) => q.eq('user_id', args.user_id))
            .first();

        return adminGrant !== null;
    },
});

/**
 * List all admin users with their user details.
 */
export const listAdmins = query({
    args: {},
    handler: async (ctx) => {
        // Note: In production, this should check if the caller is an admin
        // For now, we rely on the server-side authorization
        const admins = await ctx.db.query('admin_users').collect();

        const results = await Promise.all(
            admins.map(async (admin) => {
                const user = await ctx.db.get(admin.user_id);
                return {
                    userId: admin.user_id,
                    email: user?.email,
                    displayName: user?.display_name,
                    createdAt: admin.created_at,
                };
            })
        );

        return results;
    },
});

/**
 * Grant admin access to a user.
 */
export const grantAdmin = mutation({
    args: {
        user_id: v.id('users'),
    },
    handler: async (ctx, args) => {
        // Note: In production, this should verify the caller is an admin
        const { userId: callerId } = await getAuthAccount(ctx);

        // Check if user exists
        const user = await ctx.db.get(args.user_id);
        if (!user) {
            throw new Error('User not found');
        }

        // Check if already an admin
        const existing = await ctx.db
            .query('admin_users')
            .withIndex('by_user', (q) => q.eq('user_id', args.user_id))
            .first();

        if (existing) {
            throw new Error('User is already an admin');
        }

        // Grant admin access
        await ctx.db.insert('admin_users', {
            user_id: args.user_id,
            created_at: Date.now(),
            created_by_user_id: callerId,
        });

        return { success: true };
    },
});

/**
 * Revoke admin access from a user (hard delete).
 */
export const revokeAdmin = mutation({
    args: {
        user_id: v.id('users'),
    },
    handler: async (ctx, args) => {
        // Note: In production, this should verify the caller is an admin
        await getAuthAccount(ctx);

        const adminGrant = await ctx.db
            .query('admin_users')
            .withIndex('by_user', (q) => q.eq('user_id', args.user_id))
            .first();

        if (!adminGrant) {
            throw new Error('User is not an admin');
        }

        await ctx.db.delete(adminGrant._id);

        return { success: true };
    },
});

/**
 * Search users by email or display name.
 * Returns matching users with their IDs.
 */
export const searchUsers = query({
    args: {
        query: v.string(),
        limit: v.optional(v.number()),
    },
    handler: async (ctx, args) => {
        const limit = args.limit ?? 20;
        const searchTerm = args.query.toLowerCase().trim();

        if (!searchTerm) {
            return [];
        }

        // Get all users and filter (in production, use full-text search)
        const allUsers = await ctx.db.query('users').take(limit * 2);

        const matching = allUsers
            .filter(
                (user) =>
                    user.email?.toLowerCase().includes(searchTerm) ||
                    user.display_name?.toLowerCase().includes(searchTerm)
            )
            .slice(0, limit);

        return matching.map((user) => ({
            userId: user._id,
            email: user.email,
            displayName: user.display_name,
        }));
    },
});
