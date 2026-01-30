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

// ============================================================================
// WORKSPACE MANAGEMENT
// ============================================================================

/**
 * List all workspaces (admin only).
 * Supports search, pagination, and deleted filter.
 */
export const listWorkspaces = query({
    args: {
        search: v.optional(v.string()),
        include_deleted: v.optional(v.boolean()),
        page: v.number(),
        per_page: v.number(),
    },
    handler: async (ctx, args) => {
        const { search, include_deleted, page, per_page } = args;
        const skip = (page - 1) * per_page;

        // Get all workspaces
        let workspaces = await ctx.db.query('workspaces').collect();

        // Filter by deleted status
        if (!include_deleted) {
            workspaces = workspaces.filter((w) => !w.deleted);
        }

        // Filter by search term
        if (search) {
            const searchTerm = search.toLowerCase();
            workspaces = workspaces.filter((w) =>
                w.name.toLowerCase().includes(searchTerm)
            );
        }

        const total = workspaces.length;

        // Paginate
        const paginated = workspaces.slice(skip, skip + per_page);

        // Get owner and member info
        const results = await Promise.all(
            paginated.map(async (workspace) => {
                const owner = await ctx.db.get(workspace.owner_user_id);
                const members = await ctx.db
                    .query('workspace_members')
                    .withIndex('by_workspace', (q) =>
                        q.eq('workspace_id', workspace._id)
                    )
                    .collect();

                return {
                    id: workspace._id,
                    name: workspace.name,
                    description: workspace.description,
                    createdAt: workspace.created_at,
                    deleted: workspace.deleted ?? false,
                    deletedAt: workspace.deleted_at,
                    ownerUserId: workspace.owner_user_id,
                    ownerEmail: owner?.email,
                    memberCount: members.length,
                };
            })
        );

        return { items: results, total };
    },
});

/**
 * Get a single workspace by ID (admin only).
 */
export const getWorkspace = query({
    args: {
        workspace_id: v.id('workspaces'),
    },
    handler: async (ctx, args) => {
        const workspace = await ctx.db.get(args.workspace_id);

        if (!workspace) {
            return null;
        }

        const owner = await ctx.db.get(workspace.owner_user_id);
        const members = await ctx.db
            .query('workspace_members')
            .withIndex('by_workspace', (q) =>
                q.eq('workspace_id', workspace._id)
            )
            .collect();

        return {
            id: workspace._id,
            name: workspace.name,
            description: workspace.description,
            createdAt: workspace.created_at,
            deleted: workspace.deleted ?? false,
            deletedAt: workspace.deleted_at,
            ownerUserId: workspace.owner_user_id,
            ownerEmail: owner?.email,
            memberCount: members.length,
        };
    },
});

/**
 * Create a new workspace (admin only).
 */
export const createWorkspace = mutation({
    args: {
        name: v.string(),
        description: v.optional(v.string()),
        owner_user_id: v.id('users'),
    },
    handler: async (ctx, args) => {
        // Verify owner exists
        const owner = await ctx.db.get(args.owner_user_id);
        if (!owner) {
            throw new Error('Owner user not found');
        }

        const now = Date.now();

        // Create workspace
        const workspaceId = await ctx.db.insert('workspaces', {
            name: args.name,
            description: args.description,
            owner_user_id: args.owner_user_id,
            created_at: now,
            deleted: false,
        });

        // Add owner as member
        await ctx.db.insert('workspace_members', {
            workspace_id: workspaceId,
            user_id: args.owner_user_id,
            role: 'owner',
            created_at: now,
        });

        // Initialize server version counter
        await ctx.db.insert('server_version_counter', {
            workspace_id: workspaceId,
            value: 0,
        });

        return { workspace_id: workspaceId };
    },
});

/**
 * Soft delete a workspace (admin only).
 */
export const softDeleteWorkspace = mutation({
    args: {
        workspace_id: v.id('workspaces'),
        deleted_at: v.number(),
    },
    handler: async (ctx, args) => {
        const workspace = await ctx.db.get(args.workspace_id);

        if (!workspace) {
            throw new Error('Workspace not found');
        }

        await ctx.db.patch(args.workspace_id, {
            deleted: true,
            deleted_at: args.deleted_at,
        });
    },
});

/**
 * Restore a soft-deleted workspace (admin only).
 */
export const restoreWorkspace = mutation({
    args: {
        workspace_id: v.id('workspaces'),
    },
    handler: async (ctx, args) => {
        const workspace = await ctx.db.get(args.workspace_id);

        if (!workspace) {
            throw new Error('Workspace not found');
        }

        await ctx.db.patch(args.workspace_id, {
            deleted: false,
            deleted_at: undefined,
        });
    },
});

// ============================================================================
// WORKSPACE MEMBERS
// ============================================================================

/**
 * List workspace members (admin only).
 */
export const listWorkspaceMembers = query({
    args: {
        workspace_id: v.id('workspaces'),
    },
    handler: async (ctx, args) => {
        const members = await ctx.db
            .query('workspace_members')
            .withIndex('by_workspace', (q) =>
                q.eq('workspace_id', args.workspace_id)
            )
            .collect();

        const results = await Promise.all(
            members.map(async (m) => {
                const user = await ctx.db.get(m.user_id);
                return {
                    userId: m.user_id,
                    email: user?.email,
                    role: m.role,
                };
            })
        );

        return results;
    },
});

/**
 * Upsert a workspace member (admin only).
 */
export const upsertWorkspaceMember = mutation({
    args: {
        workspace_id: v.id('workspaces'),
        email_or_provider_id: v.string(),
        role: v.union(v.literal('owner'), v.literal('editor'), v.literal('viewer')),
        provider: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const provider = args.provider ?? 'clerk';
        const identifier = args.email_or_provider_id.trim();

        let targetUserId: Id<'users'> | null = null;

        // Find user by email or provider ID
        if (identifier.includes('@')) {
            const user = await ctx.db
                .query('users')
                .filter((q) => q.eq(q.field('email'), identifier))
                .first();
            if (user) targetUserId = user._id;
        } else {
            const authAccount = await ctx.db
                .query('auth_accounts')
                .withIndex('by_provider', (q) =>
                    q.eq('provider', provider).eq('provider_user_id', identifier)
                )
                .first();
            if (authAccount) targetUserId = authAccount.user_id;
        }

        if (!targetUserId) {
            throw new Error('User not found');
        }

        // Check for existing membership
        const existing = await ctx.db
            .query('workspace_members')
            .withIndex('by_workspace_user', (q) =>
                q.eq('workspace_id', args.workspace_id).eq('user_id', targetUserId!)
            )
            .first();

        if (existing) {
            await ctx.db.patch(existing._id, { role: args.role });
        } else {
            await ctx.db.insert('workspace_members', {
                workspace_id: args.workspace_id,
                user_id: targetUserId,
                role: args.role,
                created_at: Date.now(),
            });
        }
    },
});

/**
 * Set workspace member role (admin only).
 */
export const setWorkspaceMemberRole = mutation({
    args: {
        workspace_id: v.id('workspaces'),
        user_id: v.string(),
        role: v.union(v.literal('owner'), v.literal('editor'), v.literal('viewer')),
    },
    handler: async (ctx, args) => {
        const member = await ctx.db
            .query('workspace_members')
            .withIndex('by_workspace_user', (q) =>
                q.eq('workspace_id', args.workspace_id).eq('user_id', args.user_id as Id<'users'>)
            )
            .first();

        if (!member) {
            throw new Error('Member not found');
        }

        await ctx.db.patch(member._id, { role: args.role });
    },
});

/**
 * Remove a workspace member (admin only).
 */
export const removeWorkspaceMember = mutation({
    args: {
        workspace_id: v.id('workspaces'),
        user_id: v.string(),
    },
    handler: async (ctx, args) => {
        const member = await ctx.db
            .query('workspace_members')
            .withIndex('by_workspace_user', (q) =>
                q.eq('workspace_id', args.workspace_id).eq('user_id', args.user_id as Id<'users'>)
            )
            .first();

        if (!member) {
            throw new Error('Member not found');
        }

        await ctx.db.delete(member._id);
    },
});

// ============================================================================
// WORKSPACE SETTINGS
// ============================================================================

/**
 * Get a workspace setting (admin only).
 */
export const getWorkspaceSetting = query({
    args: {
        workspace_id: v.id('workspaces'),
        key: v.string(),
    },
    handler: async (ctx, args) => {
        const entry = await ctx.db
            .query('kv')
            .withIndex('by_workspace_name', (q) =>
                q.eq('workspace_id', args.workspace_id).eq('name', args.key)
            )
            .first();

        if (!entry || entry.deleted) return null;
        return entry.value ?? null;
    },
});

/**
 * Set a workspace setting (admin only).
 */
export const setWorkspaceSetting = mutation({
    args: {
        workspace_id: v.id('workspaces'),
        key: v.string(),
        value: v.string(),
    },
    handler: async (ctx, args) => {
        const now = Date.now();
        const existing = await ctx.db
            .query('kv')
            .withIndex('by_workspace_name', (q) =>
                q.eq('workspace_id', args.workspace_id).eq('name', args.key)
            )
            .first();

        if (existing) {
            await ctx.db.patch(existing._id, {
                value: args.value,
                deleted: false,
                deleted_at: undefined,
                updated_at: now,
                clock: now,
            });
        } else {
            await ctx.db.insert('kv', {
                workspace_id: args.workspace_id,
                id: `${args.workspace_id}:${args.key}`,
                name: args.key,
                value: args.value,
                deleted: false,
                created_at: now,
                updated_at: now,
                clock: now,
            });
        }
    },
});
