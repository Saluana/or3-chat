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
            const unsubscribes: Array<() => void> = [];

            // Track the last seen version per subscription
            let lastVersion = 0;
            let unwatch: (() => void) | null = null;

            const subscribeWithCursor = (cursor: number) => {
                if (unwatch) {
                    unwatch();
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
                        const filtered = tables.length > 0
                            ? result.changes.filter((c) => tables.includes(c.tableName))
                            : result.changes;

                        if (filtered.length > 0) {
                            onChanges(filtered);
                        }

                        if (result.latestVersion > lastVersion) {
                            lastVersion = result.latestVersion;
                            subscribeWithCursor(lastVersion);
                        }
                    }
                );
            };

            subscribeWithCursor(lastVersion);
            unsubscribes.push(() => {
                if (unwatch) {
                    unwatch();
                    unwatch = null;
                }
            });

            // Store cleanup
            const key = `${scope.workspaceId}:${tablesToWatch.join(',')}`;
            const cleanup = () => unsubscribes.forEach((fn) => fn());
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

            return {
                changes: result.changes,
                nextCursor: result.nextCursor,
                hasMore: result.hasMore,
            };
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

            return {
                results: result.results,
                serverVersion: result.serverVersion,
            };
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
