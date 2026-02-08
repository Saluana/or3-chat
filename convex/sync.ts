/**
 * @module convex/sync
 *
 * Purpose:
 * Implements the OR3 Cloud sync protocol in Convex.
 * Provides push, pull, and retention-aware GC for change logs and tombstones.
 *
 * Behavior:
 * - `push` accepts batched changes and applies LWW conflict resolution
 * - `pull` and `watchChanges` read change logs after a cursor
 * - `updateDeviceCursor` tracks per-device progress for retention
 * - GC mutations delete old tombstones and change log entries safely
 *
 * Constraints:
 * - All endpoints require workspace membership via Convex auth
 * - Wire schema is snake_case and aligns with Dexie
 * - `order_key` and `clock` drive deterministic ordering and conflicts
 *
 * Non-Goals:
 * - Per-table cursors or server-side merge strategies beyond LWW
 * - Schema enforcement beyond lightweight validation in `validatePayload`
 */
import { v } from 'convex/values';
import { mutation, query, internalMutation, type MutationCtx, type QueryCtx } from './_generated/server';
import { internal } from './_generated/api';
import type { Id, TableNames } from './_generated/dataModel';
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

/** Maximum operation ID length in characters */
const MAX_OP_ID_LENGTH = 64;

/** Maximum payload size in bytes (64KB) */
const MAX_PAYLOAD_SIZE_BYTES = 64 * 1024;

/** Maximum GC continuation jobs per workspace per scheduled run */
const MAX_GC_CONTINUATIONS = 10;

/** Maximum workspaces to schedule for GC per scheduled run */
const MAX_WORKSPACES_PER_GC_RUN = 50;

function inferProviderFromIssuer(issuer: string | undefined): string {
    if (!issuer) return 'clerk';
    if (issuer.includes('clerk')) return 'clerk';
    const marker = '/auth/';
    const markerIndex = issuer.lastIndexOf(marker);
    if (markerIndex === -1) return 'clerk';
    const provider = issuer.slice(markerIndex + marker.length).trim();
    return provider || 'clerk';
}

// ============================================================
// HELPERS
// ============================================================

/**
 * Internal helper.
 *
 * Purpose:
 * Allocates a contiguous server_version range for a workspace.
 * The return value is the start of the range.
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
 * Internal mapping.
 *
 * Purpose:
 * Maps table names to their workspace-scoped index.
 *
 * @remarks
 * `file_meta` uses `hash` as the primary key rather than `id`.
 */
const TABLE_INDEX_MAP: Record<string, { table: string; indexName: string }> = {
    threads: { table: 'threads', indexName: 'by_workspace_id' },
    messages: { table: 'messages', indexName: 'by_workspace_id' },
    projects: { table: 'projects', indexName: 'by_workspace_id' },
    posts: { table: 'posts', indexName: 'by_workspace_id' },
    kv: { table: 'kv', indexName: 'by_workspace_id' },
    file_meta: { table: 'file_meta', indexName: 'by_workspace_hash' },
    notifications: { table: 'notifications', indexName: 'by_workspace_id' },
};

/**
 * Internal helper.
 *
 * Purpose:
 * Ensures a delete operation is represented by a tombstone with the newest
 * clock value so deletes do not resurrect during sync.
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

    if (existing && typeof existing.clock === 'number' && existing.clock >= op.clock) {
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
 * Internal helper.
 *
 * Purpose:
 * Removes fields that could reassign documents across workspaces or Convex IDs.
 */
function sanitizePayload(payload: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
    if (!payload) return payload;
    const { workspace_id, _id, ...safe } = payload;
    return safe;
}

/**
 * Internal helper.
 *
 * Purpose:
 * Lightweight validation for common fields to avoid malformed writes.
 */
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
 * Internal helper.
 *
 * Purpose:
 * Applies a single operation to a data table using LWW conflict resolution.
 *
 * Behavior:
 * - Deletes set `deleted` and track `deleted_at`
 * - Puts update if incoming `clock` is newer or equal
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
        hlc: string;
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
    type IndexQueryBuilder = {
        eq: (field: string, value: unknown) => IndexQueryBuilder;
    };
    type ConvexDoc = {
        _id: Id<TableNames>;
        deleted?: boolean;
        clock?: number;
        hlc?: string;
    } & Record<string, unknown>;
    type QueryByIndex = {
        withIndex: (
            index: string,
            cb: (q: IndexQueryBuilder) => IndexQueryBuilder
        ) => { first: () => Promise<ConvexDoc | null> };
    };

    const typedTable = table as TableNames;
    const existing = await (ctx.db.query(typedTable) as unknown as QueryByIndex)
        .withIndex(indexName, (q) =>
            pkField === 'hash'
                ? q.eq('workspace_id', workspaceId).eq('hash', op.pk)
                : q.eq('workspace_id', workspaceId).eq('id', op.pk)
        )
        .first();

    if (op.operation === 'delete') {
        if (existing && !existing.deleted) {
            console.debug('[sync] apply delete', {
                table: op.table_name,
                pk: op.pk,
                clock: op.clock,
                existingClock: existing.clock ?? 0,
            });
            await ctx.db.patch(existing._id, {
                deleted: true,
                deleted_at: payloadDeletedAt ?? nowSec(),
                updated_at: payloadUpdatedAt ?? nowSec(),
                clock: op.clock,
                hlc: op.hlc,
            });
        }
    } else {
        // Put operation
        if (existing) {
            const existingClock = existing.clock ?? 0;
            const existingHlc = typeof existing.hlc === 'string' ? existing.hlc : '';
            const shouldApply =
                op.clock > existingClock || (op.clock === existingClock && op.hlc > existingHlc);
            // LWW with deterministic HLC tie-break on equal clocks.
            if (shouldApply) {
                console.debug('[sync] apply put', {
                    table: op.table_name,
                    pk: op.pk,
                    clock: op.clock,
                    existingClock,
                    existingHlc,
                    incomingHlc: op.hlc,
                    applied: true,
                });
                await ctx.db.patch(existing._id, {
                    ...(payload ?? {}),
                    clock: op.clock,
                    hlc: op.hlc,
                    updated_at: payloadUpdatedAt ?? nowSec(),
                });
            } else {
                console.debug('[sync] apply put skipped', {
                    table: op.table_name,
                    pk: op.pk,
                    clock: op.clock,
                    existingClock,
                    existingHlc,
                    incomingHlc: op.hlc,
                    applied: false,
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
            type InsertableDb = {
                insert: (name: TableNames, doc: Record<string, unknown>) => Promise<Id<TableNames>>;
            };
            await (ctx.db as unknown as InsertableDb).insert(table as TableNames, {
                ...insertPayload,
                workspace_id: workspaceId,
                [pkField]: op.pk,
                clock: op.clock,
                hlc: op.hlc,
                created_at: payloadCreatedAt ?? nowSec(),
                updated_at: payloadUpdatedAt ?? payloadCreatedAt ?? nowSec(),
            });
        }
    }
}

/**
 * Internal authorization helper.
 *
 * Purpose:
 * Ensures the caller is authenticated and a member of the workspace.
 */
async function verifyWorkspaceMembership(
    ctx: MutationCtx | QueryCtx,
    workspaceId: Id<'workspaces'>
): Promise<Id<'users'>> {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
        throw new Error('Unauthorized: No identity');
    }
    const provider = inferProviderFromIssuer(identity.issuer);

    // Find user by provider subject
    const authAccount = await ctx.db
        .query('auth_accounts')
        .withIndex('by_provider', (q) =>
            q.eq('provider', provider).eq('provider_user_id', identity.subject)
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
 * `sync.push` (mutation)
 *
 * Purpose:
 * Writes a batch of client-side changes into Convex and the change log.
 *
 * Behavior:
 * - Enforces a maximum batch size and payload size
 * - Idempotent by `op_id` and returns existing server versions
 * - Applies LWW conflict resolution per table
 * - Writes `change_log` entries for downstream pulls
 *
 * Constraints:
 * - `op_id` length is capped
 * - Only allowlisted table names are accepted
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
        console.debug('[sync] push', {
            workspace: args.workspace_id,
            ops: args.ops.length,
        });
        // Validate batch size to prevent abuse
        if (args.ops.length > MAX_PUSH_OPS) {
            throw new Error(`Batch size ${args.ops.length} exceeds maximum of ${MAX_PUSH_OPS} ops`);
        }

        // Verify workspace membership
        await verifyWorkspaceMembership(ctx, args.workspace_id);

        // Input validation
        const VALID_TABLES = Object.keys(TABLE_INDEX_MAP);

        for (const op of args.ops) {
            if (op.op_id.length > MAX_OP_ID_LENGTH) {
                throw new Error(`op_id too long: ${op.op_id.length} exceeds ${MAX_OP_ID_LENGTH}`);
            }
            if (!VALID_TABLES.includes(op.table_name)) {
                throw new Error(`Invalid table: ${op.table_name}`);
            }
            if (op.payload && JSON.stringify(op.payload).length > MAX_PAYLOAD_SIZE_BYTES) {
                throw new Error(
                    `Payload too large for ${op.table_name}: exceeds ${MAX_PAYLOAD_SIZE_BYTES} bytes`
                );
            }
        }

        const results: Array<{
            opId: string;
            success: boolean;
            serverVersion?: number;
            error?: string;
            errorCode?:
                | 'VALIDATION_ERROR'
                | 'UNAUTHORIZED'
                | 'CONFLICT'
                | 'NOT_FOUND'
                | 'RATE_LIMITED'
                | 'OVERSIZED'
                | 'NETWORK_ERROR'
                | 'SERVER_ERROR'
                | 'UNKNOWN';
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
                    errorCode: 'VALIDATION_ERROR',
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

        // Apply ops sequentially in allocated server-version order.
        for (const { op, serverVersion } of opsToApply) {
            try {
                console.debug('[sync] push apply', {
                    table: op.table_name,
                    pk: op.pk,
                    op: op.operation,
                    clock: op.clock,
                    opId: op.op_id,
                    serverVersion,
                });
                await applyOpToTable(ctx, args.workspace_id, op);

                const opPayload =
                    typeof op.payload === 'object' && op.payload !== null
                        ? (op.payload as Record<string, unknown>)
                        : undefined;
                await ctx.db.insert('change_log', {
                    workspace_id: args.workspace_id,
                    server_version: serverVersion,
                    table_name: op.table_name,
                    pk: op.pk,
                    op: op.operation,
                    payload: opPayload,
                    clock: op.clock,
                    hlc: op.hlc,
                    device_id: op.device_id,
                    op_id: op.op_id,
                    created_at: nowSec(),
                });

                if (op.operation === 'delete') {
                    const payload: { deleted_at?: number } | undefined =
                        typeof op.payload === 'object' && op.payload !== null
                            ? (op.payload as { deleted_at?: number })
                            : undefined;
                    const deletedAt =
                        payload && typeof payload.deleted_at === 'number'
                            ? payload.deleted_at
                            : nowSec();
                    await upsertTombstone(ctx, args.workspace_id, op, serverVersion, deletedAt);
                }

                results.push({ opId: op.op_id, serverVersion, success: true });
            } catch (error) {
                results.push({
                    opId: op.op_id,
                    success: false,
                    error: String(error),
                    errorCode: 'SERVER_ERROR',
                });
            }
        }

        return { results, serverVersion: latestVersion };
    },
});

/**
 * `sync.updateDeviceCursor` (mutation)
 *
 * Purpose:
 * Records the latest server version seen by a device for retention logic.
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
 * `sync.pull` (query)
 *
 * Purpose:
 * Returns a page of changes after a given server_version cursor.
 *
 * Behavior:
 * - Results are ordered by `server_version` ascending
 * - `tables` can be used to filter specific tables
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

        type ChangeLogRow = {
            server_version: number;
            table_name: string;
            pk: string;
            op: string;
            payload?: unknown;
            clock: number;
            hlc: string;
            device_id: string;
            op_id: string;
        };
        const rawResults = (await ctx.db
            .query('change_log')
            .withIndex('by_workspace_version', (q) =>
                q.eq('workspace_id', args.workspace_id).gt('server_version', args.cursor)
            )
            .order('asc')
            .take(limit + 1)) as ChangeLogRow[];

        const hasMore = rawResults.length > limit;
        const window = hasMore ? rawResults.slice(0, -1) : rawResults;
        const tableFilter: string[] = Array.isArray(args.tables) ? args.tables : [];
        const changes =
            tableFilter.length > 0
                ? window.filter((c) => tableFilter.includes(c.table_name))
                : window;

        const lastChange = window[window.length - 1];
        const nextCursor = lastChange ? lastChange.server_version : args.cursor;

        console.debug('[sync] pull', {
            workspace: args.workspace_id,
            cursor: args.cursor,
            limit,
            returned: changes.length,
            nextCursor,
            hasMore,
        });

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
 * `sync.watchChanges` (query)
 *
 * Purpose:
 * Reactive subscription endpoint that re-runs when new changes arrive.
 *
 * Behavior:
 * - Returns changes after an optional cursor
 * - Caller controls the page size via `limit`
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

        type ChangeLogRow = {
            server_version: number;
            table_name: string;
            pk: string;
            op: string;
            payload?: unknown;
            clock: number;
            hlc: string;
            device_id: string;
            op_id: string;
        };
        const changes = (await ctx.db
            .query('change_log')
            .withIndex('by_workspace_version', (q) =>
                q.eq('workspace_id', args.workspace_id).gt('server_version', since)
            )
            .order('asc')
            .take(limit)) as ChangeLogRow[];

        const latestChange = changes[changes.length - 1];
        const latestVersion = latestChange ? latestChange.server_version : since;

        console.debug('[sync] watchChanges', {
            workspace: args.workspace_id,
            cursor: since,
            limit,
            returned: changes.length,
            latestVersion,
        });

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
 * `sync.getServerVersion` (query)
 *
 * Purpose:
 * Returns the current server version counter for a workspace.
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
 * `sync.gcTombstones` (mutation)
 *
 * Purpose:
 * Deletes tombstones that are older than the retention window and below the
 * minimum device cursor to avoid resurrection.
 *
 * Behavior:
 * - Processes one batch at a time using a cursor
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

        const minCursor = minCursorRow ? minCursorRow.last_seen_version : 0;
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
            if (row.deleted_at < cutoff) {
                await ctx.db.delete(row._id);
                purged += 1;
            }
        }

        return { purged, hasMore, nextCursor };
    },
});

/**
 * `sync.gcChangeLog` (mutation)
 *
 * Purpose:
 * Deletes change_log rows older than the retention window and below the minimum
 * device cursor.
 *
 * Behavior:
 * - Processes one batch at a time using a cursor
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

        const minCursor = minCursorRow ? minCursorRow.last_seen_version : 0;
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
            if (row.created_at < cutoff) {
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
 * `sync.runWorkspaceGc` (internal mutation)
 *
 * Purpose:
 * Executes a bounded GC pass for a workspace and schedules a continuation
 * if more work remains.
 */
export const runWorkspaceGc = internalMutation({
    args: {
        workspace_id: v.id('workspaces'),
        retention_seconds: v.optional(v.number()),
        batch_size: v.optional(v.number()),
        tombstone_cursor: v.optional(v.number()),
        changelog_cursor: v.optional(v.number()),
        continuation_count: v.optional(v.number()),
    },
    handler: async (ctx, args) => {
        const retentionSeconds = args.retention_seconds ?? DEFAULT_RETENTION_SECONDS;
        const batchSize = args.batch_size ?? DEFAULT_GC_BATCH_SIZE;
        const startTombstoneCursor = args.tombstone_cursor ?? 0;
        const startChangelogCursor = args.changelog_cursor ?? 0;
        const continuationCount = args.continuation_count ?? 0;

        const minCursorRow = await ctx.db
            .query('device_cursors')
            .withIndex('by_workspace_version', (q) => q.eq('workspace_id', args.workspace_id))
            .order('asc')
            .first();

        const minCursor = minCursorRow ? minCursorRow.last_seen_version : 0;
        const cutoff = nowSec() - retentionSeconds;

        let totalPurged = 0;
        let hasMoreTombstones = true;
        let hasMoreChangeLogs = true;
        let nextTombstoneCursor = startTombstoneCursor;
        let nextChangelogCursor = startChangelogCursor;

        // GC tombstones (one batch)
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
        const tombstoneBatch = hasMoreTombstones ? tombstones.slice(0, -1) : tombstones;

        for (const row of tombstoneBatch) {
            nextTombstoneCursor = row.server_version;
            if (row.deleted_at < cutoff) {
                await ctx.db.delete(row._id);
                totalPurged += 1;
            }
        }

        if (tombstoneBatch.length === 0) {
            hasMoreTombstones = false;
        }

        // GC change_log (one batch)
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
        const changeLogBatch = hasMoreChangeLogs ? changeLogs.slice(0, -1) : changeLogs;

        for (const row of changeLogBatch) {
            nextChangelogCursor = row.server_version;
            if (row.created_at < cutoff) {
                await ctx.db.delete(row._id);
                totalPurged += 1;
            }
        }

        if (changeLogBatch.length === 0) {
            hasMoreChangeLogs = false;
        }

        // Schedule continuation if there's more to process and under continuation limit
        if ((hasMoreTombstones || hasMoreChangeLogs) && continuationCount < MAX_GC_CONTINUATIONS) {
            await ctx.scheduler.runAfter(GC_CONTINUATION_DELAY_MS, internal.sync.runWorkspaceGc, {
                workspace_id: args.workspace_id,
                retention_seconds: retentionSeconds,
                batch_size: batchSize,
                tombstone_cursor: nextTombstoneCursor,
                changelog_cursor: nextChangelogCursor,
                continuation_count: continuationCount + 1,
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
 * `sync.runScheduledGc` (internal mutation)
 *
 * Purpose:
 * Finds active workspaces and schedules GC work for each.
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
            if (workspaceIds.size >= MAX_WORKSPACES_PER_GC_RUN) break;
            const createdAt = typeof change.created_at === 'number' ? change.created_at : 0;
            if (createdAt >= sevenDaysAgo) {
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
