/**
 * Workspace mutations for OR3
 * Handles workspace creation and membership
 */
import { mutation, query } from './_generated/server';
import { v } from 'convex/values';

/**
 * Get all workspaces for the current user
 */
export const listMyWorkspaces = query({
    args: {},
    handler: async (ctx) => {
        const identity = await ctx.auth.getUserIdentity();
        if (!identity) {
            return [];
        }

        // Find user by provider ID
        const authAccount = await ctx.db
            .query('auth_accounts')
            .withIndex('by_provider', (q) =>
                q.eq('provider', 'clerk').eq('provider_user_id', identity.subject)
            )
            .first();

        if (!authAccount) {
            return [];
        }

        // Get all workspace memberships for this user
        const memberships = await ctx.db
            .query('workspace_members')
            .withIndex('by_user', (q) => q.eq('user_id', authAccount.user_id))
            .collect();

        // Fetch workspace details
        const workspaces = await Promise.all(
            memberships.map(async (m) => {
                const workspace = await ctx.db.get(m.workspace_id);
                if (!workspace) return null;
                return {
                    _id: workspace._id,
                    name: workspace.name,
                    role: m.role,
                    created_at: workspace.created_at,
                };
            })
        );

        return workspaces.filter(Boolean);
    },
});

/**
 * Create a new workspace for the current user
 */
export const create = mutation({
    args: {
        name: v.string(),
    },
    handler: async (ctx, args) => {
        const identity = await ctx.auth.getUserIdentity();
        if (!identity) {
            throw new Error('Not authenticated');
        }

        const now = Date.now();

        // Find or create user
        let authAccount = await ctx.db
            .query('auth_accounts')
            .withIndex('by_provider', (q) =>
                q.eq('provider', 'clerk').eq('provider_user_id', identity.subject)
            )
            .first();

        let userId;
        if (!authAccount) {
            // Create user first
            userId = await ctx.db.insert('users', {
                email: identity.email ?? undefined,
                display_name: identity.name ?? undefined,
                created_at: now,
            });

            // Link auth account
            await ctx.db.insert('auth_accounts', {
                user_id: userId,
                provider: 'clerk',
                provider_user_id: identity.subject,
                created_at: now,
            });
        } else {
            userId = authAccount.user_id;
        }

        // Create workspace
        const workspaceId = await ctx.db.insert('workspaces', {
            name: args.name,
            owner_user_id: userId,
            created_at: now,
        });

        // Add user as owner member
        await ctx.db.insert('workspace_members', {
            workspace_id: workspaceId,
            user_id: userId,
            role: 'owner',
            created_at: now,
        });

        // Initialize server version counter for this workspace
        await ctx.db.insert('server_version_counter', {
            workspace_id: workspaceId,
            value: 0,
        });

        return workspaceId;
    },
});

/**
 * Ensure a user and their default workspace exist.
 * Called during session resolution on first login.
 */
export const ensure = mutation({
    args: {
        provider: v.string(),
        provider_user_id: v.string(),
        email: v.optional(v.string()),
        name: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const now = Date.now();

        // Find or create user
        let authAccount = await ctx.db
            .query('auth_accounts')
            .withIndex('by_provider', (q) =>
                q.eq('provider', args.provider).eq('provider_user_id', args.provider_user_id)
            )
            .first();

        let userId;
        if (!authAccount) {
            // Create user
            userId = await ctx.db.insert('users', {
                email: args.email,
                display_name: args.name,
                created_at: now,
            });

            // Link auth account
            await ctx.db.insert('auth_accounts', {
                user_id: userId,
                provider: args.provider,
                provider_user_id: args.provider_user_id,
                created_at: now,
            });
        } else {
            userId = authAccount.user_id;
        }

        // Check for workspace membership
        const firstMembership = await ctx.db
            .query('workspace_members')
            .withIndex('by_user', (q) => q.eq('user_id', userId))
            .first();

        let workspaceId;
        if (!firstMembership) {
            // Create default workspace
            workspaceId = await ctx.db.insert('workspaces', {
                name: 'Personal Workspace',
                owner_user_id: userId,
                created_at: now,
            });

            // Add as owner
            await ctx.db.insert('workspace_members', {
                workspace_id: workspaceId,
                user_id: userId,
                role: 'owner',
                created_at: now,
            });

            // Initialize counter
            await ctx.db.insert('server_version_counter', {
                workspace_id: workspaceId,
                value: 0,
            });
        } else {
            workspaceId = firstMembership.workspace_id;
        }

        const workspace = await ctx.db.get(workspaceId);
        return {
            id: workspaceId,
            name: workspace?.name || 'Personal Workspace',
        };
    },
});

