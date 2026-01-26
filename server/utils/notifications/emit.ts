/**
 * Server-side notification emission
 *
 * Uses Convex to push notifications to the notifications table.
 */

import { ConvexHttpClient } from 'convex/browser';
import { api } from '~~/convex/_generated/api';

/**
 * Emit a background job completion notification
 */
export async function emitBackgroundComplete(
    jobId: string,
    userId: string,
    threadId: string
): Promise<void> {
    const config = useRuntimeConfig();
    const convexUrl = config.public.sync.convexUrl;

    if (!convexUrl) {
        // If no Convex URL, we can't emit notification to server
        return;
    }

    try {
        const client = new ConvexHttpClient(convexUrl);

        await client.mutation(api.notifications.create, {
            user_id: userId,
            type: 'ai.background.complete',
            title: 'AI response ready',
            body: 'Your background response is ready.',
            thread_id: threadId,
            actions: JSON.stringify([
                {
                    id: crypto.randomUUID(),
                    label: 'Open chat',
                    kind: 'navigate',
                    target: { threadId },
                    data: { jobId }
                }
            ])
        });

    } catch (err) {
        console.error('[notifications] Failed to emit background complete:', err);
    }
}
