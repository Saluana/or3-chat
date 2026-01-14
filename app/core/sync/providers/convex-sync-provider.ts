/**
 * Convex Sync Provider
 *
 * Implements SyncProvider interface for Convex backend.
 * Uses direct mode with Clerk JWT template for authentication.
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
} from '~~/shared/sync/types';
import { PullResponseSchema, SyncChangeSchema, PushResultSchema } from '~~/shared/sync/schemas';
import { z } from 'zod';
import type { Id } from '~~/convex/_generated/dataModel';

/** Tables to sync */
const SYNCED_TABLES = ['threads', 'messages', 'projects', 'posts', 'kv', 'file_meta'];

/**
 * Create a Convex sync provider instance
 */
export function createConvexSyncProvider(): SyncProvider {
    const convex = useConvexClient();
    const subscriptions = new Map<string, () => void>();

    return {
        id: 'convex',
        mode: 'direct',
        auth: {
            providerId: 'convex',
            template: 'convex', // Clerk JWT template name
        },

        async subscribe(
            scope: SyncScope,
            tables: string[],
            onChanges: (changes: SyncChange[]) => void
        ): Promise<() => void> {
            const tablesToWatch = tables.length > 0 ? tables : SYNCED_TABLES;
            let lastVersion = 0;
            let unwatch: (() => void) | null = null;
            let disposed = false;
            let pendingResubscribe: ReturnType<typeof setTimeout> | null = null;

            const subscribeWithCursor = (cursor: number) => {
                if (disposed) return;
                
                // Clear previous watcher
                if (unwatch) {
                    unwatch();
                    unwatch = null;
                }

                // Subscribe to watchChanges query
                // Note: Convex reactive queries re-run when data changes
                unwatch = convex.onUpdate(
                    api.sync.watchChanges,
                    {
                        workspace_id: scope.workspaceId as Id<'workspaces'>,
                        cursor,
                        limit: 100,
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

                            if (result.latestVersion > lastVersion) {
                                lastVersion = result.latestVersion;
                                // Debounce re-subscribe to prevent stack overflow
                                if (pendingResubscribe) clearTimeout(pendingResubscribe);
                                pendingResubscribe = setTimeout(() => {
                                    subscribeWithCursor(lastVersion);
                                }, 0);
                            }
                        } catch (error) {
                            console.error('[convex-sync] onChanges error:', error);
                        }
                    }
                );
            };

            subscribeWithCursor(lastVersion);

            // Store cleanup
            const key = `${scope.workspaceId}:${tablesToWatch.join(',')}`;
            const cleanup = () => {
                disposed = true;
                if (pendingResubscribe) clearTimeout(pendingResubscribe);
                if (unwatch) {
                    unwatch();
                    unwatch = null;
                }
            };
            subscriptions.set(key, cleanup);

            return cleanup;
        },

        async pull(request: PullRequest): Promise<PullResponse> {
            const result = await convex.query(api.sync.pull, {
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
            const result = await convex.mutation(api.sync.push, {
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
            await convex.mutation(api.sync.updateDeviceCursor, {
                workspace_id: scope.workspaceId as Id<'workspaces'>,
                device_id: deviceId,
                last_seen_version: version,
            });
        },

        async gcTombstones(scope: SyncScope, retentionSeconds: number): Promise<void> {
            await convex.mutation(api.sync.gcTombstones, {
                workspace_id: scope.workspaceId as Id<'workspaces'>,
                retention_seconds: retentionSeconds,
            });
        },

        async gcChangeLog(scope: SyncScope, retentionSeconds: number): Promise<void> {
            await convex.mutation(api.sync.gcChangeLog, {
                workspace_id: scope.workspaceId as Id<'workspaces'>,
                retention_seconds: retentionSeconds,
            });
        },

        async dispose(): Promise<void> {
            // Clean up all subscriptions
            subscriptions.forEach((cleanup) => cleanup());
            subscriptions.clear();
        },
    };
}
