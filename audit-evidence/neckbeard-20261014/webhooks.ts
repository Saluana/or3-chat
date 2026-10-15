/**
 * Run: bunx vite-node --config vitest.config.ts audit-evidence/neckbeard-20261014/webhooks.ts
 * Disposable in-memory SQLite; no network calls. Uses the installed SQLite provider.
 * Auth is represented by an already-resolved request session, as for a valid
 * same-site cookie. This tests mutation guards, not cookie authentication.
 * Failure cases: cross-origin form creation; delivery after membership removal;
 * quota races; dropped rate-limited events; response buffering before truncation.
 */
import Database from 'better-sqlite3';
import { createApp, defineEventHandler, toWebHandler } from 'h3';
import { createSqliteWebhookStore } from '../../node_modules/or3-provider-sqlite/dist/runtime/server/webhooks/sqlite-webhook-store.js';
import { registerWebhookStore } from '../../server/utils/webhooks/store/registry';
import createWebhook from '../../server/api/webhooks/index.post';
import { createWebhookDispatcher } from '../../server/utils/webhooks/dispatcher';
import { buildWebhookPayload } from '../../server/utils/webhooks/payload';

const database = new Database(':memory:');
const store = createSqliteWebhookStore({ database });
const config = {
    auth: { enabled: true, provider: 'audit' }, sync: { provider: 'audit' },
    security: { forceHttps: false, proxy: { trust: false }, allowedOrigins: [] },
    webhooks: { enabled: true, encryptionKey: 'audit-encryption-key-32-bytes-long', maxPerUser: 2,
        rateLimitPerMinute: 1, deliveryTimeoutMs: 10_000, blockPrivateIps: true, maxRetryHours: 24, logRetentionHours: 72 },
};
(globalThis as any).useRuntimeConfig = () => config;
registerWebhookStore({ id: 'audit', create: () => store });
const app = createApp().use(defineEventHandler(event => {
    event.context.__or3_request_id = 'fixture';
    event.context.__or3_session_context_fixture_audit = {
        authenticated: true, user: { id: 'member' }, workspace: { id: 'workspace' }, role: 'editor',
    };
})).use('/api/webhooks', createWebhook);
const handle = toWebHandler(app);
function formRequest() {
    return new Request('http://chat.example.test/api/webhooks', {
        method: 'POST', headers: { origin: 'http://sibling.example.test', 'content-type': 'application/x-www-form-urlencoded' },
        body: 'url=https%3A%2F%2F93.184.216.34%2Fhook&events=message.created&events=message.updated',
    });
}
const report = (name: string, observed: unknown) => console.log(JSON.stringify({ name, observed }));
let dispatcher: ReturnType<typeof createWebhookDispatcher> | undefined;
try {
    const response = await handle(formRequest());
    const body = await response.json();
    report('cross-origin-form-creates-webhook-without-intent', { status: response.status, created: Boolean(body.webhook?.id) });
    const raced = await Promise.all(Array.from({ length: 4 }, () => handle(formRequest())));
    report('two-webhook-quota-bypassed-by-concurrency', { statuses: raced.map(r => r.status), total: (await store.listWebhooks('member', 'workspace')).length });
    database.exec("CREATE TABLE workspace_members(user_id TEXT, workspace_id TEXT); INSERT INTO workspace_members VALUES ('member','workspace'); DELETE FROM workspace_members WHERE user_id='member';");
    report('revoked-member-webhooks-still-selected', { memberships: database.prepare('SELECT COUNT(*) AS n FROM workspace_members').get(), selected: (await store.listWebhooksByEvent('message.created', 'user', 'workspace')).length });
    let consumedBytes = 0;
    dispatcher = createWebhookDispatcher(store, {
        ...config.webhooks, fetchImpl: async () => new Response(new ReadableStream({
            pull(controller) {
                if (consumedBytes >= 1_048_576) return controller.close();
                const chunk = new Uint8Array(65_536).fill(65);
                consumedBytes += chunk.length; controller.enqueue(chunk);
            },
        }), { status: 200 }),
    });
    const webhook = (await store.listWebhooks('member', 'workspace'))[0]!;
    const ping = await dispatcher.sendTestPing(webhook, 'audit-secret');
    report('4k-webhook-response-cap-reads-entire-megabyte', { consumedBytes, storedChars: ping.responseBody?.length });
    const payload = buildWebhookPayload({ event: 'message.created', data: { id: 'message' }, workspaceId: 'workspace', scope: 'user' });
    await dispatcher.enqueue({ webhookId: webhook.id, eventType: payload.event, eventId: 'first', payload });
    await dispatcher.enqueue({ webhookId: webhook.id, eventType: payload.event, eventId: 'second', payload });
    report('rate-limit-permanently-cancels-event', (await store.getDeliveryLogs(webhook.id, 0)).map(row => ({ event: row.event_id, status: row.status, retryScheduled: row.next_retry_at !== null })));
} finally { dispatcher?.stop(); database.close(); }
