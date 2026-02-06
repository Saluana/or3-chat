/**
 * @module app/core/sync/providers/convex-sync-provider
 *
 * Purpose:
 * Implements `SyncProvider` for the Convex backend using direct mode.
 * Authenticates via Clerk JWT template and communicates with Convex
 * functions for push, pull, subscription, and garbage collection.
 *
 * Behavior:
 * - `subscribe()`: Uses `client.onUpdate()` for real-time reactivity
 *   (Convex reactive queries). Validates incoming changes with Zod.
 * - `pull()`: Paginates through `api.sync.pull` query
 * - `push()`: Sends batched ops to `api.sync.push` mutation
 * - `updateCursor()`: Reports device cursor to `api.sync.updateDeviceCursor`
 * - `gcTombstones()` / `gcChangeLog()`: Invoke server-side GC mutations
 *
 * Constraints:
 * - Convex client must be captured in Vue setup context (uses `useConvexClient()`)
 * - Auth uses the Clerk JWT template name defined in `shared/cloud/provider-ids`
 * - Subscription cleanup handles a known Convex SDK race condition gracefully
 * - Responses are validated with Zod schemas for safety
 *
 * @see shared/sync/types for SyncProvider interface
 * @see convex/sync.ts for the server-side Convex functions
 * @see shared/cloud/provider-ids for provider/JWT constants
 */
import { useConvexClient } from 'convex-vue';
import { api } from '~~/convex/_generated/api';
import type {
    SyncProvider,
    SyncScope,
    SyncChange,
    PullRequest,
    PullResponse,
    PushBatch,
    PushResult,
    PendingOp,
    SyncSubscribeOptions,
} from '~~/shared/sync/types';
import { PullResponseSchema, SyncChangeSchema, PushResultSchema } from '~~/shared/sync/schemas';
import { z } from 'zod';
import type { Id } from '~~/convex/_generated/dataModel';
import { CONVEX_JWT_TEMPLATE, CONVEX_PROVIDER_ID } from '~~/shared/cloud/provider-ids';

/** Tables to sync */
const SYNCED_TABLES = ['threads', 'messages', 'projects', 'posts', 'kv', 'file_meta', 'notifications'];

/** Type for the Convex client */
type ConvexClient = ReturnType<typeof useConvexClient>;

/**
 * Purpose:
 * Create a direct-mode SyncProvider backed by Convex.
 *
 * Behavior:
 * - Uses Convex queries/mutations for pull/push and device cursor updates
 * - Uses `client.onUpdate()` for subscription-style change delivery
 * - Declares `auth` config for AuthTokenBroker (Clerk JWT template)
 *
 * Constraints:
 * - `client` must be created in a Vue setup context (Convex Vue composable)
 * - Intended for deployments where the client can reach Convex directly
 */
export function createConvexSyncProvider(client: ConvexClient): SyncProvider {
    const subscriptions = new Map<string, () => void>();

    return {
        id: CONVEX_PROVIDER_ID,
        mode: 'direct',
        auth: {
            providerId: CONVEX_PROVIDER_ID,
            template: CONVEX_JWT_TEMPLATE, // Clerk JWT template name
        },

        async subscribe(
            scope: SyncScope,
            tables: string[],
            onChanges: (changes: SyncChange[]) => void,
            options?: SyncSubscribeOptions
        ): Promise<() => void> {
            const tablesToWatch = tables.length > 0 ? tables : SYNCED_TABLES;
            let disposed = false;
            const cursor = options?.cursor ?? 0;
            const limit = options?.limit ?? 200;

            const unwatch = client.onUpdate(
                api.sync.watchChanges,
                {
                    workspace_id: scope.workspaceId as Id<'workspaces'>,
                    cursor,
                    limit,
                },
                (result) => {
                    if (disposed) return;

                    try {
                        const safeChanges = z.array(SyncChangeSchema).safeParse(result.changes);
                        if (!safeChanges.success) {
                            console.error('[convex-sync] Invalid watch changes:', safeChanges.error);
                            return;
                        }

                        const changes = safeChanges.data;
                        const filtered = tables.length > 0
                            ? changes.filter((c) => tables.includes(c.tableName))
                            : changes;

                        if (filtered.length > 0) {
                            onChanges(filtered);
                        }
                        // Cursor advancement is handled by SubscriptionManager.handleChanges()
                    } catch (error) {
                        console.error('[convex-sync] onChanges error:', error);
                    }
                }
            );

            const key = `${scope.workspaceId}:${tablesToWatch.join(',')}:${cursor}:${limit}`;
            const cleanup = () => {
                disposed = true;
                if (typeof unwatch === 'function') {
                try {
                    unwatch();
                } catch (err: unknown) {
                    // Suppress known race condition in Convex SDK where removing a subscriber
                    // from an already-cleared query map throws "Cannot read properties of undefined (reading 'numSubscribers')"
                    const isKnownRaceCondition =
                        err instanceof TypeError &&
                        err.message.includes("Cannot read properties of undefined") &&
                        err.message.includes("numSubscribers");

                    if (!isKnownRaceCondition) {
                        console.warn('[convex-sync] Cleanup unwatch failed:', err);
                    }
                }
                }
            };
            subscriptions.set(key, cleanup);

            return cleanup;
        },

        async pull(request: PullRequest): Promise<PullResponse> {
            const result = await client.query(api.sync.pull, {
                workspace_id: request.scope.workspaceId as Id<'workspaces'>,
                cursor: request.cursor,
                limit: request.limit,
                tables: request.tables,
            });

            // Validate response to catch malformed server data
            const parsed = PullResponseSchema.safeParse({
                changes: result.changes,
                nextCursor: result.nextCursor,
                hasMore: result.hasMore,
            });

            if (!parsed.success) {
                console.error('[convex-sync] Invalid pull response:', parsed.error);
                throw new Error(`Invalid pull response: ${parsed.error.message}`);
            }

            return parsed.data;
        },

        async push(batch: PushBatch): Promise<PushResult> {
            const result = await client.mutation(api.sync.push, {
                workspace_id: batch.scope.workspaceId as Id<'workspaces'>,
                ops: batch.ops.map((op: PendingOp) => ({
                    op_id: op.stamp.opId,
                    table_name: op.tableName,
                    operation: op.operation,
                    pk: op.pk,
                    payload: op.payload,
                    clock: op.stamp.clock,
                    hlc: op.stamp.hlc,
                    device_id: op.stamp.deviceId,
                })),
            });

            // Validate response for consistency with pull()
            const parsed = PushResultSchema.safeParse({
                results: result.results,
                serverVersion: result.serverVersion,
            });

            if (!parsed.success) {
                console.error('[convex-sync] Invalid push response:', parsed.error);
                throw new Error(`Invalid push response: ${parsed.error.message}`);
            }

            return parsed.data;
        },

        async updateCursor(scope: SyncScope, deviceId: string, version: number): Promise<void> {
            await client.mutation(api.sync.updateDeviceCursor, {
                workspace_id: scope.workspaceId as Id<'workspaces'>,
                device_id: deviceId,
                last_seen_version: version,
            });
        },

        async gcTombstones(scope: SyncScope, retentionSeconds: number): Promise<void> {
            await client.mutation(api.sync.gcTombstones, {
                workspace_id: scope.workspaceId as Id<'workspaces'>,
                retention_seconds: retentionSeconds,
            });
        },

        async gcChangeLog(scope: SyncScope, retentionSeconds: number): Promise<void> {
            await client.mutation(api.sync.gcChangeLog, {
                workspace_id: scope.workspaceId as Id<'workspaces'>,
                retention_seconds: retentionSeconds,
            });
        },

        async dispose(): Promise<void> {
            // Clean up all subscriptions with error handling
            subscriptions.forEach((cleanup, key) => {
                try {
                    cleanup();
                } catch (err) {
                    console.warn('[convex-sync] Subscription cleanup failed:', key, err);
                }
            });
            subscriptions.clear();
        },
    };
}
