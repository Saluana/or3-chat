import { defineEventHandler, getQuery } from 'h3';
import {
    requireAdminWebhook,
    requireAdminWebhookApiContext,
    requireWebhookId,
    resolveWebhookLogSince,
} from '../_helpers';

export default defineEventHandler(async (event) => {
    const { store } = await requireAdminWebhookApiContext(event);
    const webhookId = requireWebhookId(event);
    await requireAdminWebhook(store, webhookId);

    const since = resolveWebhookLogSince(getQuery(event).since);
    const logs = await store.getDeliveryLogs(webhookId, since);

    return {
        logs,
    };
});
