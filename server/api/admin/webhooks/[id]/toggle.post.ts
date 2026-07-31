import {
    refreshAdminWebhookListeners,
    requireAdminWebhook,
    requireAdminWebhookApiContext,
    requireWebhookId,
    serializeWebhook,
} from '../_helpers';
import { createWebhookToggleHandler } from '../../../webhooks/route-factories';

export default createWebhookToggleHandler({
    getWebhookId: requireWebhookId,
    resolveContext(event) {
        return requireAdminWebhookApiContext(event, {
            mutation: true,
        });
    },
    resolveWebhook(context, webhookId) {
        return requireAdminWebhook(context.store, webhookId);
    },
    serializeWebhook,
    async afterMutation() {
        await refreshAdminWebhookListeners();
    },
});
