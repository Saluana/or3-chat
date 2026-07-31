import { resetWebhookRateLimits } from '../../../utils/webhooks/rate-limit';
import {
    refreshAdminWebhookListeners,
    requireAdminWebhook,
    requireAdminWebhookApiContext,
    requireWebhookId,
} from './_helpers';
import { createWebhookDeleteHandler } from '../../webhooks/route-factories';

export default createWebhookDeleteHandler(
    {
        getWebhookId: requireWebhookId,
        resolveContext(event) {
            return requireAdminWebhookApiContext(event, {
                mutation: true,
            });
        },
        resolveWebhook(context, webhookId) {
            return requireAdminWebhook(context.store, webhookId);
        },
        async afterMutation() {
            await refreshAdminWebhookListeners();
        },
    },
    resetWebhookRateLimits
);
