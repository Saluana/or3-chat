import { defineEventHandler } from 'h3';
import {
    buildWebhookTestPingPayload,
    recalculateWebhookHealth,
} from '../../../utils/webhooks/dispatcher';
import {
    createWebhookRouteDispatcher,
    requireOwnedWebhook,
    requireWebhookApiContext,
    requireWebhookId,
    requireWebhookSigningSecret,
} from '../_helpers';

export default defineEventHandler(async (event) => {
    const { store, userId, workspaceId } = await requireWebhookApiContext(event);
    const webhookId = requireWebhookId(event);
    const webhook = await requireOwnedWebhook(store, webhookId, userId, workspaceId);
    const signingSecret = requireWebhookSigningSecret(webhook);
    const payload = buildWebhookTestPingPayload(webhook);
    const requestPayload = JSON.stringify(payload);

    const log = await store.createDeliveryLog({
        webhook_id: webhook.id,
        event_id: payload.event_id,
        event_type: payload.event,
        attempt: 1,
        status: 'in_flight',
        claimed_by: 'manual:test',
        claimed_at: Date.now(),
        http_status: null,
        error_message: null,
        request_payload: requestPayload,
        response_body: null,
        duration_ms: null,
        next_retry_at: null,
        created_at: Date.now(),
    });

    const dispatcher = createWebhookRouteDispatcher(store);

    try {
        const result = await dispatcher.sendTestPing(webhook, signingSecret, payload);

        await store.updateDeliveryLog(log.id, {
            status: result.success ? 'success' : 'failed',
            http_status: result.statusCode,
            error_message: result.error,
            response_body: result.responseBody,
            duration_ms: result.durationMs,
            next_retry_at: null,
        });
        await recalculateWebhookHealth(store, webhook.id);

        return result;
    } finally {
        dispatcher.stop();
    }
});
