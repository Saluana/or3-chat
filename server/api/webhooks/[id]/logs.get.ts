import {
    requireOwnedWebhook,
    requireWebhookApiContext,
    requireWebhookId,
    resolveWebhookLogSince,
} from '../_helpers';
import { createWebhookLogsHandler } from '../route-factories';

export default createWebhookLogsHandler(
    {
        getWebhookId: requireWebhookId,
        resolveContext(event) {
            return requireWebhookApiContext(event);
        },
        resolveWebhook(context, webhookId) {
            return requireOwnedWebhook(
                context.store,
                webhookId,
                context.userId,
                context.workspaceId
            );
        },
    },
    resolveWebhookLogSince
);
