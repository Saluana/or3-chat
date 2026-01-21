/**
 * Workspace mutations for OR3
 * Handles workspace creation and membership
 */
import { mutation, query, type MutationCtx, type QueryCtx } from './_generated/server';
import { v } from 'convex/values';
import type { Id, TableNames } from './_generated/dataModel';

async function getAuthAccount(
    ctx: MutationCtx | QueryCtx
): Promise<{ userId: Id<'users'>; authAccountId: Id<'auth_accounts'> }> {
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

    return { userId: authAccount.user_id, authAccountId: authAccount._id };
}

async function requireWorkspaceMembership(
    ctx: MutationCtx | QueryCtx,
    workspaceId: Id<'workspaces'>,
    userId: Id<'users'>
) {
    const membership = await ctx.db
        .query('workspace_members')
        .withIndex('by_workspace_user', (q) =>
            q.eq('workspace_id', workspaceId).eq('user_id', userId)
        )
        .first();

    if (!membership) {
        throw new Error('Forbidden: Not a workspace member');
    }

    return membership;
}

async function deleteWorkspaceData(ctx: MutationCtx, workspaceId: Id<'workspaces'>) {
    type IndexQueryBuilder = {
        eq: (field: string, value: unknown) => IndexQueryBuilder;
    };
    type ConvexDoc = {
        _id: Id<TableNames>;
    } & Record<string, unknown>;
    type QueryByIndex = {
        withIndex: (
            index: string,
            cb: (q: IndexQueryBuilder) => IndexQueryBuilder
        ) => { collect: () => Promise<ConvexDoc[]> };
    };

    const deleteByIndex = async (table: TableNames, indexName: string) => {
        const rows = await (ctx.db.query(table) as unknown as QueryByIndex)
            .withIndex(indexName, (q) => q.eq('workspace_id', workspaceId))
            .collect();
        for (const row of rows) {
            await ctx.db.delete(row._id);
        }
    };

    await deleteByIndex('threads', 'by_workspace_id');
    await deleteByIndex('messages', 'by_workspace_id');
    await deleteByIndex('projects', 'by_workspace_id');
    await deleteByIndex('posts', 'by_workspace_id');
    await deleteByIndex('kv', 'by_workspace_name');
    await deleteByIndex('file_meta', 'by_workspace_hash');
    await deleteByIndex('change_log', 'by_workspace_version');
    await deleteByIndex('tombstones', 'by_workspace_version');
    await deleteByIndex('device_cursors', 'by_workspace_device');
    await deleteByIndex('workspace_members', 'by_workspace');
    await deleteByIndex('server_version_counter', 'by_workspace');
}

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

        const authAccount = await ctx.db
            .query('auth_accounts')
            .withIndex('by_provider', (q) =>
                q.eq('provider', 'clerk').eq('provider_user_id', identity.subject)
            )
            .first();

        if (!authAccount) {
            return [];
        }

        const user = await ctx.db.get(authAccount.user_id);
        const activeWorkspaceId = user?.active_workspace_id ?? null;

        const memberships = await ctx.db
            .query('workspace_members')
            .withIndex('by_user', (q) => q.eq('user_id', authAccount.user_id))
            .collect();

        const workspaces = await Promise.all(
            memberships.map(async (m) => {
                const workspace = await ctx.db.get(m.workspace_id);
                if (!workspace) return null;
                return {
                    _id: workspace._id,
                    name: workspace.name,
                    description: workspace.description ?? null,
                    role: m.role,
                    created_at: workspace.created_at,
                    is_active: activeWorkspaceId === workspace._id,
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
        description: v.optional(v.string()),
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
            description: args.description ?? undefined,
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

export const update = mutation({
    args: {
        workspace_id: v.id('workspaces'),
        name: v.string(),
        description: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const { userId } = await getAuthAccount(ctx);
        const membership = await requireWorkspaceMembership(ctx, args.workspace_id, userId);
        if (membership.role !== 'owner') {
            throw new Error('Forbidden: Only owners can edit workspaces');
        }

        await ctx.db.patch(args.workspace_id, {
            name: args.name,
            description: args.description ?? undefined,
        });

        return { id: args.workspace_id };
    },
});

export const setActive = mutation({
    args: {
        workspace_id: v.id('workspaces'),
    },
    handler: async (ctx, args) => {
        const { userId } = await getAuthAccount(ctx);
        await requireWorkspaceMembership(ctx, args.workspace_id, userId);
        await ctx.db.patch(userId, { active_workspace_id: args.workspace_id });
        const workspace = await ctx.db.get(args.workspace_id);
        return {
            id: args.workspace_id,
            name: workspace?.name ?? 'Workspace',
            description: workspace?.description ?? null,
        };
    },
});

export const remove = mutation({
    args: {
        workspace_id: v.id('workspaces'),
    },
    handler: async (ctx, args) => {
        const { userId } = await getAuthAccount(ctx);
        const membership = await requireWorkspaceMembership(ctx, args.workspace_id, userId);
        if (membership.role !== 'owner') {
            throw new Error('Forbidden: Only owners can delete workspaces');
        }

        const members = await ctx.db
            .query('workspace_members')
            .withIndex('by_workspace', (q) => q.eq('workspace_id', args.workspace_id))
            .collect();

        await deleteWorkspaceData(ctx, args.workspace_id);
        await ctx.db.delete(args.workspace_id);

        for (const member of members) {
            const user = await ctx.db.get(member.user_id);
            if (user?.active_workspace_id === args.workspace_id) {
                const nextMembership = await ctx.db
                    .query('workspace_members')
                    .withIndex('by_user', (q) => q.eq('user_id', member.user_id))
                    .order('asc') // Deterministic: oldest workspace first
                    .first();
                await ctx.db.patch(member.user_id, {
                    active_workspace_id: nextMembership?.workspace_id ?? undefined,
                });
            }
        }

        return { id: args.workspace_id };
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

        let authAccount = await ctx.db
            .query('auth_accounts')
            .withIndex('by_provider', (q) =>
                q.eq('provider', args.provider).eq('provider_user_id', args.provider_user_id)
            )
            .first();

        let userId: Id<'users'>;
        if (!authAccount) {
            userId = await ctx.db.insert('users', {
                email: args.email,
                display_name: args.name,
                created_at: now,
            });

            await ctx.db.insert('auth_accounts', {
                user_id: userId,
                provider: args.provider,
                provider_user_id: args.provider_user_id,
                created_at: now,
            });
        } else {
            userId = authAccount.user_id;
        }

        const user = await ctx.db.get(userId);

        const firstMembership = await ctx.db
            .query('workspace_members')
            .withIndex('by_user', (q) => q.eq('user_id', userId))
            .order('asc') // Deterministic: oldest workspace first
            .first();

        let workspaceId = user?.active_workspace_id ?? undefined;

        if (workspaceId) {
            const activeWorkspaceId = workspaceId as Id<'workspaces'>;
            const activeMembership = await ctx.db
                .query('workspace_members')
                .withIndex('by_workspace_user', (q) =>
                    q.eq('workspace_id', activeWorkspaceId).eq('user_id', userId)
                )
                .first();
            if (!activeMembership) {
                workspaceId = undefined;
            }
        }

        if (!workspaceId) {
            if (!firstMembership) {
                workspaceId = await ctx.db.insert('workspaces', {
                    name: 'Personal Workspace',
                    description: undefined,
                    owner_user_id: userId,
                    created_at: now,
                });

                await ctx.db.insert('workspace_members', {
                    workspace_id: workspaceId,
                    user_id: userId,
                    role: 'owner',
                    created_at: now,
                });

                await ctx.db.insert('server_version_counter', {
                    workspace_id: workspaceId,
                    value: 0,
                });
            } else {
                workspaceId = firstMembership.workspace_id;
            }

            await ctx.db.patch(userId, { active_workspace_id: workspaceId });
        }

        if (!workspaceId) {
            throw new Error('No workspace available');
        }

        const workspace = await ctx.db.get(workspaceId);
        const membership = await ctx.db
            .query('workspace_members')
            .withIndex('by_workspace_user', (q) =>
                q.eq('workspace_id', workspaceId).eq('user_id', userId)
            )
            .first();

        if (!membership) {
            throw new Error('No workspace membership found');
        }

        return {
            id: workspaceId,
            name: workspace?.name ?? 'Personal Workspace',
            description: workspace?.description ?? null,
            role: membership.role,
        };
    },
});

