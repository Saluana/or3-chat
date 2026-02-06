/**
 * @module server/utils/notifications/emit
 *
 * Purpose:
 * Server-side helpers for emitting notification records to Convex.
 * These are used for background job completion and failure events.
 *
 * Responsibilities:
 * - Create notification records with consistent types and messages.
 * - Use the server Convex HTTP client and generated API.
 *
 * Non-Goals:
 * - Client delivery or realtime subscription logic.
 * - Deduplication or batching of notifications.
 *
 * Constraints:
 * - Server-only usage.
 */

import { api } from '~~/convex/_generated/api';
import type { Id } from '~~/convex/_generated/dataModel';
import { getConvexClient } from '../utils/convex-client';

/**
 * Purpose:
 * Resolve the Convex client used for notification writes.
 */
const getNotificationsClient = () => getConvexClient();

/**
 * Purpose:
 * Emit a notification when a background job completes.
 *
 * Behavior:
 * - Writes to the Convex notifications table.
 * - Returns the created notification ID.
 *
 * Constraints:
 * - `jobId` is accepted for parity with callers but not stored in the payload.
 */
export async function emitBackgroundJobComplete(
    workspaceId: string,
    userId: string,
    threadId: string,
    jobId: string
): Promise<string> {
    const client = getNotificationsClient();

    const notificationId = await client.mutation(api.notifications.create, {
        workspace_id: workspaceId as Id<'workspaces'>,
        user_id: userId,
        thread_id: threadId,
        type: 'ai.background.complete',
        title: 'Background response completed',
        body: `Your background AI response is ready in thread ${threadId}`,
    });

    return notificationId;
}

/**
 * Purpose:
 * Emit a notification when a background job fails.
 *
 * Behavior:
 * - Writes to the Convex notifications table.
 * - Returns the created notification ID.
 *
 * Constraints:
 * - `jobId` is accepted for parity with callers but not stored in the payload.
 */
export async function emitBackgroundJobError(
    workspaceId: string,
    userId: string,
    threadId: string,
    jobId: string,
    error: string
): Promise<string> {
    const client = getNotificationsClient();

    const notificationId = await client.mutation(api.notifications.create, {
        workspace_id: workspaceId as Id<'workspaces'>,
        user_id: userId,
        thread_id: threadId,
        type: 'ai.background.error',
        title: 'Background response failed',
        body: `Failed: ${error}`,
    });

    return notificationId;
}
