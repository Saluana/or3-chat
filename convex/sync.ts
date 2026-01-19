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
import { mutation, query, internalMutation, type MutationCtx, type QueryCtx } from './_generated/server';
import { internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { getPkField } from '../shared/sync/table-metadata';

const nowSec = (): number => Math.floor(Date.now() / 1000);

// ============================================================
// CONSTANTS
// ============================================================

/** Maximum ops allowed per push batch */
const MAX_PUSH_OPS = 100;

/** Maximum limit for pull requests */
const MAX_PULL_LIMIT = 500;

/** Default batch size for GC operations */
const DEFAULT_GC_BATCH_SIZE = 100;

/** Default retention period for GC (30 days) */
const DEFAULT_RETENTION_SECONDS = 30 * 24 * 3600;

/** Delay between scheduled GC continuations (1 minute) */
const GC_CONTINUATION_DELAY_MS = 60_000;

// ============================================================
// HELPERS
// ============================================================

/**
 * Allocate a batch of server versions for a workspace (atomic increment)
 * Returns the *start* version of the batch.
 */
async function allocateServerVersions(
    ctx: MutationCtx,
    workspaceId: Id<'workspaces'>,
    count: number
): Promise<number> {
    if (count <= 0) {
        // Should not happen, but return current version if it does
        const existing = await ctx.db
            .query('server_version_counter')
            .withIndex('by_workspace', (q) => q.eq('workspace_id', workspaceId))
            .first();
        return existing?.value ?? 0;
    }

    const existing = await ctx.db
        .query('server_version_counter')
        .withIndex('by_workspace', (q) => q.eq('workspace_id', workspaceId))
        .first();

    if (existing) {
        const start = existing.value + 1;
        const end = existing.value + count;
        await ctx.db.patch(existing._id, { value: end });
        return start;
    } else {
        await ctx.db.insert('server_version_counter', {
            workspace_id: workspaceId,
            value: count,
        });
        return 1;
    }
}

/**
 * Table name to index name mapping
 * Note: file_meta uses `hash` as PK (content-addressable) instead of `id`
 */
const TABLE_INDEX_MAP: Record<string, { table: string; indexName: string }> = {
    threads: { table: 'threads', indexName: 'by_workspace_id' },
    messages: { table: 'messages', indexName: 'by_workspace_id' },
    projects: { table: 'projects', indexName: 'by_workspace_id' },
    posts: { table: 'posts', indexName: 'by_workspace_id' },
    kv: { table: 'kv', indexName: 'by_workspace_id' },
    file_meta: { table: 'file_meta', indexName: 'by_workspace_hash' },
};

/**
 * Upsert tombstone for delete operations
 */
async function upsertTombstone(
    ctx: MutationCtx,
    workspaceId: Id<'workspaces'>,
    op: {
        table_name: string;
        pk: string;
        clock: number;
    },
    serverVersion: number,
    deletedAt: number
): Promise<void> {
    const existing = await ctx.db
        .query('tombstones')
        .withIndex('by_workspace_table_pk', (q) =>
            q.eq('workspace_id', workspaceId)
                .eq('table_name', op.table_name)
                .eq('pk', op.pk)
        )
        .first();

    if (existing && (existing.clock ?? 0) >= op.clock) {
        return;
    }

    if (existing) {
        await ctx.db.patch(existing._id, {
            deleted_at: deletedAt,
            clock: op.clock,
            server_version: serverVersion,
        });
        return;
    }

    await ctx.db.insert('tombstones', {
        workspace_id: workspaceId,
        table_name: op.table_name,
        pk: op.pk,
        deleted_at: deletedAt,
        clock: op.clock,
        server_version: serverVersion,
        created_at: nowSec(),
    });
}

/**
 * Sanitize payload to prevent workspace/id injection attacks.
 * Strips `workspace_id` and `_id` fields that could reassign records.
 */
function sanitizePayload(payload: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
    if (!payload) return payload;
    const { workspace_id, _id, ...safe } = payload;
    return safe;
}

function validatePayload(
    tableName: string,
    payload: Record<string, unknown> | undefined
): void {
    if (!payload) return;
    if ('deleted' in payload && typeof payload.deleted !== 'boolean') {
        throw new Error(
            `Invalid payload for ${tableName}: 'deleted' must be boolean`
        );
    }
}

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

    const { table, indexName } = tableInfo;
    const pkField = getPkField(op.table_name);

    // SECURITY: Strip workspace_id and _id from payload to prevent injection attacks
    const payload = sanitizePayload(op.payload as Record<string, unknown> | undefined);

    validatePayload(op.table_name, payload);
    const payloadCreatedAt =
        typeof payload?.created_at === 'number' ? (payload.created_at as number) : undefined;
    const payloadUpdatedAt =
        typeof payload?.updated_at === 'number' ? (payload.updated_at as number) : undefined;
    const payloadDeletedAt =
        typeof payload?.deleted_at === 'number' ? (payload.deleted_at as number) : undefined;

    // Find existing record
    // Note: Type casts (as any) are necessary because Convex doesn't support
    // fully type-safe dynamic table queries. Table name is validated via TABLE_INDEX_MAP
    // and runtime validation of payloads happens client-side in ConflictResolver.applyPut()
    // using Zod schemas (TABLE_PAYLOAD_SCHEMAS).
    // Future: Consider a type-safe helper with switch statement for each table.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const existing = await (ctx.db.query(table as any) as any)
        .withIndex(indexName, (q: { eq: (field: string, value: unknown) => unknown }) =>
            pkField === 'hash'
                ? (q as any).eq('workspace_id', workspaceId).eq('hash', op.pk)
                : (q as any).eq('workspace_id', workspaceId).eq('id', op.pk)
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
            const insertPayload: Record<string, unknown> = {
                ...(payload ?? {}),
            };
            if (table === 'file_meta' && insertPayload.ref_count == null) {
                insertPayload.ref_count = 0;
            }
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await (ctx.db as any).insert(table, {
                ...insertPayload,
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
        // Validate batch size to prevent abuse
        if (args.ops.length > MAX_PUSH_OPS) {
            throw new Error(`Batch size ${args.ops.length} exceeds maximum of ${MAX_PUSH_OPS} ops`);
        }

        // Verify workspace membership
        await verifyWorkspaceMembership(ctx, args.workspace_id);

        const results: Array<{
            opId: string;
            success: boolean;
            serverVersion?: number;
            error?: string;
        }> = [];

        let latestVersion = 0;

        // 1. Parallelize Idempotency Checks
        // First, filter invalid tables and check for duplicates in parallel
        const checkPromises = args.ops.map((op) => {
            // SECURITY: Validate table_name against allowlist BEFORE any processing
            if (!TABLE_INDEX_MAP[op.table_name]) return Promise.resolve(null);
            return ctx.db
                .query('change_log')
                .withIndex('by_op_id', (q) => q.eq('op_id', op.op_id))
                .first();
        });

        const existingLogs = await Promise.all(checkPromises);

        // Collect all ops with their server versions
        const opsToApply: Array<{
            op: typeof args.ops[0];
            serverVersion: number;
        }> = [];

        // Temporary array to hold new ops before version allocation
        const newOps: Array<{ op: typeof args.ops[0]; index: number }> = [];

        args.ops.forEach((op, i) => {
            if (!TABLE_INDEX_MAP[op.table_name]) {
                results.push({
                    opId: op.op_id,
                    success: false,
                    error: `Unknown table: ${op.table_name}`,
                });
                return;
            }

            const existing = existingLogs[i];
            if (existing) {
                // Already processed - return existing result
                results.push({
                    opId: op.op_id,
                    success: true,
                    serverVersion: existing.server_version,
                });
            } else {
                newOps.push({ op, index: i });
            }
        });

        // 2. Batch Version Allocation
        if (newOps.length > 0) {
            const startVersion = await allocateServerVersions(ctx, args.workspace_id, newOps.length);

            newOps.forEach((item, idx) => {
                const serverVersion = startVersion + idx;
                opsToApply.push({ op: item.op, serverVersion });
            });

            latestVersion = startVersion + newOps.length - 1;
        }

        // Apply ops in parallel (Convex transactions are serializable)
        const applyResults = await Promise.allSettled(
            opsToApply.map(async ({ op, serverVersion }) => {
                await applyOpToTable(ctx, args.workspace_id, op);

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

                if (op.operation === 'delete') {
                    const deletedAt =
                        typeof (op.payload as { deleted_at?: number })?.deleted_at === 'number'
                            ? ((op.payload as { deleted_at?: number }).deleted_at as number)
                            : nowSec();
                    await upsertTombstone(ctx, args.workspace_id, op, serverVersion, deletedAt);
                }

                return { opId: op.op_id, serverVersion };
            })
        );

        for (let i = 0; i < applyResults.length; i++) {
            const result = applyResults[i];
            if (!result) continue;

            if (result.status === 'fulfilled') {
                results.push({ ...result.value, success: true });
            } else {
                results.push({
                    opId: opsToApply[i]!.op.op_id,
                    success: false,
                    error: String(result.reason),
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

        // Cap limit to prevent abuse
        const limit = Math.min(args.limit, MAX_PULL_LIMIT);

        const rawResults = await ctx.db
            .query('change_log')
            .withIndex('by_workspace_version', (q) =>
                q.eq('workspace_id', args.workspace_id).gt('server_version', args.cursor)
            )
            .order('asc')
            .take(limit + 1);

        const hasMore = rawResults.length > limit;
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

/**
 * GC tombstones older than retention window and below min cursor
 * Uses batching to avoid memory issues with large datasets
 */
export const gcTombstones = mutation({
    args: {
        workspace_id: v.id('workspaces'),
        retention_seconds: v.number(),
        batch_size: v.optional(v.number()),
        cursor: v.optional(v.number()),
    },
    handler: async (ctx, args) => {
        await verifyWorkspaceMembership(ctx, args.workspace_id);

        const batchSize = args.batch_size ?? DEFAULT_GC_BATCH_SIZE;
        const startCursor = args.cursor ?? 0;

        const minCursorRow = await ctx.db
            .query('device_cursors')
            .withIndex('by_workspace_version', (q) => q.eq('workspace_id', args.workspace_id))
            .order('asc')
            .first();

        const minCursor = minCursorRow?.last_seen_version ?? 0;
        const cutoff = nowSec() - args.retention_seconds;

        // Use .take() instead of .collect() to avoid loading all records into memory
        const candidates = await ctx.db
            .query('tombstones')
            .withIndex('by_workspace_version', (q) =>
                q
                    .eq('workspace_id', args.workspace_id)
                    .gt('server_version', startCursor)
                    .lt('server_version', minCursor)
            )
            .take(batchSize + 1);

        const hasMore = candidates.length > batchSize;
        const batch = hasMore ? candidates.slice(0, -1) : candidates;

        let purged = 0;
        let nextCursor = startCursor;
        for (const row of batch) {
            nextCursor = row.server_version;
            if ((row.deleted_at ?? 0) < cutoff) {
                await ctx.db.delete(row._id);
                purged += 1;
            }
        }

        return { purged, hasMore, nextCursor };
    },
});

/**
 * GC change_log entries below min cursor with retention window
 * Uses batching to avoid memory issues with large datasets
 */
export const gcChangeLog = mutation({
    args: {
        workspace_id: v.id('workspaces'),
        retention_seconds: v.number(),
        batch_size: v.optional(v.number()),
        cursor: v.optional(v.number()),
    },
    handler: async (ctx, args) => {
        await verifyWorkspaceMembership(ctx, args.workspace_id);

        const batchSize = args.batch_size ?? DEFAULT_GC_BATCH_SIZE;
        const startCursor = args.cursor ?? 0;

        const minCursorRow = await ctx.db
            .query('device_cursors')
            .withIndex('by_workspace_version', (q) => q.eq('workspace_id', args.workspace_id))
            .order('asc')
            .first();

        const minCursor = minCursorRow?.last_seen_version ?? 0;
        const cutoff = nowSec() - args.retention_seconds;

        // Use .take() instead of .collect() to avoid loading all records into memory
        const candidates = await ctx.db
            .query('change_log')
            .withIndex('by_workspace_version', (q) =>
                q
                    .eq('workspace_id', args.workspace_id)
                    .gt('server_version', startCursor)
                    .lt('server_version', minCursor)
            )
            .take(batchSize + 1);

        const hasMore = candidates.length > batchSize;
        const batch = hasMore ? candidates.slice(0, -1) : candidates;

        let purged = 0;
        let nextCursor = startCursor;
        for (const row of batch) {
            nextCursor = row.server_version;
            if ((row.created_at ?? 0) < cutoff) {
                await ctx.db.delete(row._id);
                purged += 1;
            }
        }

        return { purged, hasMore, nextCursor };
    },
});

// ============================================================
// SCHEDULED GC (Internal)
// ============================================================

/**
 * Internal mutation for scheduled GC.
 * Runs GC for a specific workspace and schedules continuation if needed.
 */
export const runWorkspaceGc = internalMutation({
    args: {
        workspace_id: v.id('workspaces'),
        retention_seconds: v.optional(v.number()),
        batch_size: v.optional(v.number()),
        tombstone_cursor: v.optional(v.number()),
        changelog_cursor: v.optional(v.number()),
    },
    handler: async (ctx, args) => {
        const retentionSeconds = args.retention_seconds ?? DEFAULT_RETENTION_SECONDS;
        const batchSize = args.batch_size ?? DEFAULT_GC_BATCH_SIZE;
        const startTombstoneCursor = args.tombstone_cursor ?? 0;
        const startChangelogCursor = args.changelog_cursor ?? 0;

        const minCursorRow = await ctx.db
            .query('device_cursors')
            .withIndex('by_workspace_version', (q) => q.eq('workspace_id', args.workspace_id))
            .order('asc')
            .first();

        const minCursor = minCursorRow?.last_seen_version ?? 0;
        const cutoff = nowSec() - retentionSeconds;

        let totalPurged = 0;
        let hasMoreTombstones = true;
        let hasMoreChangeLogs = true;
        let nextTombstoneCursor = startTombstoneCursor;
        let nextChangelogCursor = startChangelogCursor;

        // GC tombstones (one batch)
        if (hasMoreTombstones) {
            const tombstones = await ctx.db
                .query('tombstones')
                .withIndex('by_workspace_version', (q) =>
                    q
                        .eq('workspace_id', args.workspace_id)
                        .gt('server_version', startTombstoneCursor)
                        .lt('server_version', minCursor)
                )
                .take(batchSize + 1);

            hasMoreTombstones = tombstones.length > batchSize;
            const batch = hasMoreTombstones ? tombstones.slice(0, -1) : tombstones;

            for (const row of batch) {
                nextTombstoneCursor = row.server_version;
                if ((row.deleted_at ?? 0) < cutoff) {
                    await ctx.db.delete(row._id);
                    totalPurged += 1;
                }
            }

            if (batch.length === 0) {
                hasMoreTombstones = false;
            }
        }

        // GC change_log (one batch)
        if (hasMoreChangeLogs) {
            const changeLogs = await ctx.db
                .query('change_log')
                .withIndex('by_workspace_version', (q) =>
                    q
                        .eq('workspace_id', args.workspace_id)
                        .gt('server_version', startChangelogCursor)
                        .lt('server_version', minCursor)
                )
                .take(batchSize + 1);

            hasMoreChangeLogs = changeLogs.length > batchSize;
            const batch = hasMoreChangeLogs ? changeLogs.slice(0, -1) : changeLogs;

            for (const row of batch) {
                nextChangelogCursor = row.server_version;
                if ((row.created_at ?? 0) < cutoff) {
                    await ctx.db.delete(row._id);
                    totalPurged += 1;
                }
            }

            if (batch.length === 0) {
                hasMoreChangeLogs = false;
            }
        }

        // Schedule continuation if there's more to process
        if (hasMoreTombstones || hasMoreChangeLogs) {
            await ctx.scheduler.runAfter(GC_CONTINUATION_DELAY_MS, internal.sync.runWorkspaceGc, {
                workspace_id: args.workspace_id,
                retention_seconds: retentionSeconds,
                batch_size: batchSize,
                tombstone_cursor: nextTombstoneCursor,
                changelog_cursor: nextChangelogCursor,
            });
        }

        return {
            purged: totalPurged,
            hasMore: hasMoreTombstones || hasMoreChangeLogs,
            nextTombstoneCursor,
            nextChangelogCursor,
        };
    },
});

/**
 * Scheduled GC entry point - finds workspaces with sync activity and runs GC
 */
export const runScheduledGc = internalMutation({
    args: {},
    handler: async (ctx) => {
        // Find workspaces with recent change_log activity (last 7 days)
        const sevenDaysAgo = nowSec() - 7 * 24 * 3600;

        // Get unique workspace IDs from recent change_log entries
        // We query a sample to find active workspaces without loading everything
        const recentChanges = await ctx.db
            .query('change_log')
            .order('desc')
            .take(1000);

        const workspaceIds = new Set<Id<'workspaces'>>();
        for (const change of recentChanges) {
            if ((change.created_at ?? 0) >= sevenDaysAgo) {
                workspaceIds.add(change.workspace_id);
            }
        }

        // Schedule GC for each active workspace
        let scheduled = 0;
        for (const workspaceId of workspaceIds) {
            await ctx.scheduler.runAfter(scheduled * 1000, internal.sync.runWorkspaceGc, {
                workspace_id: workspaceId,
            });
            scheduled += 1;
        }

        return { workspacesScheduled: scheduled };
    },
});
