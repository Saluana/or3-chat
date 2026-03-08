import {
    createWebhookRouteDispatcher,
    requireAdminWebhook,
    requireAdminWebhookApiContext,
    requireWebhookId,
    requireWebhookSigningSecret,
} from '../_helpers';
import { createWebhookTestHandler } from '../../../webhooks/route-factories';

export default createWebhookTestHandler({
    getWebhookId: requireWebhookId,
    resolveContext(event) {
        return requireAdminWebhookApiContext(event, {
            mutation: true,
        });
    },
    resolveWebhook(context, webhookId) {
        return requireAdminWebhook(context.store, webhookId);
    },
    createDispatcher: createWebhookRouteDispatcher,
    getSigningSecret: requireWebhookSigningSecret,
});
