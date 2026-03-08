import {
    requireAdminWebhook,
    requireAdminWebhookApiContext,
    requireWebhookId,
    resolveWebhookLogSince,
} from '../_helpers';
import { createWebhookLogsHandler } from '../../../webhooks/route-factories';

export default createWebhookLogsHandler(
    {
        getWebhookId: requireWebhookId,
        resolveContext(event) {
            return requireAdminWebhookApiContext(event);
        },
        resolveWebhook(context, webhookId) {
            return requireAdminWebhook(context.store, webhookId);
        },
    },
    resolveWebhookLogSince
);
