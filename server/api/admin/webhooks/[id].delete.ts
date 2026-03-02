import { defineEventHandler } from 'h3';
import { resetWebhookRateLimits } from '../../../utils/webhooks/rate-limit';
import {
    refreshAdminWebhookListeners,
    requireAdminWebhook,
    requireAdminWebhookApiContext,
    requireWebhookId,
} from './_helpers';

export default defineEventHandler(async (event) => {
    const { store } = await requireAdminWebhookApiContext(event, {
        mutation: true,
    });
    const webhookId = requireWebhookId(event);

    await requireAdminWebhook(store, webhookId);
    await store.cancelDeliveriesByWebhook(webhookId);
    await store.deleteWebhook(webhookId);
    resetWebhookRateLimits(webhookId);
    await refreshAdminWebhookListeners();

    return {
        ok: true,
    };
});
