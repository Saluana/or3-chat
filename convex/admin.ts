/**
 * @module convex/admin
 *
 * Purpose:
 * Provides admin-only queries and mutations for managing users, workspaces,
 * and admin grants in OR3 Cloud.
 *
 * Behavior:
 * - All exported endpoints require admin authorization via `requireAdmin`
 * - Admin actions are written to the `audit_log` table
 * - Supports a super admin bridge for deployment bootstrap
 *
 * Constraints:
 * - Admin identity is derived from Convex auth claims and a special issuer
 * - These functions are intended to be called from trusted SSR endpoints
 *   guarded by `can()`; do not expose directly to untrusted clients
 *
 * Non-Goals:
 * - Tenant-level policy enforcement beyond admin membership
 * - User self-service endpoints
 */

import { mutation, query, type MutationCtx, type QueryCtx } from './_generated/server';
import { v } from 'convex/values';
import type { Id } from './_generated/dataModel';
import { ADMIN_IDENTITY_ISSUER } from '../shared/cloud/admin-identity';

// ============================================================
// CONSTANTS
// ============================================================

/** Maximum results returned by search queries */
const MAX_SEARCH_LIMIT = 100;

/** Maximum items per page in paginated queries */
const MAX_PER_PAGE = 100;

type AdminActor = {
    actorId: string;
    actorType: 'super_admin' | 'workspace_admin';
    userId?: Id<'users'>;
};

// ============================================================
// HELPERS
// ============================================================

/**
 * Internal helper.
 *
 * Purpose:
 * Resolves the caller's auth account mapping from Convex identity.
 */
async function getAuthAccount(
    ctx: MutationCtx | QueryCtx,
    identity: { subject: string }
): Promise<{ userId: Id<'users'> }> {
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
 * Internal helper.
 *
 * Purpose:
 * Ensures the caller is an admin. Supports a special issuer for super admins.
 */
async function requireAdmin(ctx: MutationCtx | QueryCtx): Promise<AdminActor> {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
        throw new Error('Not authenticated');
    }

    if (identity.issuer === ADMIN_IDENTITY_ISSUER) {
        return {
            actorId: 'admin-key',
            actorType: 'super_admin',
        };
    }

    const { userId } = await getAuthAccount(ctx, identity);

    const adminGrant = await ctx.db
        .query('admin_users')
        .withIndex('by_user', (q) => q.eq('user_id', userId))
        .first();

    if (!adminGrant) {
        throw new Error('Forbidden: Admin access required');
    }

    return {
        actorId: userId,
        actorType: 'workspace_admin',
        userId,
    };
}

function getBridgeSecret(): string | null {
    return process.env.OR3_ADMIN_JWT_SECRET || null;
}

async function computeBridgeSignature(
    secret: string,
    providerUserId: string,
    adminUsername: string
): Promise<string> {
    const encoder = new TextEncoder();
    const key = await globalThis.crypto.subtle.importKey(
        'raw',
        encoder.encode(secret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
    );
    const data = encoder.encode(
        `or3-admin-bridge:${providerUserId}:${adminUsername}`
    );
    const signature = await globalThis.crypto.subtle.sign('HMAC', key, data);
    const bytes = new Uint8Array(signature);
    return Array.from(bytes)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
}

/**
 * `admin.isAdmin` (query)
 *
 * Purpose:
 * Checks if a user has an admin grant.
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
 * `admin.ensureDeploymentAdmin` (mutation)
 *
 * Purpose:
 * Bootstraps deployment admin access using a signed bridge token.
 *
 * Constraints:
 * - Requires `OR3_ADMIN_JWT_SECRET` to be configured
 * - Intended for super admin bridge flows only
 */
export const ensureDeploymentAdmin = mutation({
    args: {
        bridge_signature: v.string(),
        admin_username: v.string(),
    },
    handler: async (ctx, args) => {
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

        const existing = await ctx.db
            .query('admin_users')
            .withIndex('by_user', (q) => q.eq('user_id', authAccount.user_id))
            .first();

        if (existing) {
            return { created: false, userId: authAccount.user_id };
        }

        const secret = getBridgeSecret();
        if (!secret) {
            throw new Error('Forbidden: OR3_ADMIN_JWT_SECRET not configured');
        }

        const expectedSignature = await computeBridgeSignature(
            secret,
            identity.subject,
            args.admin_username
        );

        if (expectedSignature !== args.bridge_signature) {
            throw new Error('Forbidden: Invalid super admin bridge signature');
        }

        await ctx.db.insert('admin_users', {
            user_id: authAccount.user_id,
            created_at: Date.now(),
        });

        await logAudit(
            ctx,
            'admin.grant',
            args.admin_username,
            'super_admin',
            'user',
            authAccount.user_id
        );

        return { created: true, userId: authAccount.user_id };
    },
});

/**
 * Internal helper.
 *
 * Purpose:
 * Records an admin action in the audit log.
 */
async function logAudit(
    ctx: MutationCtx,
    action: string,
    actorId: string,
    actorType: 'super_admin' | 'workspace_admin',
    targetType?: string,
    targetId?: string,
    details?: Record<string, unknown>
): Promise<void> {
    await ctx.db.insert('audit_log', {
        action,
        actor_id: actorId,
        actor_type: actorType,
        target_type: targetType,
        target_id: targetId,
        details,
        created_at: Date.now(),
    });
}

/**
 * `admin.listAdmins` (query)
 *
 * Purpose:
 * Lists all admin users with basic profile info.
 */
export const listAdmins = query({
    args: {},
    handler: async (ctx) => {
        // Verify caller is an admin
        await requireAdmin(ctx);

        const admins = await ctx.db.query('admin_users').collect();

        // Batch fetch all users at once to avoid N+1 queries
        const userIds = admins.map((a) => a.user_id);
        const allUsers = await Promise.all(userIds.map((id) => ctx.db.get(id)));
        const userMap = new Map(allUsers.filter(Boolean).map((u) => [u!._id, u!] as const));

        const results = admins.map((admin) => {
            const user = userMap.get(admin.user_id);
            return {
                userId: admin.user_id,
                email: user?.email,
                displayName: user?.display_name,
                createdAt: admin.created_at,
            };
        });

        return results;
    },
});

/**
 * `admin.grantAdmin` (mutation)
 *
 * Purpose:
 * Grants admin access to a user and records an audit entry.
 */
export const grantAdmin = mutation({
    args: {
        user_id: v.id('users'),
    },
    handler: async (ctx, args) => {
        // Verify caller is an admin
        const { actorId, actorType, userId } = await requireAdmin(ctx);

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
            created_by_user_id: userId,
        });

        // Log audit entry
        await logAudit(
            ctx,
            'admin.grant',
            actorId,
            actorType,
            'user',
            args.user_id,
            { email: user.email }
        );

        return { success: true };
    },
});

/**
 * `admin.revokeAdmin` (mutation)
 *
 * Purpose:
 * Revokes admin access for a user and records an audit entry.
 */
export const revokeAdmin = mutation({
    args: {
        user_id: v.id('users'),
    },
    handler: async (ctx, args) => {
        // Verify caller is an admin
        const { actorId, actorType } = await requireAdmin(ctx);

        const adminGrant = await ctx.db
            .query('admin_users')
            .withIndex('by_user', (q) => q.eq('user_id', args.user_id))
            .first();

        if (!adminGrant) {
            throw new Error('User is not an admin');
        }

        // Get user info for audit
        const user = await ctx.db.get(args.user_id);

        await ctx.db.delete(adminGrant._id);

        // Log audit entry
        await logAudit(
            ctx,
            'admin.revoke',
            actorId,
            actorType,
            'user',
            args.user_id,
            { email: user?.email }
        );

        return { success: true };
    },
});

/**
 * `admin.searchUsers` (query)
 *
 * Purpose:
 * Searches users by email or display name with prefix matching.
 */
export const searchUsers = query({
    args: {
        query: v.string(),
        limit: v.optional(v.number()),
    },
    handler: async (ctx, args) => {
        // Verify caller is an admin
        await requireAdmin(ctx);

        const limit = Math.min(args.limit ?? 20, MAX_SEARCH_LIMIT);
        const searchTerm = args.query.toLowerCase().trim();

        if (!searchTerm) {
            return [];
        }

        // Use indexed queries for efficient prefix matching
        // Query users by email (prefix match using index range)
        const usersByEmail = await ctx.db
            .query('users')
            .withIndex('by_email', (q) =>
                q.gte('email', searchTerm).lt('email', searchTerm + '\uffff')
            )
            .take(limit);

        // Query users by display name (prefix match using index range)
        const usersByName = await ctx.db
            .query('users')
            .withIndex('by_display_name', (q) =>
                q.gte('display_name', searchTerm).lt('display_name', searchTerm + '\uffff')
            )
            .take(limit);

        // Combine and deduplicate results
        const seen = new Set<string>();
        const results: { userId: string; email?: string; displayName?: string }[] = [];

        for (const user of [...usersByEmail, ...usersByName]) {
            if (!seen.has(user._id)) {
                seen.add(user._id);
                results.push({
                    userId: user._id,
                    email: user.email,
                    displayName: user.display_name,
                });
                if (results.length >= limit) break;
            }
        }

        return results;
    },
});

// ============================================================================
// WORKSPACE MANAGEMENT
// ============================================================================

/**
 * `admin.listWorkspaces` (query)
 *
 * Purpose:
 * Lists workspaces with pagination and optional deleted filtering.
 */
export const listWorkspaces = query({
    args: {
        search: v.optional(v.string()),
        include_deleted: v.optional(v.boolean()),
        page: v.number(),
        per_page: v.number(),
    },
    handler: async (ctx, args) => {
        // Verify caller is an admin
        await requireAdmin(ctx);

        const { search, include_deleted, page } = args;
        const per_page = Math.min(args.per_page, MAX_PER_PAGE);
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

        // Batch fetch owners and members to avoid N+1 queries
        const workspaceIds = paginated.map((w) => w._id);
        const ownerIds = paginated.map((w) => w.owner_user_id);

        // Fetch all owners in parallel
        const owners = await Promise.all(
            ownerIds.map((id) => ctx.db.get(id))
        );
        const ownerMap = new Map(
            owners.filter(Boolean).map((o) => [o!._id, o!])
        );

        // Fetch all members in parallel using indexed queries
        const allMembers = await Promise.all(
            workspaceIds.map((id) =>
                ctx.db
                    .query('workspace_members')
                    .withIndex('by_workspace', (q) =>
                        q.eq('workspace_id', id)
                    )
                    .collect()
            )
        );
        const memberCounts = new Map<string, number>();
        for (let i = 0; i < workspaceIds.length; i++) {
            const workspaceId = workspaceIds[i];
            const members = allMembers[i];
            if (workspaceId && members) {
                memberCounts.set(workspaceId, members.length);
            }
        }

        // Map results without additional queries
        const results = paginated.map((workspace) => ({
            id: workspace._id,
            name: workspace.name,
            description: workspace.description,
            createdAt: workspace.created_at,
            deleted: workspace.deleted ?? false,
            deletedAt: workspace.deleted_at,
            ownerUserId: workspace.owner_user_id,
            ownerEmail: ownerMap.get(workspace.owner_user_id)?.email,
            memberCount: memberCounts.get(workspace._id) || 0,
        }));

        return { items: results, total };
    },
});

/**
 * `admin.getWorkspace` (query)
 *
 * Purpose:
 * Returns a single workspace with owner and member counts.
 */
export const getWorkspace = query({
    args: {
        workspace_id: v.id('workspaces'),
    },
    handler: async (ctx, args) => {
        // Verify caller is an admin
        await requireAdmin(ctx);

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
 * `admin.createWorkspace` (mutation)
 *
 * Purpose:
 * Creates a workspace on behalf of a user and records an audit entry.
 */
export const createWorkspace = mutation({
    args: {
        name: v.string(),
        description: v.optional(v.string()),
        owner_user_id: v.id('users'),
    },
    handler: async (ctx, args) => {
        // Admin authorization
        const { actorId, actorType } = await requireAdmin(ctx);
        
        // Verify owner exists
        const owner = await ctx.db.get(args.owner_user_id);
        if (!owner) {
            throw new Error('Owner user not found');
        }

        // Check if workspace with same name already exists
        const existing = await ctx.db
            .query('workspaces')
            .filter((q) => q.eq(q.field('name'), args.name))
            .first();
            
        if (existing && !existing.deleted) {
            throw new Error('Workspace with this name already exists');
        }

        const now = Date.now();

        try {
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

            // Log audit entry
            await logAudit(
                ctx,
                'workspace.create',
                actorId,
                actorType,
                'workspace',
                workspaceId,
                { name: args.name, owner_user_id: args.owner_user_id }
            );

            return { workspace_id: workspaceId };
        } catch (err) {
            // Convex transactions are atomic, so this shouldn't happen,
            // but if it does, we want a clear error
            throw new Error(`Failed to create workspace: ${err instanceof Error ? err.message : 'Unknown error'}`);
        }
    },
});

/**
 * `admin.softDeleteWorkspace` (mutation)
 *
 * Purpose:
 * Soft deletes a workspace and records an audit entry.
 */
export const softDeleteWorkspace = mutation({
    args: {
        workspace_id: v.id('workspaces'),
        deleted_at: v.number(),
    },
    handler: async (ctx, args) => {
        // Admin authorization
        const { actorId, actorType } = await requireAdmin(ctx);
        
        const workspace = await ctx.db.get(args.workspace_id);

        if (!workspace) {
            throw new Error('Workspace not found');
        }

        await ctx.db.patch(args.workspace_id, {
            deleted: true,
            deleted_at: args.deleted_at,
        });

        // Log audit entry
        await logAudit(
            ctx,
            'workspace.delete',
            actorId,
            actorType,
            'workspace',
            args.workspace_id,
            { name: workspace.name }
        );
    },
});

/**
 * `admin.restoreWorkspace` (mutation)
 *
 * Purpose:
 * Restores a soft-deleted workspace.
 */
export const restoreWorkspace = mutation({
    args: {
        workspace_id: v.id('workspaces'),
    },
    handler: async (ctx, args) => {
        // Verify caller is an admin
        await requireAdmin(ctx);

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
 * `admin.listWorkspaceMembers` (query)
 *
 * Purpose:
 * Lists members for a workspace.
 */
export const listWorkspaceMembers = query({
    args: {
        workspace_id: v.id('workspaces'),
    },
    handler: async (ctx, args) => {
        // Verify caller is an admin
        await requireAdmin(ctx);

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
 * `admin.upsertWorkspaceMember` (mutation)
 *
 * Purpose:
 * Adds or updates a member with the given role.
 */
export const upsertWorkspaceMember = mutation({
    args: {
        workspace_id: v.id('workspaces'),
        email_or_provider_id: v.string(),
        role: v.union(v.literal('owner'), v.literal('editor'), v.literal('viewer')),
        provider: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        // Verify caller is an admin
        await requireAdmin(ctx);

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
 * `admin.setWorkspaceMemberRole` (mutation)
 *
 * Purpose:
 * Updates an existing member role.
 */
export const setWorkspaceMemberRole = mutation({
    args: {
        workspace_id: v.id('workspaces'),
        user_id: v.string(),
        role: v.union(v.literal('owner'), v.literal('editor'), v.literal('viewer')),
    },
    handler: async (ctx, args) => {
        // Verify caller is an admin
        await requireAdmin(ctx);

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
 * `admin.removeWorkspaceMember` (mutation)
 *
 * Purpose:
 * Removes a member from a workspace.
 */
export const removeWorkspaceMember = mutation({
    args: {
        workspace_id: v.id('workspaces'),
        user_id: v.string(),
    },
    handler: async (ctx, args) => {
        // Verify caller is an admin
        await requireAdmin(ctx);

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
 * `admin.getWorkspaceSetting` (query)
 *
 * Purpose:
 * Retrieves a workspace-scoped KV setting.
 */
export const getWorkspaceSetting = query({
    args: {
        workspace_id: v.id('workspaces'),
        key: v.string(),
    },
    handler: async (ctx, args) => {
        // Verify caller is an admin
        await requireAdmin(ctx);

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
 * `admin.setWorkspaceSetting` (mutation)
 *
 * Purpose:
 * Writes a workspace-scoped KV setting and clears deletion flags.
 */
export const setWorkspaceSetting = mutation({
    args: {
        workspace_id: v.id('workspaces'),
        key: v.string(),
        value: v.string(),
    },
    handler: async (ctx, args) => {
        // Verify caller is an admin
        await requireAdmin(ctx);

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
