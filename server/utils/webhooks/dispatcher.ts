import { webhookHasCurrentAccess } from './membership';
import { randomUUID } from 'node:crypto';
import { decryptSecret } from './crypto';
import { buildWebhookPayload } from './payload';
import { checkWebhookRateLimit } from './rate-limit';
import { buildDeliveryHeaders, signPayload } from './signing';
import { createSsrfSafeAgent } from './ssrf-safe-agent';
import { validateWebhookUrl } from './url-validator';
import type { WebhookUrlResolver } from './url-validator';
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
const MAX_RESPONSE_BODY_BYTES = 4 * 1024;
const MAX_REDIRECTS = 5;

async function readResponsePrefix(response: Response): Promise<string | null> {
    if (!response.body) return null;
    const reader = response.body.getReader();
    const prefix = new Uint8Array(MAX_RESPONSE_BODY_BYTES);
    let length = 0;
    try {
        while (length < prefix.length) {
            const { done, value } = await reader.read();
            if (done) break;
            const bytes = value.subarray(0, prefix.length - length);
            prefix.set(bytes, length);
            length += bytes.length;
        }
        if (length === prefix.length) await reader.cancel();
    } finally { reader.releaseLock(); }
    // Streaming decode drops an incomplete trailing UTF-8 sequence at the cap.
    return length ? new TextDecoder().decode(prefix.subarray(0, length), { stream: true }) : null;
}

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
    requireHttps?: boolean;
    encryptionKey: string;
    maxRetryHours: number;
    batchSize?: number;
    pollIntervalMs?: number;
    reaperIntervalMs?: number;
    deliveryConcurrency?: number;
    fetchImpl?: DispatchingFetch;
    /** Test-only DNS injection; production uses the system resolver. */
    urlResolver?: WebhookUrlResolver;
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

    async function fetchWithValidatedRedirects(
        targetUrl: string,
        init: RequestInit & { dispatcher?: unknown }
    ): Promise<Response> {
        let currentUrl = targetUrl;
        let currentInit = init;

        for (let redirectCount = 0; ; redirectCount += 1) {
            const parsedUrl = await validateWebhookUrl(currentUrl, {
                requireHttps: config.requireHttps,
                blockPrivateIps: config.blockPrivateIps,
                resolver: config.urlResolver,
            });
            const response = await fetchImpl(parsedUrl.toString(), {
                ...currentInit,
                redirect: 'manual',
            });

            if (![301, 302, 303, 307, 308].includes(response.status)) {
                return response;
            }

            const location = response.headers.get('location');
            if (!location) {
                return response;
            }

            if (redirectCount >= MAX_REDIRECTS) {
                await response.body?.cancel();
                throw new Error('Webhook redirect limit exceeded');
            }

            await response.body?.cancel();
            const method = String(currentInit.method ?? 'GET').toUpperCase();
            const shouldSwitchToGet =
                (response.status === 303 && method !== 'GET' && method !== 'HEAD') ||
                ((response.status === 301 || response.status === 302) &&
                    method === 'POST');
            if (shouldSwitchToGet) {
                const headers = new Headers(currentInit.headers);
                for (const header of [
                    'content-encoding',
                    'content-language',
                    'content-length',
                    'content-location',
                    'content-type',
                ]) {
                    headers.delete(header);
                }
                currentInit = {
                    ...currentInit,
                    method: 'GET',
                    body: undefined,
                    headers,
                };
            }

            try {
                currentUrl = new URL(location, parsedUrl).toString();
            } catch {
                throw new Error('Webhook redirect target is invalid');
            }
        }
    }

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
            const response = await fetchWithValidatedRedirects(targetUrl, {
                method: 'POST',
                headers,
                body,
                signal: controller.signal,
                dispatcher: agent as never,
            });

            const responseBody = await readResponsePrefix(response);
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
        if (!webhook || !webhook.enabled || !await webhookHasCurrentAccess(store, webhook)) {
            await store.updateDeliveryLog(log.id, {
                status: 'cancelled',
                next_retry_at: null,
            });
            return;
        }

        const admission = checkWebhookRateLimit(webhook.id, config.rateLimitPerMinute);
        if (!admission.allowed) {
            await store.updateDeliveryLog(log.id, { status: 'pending', next_retry_at: admission.resetAt, error_message: 'Rate limit exceeded; delivery deferred' });
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

    return {
        async enqueue(job) {
            const webhook = await store.getWebhook(job.webhookId);
            if (!webhook || !webhook.enabled || !await webhookHasCurrentAccess(store, webhook)) return;
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
                const results = await Promise.allSettled(workers);
                const failed = results.find(result => result.status === 'rejected');
                if (failed?.status === 'rejected') throw failed.reason;
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
                    void this.claimAndProcess().catch(error => console.warn('[webhooks] Delivery poll failed', error));
                }, pollIntervalMs);
            }

            if (!reaperInterval) {
                reaperInterval = setInterval(() => {
                    void store.resetStaleInFlightDeliveries(STALE_IN_FLIGHT_MS).catch(error => console.warn('[webhooks] Reaper failed', error));
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
            void (agent as unknown as { close?: () => Promise<void> }).close?.().catch(error => console.warn('[webhooks] Agent close failed', error));
        },
    };
}
