import { defineEventHandler } from 'h3';
import { resetWebhookRateLimits } from '../../utils/webhooks/rate-limit';
import {
    requireOwnedWebhook,
    requireWebhookApiContext,
    requireWebhookId,
} from './_helpers';

export default defineEventHandler(async (event) => {
    const { store, userId, workspaceId } = await requireWebhookApiContext(event);
    const webhookId = requireWebhookId(event);

    await requireOwnedWebhook(store, webhookId, userId, workspaceId);
    await store.cancelDeliveriesByWebhook(webhookId);
    await store.deleteWebhook(webhookId);
    resetWebhookRateLimits(webhookId);

    return {
        ok: true,
    };
});
