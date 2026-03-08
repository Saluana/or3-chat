import { createError, defineEventHandler, getQuery, readBody, type H3Event } from 'h3';
import { z } from 'zod';
import {
    buildWebhookTestPingPayload,
    recalculateWebhookHealth,
} from '../../utils/webhooks/dispatcher';
import type {
    WebhookRegistration,
    WebhookStore,
} from '../../utils/webhooks/store/types';

type RouteContext = {
    store: WebhookStore;
};

type ResolveContext<TContext extends RouteContext> = (
    event: H3Event
) => Promise<TContext>;
type ResolveWebhook<TContext extends RouteContext> = (
    context: TContext,
    webhookId: string
) => Promise<WebhookRegistration>;

interface WebhookHandlerOptions<TContext extends RouteContext> {
    getWebhookId: (event: H3Event) => string;
    resolveContext: ResolveContext<TContext>;
    resolveWebhook: ResolveWebhook<TContext>;
}

interface WebhookMutationOptions<TContext extends RouteContext>
    extends WebhookHandlerOptions<TContext> {
    serializeWebhook?: (webhook: WebhookRegistration) => unknown;
    afterMutation?: (
        context: TContext,
        webhook: WebhookRegistration
    ) => Promise<void> | void;
}

interface WebhookTestHandlerOptions<TContext extends RouteContext>
    extends WebhookHandlerOptions<TContext> {
    createDispatcher: (store: WebhookStore) => {
        sendTestPing: (
            webhook: WebhookRegistration,
            signingSecret: string,
            payload: ReturnType<typeof buildWebhookTestPingPayload>
        ) => Promise<{
            success: boolean;
            statusCode: number | null;
            error: string | null;
            responseBody: string | null;
            durationMs: number | null;
        }>;
        stop: () => void;
    };
    getSigningSecret: (webhook: WebhookRegistration) => string;
}

const ToggleBodySchema = z.object({
    enabled: z.boolean().optional(),
});

export function createWebhookToggleHandler<TContext extends RouteContext>(
    options: WebhookMutationOptions<TContext>
) {
    return defineEventHandler(async (event) => {
        const body = ToggleBodySchema.safeParse((await readBody(event)) ?? {});
        if (!body.success) {
            throw createError({
                statusCode: 400,
                statusMessage: 'Invalid request',
            });
        }

        const context = await options.resolveContext(event);
        const webhookId = options.getWebhookId(event);
        const existing = await options.resolveWebhook(context, webhookId);

        const updated = await context.store.updateWebhook(webhookId, {
            enabled: body.data.enabled ?? !existing.enabled,
        });

        await options.afterMutation?.(context, updated);

        return {
            webhook: options.serializeWebhook
                ? options.serializeWebhook(updated)
                : updated,
        };
    });
}

export function createWebhookDeleteHandler<TContext extends RouteContext>(
    options: WebhookMutationOptions<TContext>,
    resetRateLimits: (webhookId: string) => void
) {
    return defineEventHandler(async (event) => {
        const context = await options.resolveContext(event);
        const webhookId = options.getWebhookId(event);

        const webhook = await options.resolveWebhook(context, webhookId);
        await context.store.cancelDeliveriesByWebhook(webhook.id);
        await context.store.deleteWebhook(webhookId);
        resetRateLimits(webhookId);
        await options.afterMutation?.(context, webhook);

        return {
            ok: true,
        };
    });
}

export function createWebhookLogsHandler<TContext extends RouteContext>(
    options: WebhookHandlerOptions<TContext>,
    resolveSince: (since: unknown) => number
) {
    return defineEventHandler(async (event) => {
        const context = await options.resolveContext(event);
        const webhookId = options.getWebhookId(event);
        await options.resolveWebhook(context, webhookId);

        const since = resolveSince(getQuery(event).since);
        const logs = await context.store.getDeliveryLogs(webhookId, since);

        return {
            logs,
        };
    });
}

export function createWebhookTestHandler<TContext extends RouteContext>(
    options: WebhookTestHandlerOptions<TContext>
) {
    return defineEventHandler(async (event) => {
        const context = await options.resolveContext(event);
        const webhookId = options.getWebhookId(event);
        const webhook = await options.resolveWebhook(context, webhookId);
        const signingSecret = options.getSigningSecret(webhook);
        const payload = buildWebhookTestPingPayload(webhook);
        const requestPayload = JSON.stringify(payload);

        const log = await context.store.createDeliveryLog({
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

        const dispatcher = options.createDispatcher(context.store);

        try {
            const result = await dispatcher.sendTestPing(
                webhook,
                signingSecret,
                payload
            );

            await context.store.updateDeliveryLog(log.id, {
                status: result.success ? 'success' : 'failed',
                http_status: result.statusCode,
                error_message: result.error,
                response_body: result.responseBody,
                duration_ms: result.durationMs,
                next_retry_at: null,
            });
            await recalculateWebhookHealth(context.store, webhook.id);

            return result;
        } finally {
            dispatcher.stop();
        }
    });
}
