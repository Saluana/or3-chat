import { resetWebhookRateLimits } from '../../utils/webhooks/rate-limit';
import {
    requireOwnedWebhook,
    requireWebhookApiContext,
    requireWebhookId,
} from './_helpers';
import { createWebhookDeleteHandler } from './route-factories';

export default createWebhookDeleteHandler(
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
    resetWebhookRateLimits
);
