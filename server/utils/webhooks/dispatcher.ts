import { randomUUID } from 'node:crypto';
import { decryptSecret } from './crypto';
import { buildWebhookPayload } from './payload';
import { checkWebhookRateLimit } from './rate-limit';
import { buildDeliveryHeaders, signPayload } from './signing';
import { createSsrfSafeAgent } from './ssrf-safe-agent';
import { validateWebhookUrl } from './url-validator';
import type { WebhookStore } from './store/types';
import type { WebhookPayload } from '../../../shared/webhooks/payload';
import type { WebhookRegistration } from './store/types';
import {
    getNotificationEmitter,
    listNotificationEmitterIds,
} from '../notifications/registry';

export const RETRY_DELAYS = [
    0,
    30_000,
    120_000,
    600_000,
    1_800_000,
    3_600_000,
] as const;

const DEFAULT_BATCH_SIZE = 25;
const DEFAULT_POLL_INTERVAL_MS = 5_000;
const DEFAULT_REAPER_INTERVAL_MS = 60_000;
const STALE_IN_FLIGHT_MS = 2 * 60 * 1000;
const MAX_RESPONSE_BODY_CHARS = 4 * 1024;

export interface WebhookDeliveryJob {
    webhookId: string;
    eventType: string;
    eventId: string;
    payload: WebhookPayload<unknown> | Record<string, unknown>;
}

export interface TestPingResult {
    success: boolean;
    statusCode: number | null;
    durationMs: number;
    error: string | null;
    responseBody: string | null;
}

type DispatchingFetch = (
    input: string,
    init: RequestInit & { dispatcher?: unknown }
) => Promise<Response>;

export interface WebhookDispatcherConfig {
    rateLimitPerMinute: number;
    deliveryTimeoutMs: number;
    blockPrivateIps: boolean;
    encryptionKey: string;
    maxRetryHours: number;
    batchSize?: number;
    pollIntervalMs?: number;
    reaperIntervalMs?: number;
    deliveryConcurrency?: number;
    fetchImpl?: DispatchingFetch;
}

export interface WebhookDispatcher {
    enqueue(job: WebhookDeliveryJob): Promise<void>;
    claimAndProcess(): Promise<void>;
    sendTestPing(
        webhook: WebhookRegistration,
        signingSecret: string,
        payload?: WebhookPayload<{ ok: boolean; test: true }>
    ): Promise<TestPingResult>;
    start(): void;
    stop(): void;
}

type DeliveryAttemptResult = {
    success: boolean;
    statusCode: number | null;
    durationMs: number;
    error: string | null;
    responseBody: string | null;
};

async function emitWebhookFailureNotification(
    webhook: WebhookRegistration,
    eventType: string,
    attempt: number,
    error: string | null
): Promise<void> {
    if (!webhook.user_id || !webhook.workspace_id) {
        return;
    }

    const emitterId = listNotificationEmitterIds()[0];
    if (!emitterId) {
        return;
    }

    const emitter = getNotificationEmitter(emitterId);
    if (!emitter?.emitWebhookDeliveryFailed) {
        return;
    }

    await emitter.emitWebhookDeliveryFailed({
        webhookId: webhook.id,
        workspaceId: webhook.workspace_id,
        userId: webhook.user_id,
        eventType,
        attempt,
        error,
    });
}

export async function recalculateWebhookHealth(
    store: WebhookStore,
    webhookId: string
): Promise<void> {
    const lastThree = await store.getRecentTerminalDeliveries(webhookId, 3);

    if (lastThree.length === 0) {
        await store.updateWebhookHealth(webhookId, 'unknown');
        return;
    }

    if (lastThree.some((log) => log.status === 'failed')) {
        await store.updateWebhookHealth(webhookId, 'failing');
        return;
    }

    if (lastThree.length === 3 && lastThree.every((log) => log.status === 'success')) {
        await store.updateWebhookHealth(webhookId, 'healthy');
        return;
    }

    await store.updateWebhookHealth(webhookId, 'unknown');
}

export function buildWebhookTestPingPayload(
    webhook: Pick<WebhookRegistration, 'workspace_id' | 'user_id' | 'scope'>
): WebhookPayload<{ ok: boolean; test: true }> {
    return buildWebhookPayload({
        event: 'webhook.test',
        data: {
            ok: true,
            test: true,
        },
        workspaceId: webhook.workspace_id,
        userId: webhook.user_id,
        scope: webhook.scope,
    }) as WebhookPayload<{ ok: boolean; test: true }>;
}

export function createWebhookDispatcher(
    store: WebhookStore,
    config: WebhookDispatcherConfig,
    workerId: string = randomUUID()
): WebhookDispatcher {
    const batchSize = Math.max(1, Math.floor(config.batchSize ?? DEFAULT_BATCH_SIZE));
    const pollIntervalMs = Math.max(
        1000,
        Math.floor(config.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS)
    );
    const reaperIntervalMs = Math.max(
        1000,
        Math.floor(config.reaperIntervalMs ?? DEFAULT_REAPER_INTERVAL_MS)
    );
    const deliveryConcurrency = Math.max(
        1,
        Math.floor(config.deliveryConcurrency ?? 4)
    );
    const fetchImpl: DispatchingFetch =
        config.fetchImpl ??
        ((input, init) => fetch(input, init as RequestInit & { dispatcher?: unknown }));
    const agent = createSsrfSafeAgent({
        blockPrivateIps: config.blockPrivateIps,
    });

    let processInterval: ReturnType<typeof setInterval> | null = null;
    let reaperInterval: ReturnType<typeof setInterval> | null = null;
    let processing = false;

    async function deliver(
        targetUrl: string,
        body: string,
        signingSecret: string,
        eventType: string,
        eventId: string
    ): Promise<DeliveryAttemptResult> {
        const timestamp = Math.floor(Date.now() / 1000);
        const signature = signPayload(body, signingSecret, timestamp);
        const headers = buildDeliveryHeaders(eventType, eventId, signature, timestamp);
        const controller = new AbortController();
        const startedAt = Date.now();
        const timeout = setTimeout(
            () => controller.abort(),
            Math.max(1, Math.floor(config.deliveryTimeoutMs))
        );

        try {
            if (config.blockPrivateIps) {
                await validateWebhookUrl(targetUrl, {
                    blockPrivateIps: true,
                });
            }

            const response = await fetchImpl(targetUrl, {
                method: 'POST',
                headers,
                body,
                signal: controller.signal,
                dispatcher: agent as never,
            });

            const responseBody = truncateResponseBody(await response.text());
            return {
                success: response.status >= 200 && response.status < 300,
                statusCode: response.status,
                durationMs: Date.now() - startedAt,
                error:
                    response.status >= 200 && response.status < 300
                        ? null
                        : `Webhook delivery failed with HTTP ${response.status}`,
                responseBody,
            };
        } catch (error) {
            return {
                success: false,
                statusCode: null,
                durationMs: Date.now() - startedAt,
                error: error instanceof Error ? error.message : 'Webhook delivery failed',
                responseBody: null,
            };
        } finally {
            clearTimeout(timeout);
        }
    }

    async function processClaimedDelivery(
        log: Awaited<ReturnType<WebhookStore['claimPendingDeliveries']>>[number]
    ): Promise<void> {
        const webhook = await store.getWebhook(log.webhook_id);
        if (!webhook || !webhook.enabled) {
            await store.updateDeliveryLog(log.id, {
                status: 'cancelled',
                next_retry_at: null,
            });
            return;
        }

        let signingSecret: string;
        try {
            signingSecret = decryptSecret(
                webhook.signing_secret_enc,
                config.encryptionKey
            );
        } catch (error) {
            await store.updateDeliveryLog(log.id, {
                status: 'failed',
                error_message:
                    error instanceof Error ? error.message : 'Webhook secret decrypt failed',
                next_retry_at: null,
            });
            await recalculateWebhookHealth(store, webhook.id);
            await emitWebhookFailureNotification(
                webhook,
                log.event_type,
                log.attempt,
                error instanceof Error ? error.message : 'Webhook secret decrypt failed'
            );
            return;
        }

        const result = await deliver(
            webhook.url,
            log.request_payload,
            signingSecret,
            log.event_type,
            log.event_id
        );

        if (result.success) {
            await store.updateDeliveryLog(log.id, {
                status: 'success',
                http_status: result.statusCode,
                error_message: null,
                response_body: result.responseBody,
                duration_ms: result.durationMs,
                next_retry_at: null,
            });
            await recalculateWebhookHealth(store, webhook.id);
            return;
        }

        const nextAttempt = log.attempt + 1;
        const maxRetryWindowMs = Math.max(1, config.maxRetryHours) * 60 * 60 * 1000;
        const retryDeadline = log.created_at + maxRetryWindowMs;

        if (nextAttempt <= RETRY_DELAYS.length) {
            const delay =
                RETRY_DELAYS[nextAttempt - 1] ??
                RETRY_DELAYS[RETRY_DELAYS.length - 1]!;
            const nextRetryAt = Date.now() + delay;
            if (nextRetryAt <= retryDeadline) {
                await store.updateDeliveryLog(log.id, {
                    status: 'pending',
                    attempt: nextAttempt,
                    http_status: result.statusCode,
                    error_message: result.error,
                    response_body: result.responseBody,
                    duration_ms: result.durationMs,
                    next_retry_at: nextRetryAt,
                });
                return;
            }
        }

        await store.updateDeliveryLog(log.id, {
            status: 'failed',
            http_status: result.statusCode,
            error_message: result.error,
            response_body: result.responseBody,
            duration_ms: result.durationMs,
            next_retry_at: null,
        });
        await recalculateWebhookHealth(store, webhook.id);
        await emitWebhookFailureNotification(
            webhook,
            log.event_type,
            log.attempt,
            result.error
        );
    }

    function truncateResponseBody(value: string): string | null {
        if (!value) return null;
        if (value.length <= MAX_RESPONSE_BODY_CHARS) return value;
        return value.slice(0, MAX_RESPONSE_BODY_CHARS);
    }

    return {
        async enqueue(job) {
            const rateLimit = checkWebhookRateLimit(
                job.webhookId,
                config.rateLimitPerMinute
            );
            if (!rateLimit.allowed) {
                await store.createDeliveryLog({
                    webhook_id: job.webhookId,
                    event_id: job.eventId,
                    event_type: job.eventType,
                    attempt: 1,
                    status: 'cancelled',
                    claimed_by: null,
                    claimed_at: null,
                    http_status: null,
                    error_message: `Rate limit exceeded. Retry after ${new Date(rateLimit.resetAt).toISOString()}`,
                    request_payload: JSON.stringify(job.payload),
                    response_body: null,
                    duration_ms: null,
                    next_retry_at: rateLimit.resetAt,
                    created_at: Date.now(),
                });
                console.warn(
                    `[webhooks] Rate-limited event ${job.eventType} for webhook ${job.webhookId}`
                );
                return;
            }

            await store.createDeliveryLog({
                webhook_id: job.webhookId,
                event_id: job.eventId,
                event_type: job.eventType,
                attempt: 1,
                status: 'pending',
                claimed_by: null,
                claimed_at: null,
                http_status: null,
                error_message: null,
                request_payload: JSON.stringify(job.payload),
                response_body: null,
                duration_ms: null,
                next_retry_at: Date.now(),
                created_at: Date.now(),
            });
        },

        async claimAndProcess() {
            if (processing) {
                return;
            }

            processing = true;
            try {
                const claimed = await store.claimPendingDeliveries(workerId, batchSize);
                const workers = Array.from(
                    { length: Math.min(deliveryConcurrency, claimed.length) },
                    async (_, workerIndex) => {
                        for (let i = workerIndex; i < claimed.length; i += deliveryConcurrency) {
                            await processClaimedDelivery(claimed[i]!);
                        }
                    }
                );
                await Promise.all(workers);
            } finally {
                processing = false;
            }
        },

        async sendTestPing(
            webhook,
            signingSecret,
            payload = buildWebhookTestPingPayload(webhook)
        ) {

            return deliver(
                webhook.url,
                JSON.stringify(payload),
                signingSecret,
                payload.event,
                payload.event_id
            );
        },

        start() {
            if (!processInterval) {
                processInterval = setInterval(() => {
                    void this.claimAndProcess();
                }, pollIntervalMs);
            }

            if (!reaperInterval) {
                reaperInterval = setInterval(() => {
                    void store.resetStaleInFlightDeliveries(STALE_IN_FLIGHT_MS);
                }, reaperIntervalMs);
            }
        },

        stop() {
            if (processInterval) {
                clearInterval(processInterval);
                processInterval = null;
            }
            if (reaperInterval) {
                clearInterval(reaperInterval);
                reaperInterval = null;
            }
            void (agent as unknown as { close?: () => Promise<void> }).close?.();
        },
    };
}
