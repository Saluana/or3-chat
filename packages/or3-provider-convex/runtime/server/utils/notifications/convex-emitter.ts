import { api } from '~~/convex/_generated/api';
import type { Id } from '~~/convex/_generated/dataModel';
import { getConvexClient } from '../convex-client';
import type { NotificationEmitter } from '~~/server/utils/notifications/types';
import { CONVEX_PROVIDER_ID } from '~~/shared/cloud/provider-ids';

const getNotificationsClient = () => getConvexClient();

export const convexNotificationEmitter: NotificationEmitter = {
    id: CONVEX_PROVIDER_ID,
    async emitBackgroundJobComplete(input) {
        const client = getNotificationsClient();
        const notificationId = await client.mutation(api.notifications.create, {
            workspace_id: input.workspaceId as Id<'workspaces'>,
            user_id: input.userId,
            thread_id: input.threadId,
            type: 'ai.background.complete',
            title: 'Background response completed',
            body: `Your background AI response is ready in thread ${input.threadId}`,
        });

        return notificationId;
    },
    async emitBackgroundJobError(input) {
        const client = getNotificationsClient();
        const notificationId = await client.mutation(api.notifications.create, {
            workspace_id: input.workspaceId as Id<'workspaces'>,
            user_id: input.userId,
            thread_id: input.threadId,
            type: 'ai.background.error',
            title: 'Background response failed',
            body: `Failed: ${input.error}`,
        });

        return notificationId;
    },
};
