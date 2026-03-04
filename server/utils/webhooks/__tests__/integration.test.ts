/* @vitest-environment node */
import Database from 'better-sqlite3';
import { createHooks } from 'hookable';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { encryptSecret } from '../crypto';
import { createWebhookDispatcher } from '../dispatcher';
import { createWebhookEventBridge } from '../event-bridge';
import { signPayload } from '../signing';
import { createSqliteWebhookStore } from 'or3-provider-sqlite/webhooks/sqlite-store';
import type { WebhookRegistration, WebhookStore } from '../store/types';

const openDatabases = new Set<InstanceType<typeof Database>>();

function createStore(): WebhookStore {
    const db = new Database(':memory:');
    openDatabases.add(db);
    return createSqliteWebhookStore({ database: db });
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
        url: 'https://example.com/hooks',
        label: 'Primary',
        events: ['thread.created'],
        custom_hooks: [],
        signing_secret_enc: encryptSecret('whs_test_secret', 'test-encryption-key'),
        enabled: true,
        ...overrides,
    });
}

async function createStoredAdminWebhook(
    store: WebhookStore,
    overrides: Partial<
        Omit<WebhookRegistration, 'id' | 'health' | 'created_at' | 'updated_at'>
    > = {}
): Promise<WebhookRegistration> {
    return store.createWebhook({
        scope: 'admin',
        user_id: null,
        workspace_id: 'ws-1',
        url: 'https://example.com/admin-hooks',
        label: 'Admin',
        events: ['admin.workspace.created'],
        custom_hooks: ['db.messages.create:action:after'],
        signing_secret_enc: encryptSecret('whs_admin_secret', 'test-encryption-key'),
        enabled: true,
        ...overrides,
    });
}

afterEach(() => {
    for (const db of openDatabases) {
        db.close();
    }
    openDatabases.clear();
});

describe('webhook integration flow', () => {
    it('delivers a signed payload end-to-end and stops after disable-all', async () => {
        const store = createStore();
        const webhook = await createStoredWebhook(store);
        const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
            return new Response(
                JSON.stringify({
                    ok: true,
                    requestBody: init?.body,
                }),
                { status: 200 }
            );
        });

        const dispatcher = createWebhookDispatcher(
            store,
            {
                rateLimitPerMinute: 10,
                deliveryTimeoutMs: 1_000,
                blockPrivateIps: false,
                encryptionKey: 'test-encryption-key',
                maxRetryHours: 1,
                fetchImpl,
            },
            'worker-1'
        );
        const nitroApp: { hooks: any } = {
            hooks: createHooks<Record<string, (...args: unknown[]) => unknown>>(),
        };
        const bridge = createWebhookEventBridge(
            store,
            dispatcher,
            nitroApp as never
        );

        bridge.start();

        await nitroApp.hooks.callHook('db.threads.create:action:after', {
            id: 'thread-1',
            title: 'Hello',
            workspace_id: 'ws-1',
            user_id: 'user-1',
        });
        await dispatcher.claimAndProcess();

        expect(fetchImpl).toHaveBeenCalledTimes(1);

        const [_url, init] = fetchImpl.mock.calls[0] as [
            RequestInfo | URL,
            RequestInit,
        ];
        const headers = new Headers(init.headers);
        const body = String(init.body);
        const timestamp = Number(headers.get('X-OR3-Timestamp'));

        expect(headers.get('X-OR3-Event')).toBe('thread.created');
        expect(headers.get('X-OR3-Signature')).toBe(
            signPayload(body, 'whs_test_secret', timestamp)
        );
        expect(JSON.parse(body)).toMatchObject({
            event: 'thread.created',
            workspace_id: 'ws-1',
            user_id: 'user-1',
            data: {
                id: 'thread-1',
                title: 'Hello',
            },
        });

        const firstLogs = await store.getDeliveryLogs(webhook.id, 0);
        expect(firstLogs).toHaveLength(1);
        expect(firstLogs[0]?.status).toBe('success');

        await store.disableAllWebhooks('user-1', 'ws-1');

        await nitroApp.hooks.callHook('db.threads.create:action:after', {
            id: 'thread-2',
            title: 'Blocked',
            workspace_id: 'ws-1',
            user_id: 'user-1',
        });
        await dispatcher.claimAndProcess();

        const finalLogs = await store.getDeliveryLogs(webhook.id, 0);
        expect(finalLogs).toHaveLength(1);
        expect(fetchImpl).toHaveBeenCalledTimes(1);

        bridge.stop();
    });

    it('delivers curated and custom admin webhooks with workspace filtering and signatures', async () => {
        const store = createStore();
        await createStoredAdminWebhook(store);
        const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
            return new Response(String(init?.body ?? ''), { status: 200 });
        });

        const dispatcher = createWebhookDispatcher(
            store,
            {
                rateLimitPerMinute: 10,
                deliveryTimeoutMs: 1_000,
                blockPrivateIps: false,
                encryptionKey: 'test-encryption-key',
                maxRetryHours: 1,
                fetchImpl,
            },
            'worker-1'
        );
        const nitroApp: { hooks: any } = {
            hooks: createHooks<Record<string, (...args: unknown[]) => unknown>>(),
        };
        const bridge = createWebhookEventBridge(
            store,
            dispatcher,
            nitroApp as never
        );

        bridge.start();
        await bridge.refreshCustomHookListeners();

        await nitroApp.hooks.callHook('admin.workspace:action:created', {
            id: 'ws-other',
            workspaceId: 'ws-other',
        });
        await dispatcher.claimAndProcess();
        expect(fetchImpl).not.toHaveBeenCalled();

        await nitroApp.hooks.callHook('admin.workspace:action:created', {
            id: 'ws-1',
            workspaceId: 'ws-1',
        });
        await dispatcher.claimAndProcess();

        let [, init] = fetchImpl.mock.calls[0] as [RequestInfo | URL, RequestInit];
        let headers = new Headers(init.headers);
        let body = String(init.body);
        let timestamp = Number(headers.get('X-OR3-Timestamp'));
        expect(headers.get('X-OR3-Signature')).toBe(
            signPayload(body, 'whs_admin_secret', timestamp)
        );
        expect(JSON.parse(body)).toMatchObject({
            event: 'admin.workspace.created',
            scope: 'admin',
            workspace_id: 'ws-1',
            data: {
                workspace_id: 'ws-1',
            },
        });
        expect(JSON.parse(body)).not.toHaveProperty('user_id');

        await nitroApp.hooks.callHook(
            'db.messages.create:action:after',
            { id: 'msg-1', workspace_id: 'ws-1' },
            { actor: 'system' }
        );
        await dispatcher.claimAndProcess();

        expect(fetchImpl).toHaveBeenCalledTimes(2);
        [, init] = fetchImpl.mock.calls[1] as [RequestInfo | URL, RequestInit];
        headers = new Headers(init.headers);
        body = String(init.body);
        timestamp = Number(headers.get('X-OR3-Timestamp'));
        expect(headers.get('X-OR3-Signature')).toBe(
            signPayload(body, 'whs_admin_secret', timestamp)
        );
        expect(JSON.parse(body)).toMatchObject({
            event: 'db.messages.create:action:after',
            scope: 'admin',
            data: {
                args: [
                    { id: 'msg-1', workspace_id: 'ws-1' },
                    { actor: 'system' },
                ],
            },
        });

        bridge.stop();
    });
});
