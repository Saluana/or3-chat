/* @vitest-environment node */
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import type { H3Event } from 'h3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { decryptSecret, encryptSecret } from '../../../utils/webhooks/crypto';
import {
    getWebhookStore,
    registerWebhookStore,
} from '../../../utils/webhooks/store/registry';
import { createSqliteWebhookStore } from 'or3-provider-sqlite/webhooks/sqlite-store';
import type {
    WebhookDeliveryLog,
    WebhookRegistration,
    WebhookStore,
} from '../../../utils/webhooks/store/types';

const {
    readBodyMock,
    getRouterParamMock,
    getQueryMock,
    useRuntimeConfigMock,
    resolveSessionContextMock,
    requireCanMock,
    requireSessionMock,
    sendTestPingMock,
    stopDispatcherMock,
    createWebhookDispatcherMock,
} = vi.hoisted(() => ({
    readBodyMock: vi.fn(),
    getRouterParamMock: vi.fn(),
    getQueryMock: vi.fn(),
    useRuntimeConfigMock: vi.fn(),
    resolveSessionContextMock: vi.fn(),
    requireCanMock: vi.fn(),
    requireSessionMock: vi.fn(),
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

vi.mock('../../../auth/session', () => ({
    resolveSessionContext: resolveSessionContextMock as typeof resolveSessionContextMock,
}));

vi.mock('../../../auth/can', () => ({
    requireCan: requireCanMock as typeof requireCanMock,
    requireSession: requireSessionMock as typeof requireSessionMock,
}));

vi.mock('../../../utils/webhooks/dispatcher', async () => {
    const actual =
        await vi.importActual<typeof import('../../../utils/webhooks/dispatcher')>(
            '../../../utils/webhooks/dispatcher'
        );

    return {
        ...actual,
        createWebhookDispatcher:
            createWebhookDispatcherMock as typeof createWebhookDispatcherMock,
    };
});

const TEST_STORE_ID = 'test-webhook-store';
const TEST_ENCRYPTION_KEY = 'test-webhook-encryption-key';
const openDatabases = new Set<InstanceType<typeof Database>>();

type RuntimeConfig = ReturnType<typeof createRuntimeConfig>;

let runtimeConfig: RuntimeConfig;

function createRuntimeConfig() {
    return {
        auth: {
            enabled: true,
        },
        security: {
            forceHttps: false,
        },
        webhooks: {
            enabled: true,
            maxPerUser: 20,
            rateLimitPerMinute: 120,
            deliveryTimeoutMs: 10_000,
            blockPrivateIps: false,
            encryptionKey: TEST_ENCRYPTION_KEY,
            maxRetryHours: 1,
            logRetentionHours: 72,
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

function createWebhookInput(
    overrides: Partial<
        Omit<WebhookRegistration, 'id' | 'health' | 'created_at' | 'updated_at'>
    > = {}
): Omit<WebhookRegistration, 'id' | 'health' | 'created_at' | 'updated_at'> {
    return {
        scope: 'user',
        user_id: 'user-1',
        workspace_id: 'ws-1',
        url: 'https://example.com/hooks/main',
        label: 'Primary',
        events: ['thread.created'],
        custom_hooks: [],
        signing_secret_enc: encryptSecret('whs_seed_secret', TEST_ENCRYPTION_KEY),
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
        next_retry_at: Date.now(),
        created_at: Date.now(),
        ...overrides,
    };
}

function getRegisteredStore(): WebhookStore {
    const store = getWebhookStore(TEST_STORE_ID);
    if (!store) {
        throw new Error('Missing test webhook store');
    }

    return store;
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
    resolveSessionContextMock.mockReset().mockResolvedValue({
        authenticated: true,
        user: { id: 'user-1' },
        workspace: { id: 'ws-1' },
    });
    requireCanMock.mockReset();
    requireSessionMock.mockReset().mockImplementation((session?: { authenticated?: boolean }) => {
        if (!session?.authenticated) {
            const error = new Error('Unauthorized') as Error & { statusCode: number };
            error.statusCode = 401;
            throw error;
        }

        return session;
    });

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

describe('user webhook API routes', () => {
    it('bulk-disables only the current user workspace webhooks and returns the count', async () => {
        const store = getRegisteredStore();
        const first = await store.createWebhook(createWebhookInput());
        const second = await store.createWebhook(
            createWebhookInput({
                url: 'https://example.com/hooks/second',
                label: 'Second',
            })
        );
        const otherUser = await store.createWebhook(
            createWebhookInput({
                user_id: 'user-2',
                url: 'https://example.com/hooks/other-user',
            })
        );
        const otherWorkspace = await store.createWebhook(
            createWebhookInput({
                workspace_id: 'ws-2',
                url: 'https://example.com/hooks/other-workspace',
            })
        );

        const handler =
            (await import('../disable-all.post')).default as (
                event: H3Event
            ) => Promise<{ disabled: number }>;
        const result = await handler(makeEvent());

        expect(result).toEqual({ disabled: 2 });
        expect((await store.getWebhook(first.id))?.enabled).toBe(false);
        expect((await store.getWebhook(second.id))?.enabled).toBe(false);
        expect((await store.getWebhook(otherUser.id))?.enabled).toBe(true);
        expect((await store.getWebhook(otherWorkspace.id))?.enabled).toBe(true);
    });

    it('returns 401 for unauthenticated disable-all requests', async () => {
        const handler =
            (await import('../disable-all.post')).default as (
                event: H3Event
            ) => Promise<unknown>;
        resolveSessionContextMock.mockResolvedValue({
            authenticated: false,
        });

        await expect(handler(makeEvent())).rejects.toMatchObject({ statusCode: 401 });
    });

    it('supports the full CRUD lifecycle and removes delivery logs on delete', async () => {
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
            ) => Promise<{
                webhooks: Array<Omit<WebhookRegistration, 'signing_secret_enc'>>;
            }>;
        const patchHandler =
            (await import('../[id].patch')).default as (
                event: H3Event
            ) => Promise<{
                webhook: Omit<WebhookRegistration, 'signing_secret_enc'>;
            }>;
        const toggleHandler =
            (await import('../[id]/toggle.post')).default as (
                event: H3Event
            ) => Promise<{
                webhook: Omit<WebhookRegistration, 'signing_secret_enc'>;
            }>;
        const deleteHandler =
            (await import('../[id].delete')).default as (
                event: H3Event
            ) => Promise<{ ok: true }>;

        const created = await createHandler(
            makeEvent({
                body: {
                    url: 'http://example.com/hooks/create',
                    label: 'Created',
                    events: ['thread.created', 'message.created'],
                },
            })
        );
        const store = getRegisteredStore();
        const stored = await store.getWebhook(created.webhook.id);

        expect(created.signing_secret).toMatch(/^whs_[a-f0-9]{64}$/);
        expect(stored).toBeTruthy();
        expect(stored?.signing_secret_enc).not.toBe(created.signing_secret);
        expect(
            decryptSecret(stored?.signing_secret_enc ?? '', TEST_ENCRYPTION_KEY)
        ).toBe(created.signing_secret);

        const listed = await listHandler(makeEvent());
        expect(listed.webhooks).toEqual([
            expect.objectContaining({
                id: created.webhook.id,
                url: 'http://example.com/hooks/create',
                label: 'Created',
                events: ['thread.created', 'message.created'],
            }),
        ]);
        expect(
            Object.prototype.hasOwnProperty.call(listed.webhooks[0] ?? {}, 'signing_secret_enc')
        ).toBe(false);

        await store.updateWebhookHealth(created.webhook.id, 'healthy');
        const patched = await patchHandler(
            makeEvent({
                params: {
                    id: created.webhook.id,
                },
                body: {
                    url: 'http://example.com/hooks/updated',
                    label: 'Updated',
                    events: ['thread.updated'],
                },
            })
        );
        expect(patched.webhook).toEqual(
            expect.objectContaining({
                id: created.webhook.id,
                url: 'http://example.com/hooks/updated',
                label: 'Updated',
                events: ['thread.updated'],
                health: 'unknown',
            })
        );

        const toggledOff = await toggleHandler(
            makeEvent({
                params: {
                    id: created.webhook.id,
                },
            })
        );
        expect(toggledOff.webhook.enabled).toBe(false);

        const toggledOn = await toggleHandler(
            makeEvent({
                params: {
                    id: created.webhook.id,
                },
                body: {
                    enabled: true,
                },
            })
        );
        expect(toggledOn.webhook.enabled).toBe(true);

        await store.createDeliveryLog(
            createDeliveryLogInput(created.webhook.id, {
                status: 'success',
                next_retry_at: null,
                created_at: Date.now(),
            })
        );

        await expect(
            deleteHandler(
                makeEvent({
                    params: {
                        id: created.webhook.id,
                    },
                })
            )
        ).resolves.toEqual({ ok: true });

        expect(await store.getWebhook(created.webhook.id)).toBeNull();
        expect(await store.getDeliveryLogs(created.webhook.id, 0)).toEqual([]);
    });

    it('returns validation errors for bad input and enforced limits', async () => {
        const createHandler =
            (await import('../index.post')).default as (
                event: H3Event
            ) => Promise<unknown>;

        await expect(
            createHandler(
                makeEvent({
                    body: {
                        url: 'not-a-url',
                        label: 'Bad',
                        events: ['thread.created'],
                    },
                })
            )
        ).rejects.toMatchObject({
            statusCode: 400,
            statusMessage: 'Invalid webhook URL',
        });

        await expect(
            createHandler(
                makeEvent({
                    body: {
                        url: 'http://example.com/hooks/empty',
                        events: [],
                    },
                })
            )
        ).rejects.toMatchObject({
            statusCode: 400,
        });

        await expect(
            createHandler(
                makeEvent({
                    body: {
                        url: 'http://example.com/hooks/invalid-event',
                        events: ['webhook.test'],
                    },
                })
            )
        ).rejects.toMatchObject({
            statusCode: 400,
        });

        runtimeConfig.webhooks.maxPerUser = 1;
        await createHandler(
            makeEvent({
                body: {
                    url: 'http://example.com/hooks/limit-1',
                    events: ['thread.created'],
                },
            })
        );

        await expect(
            createHandler(
                makeEvent({
                    body: {
                        url: 'http://example.com/hooks/limit-2',
                        events: ['thread.created'],
                    },
                })
            )
        ).rejects.toMatchObject({
            statusCode: 400,
            statusMessage: 'Webhook limit exceeded',
        });
    });

    it('returns 403 when a different user attempts to mutate another user webhook', async () => {
        const store = getRegisteredStore();
        const webhook = await store.createWebhook(createWebhookInput());
        const patchHandler =
            (await import('../[id].patch')).default as (
                event: H3Event
            ) => Promise<unknown>;

        resolveSessionContextMock.mockResolvedValue({
            authenticated: true,
            user: { id: 'user-2' },
            workspace: { id: 'ws-1' },
        });

        await expect(
            patchHandler(
                makeEvent({
                    params: {
                        id: webhook.id,
                    },
                    body: {
                        label: 'nope',
                    },
                })
            )
        ).rejects.toMatchObject({ statusCode: 403 });
    });

    it('sends a test ping, returns the result, and records a successful delivery log', async () => {
        const store = getRegisteredStore();
        const webhook = await store.createWebhook(createWebhookInput());
        const handler =
            (await import('../[id]/test.post')).default as (
                event: H3Event
            ) => Promise<{
                success: boolean;
                statusCode: number | null;
                durationMs: number;
                error: string | null;
                responseBody: string | null;
            }>;

        const result = await handler(
            makeEvent({
                params: {
                    id: webhook.id,
                },
            })
        );

        expect(result).toEqual({
            success: true,
            statusCode: 200,
            durationMs: 25,
            error: null,
            responseBody: 'ok',
        });
        expect(sendTestPingMock).toHaveBeenCalledWith(
            expect.objectContaining({ id: webhook.id }),
            'whs_seed_secret',
            expect.objectContaining({ event: 'webhook.test' })
        );
        expect(stopDispatcherMock).toHaveBeenCalledTimes(1);

        const logs = await store.getDeliveryLogs(webhook.id, 0);
        expect(logs).toHaveLength(1);
        expect(logs[0]).toEqual(
            expect.objectContaining({
                event_type: 'webhook.test',
                status: 'success',
                http_status: 200,
                duration_ms: 25,
                error_message: null,
                response_body: 'ok',
            })
        );
        expect(JSON.parse(logs[0]!.request_payload)).toEqual(
            expect.objectContaining({
                event: 'webhook.test',
                data: {
                    ok: true,
                    test: true,
                },
            })
        );
    });

    it('records a failed test ping and exposes delivery logs with default and custom cutoffs', async () => {
        const store = getRegisteredStore();
        const webhook = await store.createWebhook(createWebhookInput());
        const testHandler =
            (await import('../[id]/test.post')).default as (
                event: H3Event
            ) => Promise<unknown>;
        const logsHandler =
            (await import('../[id]/logs.get')).default as (
                event: H3Event
            ) => Promise<{ logs: WebhookDeliveryLog[] }>;

        sendTestPingMock.mockResolvedValueOnce({
            success: false,
            statusCode: 502,
            durationMs: 40,
            error: 'Bad gateway',
            responseBody: 'upstream failed',
        });

        await testHandler(
            makeEvent({
                params: {
                    id: webhook.id,
                },
            })
        );

        const refreshedWebhook = await store.getWebhook(webhook.id);
        expect(refreshedWebhook?.health).toBe('failing');

        const now = Date.now();
        await store.createDeliveryLog(
            createDeliveryLogInput(webhook.id, {
                status: 'success',
                http_status: 204,
                response_body: 'fresh response',
                request_payload: '{"fresh":true}',
                next_retry_at: null,
                created_at: now - 60_000,
            })
        );
        await store.createDeliveryLog(
            createDeliveryLogInput(webhook.id, {
                status: 'failed',
                error_message: 'too old',
                response_body: 'stale response',
                request_payload: '{"stale":true}',
                next_retry_at: null,
                created_at: now - 73 * 60 * 60 * 1000,
            })
        );

        const defaultLogs = await logsHandler(
            makeEvent({
                params: {
                    id: webhook.id,
                },
            })
        );

        expect(defaultLogs.logs).toHaveLength(2);
        expect(defaultLogs.logs.every((log) => log.created_at >= now - 72 * 60 * 60 * 1000)).toBe(
            true
        );
        expect(defaultLogs.logs[0]).toEqual(
            expect.objectContaining({
                request_payload: expect.any(String),
                response_body: expect.anything(),
            })
        );

        const customLogs = await logsHandler(
            makeEvent({
                params: {
                    id: webhook.id,
                },
                query: {
                    since: String(now - 30_000),
                },
            })
        );

        expect(customLogs.logs).toHaveLength(1);
        expect(customLogs.logs[0]).toEqual(
            expect.objectContaining({
                event_type: 'webhook.test',
            })
        );

        const failedTestLog = (await store.getDeliveryLogs(webhook.id, 0)).find(
            (log) => log.event_type === 'webhook.test'
        );
        expect(failedTestLog).toEqual(
            expect.objectContaining({
                status: 'failed',
                http_status: 502,
                error_message: 'Bad gateway',
                response_body: 'upstream failed',
            })
        );
    });
});
