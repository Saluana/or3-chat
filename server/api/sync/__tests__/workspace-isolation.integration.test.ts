import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, createRouter, toNodeListener, type H3Event } from 'h3';
import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { ChatGenerationAdmissionEnvelope, CanonicalGenerationSnapshot } from '~~/shared/chat/background-history';
import type { SyncGatewayAdapter } from '../../../sync/gateway/types';
import type { SessionContext } from '~/core/hooks/hook-types';
import { initializeSqliteDb, destroySqliteDb, _resetForTest, getRawDb } from '~~/node_modules/or3-provider-sqlite/dist/runtime/server/db/kysely.js';
import { runMigrations } from '~~/node_modules/or3-provider-sqlite/dist/runtime/server/db/migrate.js';
import { SqliteAuthWorkspaceStore } from '~~/node_modules/or3-provider-sqlite/dist/runtime/server/auth/sqlite-auth-workspace-store.js';
import { createSqliteWorkspaceAccessStore } from '~~/node_modules/or3-provider-sqlite/dist/runtime/server/admin/stores/sqlite-store.js';
import { SqliteSyncGatewayAdapter } from '~~/node_modules/or3-provider-sqlite/dist/runtime/server/sync/sqlite-sync-gateway-adapter.js';
import { stableJson } from '~~/node_modules/or3-provider-sqlite/dist/runtime/server/sync/background-history-fingerprint.js';

const fixture = vi.hoisted(() => ({
    auth: null as SqliteAuthWorkspaceStore | null,
    adapter: null as SqliteSyncGatewayAdapter | null,
    userId: '', workspaceId: '',
}));
// Use the existing pinned SQLite harness. Only verified identity and registry
// selection are synthetic; H3 guards, can(), roles, sync and persisted rows are real.
// Cached-session freshness has a separate owner and is deliberately not modeled.
vi.mock('../../../auth/session', () => ({
    resolveSessionContext: async (event: H3Event) => {
        const session = {
            authenticated: true, provider: 'fixture', providerUserId: fixture.userId,
            user: { id: fixture.userId }, workspace: { id: fixture.workspaceId },
            role: await fixture.auth!.getWorkspaceRole({ userId: fixture.userId, workspaceId: fixture.workspaceId }) ?? undefined,
        } as SessionContext;
        event.context.__or3_session_context_fixture = session;
        return session;
    },
}));
vi.mock('../../../sync/gateway/registry', () => ({ getActiveSyncGatewayAdapter: () => fixture.adapter }));
vi.mock('../../../utils/webhooks/runtime', () => ({ emitWebhookSystemHook: async () => {} }));
vi.mock('#imports', () => ({ useRuntimeConfig: () => ({ auth: { enabled: true }, sync: { enabled: true }, security: { proxy: {} } }) }));

import pullRoute from '../pull.post';
import pushRoute from '../push.post';
import snapshotRoute from '../snapshot.post';

const supportsHistory = (new SqliteSyncGatewayAdapter() as unknown as SyncGatewayAdapter).capabilities?.historyIncarnation === 'v1';

describe('document sync HTTP isolation with the real SQLite harness', () => {
    let root = '';
    let server: Server;
    let baseUrl = '';
    let history: string | null = null;
    const historyFields = () => ({ unavailableRecordCapability: 'unavailable-v1', historyIncarnationCapability: 'incarnation-v1', historyIncarnation: history });
    const qualifiedIt = it.runIf(supportsHistory);
    let access: ReturnType<typeof createSqliteWorkspaceAccessStore>;
    let alice: string, bob: string, workspaceA: string, workspaceB: string;

    function admission(workspaceId: string): ChatGenerationAdmissionEnvelope {
        return { version: 1, kind: 'new-turn', admissionId: 'shared-admission', generationId: 'shared-generation',
            workspaceId, threadId: 'shared-thread', messageId: 'shared-assistant',
            thread: { id: 'shared-thread', clock: 1, title: 'Synthetic thread', status: 'ready', pinned: false, deleted: false, created_at: 1, updated_at: 1 },
            userMessage: { id: 'shared-user', clock: 1, thread_id: 'shared-thread', role: 'user', index: 0, order_key: '1:0:server', deleted: false, created_at: 1, updated_at: 1, data: { content: 'Synthetic request' } },
            assistantMessage: { id: 'shared-assistant', clock: 1, thread_id: 'shared-thread', role: 'assistant', pending: true, index: 1, order_key: '1:1:server', deleted: false, created_at: 1, updated_at: 1,
                data: { content: '', generation_id: 'shared-generation' } },
        };
    }
    function message(workspaceId: string) {
        const row = getRawDb().prepare('SELECT data_json FROM s_messages WHERE workspace_id = ? AND id = ?')
            .get(workspaceId, 'shared-assistant') as { data_json: string };
        return JSON.parse(row.data_json);
    }

    function select(userId: string, workspaceId: string) {
        fixture.userId = userId;
        fixture.workspaceId = workspaceId;
    }

    function documentOp(title: string) {
        return {
            id: crypto.randomUUID(), tableName: 'posts', operation: 'put', pk: 'copied-document',
            payload: {
                id: 'copied-document', title, content: title, post_type: 'doc',
                deleted: false, created_at: 1, updated_at: 1, clock: 1,
            },
            stamp: { deviceId: 'fixture-device', opId: crypto.randomUUID(), hlc: '0000000000001:00000:fixture', clock: 1 },
            createdAt: 1, attempts: 0, status: 'pending',
        };
    }

    function call(route: 'pull' | 'snapshot' | 'push', workspaceId: string) {
        const body = route === 'pull' ? { cursor: 0, limit: 50, tables: ['posts'] }
            : route === 'snapshot' ? { pageSize: 50, tables: ['posts'] }
            : { ops: [documentOp('Unauthorized replacement')] };
        return fetch(`${baseUrl}/${route}`, {
            method: 'POST',
            headers: { origin: baseUrl, 'content-type': 'application/json', 'x-or3-cloud-intent': 'mutation' },
            body: JSON.stringify({ ...historyFields(), scope: { workspaceId }, ...body }),
        });
    }

    beforeEach(async () => {
        vi.stubGlobal('useRuntimeConfig', () => ({ auth: { enabled: true }, sync: { enabled: true } }));
        _resetForTest();
        root = await mkdtemp('/tmp/or3-sync-isolation-');
        await runMigrations(await initializeSqliteDb({ path: join(root, 'fixture.sqlite') }));
        fixture.auth = new SqliteAuthWorkspaceStore();
        fixture.adapter = new SqliteSyncGatewayAdapter();
        access = createSqliteWorkspaceAccessStore();
        alice = (await fixture.auth.getOrCreateUser({ provider: 'fixture', providerUserId: 'alice' })).userId;
        bob = (await fixture.auth.getOrCreateUser({ provider: 'fixture', providerUserId: 'bob' })).userId;
        workspaceA = (await access.createWorkspace({ name: 'Fixture A', ownerUserId: alice })).workspaceId;
        workspaceB = (await access.createWorkspace({ name: 'Fixture B', ownerUserId: bob })).workspaceId;
        await access.upsertMember({ workspaceId: workspaceA, provider: 'fixture', emailOrProviderId: 'bob', role: 'editor' });
        const router = createRouter();
        router.post('/pull', pullRoute);
        router.post('/push', pushRoute);
        router.post('/snapshot', snapshotRoute);
        server = createServer(toNodeListener(createApp().use(router)));
        server.listen(0, '127.0.0.1');
        await once(server, 'listening');
        baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
        if (!supportsHistory) return;
        select(alice, workspaceA);
        history = null;
        const discovery = await call('snapshot', workspaceA);
        expect(discovery.status).toBe(200);
        history = (await discovery.json()).historyIncarnation;
        expect(typeof history).toBe('string');
        for (const [userId, workspaceId, title] of [[alice, workspaceA, 'A private document'], [bob, workspaceB, 'B private document']]) {
            select(userId!, workspaceId!);
            const response = await fetch(`${baseUrl}/push`, {
                method: 'POST', headers: { origin: baseUrl, 'content-type': 'application/json', 'x-or3-cloud-intent': 'mutation' },
                body: JSON.stringify({ ...historyFields(), scope: { workspaceId }, ops: [documentOp(title!)] }),
            });
            expect(response.status).toBe(200);
            expect((await response.json()).results[0].success).toBe(true);
        }
    });

    afterEach(async () => {
        if (server) {
            await new Promise<void>((resolve, reject) => {
                server.close((error) => error ? reject(error) : resolve());
                server.closeAllConnections();
            });
        }
        vi.unstubAllGlobals();
        await destroySqliteDb();
        if (root) await rm(root, { recursive: true, force: true });
        root = '';
    });

    it.runIf(!supportsHistory).each(['pull', 'snapshot', 'push'] as const)('refuses unqualified published-provider %s before dispatch', async route => {
        select(alice, workspaceA);
        const response = await call(route, workspaceA);
        expect(response.status).toBe(503);
        expect((await response.json()).data.code).toBe('OR3_SYNC_HISTORY_UNSUPPORTED');
        expect(getRawDb().prepare('SELECT COUNT(*) AS count FROM change_log').get()).toEqual({ count: 0 });
    });

    qualifiedIt.each(['pull', 'snapshot'] as const)('returns only the active owner workspace through %s', async (route) => {
        for (const [userId, workspaceId, own, foreign] of [[alice, workspaceA, 'A private document', 'B private document'], [bob, workspaceB, 'B private document', 'A private document']]) {
            select(userId!, workspaceId!);
            const response = await call(route, workspaceId!);
            expect(response.status).toBe(200);
            expect(response.headers.get('cache-control')).toContain('no-store');
            const body = await response.text();
            expect(body).toContain(own);
            expect(body).not.toContain(foreign);
        }
    });

    qualifiedIt.each(['pull', 'snapshot'] as const)('reads legacy HLC-ordered messages through %s without rewriting history', async route => {
        select(alice, workspaceA);
        await fixture.adapter!.admitChatGeneration({ userId: alice, workspaceId: workspaceA }, admission(workspaceA));
        // 0.0.29/0.0.30 background writers accepted messages without order_key;
        // the client derives it from the revision HLC without changing history.
        getRawDb().prepare("UPDATE s_messages SET data_json = json_remove(data_json, '$.order_key') WHERE workspace_id = ?").run(workspaceA);
        getRawDb().prepare("UPDATE change_log SET payload_json = json_remove(payload_json, '$.order_key') WHERE workspace_id = ? AND table_name = 'messages'").run(workspaceA);
        const response = await fetch(`${baseUrl}/${route}`, {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ ...historyFields(), scope: { workspaceId: workspaceA }, tables: ['messages'],
                ...(route === 'pull' ? { cursor: 0, limit: 50 } : { pageSize: 50 }) }),
        });
        expect(response.status).toBe(200);
        const page = await response.json();
        const entries = route === 'pull' ? page.changes : page.items;
        expect(entries.map((entry: { pk: string }) => entry.pk).sort()).toEqual(['shared-assistant', 'shared-user']);
        expect(entries.every((entry: { payload: object }) => !Object.hasOwn(entry.payload, 'order_key'))).toBe(true);
        expect(page.unavailable ?? []).toEqual([]);
    });

    qualifiedIt.each([true, false])('replays a legacy background admission without normalizing its receipt identity (order_key=%s)', async hasOrderKey => {
        const input = { ...admission(workspaceA), expectedAssistant: undefined };
        input.assistantMessage.modelId = 'legacy-extension';
        if (!hasOrderKey) {
            delete input.assistantMessage.order_key;
            delete input.userMessage!.order_key;
        }
        const actor = { userId: alice, workspaceId: workspaceA };
        const committed = await fixture.adapter!.admitChatGeneration(actor, input);
        // Before H2, the envelope parser returned the original record objects.
        // Seed that exact receipt using the provider's actual fingerprint encoder.
        getRawDb().prepare("UPDATE background_generation_receipts SET fingerprint = ? WHERE workspace_id = ? AND generation_id = ? AND stage = 'admission'")
            .run(createHash('sha256').update(stableJson(input)).digest('hex'), workspaceA, input.generationId);
        await expect(fixture.adapter!.admitChatGeneration(actor, input)).resolves.toEqual({ ...committed, replayed: true });
    });

    qualifiedIt('replays a deletion committed with the old wire payload without fingerprint drift', async () => {
        select(alice, workspaceA);
        const op = { ...documentOp('unused'), operation: 'delete' as const, status: 'pending' as const,
            payload: { id: 'copied-document', deletedAt: 123, deleted: true } };
        const batch = { ...historyFields(), historyIncarnationCapability: 'incarnation-v1' as const, scope: { workspaceId: workspaceA }, ops: [op] };
        // Old HTTP admission forwarded delete metadata unchanged to this sink.
        const committed = await fixture.adapter!.push({ context: {} } as H3Event, batch);
        expect(committed.results[0]).toMatchObject({ success: true });
        const response = await fetch(`${baseUrl}/push`, {
            method: 'POST', headers: { origin: baseUrl, 'content-type': 'application/json', 'x-or3-cloud-intent': 'mutation' },
            body: JSON.stringify(batch),
        });
        expect(response.status).toBe(200);
        expect((await response.json()).results[0]).toMatchObject({ success: true, replayed: true,
            serverVersion: committed.results[0]!.serverVersion });
        expect(getRawDb().prepare('SELECT COUNT(*) AS count FROM change_log WHERE op_id = ?').get(op.stamp.opId)).toEqual({ count: 1 });
    });

    qualifiedIt.each(['pull', 'snapshot', 'push'] as const)('refuses a foreign scope through %s even when the user belongs to it', async (route) => {
        select(bob, workspaceB);
        expect((await call(route, workspaceA)).status).toBe(403);
        select(alice, workspaceA);
        expect((await call(route, workspaceB)).status).toBe(403);
    });

    qualifiedIt('preserves viewer reads, denies writes after downgrade, and denies removed membership', async () => {
        await access.setMemberRole({ workspaceId: workspaceA, userId: bob, role: 'viewer' });
        select(bob, workspaceA);
        expect((await call('pull', workspaceA)).status).toBe(200);
        expect((await call('snapshot', workspaceA)).status).toBe(200);
        expect((await call('push', workspaceA)).status).toBe(403);
        await access.removeMember({ workspaceId: workspaceA, userId: bob });
        for (const route of ['pull', 'snapshot', 'push'] as const) {
            expect((await call(route, workspaceA)).status).toBe(403);
        }
        select(alice, workspaceA);
        expect(await (await call('snapshot', workspaceA)).text()).toContain('A private document');
        select(bob, workspaceB);
        expect(await (await call('snapshot', workspaceB)).text()).toContain('B private document');
    });
    qualifiedIt.each(['removed', 'viewer', 'editor'] as const)('rechecks %s membership at finalization while identical identifiers exist elsewhere', async role => {
        for (const workspaceId of [workspaceA, workspaceB]) await fixture.adapter!.admitChatGeneration({ userId: bob, workspaceId }, admission(workspaceId));
        const snapshot: CanonicalGenerationSnapshot = { status: 'complete', content: 'Synthetic A response', reasoning: '', completedAt: Date.now() };
        const input = { admission: admission(workspaceA), snapshot };
        const beforeA = message(workspaceA), beforeB = message(workspaceB);
        if (role === 'removed') await access.removeMember({ workspaceId: workspaceA, userId: bob });
        else await access.setMemberRole({ workspaceId: workspaceA, userId: bob, role });
        if (role === 'editor') {
            expect((await fixture.adapter!.finalizeChatGeneration({ userId: bob, workspaceId: workspaceA }, input)).status).toBe('committed');
            expect(message(workspaceA).data.content).toBe(snapshot.content);
        } else {
            await expect(fixture.adapter!.finalizeChatGeneration({ userId: bob, workspaceId: workspaceA }, input)).rejects.toThrow(/Forbidden/);
            expect(message(workspaceA)).toEqual(beforeA);
            const receipts = getRawDb().prepare("SELECT COUNT(*) AS count FROM background_generation_receipts WHERE workspace_id = ? AND stage = 'finalization'")
                .get(workspaceA) as { count: number };
            expect(receipts.count).toBe(0);
        }
        expect(message(workspaceB)).toEqual(beforeB);
        await fixture.adapter!.finalizeChatGeneration({ userId: bob, workspaceId: workspaceB }, { admission: admission(workspaceB), snapshot: { ...snapshot, content: 'Synthetic B response' } });
        expect(message(workspaceB).data.content).toBe('Synthetic B response');
        if (role !== 'editor') {
            await access.upsertMember({ workspaceId: workspaceA, provider: 'fixture', emailOrProviderId: 'bob', role: 'editor' });
            expect((await fixture.adapter!.finalizeChatGeneration({ userId: bob, workspaceId: workspaceA }, input)).status).toBe('committed');
            expect(message(workspaceA).data.content).toBe('Synthetic A response');
            expect(message(workspaceB).data.content).toBe('Synthetic B response');
        }
    });
    qualifiedIt('rejects a direct workspace substitution despite matching thread/message/generation identifiers', async () => {
        for (const workspaceId of [workspaceA, workspaceB]) await fixture.adapter!.admitChatGeneration({ userId: bob, workspaceId }, admission(workspaceId));
        const beforeA = message(workspaceA), beforeB = message(workspaceB);
        await expect(fixture.adapter!.finalizeChatGeneration({ userId: bob, workspaceId: workspaceB }, {
            admission: admission(workspaceA), snapshot: { status: 'complete', content: 'Synthetic forged destination', reasoning: '', completedAt: Date.now() },
        })).rejects.toThrow(/Invalid background history workspace/);
        expect(message(workspaceA)).toEqual(beforeA); expect(message(workspaceB)).toEqual(beforeB);
    });
});
