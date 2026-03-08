import { defineEventHandler } from 'h3';
import { requireWebhookApiContext, serializeWebhook } from './_helpers';

export default defineEventHandler(async (event) => {
    const { store, userId, workspaceId } = await requireWebhookApiContext(event);
    const webhooks = await store.listWebhooks(userId, workspaceId);

    return {
        webhooks: webhooks.map(serializeWebhook),
    };
});
