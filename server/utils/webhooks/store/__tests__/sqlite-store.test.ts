/* @vitest-environment node */
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { createSqliteWebhookStore } from '../sqlite-store';
import type { WebhookDeliveryLog, WebhookRegistration, WebhookStore } from '../types';

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

function createWebhookInput(
    overrides: Partial<
        Omit<WebhookRegistration, 'id' | 'health' | 'created_at' | 'updated_at'>
    > = {}
): Omit<WebhookRegistration, 'id' | 'health' | 'created_at' | 'updated_at'> {
    return {
        scope: 'user',
        user_id: 'user-1',
        workspace_id: 'ws-1',
        url: 'https://example.com/webhooks',
        label: 'Primary',
        events: ['thread.created'],
        custom_hooks: [],
        signing_secret_enc: 'enc-secret',
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

afterEach(() => {
    for (const db of openDatabases) {
        db.close();
    }
    openDatabases.clear();
});

describe('sqlite webhook store', () => {
    it('supports the user webhook CRUD lifecycle', async () => {
        const { store } = createTestContext();

        const created = await store.createWebhook(
            createWebhookInput({
                signing_secret_enc: 'enc:user:secret',
            })
        );

        expect(created.id).toBeTruthy();
        expect(created.health).toBe('unknown');
        expect(created.signing_secret_enc).toBe('enc:user:secret');

        const listed = await store.listWebhooks('user-1', 'ws-1');
        expect(listed).toHaveLength(1);

        await store.updateWebhookHealth(created.id, 'healthy');

        const updated = await store.updateWebhook(created.id, {
            url: 'https://example.com/new',
            label: 'Renamed',
            events: ['thread.updated', 'message.created'],
        });

        expect(updated.url).toBe('https://example.com/new');
        expect(updated.events).toEqual(['thread.updated', 'message.created']);
        expect(updated.health).toBe('unknown');

        await store.deleteWebhook(created.id);
        expect(await store.getWebhook(created.id)).toBeNull();
    });

    it('supports the admin webhook CRUD lifecycle and custom hook queries', async () => {
        const { store } = createTestContext();

        const adminA = await store.createWebhook(
            createWebhookInput({
                scope: 'admin',
                user_id: null,
                workspace_id: null,
                custom_hooks: ['db.messages.create:action:after', 'admin.workspace:action:created'],
            })
        );
        const adminB = await store.createWebhook(
            createWebhookInput({
                scope: 'admin',
                user_id: null,
                workspace_id: 'ws-1',
                custom_hooks: ['db.messages.create:action:after'],
            })
        );

        const adminListed = await store.listAdminWebhooks();
        expect(adminListed).toHaveLength(2);

        const byHook = await store.listWebhooksByCustomHook(
            'db.messages.create:action:after'
        );
        expect(byHook.map((webhook) => webhook.id).sort()).toEqual(
            [adminA.id, adminB.id].sort()
        );

        expect(await store.listActiveCustomHookNames()).toEqual([
            'admin.workspace:action:created',
            'db.messages.create:action:after',
        ]);
    });

    it('filters listWebhooksByEvent by scope and admin workspace filter', async () => {
        const { store } = createTestContext();

        const userWebhook = await store.createWebhook(createWebhookInput());
        const adminGlobal = await store.createWebhook(
            createWebhookInput({
                scope: 'admin',
                user_id: null,
                workspace_id: null,
            })
        );
        const adminScoped = await store.createWebhook(
            createWebhookInput({
                scope: 'admin',
                user_id: null,
                workspace_id: 'ws-1',
            })
        );
        await store.createWebhook(
            createWebhookInput({
                scope: 'admin',
                user_id: null,
                workspace_id: 'ws-2',
            })
        );

        const userMatches = await store.listWebhooksByEvent(
            'thread.created',
            'user',
            'ws-1'
        );
        expect(userMatches.map((webhook) => webhook.id)).toEqual([userWebhook.id]);

        const adminMatches = await store.listWebhooksByEvent(
            'thread.created',
            'admin',
            'ws-1'
        );
        expect(adminMatches.map((webhook) => webhook.id).sort()).toEqual(
            [adminGlobal.id, adminScoped.id].sort()
        );
    });

    it('bulk-disables only matching user webhooks', async () => {
        const { store } = createTestContext();

        const userA = await store.createWebhook(createWebhookInput());
        const userB = await store.createWebhook(
            createWebhookInput({
                label: 'Secondary',
            })
        );
        await store.createWebhook(
            createWebhookInput({
                user_id: 'user-2',
            })
        );

        const disabledCount = await store.disableAllWebhooks('user-1', 'ws-1');
        expect(disabledCount).toBe(2);

        const refreshedA = await store.getWebhook(userA.id);
        const refreshedB = await store.getWebhook(userB.id);
        expect(refreshedA?.enabled).toBe(false);
        expect(refreshedB?.enabled).toBe(false);
    });

    it('supports delivery log CRUD', async () => {
        const { store } = createTestContext();
        const webhook = await store.createWebhook(createWebhookInput());

        const created = await store.createDeliveryLog(
            createDeliveryLogInput(webhook.id)
        );
        await store.updateDeliveryLog(created.id, {
            status: 'success',
            http_status: 204,
            duration_ms: 42,
            response_body: 'ok',
        });

        const logs = await store.getDeliveryLogs(webhook.id, Date.now() - 1000);
        expect(logs).toHaveLength(1);
        expect(logs[0]).toMatchObject({
            id: created.id,
            status: 'success',
            http_status: 204,
            duration_ms: 42,
            response_body: 'ok',
        });
    });

    it('claims only due pending deliveries and marks them in_flight', async () => {
        const { store } = createTestContext();
        const webhook = await store.createWebhook(createWebhookInput());

        const due = await store.createDeliveryLog(
            createDeliveryLogInput(webhook.id, {
                next_retry_at: Date.now() - 1,
            })
        );
        await store.createDeliveryLog(
            createDeliveryLogInput(webhook.id, {
                next_retry_at: Date.now() + 60_000,
            })
        );

        const claimed = await store.claimPendingDeliveries('worker-a', 10);
        expect(claimed).toHaveLength(1);
        expect(claimed[0]).toMatchObject({
            id: due.id,
            status: 'in_flight',
            claimed_by: 'worker-a',
        });
    });

    it('never returns the same row to concurrent claimers', async () => {
        const { store } = createTestContext();
        const webhook = await store.createWebhook(createWebhookInput());

        await store.createDeliveryLog(
            createDeliveryLogInput(webhook.id, { next_retry_at: Date.now() - 1 })
        );
        await store.createDeliveryLog(
            createDeliveryLogInput(webhook.id, { next_retry_at: Date.now() - 1 })
        );

        const [workerA, workerB] = await Promise.all([
            store.claimPendingDeliveries('worker-a', 1),
            store.claimPendingDeliveries('worker-b', 1),
        ]);

        const claimedIds = [...workerA, ...workerB].map((log) => log.id);
        expect(claimedIds).toHaveLength(2);
        expect(new Set(claimedIds).size).toBe(2);
    });

    it('resets stale in-flight deliveries back to pending', async () => {
        const { store } = createTestContext();
        const webhook = await store.createWebhook(createWebhookInput());

        const stale = await store.createDeliveryLog(
            createDeliveryLogInput(webhook.id, {
                status: 'in_flight',
                claimed_by: 'worker-a',
                claimed_at: Date.now() - 10_000,
            })
        );
        await store.createDeliveryLog(
            createDeliveryLogInput(webhook.id, {
                status: 'in_flight',
                claimed_by: 'worker-a',
                claimed_at: Date.now(),
            })
        );

        const resetCount = await store.resetStaleInFlightDeliveries(5_000);
        expect(resetCount).toBe(1);

        const [resetLog] = await store.getDeliveryLogs(stale.webhook_id, 0);
        const staleRow = resetLog.id === stale.id
            ? resetLog
            : (await store.getDeliveryLogs(stale.webhook_id, 0)).find(
                  (log) => log.id === stale.id
              );
        expect(staleRow).toMatchObject({
            status: 'pending',
            claimed_by: null,
            claimed_at: null,
        });
    });


    it('supports explicit null clearing in delivery log updates', async () => {
        const { store } = createTestContext();
        const webhook = await store.createWebhook(createWebhookInput());

        const created = await store.createDeliveryLog(
            createDeliveryLogInput(webhook.id, {
                status: 'in_flight',
                claimed_by: 'worker-a',
                claimed_at: Date.now(),
                http_status: 500,
                error_message: 'boom',
                response_body: 'failed',
                duration_ms: 123,
                next_retry_at: Date.now() + 60_000,
            })
        );

        await store.updateDeliveryLog(created.id, {
            status: 'success',
            http_status: null,
            error_message: null,
            response_body: null,
            duration_ms: null,
            next_retry_at: null,
        });

        const [log] = await store.getDeliveryLogs(webhook.id, 0);
        expect(log).toMatchObject({
            status: 'success',
            claimed_by: null,
            claimed_at: null,
            http_status: null,
            error_message: null,
            response_body: null,
            duration_ms: null,
            next_retry_at: null,
        });
    });

    it('returns only recent terminal deliveries for health windows', async () => {
        const { store } = createTestContext();
        const webhook = await store.createWebhook(createWebhookInput());

        await store.createDeliveryLog(
            createDeliveryLogInput(webhook.id, {
                status: 'pending',
                created_at: 10,
            })
        );
        await store.createDeliveryLog(
            createDeliveryLogInput(webhook.id, {
                status: 'success',
                created_at: 20,
            })
        );
        await store.createDeliveryLog(
            createDeliveryLogInput(webhook.id, {
                status: 'failed',
                created_at: 30,
            })
        );
        await store.createDeliveryLog(
            createDeliveryLogInput(webhook.id, {
                status: 'success',
                created_at: 40,
            })
        );

        const logs = await store.getRecentTerminalDeliveries(webhook.id, 2);
        expect(logs).toHaveLength(2);
        expect(logs.map((log) => [log.status, log.created_at])).toEqual([
            ['success', 40],
            ['failed', 30],
        ]);
    });

    it('cancels and deletes logs by webhook and purges expired rows', async () => {
        const { store } = createTestContext();
        const webhookA = await store.createWebhook(createWebhookInput());
        const webhookB = await store.createWebhook(
            createWebhookInput({ label: 'Other' })
        );

        await store.createDeliveryLog(
            createDeliveryLogInput(webhookA.id, {
                status: 'pending',
                created_at: Date.now() - 10_000,
            })
        );
        await store.createDeliveryLog(
            createDeliveryLogInput(webhookA.id, {
                status: 'in_flight',
                claimed_by: 'worker-a',
                claimed_at: Date.now() - 10_000,
                created_at: Date.now() - 10_000,
            })
        );
        const keepLog = await store.createDeliveryLog(
            createDeliveryLogInput(webhookB.id, {
                status: 'success',
                created_at: Date.now(),
            })
        );

        expect(await store.cancelDeliveriesByWebhook(webhookA.id)).toBe(2);
        expect(await store.deleteDeliveryLogsByWebhook(webhookA.id)).toBe(2);
        expect(await store.purgeExpiredLogs(Date.now() - 1)).toBe(0);
        expect(await store.purgeExpiredLogs(Date.now() + 1)).toBe(1);

        const remaining = await store.getDeliveryLogs(webhookB.id, 0);
        expect(remaining.find((log) => log.id === keepLog.id)).toBeUndefined();
    });
});
