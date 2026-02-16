/**
 * @module convex/workspaces
 *
 * Purpose:
 * Implements workspace lifecycle and membership mutations for OR3 Cloud.
 * Provides the primary user-facing API for creating, listing, and selecting
 * workspaces.
 *
 * Behavior:
 * - Authenticated users can create and list their workspaces
 * - Membership is required for updates, activation, and removal
 * - `ensure` and `resolveSession` support session bootstrapping
 *
 * Constraints:
 * - Provider identity is inferred from the JWT issuer
 * - Owner-only actions are enforced for updates and deletion
 *
 * Non-Goals:
 * - Admin-grade management of all workspaces (see convex/admin.ts)
 * - Fine-grained role permissions beyond owner checks
 */
import { mutation, query, type MutationCtx, type QueryCtx } from './_generated/server';
import { v } from 'convex/values';
import type { Id, TableNames } from './_generated/dataModel';

// ============================================================
// CONSTANTS
// ============================================================

/** Batch size for workspace data deletion operations */
const DELETE_BATCH_SIZE = 100;

// ============================================================
// HELPERS
// ============================================================

function inferProviderFromIssuer(issuer: string | undefined): string {
    if (!issuer) return 'clerk';

    if (issuer.includes('clerk')) {
        return 'clerk';
    }

    const marker = '/auth/';
    const markerIndex = issuer.lastIndexOf(marker);
    if (markerIndex === -1) {
        return 'clerk';
    }

    const provider = issuer.slice(markerIndex + marker.length).trim();
    return provider || 'clerk';
}

function normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
}

async function markExpiredInvites(ctx: MutationCtx | QueryCtx, workspaceId: Id<'workspaces'>, now: number) {
    const pending = await ctx.db
        .query('auth_invites')
        .withIndex('by_workspace_status', (q) =>
            q.eq('workspace_id', workspaceId).eq('status', 'pending')
        )
        .collect();

    await Promise.all(
        pending
            .filter((invite) => invite.expires_at <= now)
            .map((invite) =>
                ctx.db.patch(invite._id, {
                    status: 'expired',
                    updated_at: now,
                })
            )
    );
}

/**
 * Internal helper.
 *
 * Purpose:
 * Resolves the authenticated user's auth account mapping.
 */
async function getAuthAccount(
    ctx: MutationCtx | QueryCtx
): Promise<{ userId: Id<'users'>; authAccountId: Id<'auth_accounts'> }> {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
        throw new Error('Not authenticated');
    }
    const provider = inferProviderFromIssuer(identity.issuer);

    const authAccount = await ctx.db
        .query('auth_accounts')
        .withIndex('by_provider', (q) =>
            q.eq('provider', provider).eq('provider_user_id', identity.subject)
        )
        .first();

    if (!authAccount) {
        throw new Error('Unauthorized: User not found');
    }

    return { userId: authAccount.user_id, authAccountId: authAccount._id };
}

/**
 * Internal helper.
 *
 * Purpose:
 * Ensures a user is a member of a workspace and returns the membership row.
 */
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

/**
 * Internal helper.
 *
 * Purpose:
 * Deletes workspace-scoped data in batches to avoid large transactions.
 */
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
        ) => { collect: () => Promise<ConvexDoc[]>; take: (n: number) => Promise<ConvexDoc[]> };
    };

    const deleteByIndexBatched = async (table: TableNames, indexName: string) => {
        let totalDeleted = 0;
        let hasMore = true;
        while (hasMore) {
            const rows = await (ctx.db.query(table) as unknown as QueryByIndex)
                .withIndex(indexName, (q) => q.eq('workspace_id', workspaceId))
                .take(DELETE_BATCH_SIZE);

            if (rows.length === 0) {
                hasMore = false;
                break;
            }

            await Promise.all(rows.map((r) => ctx.db.delete(r._id)));
            totalDeleted += rows.length;

            if (rows.length < DELETE_BATCH_SIZE) {
                hasMore = false;
            }
        }
        return totalDeleted;
    };

    await deleteByIndexBatched('threads', 'by_workspace_id');
    await deleteByIndexBatched('messages', 'by_workspace_id');
    await deleteByIndexBatched('projects', 'by_workspace_id');
    await deleteByIndexBatched('posts', 'by_workspace_id');
    await deleteByIndexBatched('kv', 'by_workspace_name');
    await deleteByIndexBatched('file_meta', 'by_workspace_hash');
    await deleteByIndexBatched('change_log', 'by_workspace_version');
    await deleteByIndexBatched('tombstones', 'by_workspace_version');
    await deleteByIndexBatched('device_cursors', 'by_workspace_device');
    await deleteByIndexBatched('workspace_members', 'by_workspace');
    await deleteByIndexBatched('server_version_counter', 'by_workspace');
}

/**
 * `workspaces.listMyWorkspaces` (query)
 *
 * Purpose:
 * Lists all workspaces for the current authenticated user.
 *
 * Behavior:
 * - Returns an empty array for unauthenticated users
 * - Marks the active workspace via `is_active`
 */
export const listMyWorkspaces = query({
    args: {},
    handler: async (ctx) => {
        const identity = await ctx.auth.getUserIdentity();
        if (!identity) {
            return [];
        }
        const provider = inferProviderFromIssuer(identity.issuer);

        const authAccount = await ctx.db
            .query('auth_accounts')
            .withIndex('by_provider', (q) =>
                q.eq('provider', provider).eq('provider_user_id', identity.subject)
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

        // Batch fetch all workspaces at once to avoid N+1 queries
        const workspaceIds = memberships.map((m) => m.workspace_id);
        const allWorkspaces = await Promise.all(workspaceIds.map((id) => ctx.db.get(id)));
        const workspaceMap = new Map(
            allWorkspaces.filter(Boolean).map((w) => [w!._id, w!] as const)
        );

        const workspaces = memberships
            .map((m) => {
                const workspace = workspaceMap.get(m.workspace_id);
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
            .filter(Boolean);

        return workspaces;
    },
});

/**
 * `workspaces.create` (mutation)
 *
 * Purpose:
 * Creates a workspace and grants the current user owner membership.
 *
 * Behavior:
 * - Creates a user record and auth account mapping if missing
 * - Initializes `server_version_counter` for sync
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
        const provider = inferProviderFromIssuer(identity.issuer);

        const now = Date.now();

        // Find or create user
        let authAccount = await ctx.db
            .query('auth_accounts')
            .withIndex('by_provider', (q) =>
                q.eq('provider', provider).eq('provider_user_id', identity.subject)
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
                provider,
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

/**
 * `workspaces.update` (mutation)
 *
 * Purpose:
 * Updates workspace name and description.
 *
 * Constraints:
 * - Only workspace owners can update
 */
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

/**
 * `workspaces.setActive` (mutation)
 *
 * Purpose:
 * Sets the current user's active workspace.
 *
 * Behavior:
 * - Requires membership in the target workspace
 */
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

/**
 * `workspaces.remove` (mutation)
 *
 * Purpose:
 * Deletes a workspace and all workspace-scoped data.
 *
 * Constraints:
 * - Only owners can delete
 * - Updates `active_workspace_id` for affected users
 */
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
 * `workspaces.ensure` (mutation)
 *
 * Purpose:
 * Ensures a user and a default workspace exist on first login.
 *
 * Behavior:
 * - Validates provider and JWT subject
 * - Creates a personal workspace if none exists
 * - Sets active workspace for the user
 */
export const ensure = mutation({
    args: {
        provider: v.string(),
        provider_user_id: v.string(),
        email: v.optional(v.string()),
        name: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        // Verify JWT subject matches provider_user_id
        const identity = await ctx.auth.getUserIdentity();
        if (!identity || identity.subject !== args.provider_user_id) {
            throw new Error('Provider user ID mismatch: JWT subject does not match request');
        }
        const provider = inferProviderFromIssuer(identity.issuer);
        if (args.provider !== provider) {
            throw new Error(
                `Provider mismatch: request "${args.provider}" does not match JWT "${provider}"`
            );
        }

        const now = Date.now();

        let authAccount = await ctx.db
            .query('auth_accounts')
            .withIndex('by_provider', (q) =>
                q.eq('provider', provider).eq('provider_user_id', args.provider_user_id)
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
                provider,
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

/**
 * `workspaces.resolveSession` (query)
 *
 * Purpose:
 * Resolves a user and workspace session without mutating state.
 *
 * Behavior:
 * - Returns `null` when the mapping or workspace cannot be found
 * - Falls back to the oldest membership when no active workspace is set
 */
export const resolveSession = query({
    args: {
        provider: v.string(),
        provider_user_id: v.string(),
    },
    handler: async (ctx, args) => {
        const authAccount = await ctx.db
            .query('auth_accounts')
            .withIndex('by_provider', (q) =>
                q.eq('provider', args.provider).eq('provider_user_id', args.provider_user_id)
            )
            .first();

        if (!authAccount) return null;

        const userId = authAccount.user_id;
        const user = await ctx.db.get(userId);

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
            const firstMembership = await ctx.db
                .query('workspace_members')
                .withIndex('by_user', (q) => q.eq('user_id', userId))
                .order('asc')
                .first();
            workspaceId = firstMembership?.workspace_id;
        }

        if (!workspaceId) return null;

        const workspace = await ctx.db.get(workspaceId);
        if (!workspace) return null;

        const membership = await ctx.db
            .query('workspace_members')
            .withIndex('by_workspace_user', (q) =>
                q.eq('workspace_id', workspaceId).eq('user_id', userId)
            )
            .first();

        if (!membership) return null;

        return {
            id: workspaceId,
            name: workspace.name,
            description: workspace.description ?? null,
            role: membership.role,
        };
    },
});

export const createInvite = mutation({
    args: {
        workspace_id: v.id('workspaces'),
        email: v.string(),
        role: v.union(v.literal('owner'), v.literal('editor'), v.literal('viewer')),
        invited_by_user_id: v.id('users'),
        token_hash: v.string(),
        expires_at: v.number(),
    },
    handler: async (ctx, args) => {
        const now = Date.now();
        const inviteId = await ctx.db.insert('auth_invites', {
            workspace_id: args.workspace_id,
            email: normalizeEmail(args.email),
            role: args.role,
            status: 'pending',
            invited_by_user_id: args.invited_by_user_id,
            token_hash: args.token_hash,
            expires_at: args.expires_at,
            created_at: now,
            updated_at: now,
        });
        return { invite_id: inviteId };
    },
});

export const listInvites = query({
    args: {
        workspace_id: v.id('workspaces'),
        status: v.optional(
            v.union(v.literal('pending'), v.literal('accepted'), v.literal('revoked'), v.literal('expired'))
        ),
        limit: v.optional(v.number()),
    },
    handler: async (ctx, args) => {
        const now = Date.now();
        await markExpiredInvites(ctx, args.workspace_id, now);

        const limit = Math.max(1, Math.min(args.limit ?? 100, 500));
        let rows = await ctx.db
            .query('auth_invites')
            .withIndex('by_workspace_status', (q) => q.eq('workspace_id', args.workspace_id))
            .collect();

        if (args.status) {
            rows = rows.filter((row) => row.status === args.status);
        }

        return rows
            .sort((a, b) => b.created_at - a.created_at)
            .slice(0, limit)
            .map((row) => ({
                id: row._id,
                workspace_id: row.workspace_id,
                email: row.email,
                role: row.role,
                status: row.status,
                invited_by_user_id: row.invited_by_user_id,
                token_hash: row.token_hash,
                expires_at: row.expires_at,
                accepted_at: row.accepted_at ?? null,
                accepted_user_id: row.accepted_user_id ?? null,
                revoked_at: row.revoked_at ?? null,
                created_at: row.created_at,
                updated_at: row.updated_at,
            }));
    },
});

export const revokeInvite = mutation({
    args: {
        workspace_id: v.id('workspaces'),
        invite_id: v.id('auth_invites'),
    },
    handler: async (ctx, args) => {
        const now = Date.now();
        const invite = await ctx.db.get(args.invite_id);
        if (!invite || invite.workspace_id !== args.workspace_id) {
            throw new Error('Invite not found');
        }
        if (invite.status !== 'pending') {
            return { ok: true };
        }
        await ctx.db.patch(args.invite_id, {
            status: 'revoked',
            revoked_at: now,
            updated_at: now,
        });
        return { ok: true };
    },
});

export const consumeInvite = mutation({
    args: {
        workspace_id: v.id('workspaces'),
        email: v.string(),
        token_hash: v.string(),
        accepted_user_id: v.id('users'),
    },
    handler: async (ctx, args) => {
        const now = Date.now();
        await markExpiredInvites(ctx, args.workspace_id, now);
        const email = normalizeEmail(args.email);

        const candidates = await ctx.db
            .query('auth_invites')
            .withIndex('by_workspace_email_status', (q) =>
                q.eq('workspace_id', args.workspace_id).eq('email', email)
            )
            .collect();

        const invite = candidates
            .filter((row) => row.status === 'pending')
            .sort((a, b) => a.created_at - b.created_at)[0];

        if (!invite) {
            return { ok: false as const, reason: 'not_found' as const };
        }
        if (invite.expires_at <= now) {
            await ctx.db.patch(invite._id, { status: 'expired', updated_at: now });
            return { ok: false as const, reason: 'expired' as const };
        }
        if (invite.token_hash !== args.token_hash) {
            return { ok: false as const, reason: 'token_mismatch' as const };
        }

        await ctx.db.patch(invite._id, {
            status: 'accepted',
            accepted_at: now,
            accepted_user_id: args.accepted_user_id,
            updated_at: now,
        });

        const existingMembership = await ctx.db
            .query('workspace_members')
            .withIndex('by_workspace_user', (q) =>
                q.eq('workspace_id', args.workspace_id).eq('user_id', args.accepted_user_id)
            )
            .first();

        if (existingMembership) {
            await ctx.db.patch(existingMembership._id, { role: invite.role });
        } else {
            await ctx.db.insert('workspace_members', {
                workspace_id: args.workspace_id,
                user_id: args.accepted_user_id,
                role: invite.role,
                created_at: now,
            });
        }

        await ctx.db.patch(args.accepted_user_id, {
            active_workspace_id: args.workspace_id,
        });

        return { ok: true as const, role: invite.role };
    },
});
