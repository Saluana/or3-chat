/**
 * @module server/sync/gateway/types.ts
 *
 * Purpose:
 * Defines the server-side adapter interface for sync backends. This decouples
 * SSR sync endpoints from specific backend implementations (Convex, SQLite, etc.).
 *
 * Architecture:
 * - Core sync endpoints handle auth, validation, rate limiting
 * - Adapters handle backend-specific logic (queries, mutations, cursors)
 * - Wire types (PullRequest, PushBatch, etc.) are shared with client
 *
 * Example Flow:
 * 1. POST /api/sync/push receives PushBatch from client
 * 2. Endpoint resolves session, checks can('workspace.write')
 * 3. Endpoint gets active SyncGatewayAdapter from config
 * 4. Adapter handles backend operations (insert to change_log, etc.)
 * 5. Endpoint returns PushResult to client
 */
import type { H3Event } from 'h3';
import type {
    PullRequest,
    PullResponse,
    PushBatch,
    PushResult,
} from '~~/shared/sync/types';

/**
 * Purpose:
 * Server-side sync gateway adapter interface.
 *
 * Responsibilities:
 * - Handle pull/push/cursor operations for a specific backend
 * - Maintain change log and device cursors
 * - Implement GC for tombstones and change log
 * - Ensure idempotency and ordering invariants
 *
 * Constraints:
 * - Must respect workspace isolation (scope.workspaceId)
 * - Must maintain stable ordering (serverVersion monotonic)
 * - Must handle concurrent operations safely
 */
export interface SyncGatewayAdapter {
    id: string;

    /**
     * Pull changes from server since cursor.
     *
     * Behavior:
     * - Returns changes where serverVersion > cursor
     * - Limited to `limit` changes per request
     * - Sets `hasMore` if more changes available
     * - Respects workspace isolation
     *
     * @param event - Nitro request event (contains session)
     * @param input - Pull request with scope, cursor, limit
     * @returns Pull response with changes and next cursor
     */
    pull(event: H3Event, input: PullRequest): Promise<PullResponse>;

    /**
     * Push batch of operations to server.
     *
     * Behavior:
     * - Validates and applies operations atomically
     * - Returns per-op success/failure results
     * - Assigns serverVersion to each successful op
     * - Ensures idempotency (same opId = same result)
     *
     * @param event - Nitro request event (contains session)
     * @param input - Push batch with scope and operations
     * @returns Push result with per-op status
     */
    push(event: H3Event, input: PushBatch): Promise<PushResult>;

    /**
     * Update device cursor for change log GC.
     *
     * Behavior:
     * - Records last-seen serverVersion for device
     * - Used to determine safe deletion point for change log
     * - Idempotent (upsert operation)
     *
     * @param event - Nitro request event (contains session)
     * @param input - Device cursor update with scope, deviceId, version
     */
    updateCursor(
        event: H3Event,
        input: { scope: { workspaceId: string }; deviceId: string; version: number }
    ): Promise<void>;

    /**
     * Garbage collect tombstones older than retention period.
     *
     * Behavior:
     * - Deletes tombstones where deleted_at < now - retentionSeconds
     * - Optional: may be no-op if backend handles this automatically
     *
     * @param event - Nitro request event (contains session)
     * @param input - GC request with scope and retention window
     */
    gcTombstones?(
        event: H3Event,
        input: { scope: { workspaceId: string }; retentionSeconds: number }
    ): Promise<void>;

    /**
     * Garbage collect change log entries beyond retention window.
     *
     * Behavior:
     * - Deletes change log entries where:
     *   - serverVersion < min(deviceCursors) AND
     *   - created_at < now - retentionSeconds
     * - Ensures no device misses changes
     *
     * @param event - Nitro request event (contains session)
     * @param input - GC request with scope and retention window
     */
    gcChangeLog?(
        event: H3Event,
        input: { scope: { workspaceId: string }; retentionSeconds: number }
    ): Promise<void>;
}
