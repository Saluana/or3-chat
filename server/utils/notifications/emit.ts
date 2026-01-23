/**
 * Server-side Notification Emission
 *
 * Utilities for emitting notifications from the server to the Convex notifications table.
 */

import { ConvexHttpClient } from 'convex/browser';
import { api } from '~~/convex/_generated/api';
import type { Id } from '~~/convex/_generated/dataModel';

/**
 * Get a Convex HTTP client for server-side calls
 */
function getConvexClient(): ConvexHttpClient {
    const config = useRuntimeConfig();
    const url = config.public.sync.convexUrl as string | undefined;
    if (!url) {
        throw new Error('Convex URL not configured');
    }
    return new ConvexHttpClient(url);
}

/**
 * Emit a notification when a background job completes
 */
export async function emitBackgroundJobComplete(
    workspaceId: string,
    userId: string,
    threadId: string,
    jobId: string
): Promise<string> {
    const client = getConvexClient();

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
 * Emit a notification when a background job fails
 */
export async function emitBackgroundJobError(
    workspaceId: string,
    userId: string,
    threadId: string,
    jobId: string,
    error: string
): Promise<string> {
    const client = getConvexClient();

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
