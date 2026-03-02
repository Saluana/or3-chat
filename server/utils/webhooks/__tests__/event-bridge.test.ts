/* @vitest-environment node */
import { createHooks } from 'hookable';
import { describe, expect, it, vi } from 'vitest';
import {
    ADMIN_HOOK_TO_EVENT_MAP,
    USER_HOOK_TO_EVENT_MAP,
    createWebhookEventBridge,
} from '../event-bridge';
import type { WebhookDispatcher } from '../dispatcher';
import type { WebhookRegistration, WebhookStore } from '../store/types';

function createTestHarness() {
    const byEvent = new Map<string, WebhookLike[]>();
    const byCustomHook = new Map<string, WebhookLike[]>();
    let activeCustomHooks: string[] = [];

    const store: Partial<WebhookStore> = {
        listWebhooksByEvent: vi.fn(
            async (
                eventType: string,
                scope: 'user' | 'admin',
                workspaceId?: string
            ) => {
                return (
                    byEvent.get(`${scope}:${eventType}:${workspaceId ?? '*'}`) ??
                    byEvent.get(`${scope}:${eventType}`) ??
                    []
                );
            }
        ),
        listWebhooksByCustomHook: vi.fn(async (hookName: string) => {
            return byCustomHook.get(hookName) ?? [];
        }),
        listActiveCustomHookNames: vi.fn(async () => activeCustomHooks),
    };

    const dispatcher: Partial<WebhookDispatcher> = {
        enqueue: vi.fn(async () => {}),
    };

    const nitroApp = {
        hooks: createHooks<Record<string, (...args: any[]) => unknown>>(),
    } as any;

    return {
        byEvent,
        byCustomHook,
        setActiveCustomHooks(next: string[]) {
            activeCustomHooks = next;
        },
        store: store as WebhookStore,
        dispatcher: dispatcher as WebhookDispatcher,
        enqueue: dispatcher.enqueue as ReturnType<typeof vi.fn>,
        listByEvent: store.listWebhooksByEvent as ReturnType<typeof vi.fn>,
        listCustomHooks: store.listActiveCustomHookNames as ReturnType<typeof vi.fn>,
        nitroApp,
    };
}

type WebhookLike = WebhookRegistration;

function activeWebhook(
    overrides: Partial<WebhookRegistration> = {}
): WebhookRegistration {
    return {
        id: 'wh_1',
        scope: 'user',
        enabled: true,
        user_id: 'user-1',
        workspace_id: 'ws-1',
        url: 'https://example.com/webhooks',
        label: 'Primary',
        events: ['thread.created'],
        custom_hooks: [],
        signing_secret_enc: 'enc-secret',
        health: 'unknown',
        created_at: 1,
        updated_at: 1,
        ...overrides,
    };
}

describe('webhook event bridge', () => {
    it('maps all curated user hooks to their webhook event types', async () => {
        const harness = createTestHarness();
        const bridge = createWebhookEventBridge(
            harness.store,
            harness.dispatcher,
            harness.nitroApp
        );

        for (const eventType of Object.values(USER_HOOK_TO_EVENT_MAP)) {
            harness.byEvent.set(`user:${eventType}`, [activeWebhook()]);
        }

        bridge.start();

        for (const [hookName, eventType] of Object.entries(USER_HOOK_TO_EVENT_MAP)) {
            await harness.nitroApp.hooks.callHook(hookName, {
                id: `${eventType}-id`,
                workspace_id: 'ws-1',
            });
        }

        expect(harness.enqueue.mock.calls.map((call) => call[0].eventType)).toEqual(
            Object.values(USER_HOOK_TO_EVENT_MAP)
        );
    });

    it('maps all curated admin hooks to their webhook event types', async () => {
        const harness = createTestHarness();
        const bridge = createWebhookEventBridge(
            harness.store,
            harness.dispatcher,
            harness.nitroApp
        );

        for (const eventType of Object.values(ADMIN_HOOK_TO_EVENT_MAP)) {
            harness.byEvent.set(
                `admin:${eventType}`,
                [activeWebhook({ id: `admin:${eventType}`, user_id: null })]
            );
        }

        bridge.start();

        for (const [hookName, eventType] of Object.entries(ADMIN_HOOK_TO_EVENT_MAP)) {
            await harness.nitroApp.hooks.callHook(hookName, {
                id: `${eventType}-id`,
                workspace_id: 'ws-1',
            });
        }

        expect(harness.enqueue.mock.calls.map((call) => call[0].eventType)).toEqual(
            Object.values(ADMIN_HOOK_TO_EVENT_MAP)
        );
    });

    it('fans out one delivery per subscribed webhook', async () => {
        const harness = createTestHarness();
        const bridge = createWebhookEventBridge(
            harness.store,
            harness.dispatcher,
            harness.nitroApp
        );

        harness.byEvent.set('user:thread.created', [
            activeWebhook({ id: 'wh_1' }),
            activeWebhook({ id: 'wh_2' }),
        ]);

        bridge.start();
        await harness.nitroApp.hooks.callHook('db.threads.create:action:after', {
            id: 'thread-1',
            workspace_id: 'ws-1',
        });

        expect(harness.enqueue).toHaveBeenCalledTimes(2);
    });

    it('skips repeated empty lookups after learning an event has no subscriptions', async () => {
        const harness = createTestHarness();
        const bridge = createWebhookEventBridge(
            harness.store,
            harness.dispatcher,
            harness.nitroApp
        );

        bridge.start();

        await harness.nitroApp.hooks.callHook('db.threads.create:action:after', {
            id: 'thread-1',
            workspace_id: 'ws-1',
        });
        await harness.nitroApp.hooks.callHook('db.threads.create:action:after', {
            id: 'thread-2',
            workspace_id: 'ws-1',
        });

        expect(harness.listByEvent).toHaveBeenCalledTimes(1);
        expect(harness.enqueue).not.toHaveBeenCalled();
    });

    it('does not reuse empty lookup cache entries across workspaces', async () => {
        const harness = createTestHarness();
        const bridge = createWebhookEventBridge(
            harness.store,
            harness.dispatcher,
            harness.nitroApp
        );

        harness.byEvent.set(
            'admin:admin.workspace.created:ws-2',
            [activeWebhook({ id: 'wh_admin', scope: 'admin', user_id: null, workspace_id: 'ws-2' })]
        );

        bridge.start();

        await harness.nitroApp.hooks.callHook('admin.workspace:action:created', {
            id: 'ws-1',
            workspace_id: 'ws-1',
        });
        await harness.nitroApp.hooks.callHook('admin.workspace:action:created', {
            id: 'ws-2',
            workspace_id: 'ws-2',
        });

        expect(harness.listByEvent).toHaveBeenCalledTimes(2);
        expect(harness.enqueue).toHaveBeenCalledTimes(1);
        expect(harness.enqueue.mock.calls[0]?.[0]).toMatchObject({
            eventType: 'admin.workspace.created',
            webhookId: 'wh_admin',
        });
    });

    it('skips disabled webhooks returned by the store', async () => {
        const harness = createTestHarness();
        const bridge = createWebhookEventBridge(
            harness.store,
            harness.dispatcher,
            harness.nitroApp
        );

        harness.byEvent.set('user:thread.created', [
            activeWebhook({ enabled: false }),
        ]);

        bridge.start();
        await harness.nitroApp.hooks.callHook('db.threads.create:action:after', {
            id: 'thread-1',
            workspace_id: 'ws-1',
        });

        expect(harness.enqueue).not.toHaveBeenCalled();
    });

    it('applies the admin workspace filter for custom hooks', async () => {
        const harness = createTestHarness();
        const bridge = createWebhookEventBridge(
            harness.store,
            harness.dispatcher,
            harness.nitroApp
        );

        harness.setActiveCustomHooks(['custom:hook']);
        harness.byCustomHook.set('custom:hook', [
            activeWebhook({ id: 'wh_match', user_id: null, workspace_id: 'ws-1' }),
            activeWebhook({ id: 'wh_skip', user_id: null, workspace_id: 'ws-2' }),
        ]);

        bridge.start();
        await bridge.refreshCustomHookListeners();
        await harness.nitroApp.hooks.callHook('custom:hook', {
            id: 'payload-1',
            workspace_id: 'ws-1',
        });

        expect(harness.enqueue).toHaveBeenCalledTimes(1);
        expect(harness.enqueue.mock.calls[0]?.[0]).toMatchObject({
            webhookId: 'wh_match',
            eventType: 'custom:hook',
        });
    });

    it('extracts workspace filters for custom hooks from multi-arg emissions', async () => {
        const harness = createTestHarness();
        const bridge = createWebhookEventBridge(
            harness.store,
            harness.dispatcher,
            harness.nitroApp
        );

        harness.setActiveCustomHooks(['custom:hook']);
        harness.byCustomHook.set('custom:hook', [
            activeWebhook({ id: 'wh_match', user_id: null, workspace_id: 'ws-1' }),
        ]);

        bridge.start();
        await bridge.refreshCustomHookListeners();
        await harness.nitroApp.hooks.callHook(
            'custom:hook',
            { id: 'first' },
            { workspace_id: 'ws-1' }
        );

        expect(harness.enqueue).toHaveBeenCalledTimes(1);
        expect(harness.enqueue.mock.calls[0]?.[0]).toMatchObject({
            webhookId: 'wh_match',
            eventType: 'custom:hook',
        });
    });

    it('removes stale custom hook listeners when bindings are refreshed', async () => {
        const harness = createTestHarness();
        const bridge = createWebhookEventBridge(
            harness.store,
            harness.dispatcher,
            harness.nitroApp
        );

        harness.setActiveCustomHooks(['custom:hook']);
        harness.byCustomHook.set('custom:hook', [
            activeWebhook({ id: 'wh_1', user_id: null, workspace_id: null }),
        ]);

        bridge.start();
        await bridge.refreshCustomHookListeners();
        await harness.nitroApp.hooks.callHook('custom:hook', { id: 'payload-1' });
        expect(harness.enqueue).toHaveBeenCalledTimes(1);

        harness.enqueue.mockClear();
        harness.setActiveCustomHooks([]);
        await bridge.refreshCustomHookListeners();
        await harness.nitroApp.hooks.callHook('custom:hook', { id: 'payload-2' });

        expect(harness.enqueue).not.toHaveBeenCalled();
    });
});
