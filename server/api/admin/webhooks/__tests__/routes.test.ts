/* @vitest-environment node */
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import type { H3Event } from 'h3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { decryptSecret, encryptSecret } from '../../../../utils/webhooks/crypto';
import { createWebhookEventBridge } from '../../../../utils/webhooks/event-bridge';
import {
    getWebhookStore,
    registerWebhookStore,
} from '../../../../utils/webhooks/store/registry';
import { createSqliteWebhookStore } from 'or3-provider-sqlite/webhooks/sqlite-store';
import type {
    WebhookDeliveryLog,
    WebhookRegistration,
    WebhookStore,
} from '../../../../utils/webhooks/store/types';

const {
    readBodyMock,
    getRouterParamMock,
    getQueryMock,
    useRuntimeConfigMock,
    requireAdminApiContextMock,
    refreshCustomListenersMock,
    sendTestPingMock,
    stopDispatcherMock,
    createWebhookDispatcherMock,
} = vi.hoisted(() => ({
    readBodyMock: vi.fn(),
    getRouterParamMock: vi.fn(),
    getQueryMock: vi.fn(),
    useRuntimeConfigMock: vi.fn(),
    requireAdminApiContextMock: vi.fn(),
    refreshCustomListenersMock: vi.fn(),
    sendTestPingMock: vi.fn(),
    stopDispatcherMock: vi.fn(),
    createWebhookDispatcherMock: vi.fn(),
}));

vi.mock('h3', () => ({
    defineEventHandler: (handler: unknown) => handler,
    readBody: readBodyMock,
    getRouterParam: getRouterParamMock,
    getQuery: getQueryMock,
    createError: (opts: { statusCode: number; statusMessage?: string }) => {
        const error = new Error(opts.statusMessage ?? 'Error') as Error & {
            statusCode: number;
            statusMessage?: string;
        };
        error.statusCode = opts.statusCode;
        error.statusMessage = opts.statusMessage;
        return error;
    },
}));

vi.mock('#imports', () => ({
    useRuntimeConfig: useRuntimeConfigMock as typeof useRuntimeConfigMock,
}));

vi.mock('../../../../admin/api', () => ({
    requireAdminApiContext:
        requireAdminApiContextMock as typeof requireAdminApiContextMock,
}));

vi.mock('../../../../utils/webhooks/runtime', () => ({
    refreshActiveWebhookCustomHookListeners:
        refreshCustomListenersMock as typeof refreshCustomListenersMock,
}));

vi.mock('../../../../utils/webhooks/dispatcher', async () => {
    const actual =
        await vi.importActual<
            typeof import('../../../../utils/webhooks/dispatcher')
        >('../../../../utils/webhooks/dispatcher');

    return {
        ...actual,
        createWebhookDispatcher:
            createWebhookDispatcherMock as typeof createWebhookDispatcherMock,
    };
});

const TEST_STORE_ID = 'test-admin-webhook-store';
const TEST_ENCRYPTION_KEY = 'test-admin-webhook-encryption-key';
const openDatabases = new Set<InstanceType<typeof Database>>();

type RuntimeConfig = ReturnType<typeof createRuntimeConfig>;

let runtimeConfig: RuntimeConfig;

function createRuntimeConfig() {
    return {
        webhooks: {
            enabled: true,
            adminMax: 50,
            rateLimitPerMinute: 120,
            deliveryTimeoutMs: 10_000,
            blockPrivateIps: false,
            encryptionKey: TEST_ENCRYPTION_KEY,
            maxRetryHours: 1,
            logRetentionHours: 72,
        },
        security: {
            forceHttps: false,
        },
        sync: {
            provider: TEST_STORE_ID,
        },
        public: {
            sync: {
                provider: TEST_STORE_ID,
            },
        },
    };
}

function makeEvent(input: {
    body?: unknown;
    params?: Record<string, string>;
    query?: Record<string, string | string[] | undefined>;
} = {}): H3Event {
    return {
        context: {
            body: input.body,
            params: input.params ?? {},
            query: input.query ?? {},
        },
        node: {
            req: {
                headers: {},
            },
            res: {},
        },
    } as unknown as H3Event;
}

function registerTestStore(): WebhookStore {
    const db = new Database(':memory:');
    openDatabases.add(db);
    const store = createSqliteWebhookStore({
        database: db,
    });

    registerWebhookStore({
        id: TEST_STORE_ID,
        create: () => store,
    });

    return store;
}

function getRegisteredStore(): WebhookStore {
    const store = getWebhookStore(TEST_STORE_ID);
    if (!store) {
        throw new Error('Missing test webhook store');
    }

    return store;
}

function createAdminWebhookInput(
    overrides: Partial<
        Omit<WebhookRegistration, 'id' | 'health' | 'created_at' | 'updated_at'>
    > = {}
): Omit<WebhookRegistration, 'id' | 'health' | 'created_at' | 'updated_at'> {
    return {
        scope: 'admin',
        user_id: null,
        workspace_id: null,
        url: 'https://example.com/admin-hooks/main',
        label: 'Admin Primary',
        events: ['admin.workspace.created'],
        custom_hooks: [],
        signing_secret_enc: encryptSecret('whs_admin_seed_secret', TEST_ENCRYPTION_KEY),
        enabled: true,
        ...overrides,
    };
}

function createDeliveryLogInput(
    webhookId: string,
    overrides: Partial<Omit<WebhookDeliveryLog, 'id'>> = {}
): Omit<WebhookDeliveryLog, 'id'> {
    return {
        webhook_id: webhookId,
        event_id: randomUUID(),
        event_type: 'admin.workspace.created',
        attempt: 1,
        status: 'pending',
        claimed_by: null,
        claimed_at: null,
        http_status: null,
        error_message: null,
        request_payload: '{"ok":true}',
        response_body: null,
        duration_ms: null,
        next_retry_at: Date.now(),
        created_at: Date.now(),
        ...overrides,
    };
}

function createNitroApp() {
    const listeners = new Map<string, Array<(...args: unknown[]) => unknown>>();

    return {
        hooks: {
            hook(name: string, fn: (...args: unknown[]) => unknown) {
                const bucket = listeners.get(name) ?? [];
                bucket.push(fn);
                listeners.set(name, bucket);
                return () => {
                    const current = listeners.get(name) ?? [];
                    listeners.set(
                        name,
                        current.filter((entry) => entry !== fn)
                    );
                };
            },
            async callHook(name: string, ...args: unknown[]) {
                for (const fn of listeners.get(name) ?? []) {
                    await fn(...args);
                }
            },
        },
    };
}

beforeEach(() => {
    runtimeConfig = createRuntimeConfig();
    registerTestStore();

    readBodyMock.mockReset().mockImplementation(async (event: H3Event) => {
        return (event as H3Event & { context?: { body?: unknown } }).context?.body;
    });
    getRouterParamMock.mockReset().mockImplementation((event: H3Event, key: string) => {
        return (
            (event as H3Event & { context?: { params?: Record<string, string> } })
                .context?.params?.[key] ?? null
        );
    });
    getQueryMock.mockReset().mockImplementation((event: H3Event) => {
        return (
            (event as H3Event & {
                context?: { query?: Record<string, string | string[] | undefined> };
            }).context?.query ?? {}
        );
    });

    useRuntimeConfigMock.mockReset().mockImplementation(() => runtimeConfig);
    requireAdminApiContextMock.mockReset().mockResolvedValue({
        principal: { kind: 'super_admin', username: 'root' },
    });
    refreshCustomListenersMock.mockReset().mockResolvedValue(undefined);
    sendTestPingMock.mockReset().mockResolvedValue({
        success: true,
        statusCode: 200,
        durationMs: 25,
        error: null,
        responseBody: 'ok',
    });
    stopDispatcherMock.mockReset();
    createWebhookDispatcherMock.mockReset().mockImplementation(() => ({
        enqueue: vi.fn(),
        claimAndProcess: vi.fn(),
        sendTestPing: sendTestPingMock,
        start: vi.fn(),
        stop: stopDispatcherMock,
    }));
});

afterEach(() => {
    for (const db of openDatabases) {
        db.close();
    }
    openDatabases.clear();
});

describe('admin webhook API routes', () => {
    it('supports the full admin webhook CRUD lifecycle and returns the signing secret only once', async () => {
        const createHandler =
            (await import('../index.post')).default as (
                event: H3Event
            ) => Promise<{
                webhook: Omit<WebhookRegistration, 'signing_secret_enc'>;
                signing_secret: string;
            }>;
        const listHandler =
            (await import('../index.get')).default as (
                event: H3Event
            ) => Promise<{ webhooks: Array<Omit<WebhookRegistration, 'signing_secret_enc'>> }>;
        const updateHandler =
            (await import('../[id].patch')).default as (
                event: H3Event
            ) => Promise<{ webhook: Omit<WebhookRegistration, 'signing_secret_enc'> }>;
        const toggleHandler =
            (await import('../[id]/toggle.post')).default as (
                event: H3Event
            ) => Promise<{ webhook: Omit<WebhookRegistration, 'signing_secret_enc'> }>;
        const deleteHandler =
            (await import('../[id].delete')).default as (
                event: H3Event
            ) => Promise<{ ok: true }>;

        const created = await createHandler(
            makeEvent({
                body: {
                    url: 'https://example.com/admin-hooks/created',
                    label: 'Ops hook',
                    events: ['admin.workspace.created', 'admin.job.completed'],
                    custom_hooks: ['db.messages.create:action:after'],
                    workspace_id: 'ws-42',
                },
            })
        );

        expect(created.webhook.scope).toBe('admin');
        expect(created.webhook.user_id).toBeNull();
        expect(created.webhook.custom_hooks).toEqual(['db.messages.create:action:after']);
        expect(created.signing_secret).toMatch(/^whs_/);
        expect(refreshCustomListenersMock).toHaveBeenCalledTimes(1);

        const stored = await getRegisteredStore().getWebhook(created.webhook.id);
        expect(stored).toBeTruthy();
        expect(
            decryptSecret(stored!.signing_secret_enc, TEST_ENCRYPTION_KEY)
        ).toBe(created.signing_secret);

        const listed = await listHandler(makeEvent());
        expect(listed.webhooks).toHaveLength(1);
        expect(listed.webhooks[0]).not.toHaveProperty('signing_secret_enc');

        const updated = await updateHandler(
            makeEvent({
                params: { id: created.webhook.id },
                body: {
                    label: 'Ops hook updated',
                    custom_hooks: ['db.threads.create:action:after'],
                    workspace_id: null,
                },
            })
        );

        expect(updated.webhook.label).toBe('Ops hook updated');
        expect(updated.webhook.custom_hooks).toEqual(['db.threads.create:action:after']);
        expect(updated.webhook.workspace_id).toBeNull();

        const toggled = await toggleHandler(
            makeEvent({
                params: { id: created.webhook.id },
                body: {},
            })
        );
        expect(toggled.webhook.enabled).toBe(false);

        await expect(
            deleteHandler(makeEvent({ params: { id: created.webhook.id } }))
        ).resolves.toEqual({ ok: true });
        expect(await getRegisteredStore().getWebhook(created.webhook.id)).toBeNull();
    });

    it('rejects invalid custom hook names', async () => {
        const handler =
            (await import('../index.post')).default as (
                event: H3Event
            ) => Promise<unknown>;

        await expect(
            handler(
                makeEvent({
                    body: {
                        url: 'https://example.com/admin-hooks/bad-custom',
                        events: [],
                        custom_hooks: ['not-a-real-hook'],
                    },
                })
            )
        ).rejects.toMatchObject({ statusCode: 400 });
    });

    it('enforces the admin webhook limit', async () => {
        const handler =
            (await import('../index.post')).default as (
                event: H3Event
            ) => Promise<unknown>;
        runtimeConfig.webhooks.adminMax = 1;

        await getRegisteredStore().createWebhook(createAdminWebhookInput());

        await expect(
            handler(
                makeEvent({
                    body: {
                        url: 'https://example.com/admin-hooks/overflow',
                        events: ['admin.workspace.created'],
                    },
                })
            )
        ).rejects.toMatchObject({ statusCode: 400, statusMessage: 'Admin webhook limit exceeded' });
    });

    it('denies non-admin access', async () => {
        const handler =
            (await import('../index.get')).default as (
                event: H3Event
            ) => Promise<unknown>;
        requireAdminApiContextMock.mockRejectedValueOnce(
            Object.assign(new Error('Forbidden'), { statusCode: 403 })
        );

        await expect(handler(makeEvent())).rejects.toMatchObject({ statusCode: 403 });
    });

    it('sends test pings and exposes recent delivery logs', async () => {
        const store = getRegisteredStore();
        const webhook = await store.createWebhook(
            createAdminWebhookInput({
                url: 'https://example.com/admin-hooks/testing',
            })
        );
        await store.createDeliveryLog(
            createDeliveryLogInput(webhook.id, {
                status: 'success',
                http_status: 202,
                response_body: 'ok-1',
                next_retry_at: null,
            })
        );
        await store.createDeliveryLog(
            createDeliveryLogInput(webhook.id, {
                status: 'success',
                http_status: 204,
                response_body: 'ok',
                next_retry_at: null,
            })
        );

        const testHandler =
            (await import('../[id]/test.post')).default as (
                event: H3Event
            ) => Promise<{
                success: boolean;
                statusCode: number | null;
                durationMs: number;
            }>;
        const logsHandler =
            (await import('../[id]/logs.get')).default as (
                event: H3Event
            ) => Promise<{ logs: WebhookDeliveryLog[] }>;

        const testResult = await testHandler(
            makeEvent({
                params: { id: webhook.id },
            })
        );
        expect(testResult.success).toBe(true);
        expect(sendTestPingMock).toHaveBeenCalledTimes(1);

        const refreshedWebhook = await store.getWebhook(webhook.id);
        expect(refreshedWebhook?.health).toBe('healthy');

        const logs = await logsHandler(
            makeEvent({
                params: { id: webhook.id },
            })
        );
        expect(logs.logs.length).toBeGreaterThanOrEqual(2);
        expect(logs.logs[0]?.request_payload).toContain('"event"');
    });

    it('applies workspace filters during admin event fan-out', async () => {
        const store = getRegisteredStore();
        await store.createWebhook(
            createAdminWebhookInput({
                workspace_id: 'ws-match',
                events: ['admin.workspace.created'],
            })
        );

        const enqueueMock = vi.fn().mockResolvedValue(undefined);
        const dispatcher = {
            enqueue: enqueueMock,
            claimAndProcess: vi.fn(),
            sendTestPing: vi.fn(),
            start: vi.fn(),
            stop: vi.fn(),
        };
        const nitroApp = createNitroApp();
        const bridge = createWebhookEventBridge(store, dispatcher, nitroApp as never);
        bridge.start();

        await nitroApp.hooks.callHook('admin.workspace:action:created', {
            workspaceId: 'ws-other',
            id: 'ws-other',
        });
        expect(enqueueMock).not.toHaveBeenCalled();

        await nitroApp.hooks.callHook('admin.workspace:action:created', {
            workspaceId: 'ws-match',
            id: 'ws-match',
        });
        expect(enqueueMock).toHaveBeenCalledTimes(1);

        bridge.stop();
    });
});
