import { defineEventHandler } from 'h3';
import {
    requireAdminWebhookApiContext,
    serializeWebhook,
} from './_helpers';

export default defineEventHandler(async (event) => {
    const { store } = await requireAdminWebhookApiContext(event);
    const webhooks = await store.listAdminWebhooks();

    return {
        webhooks: webhooks.map(serializeWebhook),
    };
});
