/* @vitest-environment node */
import { createHmac, randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { encryptSecret } from '../crypto';
import { createWebhookDispatcher } from '../dispatcher';
import { resetNotificationEmitters, registerNotificationEmitter } from '../../notifications/registry';
import { createSqliteWebhookStore } from 'or3-provider-sqlite/webhooks/sqlite-store';
import type { WebhookRegistration, WebhookStore } from '../store/types';

type TestContext = {
    db: InstanceType<typeof Database>;
    store: WebhookStore;
};

const openDatabases = new Set<InstanceType<typeof Database>>();

function createTestContext(): TestContext {
    const db = new Database(':memory:');
    openDatabases.add(db);
    return {
        db,
        store: createSqliteWebhookStore({ database: db }),
    };
}

async function createStoredWebhook(
    store: WebhookStore,
    overrides: Partial<
        Omit<WebhookRegistration, 'id' | 'health' | 'created_at' | 'updated_at'>
    > = {}
): Promise<WebhookRegistration> {
    return store.createWebhook({
        scope: 'user',
        user_id: 'user-1',
        workspace_id: 'ws-1',
        url: 'https://example.com/webhooks',
        label: 'Primary',
        events: ['thread.created'],
        custom_hooks: [],
        signing_secret_enc: encryptSecret('whs_test_secret', 'test-encryption-key'),
        enabled: true,
        ...overrides,
    });
}

afterEach(() => {
    for (const db of openDatabases) {
        db.close();
    }
    openDatabases.clear();
    resetNotificationEmitters();
    vi.useRealTimers();
});

beforeEach(() => {
    resetNotificationEmitters();
});

describe('webhook dispatcher', () => {
    it('delivers to a public target after an immediate DNS safety check', async () => {
        const { store } = createTestContext();
        const webhook = await createStoredWebhook(store, {
            url: 'https://public.example/webhooks',
        });
        const fetchImpl = vi.fn(async () => new Response('ok', { status: 200 }));
        const dispatcher = createWebhookDispatcher(
            store,
            {
                rateLimitPerMinute: 10,
                deliveryTimeoutMs: 1000,
                blockPrivateIps: true,
                encryptionKey: 'test-encryption-key',
                maxRetryHours: 1,
                urlResolver: async () => [{ address: '8.8.8.8', family: 4 }],
                fetchImpl,
            },
            'worker-1'
        );

        await dispatcher.enqueue({
            webhookId: webhook.id,
            eventType: 'thread.created',
            eventId: randomUUID(),
            payload: { ok: true },
        });
        await dispatcher.claimAndProcess();

        const [log] = await store.getDeliveryLogs(webhook.id, 0);
        expect(fetchImpl).toHaveBeenCalledTimes(1);
        expect(log).toMatchObject({ status: 'success', http_status: 200 });
    });

    it('enqueues deliveries without performing network I/O on the request path', async () => {
        const { store } = createTestContext();
        const webhook = await createStoredWebhook(store);
        const fetchImpl = vi.fn(async () => new Response('ok', { status: 200 }));
        const dispatcher = createWebhookDispatcher(
            store,
            {
                rateLimitPerMinute: 10,
                deliveryTimeoutMs: 1000,
                blockPrivateIps: false,
                encryptionKey: 'test-encryption-key',
                maxRetryHours: 1,
                fetchImpl,
            },
            'worker-1'
        );

        await dispatcher.enqueue({
            webhookId: webhook.id,
            eventType: 'thread.created',
            eventId: randomUUID(),
            payload: { ok: true },
        });

        const [log] = await store.getDeliveryLogs(webhook.id, 0);
        expect(fetchImpl).not.toHaveBeenCalled();
        expect(log?.status).toBe('pending');
    });

    it('marks successful deliveries as success', async () => {
        const { store } = createTestContext();
        const webhook = await createStoredWebhook(store);
        const fetchImpl = vi.fn(async () => new Response('ok', { status: 200 }));
        const dispatcher = createWebhookDispatcher(
            store,
            {
                rateLimitPerMinute: 10,
                deliveryTimeoutMs: 1000,
                blockPrivateIps: false,
                encryptionKey: 'test-encryption-key',
                maxRetryHours: 1,
                fetchImpl,
            },
            'worker-1'
        );

        await dispatcher.enqueue({
            webhookId: webhook.id,
            eventType: 'thread.created',
            eventId: randomUUID(),
            payload: {
                ok: true,
            },
        });
        await dispatcher.claimAndProcess();

        const [log] = await store.getDeliveryLogs(webhook.id, 0);
        expect(fetchImpl).toHaveBeenCalledTimes(1);
        expect(log).toMatchObject({
            status: 'success',
            http_status: 200,
            response_body: 'ok',
        });
    });

    it('schedules a retry with the expected backoff after failure', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-03-01T12:00:00.000Z'));

        const { store } = createTestContext();
        const webhook = await createStoredWebhook(store);
        const dispatcher = createWebhookDispatcher(
            store,
            {
                rateLimitPerMinute: 10,
                deliveryTimeoutMs: 1000,
                blockPrivateIps: false,
                encryptionKey: 'test-encryption-key',
                maxRetryHours: 1,
                fetchImpl: vi.fn(async () => new Response('nope', { status: 500 })),
            },
            'worker-1'
        );

        await dispatcher.enqueue({
            webhookId: webhook.id,
            eventType: 'thread.created',
            eventId: randomUUID(),
            payload: { ok: true },
        });
        await dispatcher.claimAndProcess();

        const [log] = await store.getDeliveryLogs(webhook.id, 0);
        expect(log).toBeDefined();
        expect(log!.status).toBe('pending');
        expect(log!.attempt).toBe(2);
        expect(log!.next_retry_at).toBe(Date.now() + 30_000);
    });

    it('preserves replay identity and raw payload while re-signing each retry', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-03-01T12:00:00.000Z'));

        const { store } = createTestContext();
        const webhook = await createStoredWebhook(store);
        const eventId = 'evt-retry-stable';
        const payload = {
            event: 'thread.created',
            event_id: eventId,
            timestamp: '2026-03-01T12:00:00.000Z',
            workspace_id: 'ws-1',
            user_id: 'user-1',
            data: { id: 'thread-1' },
        };
        const fetchImpl = vi
            .fn()
            .mockResolvedValueOnce(new Response('retry', { status: 503 }))
            .mockResolvedValueOnce(new Response('ok', { status: 200 }));
        const dispatcher = createWebhookDispatcher(
            store,
            {
                rateLimitPerMinute: 10,
                deliveryTimeoutMs: 1000,
                blockPrivateIps: false,
                encryptionKey: 'test-encryption-key',
                maxRetryHours: 1,
                fetchImpl,
            },
            'worker-1'
        );

        await dispatcher.enqueue({
            webhookId: webhook.id,
            eventType: 'thread.created',
            eventId,
            payload,
        });
        await dispatcher.claimAndProcess();

        vi.setSystemTime(new Date('2026-03-01T12:00:30.000Z'));
        await dispatcher.claimAndProcess();

        expect(fetchImpl).toHaveBeenCalledTimes(2);
        const attempts = fetchImpl.mock.calls.map(([, init]) => {
            const headers = new Headers(init.headers);
            return {
                body: String(init.body),
                eventId: headers.get('X-OR3-Event-ID'),
                timestamp: Number(headers.get('X-OR3-Timestamp')),
                signature: headers.get('X-OR3-Signature'),
            };
        });

        expect(attempts[0]?.body).toBe(JSON.stringify(payload));
        expect(attempts[1]?.body).toBe(attempts[0]?.body);
        expect(attempts.map((attempt) => attempt.eventId)).toEqual([
            eventId,
            eventId,
        ]);
        expect(attempts[1]!.timestamp).toBeGreaterThan(attempts[0]!.timestamp);
        expect(attempts[1]!.signature).not.toBe(attempts[0]!.signature);

        for (const attempt of attempts) {
            expect(attempt.signature).toBe(
                `sha256=${createHmac('sha256', 'whs_test_secret')
                    .update(`${attempt.timestamp}.${attempt.body}`)
                    .digest('hex')}`
            );
        }

        const [log] = await store.getDeliveryLogs(webhook.id, 0);
        expect(log).toMatchObject({
            event_id: eventId,
            attempt: 2,
            status: 'success',
        });
    });

    it('marks final failures and emits a notification', async () => {
        const { store } = createTestContext();
        const webhook = await createStoredWebhook(store);
        const notificationSpy = vi.fn(async () => null);

        registerNotificationEmitter('test', {
            emitBackgroundJobComplete: async () => null,
            emitBackgroundJobError: async () => null,
            emitWebhookDeliveryFailed: notificationSpy,
        });

        await store.createDeliveryLog({
            webhook_id: webhook.id,
            event_id: randomUUID(),
            event_type: 'thread.created',
            attempt: 6,
            status: 'pending',
            claimed_by: null,
            claimed_at: null,
            http_status: null,
            error_message: null,
            request_payload: '{"ok":true}',
            response_body: null,
            duration_ms: null,
            next_retry_at: Date.now() - 1,
            created_at: Date.now(),
        });

        const dispatcher = createWebhookDispatcher(
            store,
            {
                rateLimitPerMinute: 10,
                deliveryTimeoutMs: 1000,
                blockPrivateIps: false,
                encryptionKey: 'test-encryption-key',
                maxRetryHours: 1,
                fetchImpl: vi.fn(async () => new Response('fail', { status: 500 })),
            },
            'worker-1'
        );

        await dispatcher.claimAndProcess();

        const [log] = await store.getDeliveryLogs(webhook.id, 0);
        expect(log).toBeDefined();
        expect(log!.status).toBe('failed');
        expect(notificationSpy).toHaveBeenCalledTimes(1);
    });

    it('cancels deliveries when the webhook is disabled before processing', async () => {
        const { store } = createTestContext();
        const webhook = await createStoredWebhook(store, {
            enabled: false,
        });
        const dispatcher = createWebhookDispatcher(
            store,
            {
                rateLimitPerMinute: 10,
                deliveryTimeoutMs: 1000,
                blockPrivateIps: false,
                encryptionKey: 'test-encryption-key',
                maxRetryHours: 1,
                fetchImpl: vi.fn(async () => new Response('ok', { status: 200 })),
            },
            'worker-1'
        );

        await store.createDeliveryLog({
            webhook_id: webhook.id,
            event_id: randomUUID(),
            event_type: 'thread.created',
            attempt: 2,
            status: 'pending',
            claimed_by: null,
            claimed_at: null,
            http_status: null,
            error_message: null,
            request_payload: '{"ok":true}',
            response_body: null,
            duration_ms: null,
            next_retry_at: Date.now() - 1,
            created_at: Date.now(),
        });

        await dispatcher.claimAndProcess();

        const [log] = await store.getDeliveryLogs(webhook.id, 0);
        expect(log).toBeDefined();
        expect(log!.status).toBe('cancelled');
    });

    it('sends a test ping and returns the result shape', async () => {
        const { store } = createTestContext();
        const webhook = await createStoredWebhook(store, {
            scope: 'admin',
            user_id: null,
        });
        const dispatcher = createWebhookDispatcher(
            store,
            {
                rateLimitPerMinute: 10,
                deliveryTimeoutMs: 1000,
                blockPrivateIps: false,
                encryptionKey: 'test-encryption-key',
                maxRetryHours: 1,
                fetchImpl: vi.fn(async () => new Response('pong', { status: 202 })),
            },
            'worker-1'
        );

        const result = await dispatcher.sendTestPing(webhook, 'whs_test_secret');
        expect(result).toMatchObject({
            success: true,
            statusCode: 202,
        });
    });

    it('records rate-limited events as cancelled logs', async () => {
        const { store } = createTestContext();
        const webhook = await createStoredWebhook(store);
        const dispatcher = createWebhookDispatcher(
            store,
            {
                rateLimitPerMinute: 1,
                deliveryTimeoutMs: 1000,
                blockPrivateIps: false,
                encryptionKey: 'test-encryption-key',
                maxRetryHours: 1,
                fetchImpl: vi.fn(async () => new Response('ok', { status: 200 })),
            },
            'worker-1'
        );

        await dispatcher.enqueue({
            webhookId: webhook.id,
            eventType: 'thread.created',
            eventId: randomUUID(),
            payload: { ok: true },
        });
        await dispatcher.enqueue({
            webhookId: webhook.id,
            eventType: 'thread.created',
            eventId: randomUUID(),
            payload: { ok: true },
        });

        const logs = await store.getDeliveryLogs(webhook.id, 0);
        expect(logs).toHaveLength(2);
        expect(logs[0]).toMatchObject({
            status: 'cancelled',
        });
        expect(logs[0]?.error_message).toContain('Rate limit exceeded');
        expect(logs[1]).toMatchObject({
            status: 'pending',
        });
    });

    it('blocks private IPs at dispatch time when SSRF protection is enabled', async () => {
        const { store } = createTestContext();
        const webhook = await createStoredWebhook(store, {
            url: 'http://127.0.0.1/webhooks',
        });
        const dispatcher = createWebhookDispatcher(
            store,
            {
                rateLimitPerMinute: 10,
                deliveryTimeoutMs: 1000,
                blockPrivateIps: true,
                encryptionKey: 'test-encryption-key',
                maxRetryHours: 1,
            },
            'worker-1'
        );

        await dispatcher.enqueue({
            webhookId: webhook.id,
            eventType: 'thread.created',
            eventId: randomUUID(),
            payload: { ok: true },
        });
        await dispatcher.claimAndProcess();

        const [log] = await store.getDeliveryLogs(webhook.id, 0);
        expect(log).toBeDefined();
        expect(log!.status).toBe('pending');
        expect(log!.error_message?.toLowerCase()).toContain('private ip');
    });

    it('blocks a public hostname that resolves to a private address at delivery time', async () => {
        const { store } = createTestContext();
        const webhook = await createStoredWebhook(store, {
            url: 'https://rebind.example/webhooks',
        });
        const fetchImpl = vi.fn(async () => new Response('ok', { status: 200 }));
        const dispatcher = createWebhookDispatcher(
            store,
            {
                rateLimitPerMinute: 10,
                deliveryTimeoutMs: 1000,
                blockPrivateIps: true,
                encryptionKey: 'test-encryption-key',
                maxRetryHours: 1,
                urlResolver: async () => [{ address: '10.0.0.9', family: 4 }],
                fetchImpl,
            },
            'worker-1'
        );

        await dispatcher.enqueue({
            webhookId: webhook.id,
            eventType: 'thread.created',
            eventId: randomUUID(),
            payload: { ok: true },
        });
        await dispatcher.claimAndProcess();

        const [log] = await store.getDeliveryLogs(webhook.id, 0);
        expect(fetchImpl).not.toHaveBeenCalled();
        expect(log).toMatchObject({ status: 'pending' });
        expect(log?.error_message?.toLowerCase()).toContain('private ip');
    });

    it('rejects redirects to unsafe targets before following them', async () => {
        const { store } = createTestContext();
        const webhook = await createStoredWebhook(store, {
            url: 'https://public.example/webhooks',
        });
        const fetchImpl = vi.fn(async () =>
            new Response(null, {
                status: 302,
                headers: { location: 'http://127.0.0.1/internal' },
            })
        );
        const dispatcher = createWebhookDispatcher(
            store,
            {
                rateLimitPerMinute: 10,
                deliveryTimeoutMs: 1000,
                blockPrivateIps: true,
                encryptionKey: 'test-encryption-key',
                maxRetryHours: 1,
                urlResolver: async () => [{ address: '8.8.8.8', family: 4 }],
                fetchImpl,
            },
            'worker-1'
        );

        await dispatcher.enqueue({
            webhookId: webhook.id,
            eventType: 'thread.created',
            eventId: randomUUID(),
            payload: { ok: true },
        });
        await dispatcher.claimAndProcess();

        const [log] = await store.getDeliveryLogs(webhook.id, 0);
        expect(fetchImpl).toHaveBeenCalledTimes(1);
        expect(log).toMatchObject({ status: 'pending' });
        expect(log?.error_message?.toLowerCase()).toContain('private ip');
    });

    it('matches fetch redirect semantics by switching POST to bodyless GET on 302', async () => {
        const { store } = createTestContext();
        const webhook = await createStoredWebhook(store, {
            url: 'https://public.example/webhooks',
        });
        const fetchImpl = vi
            .fn()
            .mockResolvedValueOnce(
                new Response(null, {
                    status: 302,
                    headers: { location: 'https://public.example/redirected' },
                })
            )
            .mockResolvedValueOnce(new Response('ok', { status: 200 }));
        const dispatcher = createWebhookDispatcher(
            store,
            {
                rateLimitPerMinute: 10,
                deliveryTimeoutMs: 1000,
                blockPrivateIps: true,
                encryptionKey: 'test-encryption-key',
                maxRetryHours: 1,
                urlResolver: async () => [{ address: '8.8.8.8', family: 4 }],
                fetchImpl,
            },
            'worker-1'
        );

        await dispatcher.enqueue({
            webhookId: webhook.id,
            eventType: 'thread.created',
            eventId: randomUUID(),
            payload: { ok: true },
        });
        await dispatcher.claimAndProcess();

        expect(fetchImpl).toHaveBeenCalledTimes(2);
        const redirectedInit = fetchImpl.mock.calls[1]?.[1];
        expect(redirectedInit?.method).toBe('GET');
        expect(redirectedInit?.body).toBeUndefined();
        expect(new Headers(redirectedInit?.headers).has('content-type')).toBe(false);
        const [log] = await store.getDeliveryLogs(webhook.id, 0);
        expect(log).toMatchObject({ status: 'success', http_status: 200 });
    });

    it('preserves POST method and body across a 307 redirect', async () => {
        const { store } = createTestContext();
        const webhook = await createStoredWebhook(store, {
            url: 'https://public.example/webhooks',
        });
        const fetchImpl = vi
            .fn()
            .mockResolvedValueOnce(
                new Response(null, {
                    status: 307,
                    headers: { location: 'https://public.example/redirected' },
                })
            )
            .mockResolvedValueOnce(new Response('ok', { status: 200 }));
        const dispatcher = createWebhookDispatcher(
            store,
            {
                rateLimitPerMinute: 10,
                deliveryTimeoutMs: 1000,
                blockPrivateIps: true,
                encryptionKey: 'test-encryption-key',
                maxRetryHours: 1,
                urlResolver: async () => [{ address: '8.8.8.8', family: 4 }],
                fetchImpl,
            },
            'worker-1'
        );

        await dispatcher.enqueue({
            webhookId: webhook.id,
            eventType: 'thread.created',
            eventId: randomUUID(),
            payload: { ok: true },
        });
        await dispatcher.claimAndProcess();

        expect(fetchImpl).toHaveBeenCalledTimes(2);
        const firstInit = fetchImpl.mock.calls[0]?.[1];
        const redirectedInit = fetchImpl.mock.calls[1]?.[1];
        expect(redirectedInit?.method).toBe('POST');
        expect(redirectedInit?.body).toBe(firstInit?.body);
        expect(new Headers(redirectedInit?.headers).has('content-type')).toBe(true);
        const [log] = await store.getDeliveryLogs(webhook.id, 0);
        expect(log).toMatchObject({ status: 'success', http_status: 200 });
    });

    it('does not process the same delivery twice across concurrent dispatchers', async () => {
        const { store } = createTestContext();
        const webhook = await createStoredWebhook(store);
        const fetchImpl = vi.fn(async () => new Response('ok', { status: 200 }));

        await store.createDeliveryLog({
            webhook_id: webhook.id,
            event_id: randomUUID(),
            event_type: 'thread.created',
            attempt: 1,
            status: 'pending',
            claimed_by: null,
            claimed_at: null,
            http_status: null,
            error_message: null,
            request_payload: '{"ok":true}',
            response_body: null,
            duration_ms: null,
            next_retry_at: Date.now() - 1,
            created_at: Date.now(),
        });

        const dispatcherA = createWebhookDispatcher(
            store,
            {
                rateLimitPerMinute: 10,
                deliveryTimeoutMs: 1000,
                blockPrivateIps: false,
                encryptionKey: 'test-encryption-key',
                maxRetryHours: 1,
                fetchImpl,
            },
            'worker-a'
        );
        const dispatcherB = createWebhookDispatcher(
            store,
            {
                rateLimitPerMinute: 10,
                deliveryTimeoutMs: 1000,
                blockPrivateIps: false,
                encryptionKey: 'test-encryption-key',
                maxRetryHours: 1,
                fetchImpl,
            },
            'worker-b'
        );

        await Promise.all([
            dispatcherA.claimAndProcess(),
            dispatcherB.claimAndProcess(),
        ]);

        expect(fetchImpl).toHaveBeenCalledTimes(1);
        const [log] = await store.getDeliveryLogs(webhook.id, 0);
        expect(log).toBeDefined();
        expect(log!.status).toBe('success');
    });

    it('processes claimed deliveries with bounded concurrency', async () => {
        const { store } = createTestContext();
        const webhook = await createStoredWebhook(store);

        await store.createDeliveryLog({
            webhook_id: webhook.id,
            event_id: randomUUID(),
            event_type: 'thread.created',
            attempt: 1,
            status: 'pending',
            claimed_by: null,
            claimed_at: null,
            http_status: null,
            error_message: null,
            request_payload: '{"seq":1}',
            response_body: null,
            duration_ms: null,
            next_retry_at: Date.now() - 1,
            created_at: Date.now(),
        });
        await store.createDeliveryLog({
            webhook_id: webhook.id,
            event_id: randomUUID(),
            event_type: 'thread.created',
            attempt: 1,
            status: 'pending',
            claimed_by: null,
            claimed_at: null,
            http_status: null,
            error_message: null,
            request_payload: '{"seq":2}',
            response_body: null,
            duration_ms: null,
            next_retry_at: Date.now() - 1,
            created_at: Date.now(),
        });

        let releaseFirst: () => void = () => {};
        const firstStarted = new Promise<void>((resolve) => {
            releaseFirst = resolve;
        });
        let secondStarted = false;

        const fetchImpl = vi.fn(async (_input: string, init: RequestInit) => {
            if (String(init.body).includes('"seq":1')) {
                await firstStarted;
                return new Response('ok-1', { status: 200 });
            }
            secondStarted = true;
            return new Response('ok-2', { status: 200 });
        });

        const dispatcher = createWebhookDispatcher(
            store,
            {
                rateLimitPerMinute: 10,
                deliveryTimeoutMs: 1000,
                blockPrivateIps: false,
                encryptionKey: 'test-encryption-key',
                maxRetryHours: 1,
                deliveryConcurrency: 2,
                fetchImpl,
            },
            'worker-1'
        );

        const processing = dispatcher.claimAndProcess();
        await vi.waitFor(() => {
            expect(fetchImpl).toHaveBeenCalledTimes(2);
        });
        expect(secondStarted).toBe(true);
        releaseFirst();
        await processing;
    });

});
