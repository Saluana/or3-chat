/** Disposable HTTP/SQLite qualification; no live services or credentials. */
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { createApp, defineEventHandler, toWebHandler } from 'h3';
import { createHooks } from 'hookable';
import { registerWebhookStore } from '../../server/utils/webhooks/store/registry';
import { registerAuthWorkspaceStore } from '../../server/auth/store/registry';
import type { WebhookStore } from '../../server/utils/webhooks/store/types';
import createWebhook from '../../server/api/webhooks/index.post';
import { createWebhookDispatcher } from '../../server/utils/webhooks/dispatcher';
import { createWebhookEventBridge } from '../../server/utils/webhooks/event-bridge';
const source = process.env.OR3_SQLITE_PROVIDER_SOURCE || 'or3-provider-sqlite/webhooks/sqlite-store';
const { createSqliteWebhookStore } = await import(source) as { createSqliteWebhookStore: (options: { database: InstanceType<typeof Database> }) => WebhookStore };
const database = new Database(':memory:');
const store = createSqliteWebhookStore({ database }) as WebhookStore;
database.exec("CREATE TABLE workspace_members(user_id TEXT, workspace_id TEXT); INSERT INTO workspace_members VALUES ('member','workspace');");
const config = {
    auth: { enabled: true, provider: 'audit' }, sync: { provider: 'audit' },
    security: { forceHttps: false, proxy: { trust: false }, allowedOrigins: [] },
    webhooks: { enabled: true, encryptionKey: 'audit-encryption-key-32-bytes-long', maxPerUser: 2,
        rateLimitPerMinute: 1, deliveryTimeoutMs: 10_000, blockPrivateIps: true, maxRetryHours: 24, logRetentionHours: 72 },
};
(globalThis as typeof globalThis & { useRuntimeConfig: () => typeof config }).useRuntimeConfig = () => config;
registerWebhookStore({ id: 'audit', create: () => store });
registerAuthWorkspaceStore({ id: 'audit', create: () => ({ getWorkspaceRole: async ({ userId, workspaceId }: { userId: string; workspaceId: string }) => database.prepare('SELECT 1 FROM workspace_members WHERE user_id = ? AND workspace_id = ?').get(userId, workspaceId) ? 'editor' : null }) as never });
const handle = toWebHandler(createApp().use(defineEventHandler(event => {
    event.context.__or3_request_id = 'fixture';
    event.context.__or3_session_context_fixture_audit = { authenticated: true, user: { id: 'member' }, workspace: { id: 'workspace' }, role: 'editor' };
})).use('/api/webhooks', createWebhook));
const report = (name: string, observed: unknown) => console.log(JSON.stringify({ name, observed }));
let dispatcher: ReturnType<typeof createWebhookDispatcher> | undefined;
let bridge: ReturnType<typeof createWebhookEventBridge> | undefined;
try {
    const hostile = await handle(new Request('http://chat.example.test/api/webhooks', { method: 'POST', headers: { origin: 'http://sibling.example.test', 'content-type': 'application/x-www-form-urlencoded' }, body: 'url=https%3A%2F%2F93.184.216.34%2Fhook&events=message.created&events=message.updated' }));
    assert.equal(hostile.status, 403);
    report('hostile-form-rejected', hostile.status);
    const legitimate = () => handle(new Request('http://chat.example.test/api/webhooks', { method: 'POST', headers: { host: 'chat.example.test', origin: 'http://chat.example.test', 'content-type': 'application/json', 'x-or3-cloud-intent': 'mutation' }, body: JSON.stringify({ url: 'https://93.184.216.34/hook', events: ['message.created'] }) }));
    const responses = await Promise.all(Array.from({ length: 4 }, legitimate));
    assert.deepEqual(responses.map(r => r.status).sort(), [200, 200, 400, 400]);
    assert.equal((await store.listWebhooks('member', 'workspace')).length, 2);
    report('concurrent-registration-quota', responses.map(r => r.status));
    let consumedBytes = 0;
    let cancelled = false;
    dispatcher = createWebhookDispatcher(store, { ...config.webhooks, fetchImpl: async () => new Response(new ReadableStream({ pull(controller) { const chunk = new Uint8Array(65_536).fill(65); consumedBytes += chunk.length; controller.enqueue(chunk); }, cancel() { cancelled = true; } })) });
    const webhook = (await store.listWebhooks('member', 'workspace'))[0]!;
    const ping = await dispatcher.sendTestPing(webhook, 'synthetic');
    assert.equal(ping.responseBody?.length, 4096);
    assert.equal(cancelled, true);
    assert.ok(consumedBytes < 1_048_576);
    report('bounded-response-stream', { consumedBytes, storedBytes: ping.responseBody.length, cancelled });
    for (const eventId of ['first', 'second']) await dispatcher.enqueue({ webhookId: webhook.id, eventType: 'message.created', eventId, payload: {} });
    await dispatcher.claimAndProcess();
    const logs = await store.getDeliveryLogs(webhook.id, 0);
    assert.deepEqual(logs.map(log => log.status).sort(), ['pending', 'success']);
    assert.ok(logs.find(log => log.status === 'pending')?.next_retry_at);
    report('rate-limit-defers-without-cancelling', logs.map(log => log.status));
    database.exec('DELETE FROM workspace_members');
    const nitro = { hooks: createHooks<Record<string, (...args: unknown[]) => unknown>>() };
    bridge = createWebhookEventBridge(store, dispatcher, nitro as never);
    bridge.start();
    await nitro.hooks.callHook('db.messages.create:action:after', { id: 'after-revocation', workspace_id: 'workspace' });
    assert.ok((await store.listWebhooks('member', 'workspace')).every(hook => !hook.enabled));
    assert.equal((await store.getDeliveryLogs(webhook.id, 0)).length, 2);
    assert.ok((await store.getDeliveryLogs(webhook.id, 0)).every(log => log.status !== 'pending'));
    report('membership-revocation-blocks-new-events-and-cancels-pending', true);
} finally { bridge?.stop(); dispatcher?.stop(); database.close(); }
