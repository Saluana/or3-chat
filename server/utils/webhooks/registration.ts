import { createError } from 'h3';
import type { WebhookStore } from './store/types';

/** Quotas must be checked by the same database operation that inserts the row. */
export async function createLimitedWebhook(
    store: WebhookStore,
    input: Parameters<WebhookStore['createWebhook']>[0],
    limit: number
) {
    if (store.registrationLimit !== 'atomic-v1') {
        throw createError({ statusCode: 503, statusMessage: 'Update the webhook provider to support atomic registration limits' });
    }
    try {
        return await store.createWebhook(input, limit);
    } catch (error) {
        if (error && typeof error === 'object' && 'code' in error && error.code === 'WEBHOOK_LIMIT_EXCEEDED') {
            throw createError({ statusCode: 400, statusMessage: 'Webhook limit exceeded' });
        }
        throw error;
    }
}
