/**
 * Convex Sync Functions
 *
 * Core sync operations for the OR3 sync layer:
 * - push: Batch write changes from clients with idempotency
 * - pull: Cursor-based fetch of changes since last sync
 * - watchChanges: Reactive query for real-time subscriptions
 * - updateDeviceCursor: Track device sync progress for retention
 */
import { v } from 'convex/values';
import { mutation, query, type MutationCtx, type QueryCtx } from './_generated/server';
import type { Id } from './_generated/dataModel';

const nowSec = (): number => Math.floor(Date.now() / 1000);

// ============================================================
// HELPERS
// ============================================================

/**
 * Get next server version for a workspace (atomic increment)
 */
async function getNextServerVersion(
    ctx: MutationCtx,
    workspaceId: Id<'workspaces'>
): Promise<number> {
    const existing = await ctx.db
        .query('server_version_counter')
        .withIndex('by_workspace', (q) => q.eq('workspace_id', workspaceId))
        .first();

    if (existing) {
        const next = existing.value + 1;
        await ctx.db.patch(existing._id, { value: next });
        return next;
    } else {
        await ctx.db.insert('server_version_counter', {
            workspace_id: workspaceId,
            value: 1,
        });
        return 1;
    }
}

/**
 * Table name to index name mapping
 */
const TABLE_INDEX_MAP: Record<string, { table: string; indexName: string; pkField: string }> = {
    threads: { table: 'threads', indexName: 'by_workspace_id', pkField: 'id' },
    messages: { table: 'messages', indexName: 'by_workspace_id', pkField: 'id' },
    projects: { table: 'projects', indexName: 'by_workspace_id', pkField: 'id' },
    posts: { table: 'posts', indexName: 'by_workspace_id', pkField: 'id' },
    kv: { table: 'kv', indexName: 'by_workspace_id', pkField: 'id' },
    file_meta: { table: 'file_meta', indexName: 'by_workspace_hash', pkField: 'hash' },
};

/**
 * Apply a single operation to the appropriate data table
 * Implements LWW (Last-Write-Wins) conflict resolution
 */
async function applyOpToTable(
    ctx: MutationCtx,
    workspaceId: Id<'workspaces'>,
    op: {
        table_name: string;
        operation: 'put' | 'delete';
        pk: string;
        payload?: unknown;
        clock: number;
    }
): Promise<void> {
    const tableInfo = TABLE_INDEX_MAP[op.table_name];
    if (!tableInfo) {
        console.warn(`Unknown table: ${op.table_name}`);
        return;
    }

    const { table, indexName, pkField } = tableInfo;
    const payload = op.payload as Record<string, unknown> | undefined;
    const payloadCreatedAt =
        typeof payload?.created_at === 'number' ? (payload.created_at as number) : undefined;
    const payloadUpdatedAt =
        typeof payload?.updated_at === 'number' ? (payload.updated_at as number) : undefined;
    const payloadDeletedAt =
        typeof payload?.deleted_at === 'number' ? (payload.deleted_at as number) : undefined;

    // Find existing record
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const existing = await (ctx.db.query(table as any) as any)
        .withIndex(indexName, (q: { eq: (field: string, value: unknown) => unknown }) =>
            pkField === 'hash'
                ? q.eq('workspace_id', workspaceId).eq('hash', op.pk)
                : q.eq('workspace_id', workspaceId).eq('id', op.pk)
        )
        .first();

    if (op.operation === 'delete') {
        if (existing && !existing.deleted) {
            await ctx.db.patch(existing._id, {
                deleted: true,
                deleted_at: payloadDeletedAt ?? nowSec(),
                updated_at: payloadUpdatedAt ?? nowSec(),
                clock: op.clock,
            });
        }
    } else {
        // Put operation
        if (existing) {
            // LWW: only update if incoming clock >= existing
            if (op.clock >= (existing.clock ?? 0)) {
                await ctx.db.patch(existing._id, {
                    ...(payload ?? {}),
                    clock: op.clock,
                    updated_at: payloadUpdatedAt ?? nowSec(),
                });
            }
            // else: local wins, no-op
        } else {
            // New record
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await (ctx.db as any).insert(table, {
                ...(payload ?? {}),
                workspace_id: workspaceId,
                [pkField]: op.pk,
                clock: op.clock,
                created_at: payloadCreatedAt ?? nowSec(),
                updated_at: payloadUpdatedAt ?? payloadCreatedAt ?? nowSec(),
            });
        }
    }
}

/**
 * Verify user has access to workspace
 */
async function verifyWorkspaceMembership(
    ctx: MutationCtx | QueryCtx,
    workspaceId: Id<'workspaces'>
): Promise<Id<'users'>> {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
        throw new Error('Unauthorized: No identity');
    }

    // Find user by Clerk subject
    const authAccount = await ctx.db
        .query('auth_accounts')
        .withIndex('by_provider', (q) =>
            q.eq('provider', 'clerk').eq('provider_user_id', identity.subject)
        )
        .first();

    if (!authAccount) {
        throw new Error('Unauthorized: User not found');
    }

    // Check workspace membership
    const membership = await ctx.db
        .query('workspace_members')
        .withIndex('by_workspace_user', (q) =>
            q.eq('workspace_id', workspaceId).eq('user_id', authAccount.user_id)
        )
        .first();

    if (!membership) {
        throw new Error('Unauthorized: Not a workspace member');
    }

    return authAccount.user_id;
}

// ============================================================
// SYNC MUTATIONS
// ============================================================

/**
 * Push batch of changes from client
 * - Idempotent via op_id
 * - Applies LWW conflict resolution
 * - Writes to change_log for other clients to pull
 */
export const push = mutation({
    args: {
        workspace_id: v.id('workspaces'),
        ops: v.array(
            v.object({
                op_id: v.string(),
                table_name: v.string(),
                operation: v.union(v.literal('put'), v.literal('delete')),
                pk: v.string(),
                payload: v.optional(v.any()),
                clock: v.number(),
                hlc: v.string(),
                device_id: v.string(),
            })
        ),
    },
    handler: async (ctx, args) => {
        // Verify workspace membership
        await verifyWorkspaceMembership(ctx, args.workspace_id);

        const results: Array<{
            opId: string;
            success: boolean;
            serverVersion?: number;
            error?: string;
        }> = [];

        let latestVersion = 0;

        for (const op of args.ops) {
            // Check for duplicate opId (idempotency)
            const existing = await ctx.db
                .query('change_log')
                .withIndex('by_op_id', (q) => q.eq('op_id', op.op_id))
                .first();

            if (existing) {
                // Already processed - return existing result
                results.push({
                    opId: op.op_id,
                    success: true,
                    serverVersion: existing.server_version,
                });
                continue;
            }

            try {
                // Get next server version
                const serverVersion = await getNextServerVersion(ctx, args.workspace_id);
                latestVersion = serverVersion;

                // Apply to data table
                await applyOpToTable(ctx, args.workspace_id, op);

                // Write to change log
                await ctx.db.insert('change_log', {
                    workspace_id: args.workspace_id,
                    server_version: serverVersion,
                    table_name: op.table_name,
                    pk: op.pk,
                    op: op.operation,
                    payload: op.payload,
                    clock: op.clock,
                    hlc: op.hlc,
                    device_id: op.device_id,
                    op_id: op.op_id,
                    created_at: nowSec(),
                });

                results.push({ opId: op.op_id, success: true, serverVersion });
            } catch (error) {
                results.push({
                    opId: op.op_id,
                    success: false,
                    error: String(error),
                });
            }
        }

        return { results, serverVersion: latestVersion };
    },
});

/**
 * Update device cursor - tracks sync progress for retention
 */
export const updateDeviceCursor = mutation({
    args: {
        workspace_id: v.id('workspaces'),
        device_id: v.string(),
        last_seen_version: v.number(),
    },
    handler: async (ctx, args) => {
        await verifyWorkspaceMembership(ctx, args.workspace_id);

        const existing = await ctx.db
            .query('device_cursors')
            .withIndex('by_workspace_device', (q) =>
                q.eq('workspace_id', args.workspace_id).eq('device_id', args.device_id)
            )
            .first();

        if (existing) {
            await ctx.db.patch(existing._id, {
                last_seen_version: args.last_seen_version,
                updated_at: nowSec(),
            });
        } else {
            await ctx.db.insert('device_cursors', {
                workspace_id: args.workspace_id,
                device_id: args.device_id,
                last_seen_version: args.last_seen_version,
                updated_at: nowSec(),
            });
        }
    },
});

// ============================================================
// SYNC QUERIES
// ============================================================

/**
 * Pull changes since cursor
 * Returns paginated changes ordered by server_version
 */
export const pull = query({
    args: {
        workspace_id: v.id('workspaces'),
        cursor: v.number(),
        limit: v.number(),
        tables: v.optional(v.array(v.string())),
    },
    handler: async (ctx, args) => {
        await verifyWorkspaceMembership(ctx, args.workspace_id);

        const rawResults = await ctx.db
            .query('change_log')
            .withIndex('by_workspace_version', (q) =>
                q.eq('workspace_id', args.workspace_id).gt('server_version', args.cursor)
            )
            .order('asc')
            .take(args.limit + 1);

        const hasMore = rawResults.length > args.limit;
        const window = hasMore ? rawResults.slice(0, -1) : rawResults;
        const changes =
            args.tables && args.tables.length > 0
                ? window.filter((c) => args.tables!.includes(c.table_name))
                : window;

        const nextCursor =
            window.length > 0
                ? (window[window.length - 1]?.server_version ?? args.cursor)
                : args.cursor;

        return {
            changes: changes.map((c) => ({
                serverVersion: c.server_version,
                tableName: c.table_name,
                pk: c.pk,
                op: c.op,
                payload: c.payload,
                stamp: {
                    clock: c.clock,
                    hlc: c.hlc,
                    deviceId: c.device_id,
                    opId: c.op_id,
                },
            })),
            nextCursor,
            hasMore,
        };
    },
});

/**
 * Watch for changes - reactive query for subscriptions
 * Returns changes since cursor, re-runs when new changes arrive
 */
export const watchChanges = query({
    args: {
        workspace_id: v.id('workspaces'),
        cursor: v.optional(v.number()),
        limit: v.optional(v.number()),
    },
    handler: async (ctx, args) => {
        await verifyWorkspaceMembership(ctx, args.workspace_id);
        const since = args.cursor ?? 0;
        const limit = args.limit ?? 100;

        const changes = await ctx.db
            .query('change_log')
            .withIndex('by_workspace_version', (q) =>
                q.eq('workspace_id', args.workspace_id).gt('server_version', since)
            )
            .order('asc')
            .take(limit);

        const latestVersion =
            changes.length > 0
                ? (changes[changes.length - 1]?.server_version ?? since)
                : since;

        return {
            changes: changes.map((c) => ({
                serverVersion: c.server_version,
                tableName: c.table_name,
                pk: c.pk,
                op: c.op,
                payload: c.payload,
                stamp: {
                    clock: c.clock,
                    hlc: c.hlc,
                    deviceId: c.device_id,
                    opId: c.op_id,
                },
            })),
            latestVersion,
        };
    },
});

/**
 * Get current server version for a workspace
 */
export const getServerVersion = query({
    args: {
        workspace_id: v.id('workspaces'),
    },
    handler: async (ctx, args) => {
        await verifyWorkspaceMembership(ctx, args.workspace_id);
        const counter = await ctx.db
            .query('server_version_counter')
            .withIndex('by_workspace', (q) => q.eq('workspace_id', args.workspace_id))
            .first();

        return counter?.value ?? 0;
    },
});
