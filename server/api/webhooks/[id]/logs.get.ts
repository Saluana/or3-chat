import { defineEventHandler, getQuery } from 'h3';
import {
    requireOwnedWebhook,
    requireWebhookApiContext,
    requireWebhookId,
    resolveWebhookLogSince,
} from '../_helpers';

export default defineEventHandler(async (event) => {
    const { store, userId, workspaceId } = await requireWebhookApiContext(event);
    const webhookId = requireWebhookId(event);
    await requireOwnedWebhook(store, webhookId, userId, workspaceId);

    const since = resolveWebhookLogSince(getQuery(event).since);
    const logs = await store.getDeliveryLogs(webhookId, since);

    return {
        logs,
    };
});
