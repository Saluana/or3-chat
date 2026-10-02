import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, createRouter, toNodeListener, type H3Event } from 'h3';
import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { SessionContext } from '~/core/hooks/hook-types';
import { initializeSqliteDb, destroySqliteDb, _resetForTest } from '~~/node_modules/or3-provider-sqlite-tests/src/runtime/server/db/kysely.ts';
import { runMigrations } from '~~/node_modules/or3-provider-sqlite-tests/src/runtime/server/db/migrate.ts';
import { SqliteAuthWorkspaceStore } from '~~/node_modules/or3-provider-sqlite-tests/src/runtime/server/auth/sqlite-auth-workspace-store.ts';
import { createSqliteWorkspaceAccessStore } from '~~/node_modules/or3-provider-sqlite-tests/src/runtime/server/admin/stores/sqlite-store.ts';
import { SqliteSyncGatewayAdapter } from '~~/node_modules/or3-provider-sqlite-tests/src/runtime/server/sync/sqlite-sync-gateway-adapter.ts';

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

describe('document sync HTTP isolation with the real SQLite harness', () => {
    let root = '';
    let server: Server;
    let baseUrl = '';
    let access: ReturnType<typeof createSqliteWorkspaceAccessStore>;
    let alice: string, bob: string, workspaceA: string, workspaceB: string;

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
            body: JSON.stringify({ scope: { workspaceId }, ...body }),
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
        for (const [userId, workspaceId, title] of [[alice, workspaceA, 'A private document'], [bob, workspaceB, 'B private document']]) {
            select(userId!, workspaceId!);
            const response = await fetch(`${baseUrl}/push`, {
                method: 'POST', headers: { origin: baseUrl, 'content-type': 'application/json', 'x-or3-cloud-intent': 'mutation' },
                body: JSON.stringify({ scope: { workspaceId }, ops: [documentOp(title!)] }),
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

    it.each(['pull', 'snapshot'] as const)('returns only the active owner workspace through %s', async (route) => {
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

    it.each(['pull', 'snapshot', 'push'] as const)('refuses a foreign scope through %s even when the user belongs to it', async (route) => {
        select(bob, workspaceB);
        expect((await call(route, workspaceA)).status).toBe(403);
        select(alice, workspaceA);
        expect((await call(route, workspaceB)).status).toBe(403);
    });

    it('preserves viewer reads, denies writes after downgrade, and denies removed membership', async () => {
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
});
