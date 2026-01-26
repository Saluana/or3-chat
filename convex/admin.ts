import { mutation, query, type MutationCtx, type QueryCtx } from './_generated/server';
import { v } from 'convex/values';
import type { Id } from './_generated/dataModel';

type Role = 'owner' | 'editor' | 'viewer';

async function getAuthAccount(ctx: MutationCtx | QueryCtx) {
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

async function requireOwner(
    ctx: MutationCtx | QueryCtx,
    workspaceId: Id<'workspaces'>,
    userId: Id<'users'>
) {
    const membership = await requireWorkspaceMembership(ctx, workspaceId, userId);
    if (membership.role !== 'owner') {
        throw new Error('Forbidden: Only owners can manage workspace access');
    }
    return membership;
}

export const listWorkspaceMembers = query({
    args: { workspace_id: v.id('workspaces') },
    handler: async (ctx, args) => {
        const { userId } = await getAuthAccount(ctx);
        await requireWorkspaceMembership(ctx, args.workspace_id, userId);

        const members = await ctx.db
            .query('workspace_members')
            .withIndex('by_workspace', (q) => q.eq('workspace_id', args.workspace_id))
            .collect();

        const results = await Promise.all(
            members.map(async (m) => {
                const user = await ctx.db.get(m.user_id);
                return {
                    userId: m.user_id,
                    email: user?.email,
                    role: m.role as Role,
                };
            })
        );

        return results;
    },
});

export const upsertWorkspaceMember = mutation({
    args: {
        workspace_id: v.id('workspaces'),
        email_or_provider_id: v.string(),
        role: v.union(v.literal('owner'), v.literal('editor'), v.literal('viewer')),
        provider: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const { userId } = await getAuthAccount(ctx);
        await requireOwner(ctx, args.workspace_id, userId);

        const provider = args.provider ?? 'clerk';
        const identifier = args.email_or_provider_id.trim();

        let targetUserId: Id<'users'> | null = null;

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

        const existing = await ctx.db
            .query('workspace_members')
            .withIndex('by_workspace_user', (q) =>
                q.eq('workspace_id', args.workspace_id).eq('user_id', targetUserId)
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

export const setWorkspaceMemberRole = mutation({
    args: {
        workspace_id: v.id('workspaces'),
        user_id: v.string(),
        role: v.union(v.literal('owner'), v.literal('editor'), v.literal('viewer')),
    },
    handler: async (ctx, args) => {
        const { userId } = await getAuthAccount(ctx);
        await requireOwner(ctx, args.workspace_id, userId);

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

export const removeWorkspaceMember = mutation({
    args: {
        workspace_id: v.id('workspaces'),
        user_id: v.string(),
    },
    handler: async (ctx, args) => {
        const { userId } = await getAuthAccount(ctx);
        await requireOwner(ctx, args.workspace_id, userId);

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

export const getWorkspaceSetting = query({
    args: {
        workspace_id: v.id('workspaces'),
        key: v.string(),
    },
    handler: async (ctx, args) => {
        const { userId } = await getAuthAccount(ctx);
        await requireWorkspaceMembership(ctx, args.workspace_id, userId);

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

export const setWorkspaceSetting = mutation({
    args: {
        workspace_id: v.id('workspaces'),
        key: v.string(),
        value: v.string(),
    },
    handler: async (ctx, args) => {
        const { userId } = await getAuthAccount(ctx);
        await requireOwner(ctx, args.workspace_id, userId);

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
                deleted_at: undefined,
                created_at: now,
                updated_at: now,
                clock: now,
            });
        }
    },
});
