import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, createRouter, toWebHandler } from 'h3';
import type { SessionContext, WorkspaceRole } from '~/core/hooks/hook-types';
import { PluginConnectionService } from '../../../utils/plugins/connections/service';
import { createMemoryPluginConnectionStore } from '../../../utils/plugins/connections/store/memory';

const fixtures = vi.hoisted(() => ({
    session: null as SessionContext | null,
    service: null as PluginConnectionService | null,
}));

// Identity verification/session freshness belongs to the auth resolver's suite.
// Keep that boundary synthetic; exercise H3, can(), mutation guards and the
// real credential service/store without replacing their authorization behavior.
vi.mock('../../../auth/session', () => ({
    resolveSessionContext: async () => fixtures.session,
}));
vi.mock('#imports', () => ({
    useRuntimeConfig: () => ({ auth: { enabled: true }, security: { proxy: {} } }),
}));
vi.mock('../../../utils/plugins/connections/resolve', () => ({
    resolveConnectionService: () => ({ service: fixtures.service, durable: false }),
}));

import listRoute from '../connections/index.get';
import deleteRoute from '../connections/[id].delete';

describe('plugin connection HTTP isolation', () => {
    let store: ReturnType<typeof createMemoryPluginConnectionStore>;
    let ids: Record<string, string>;
    let memberships: Map<string, WorkspaceRole>;
    let request: ReturnType<typeof toWebHandler>;

    function select(userId: string, workspaceId: string) {
        fixtures.session = {
            authenticated: true,
            provider: 'fixture',
            providerUserId: userId,
            user: { id: userId },
            workspace: { id: workspaceId },
            role: memberships.get(`${userId}:${workspaceId}`),
        } as SessionContext;
    }

    async function call(method: 'GET' | 'DELETE', id?: string) {
        return request(new Request(`http://fixture.test/connections${id ? `/${id}` : ''}`, {
            method,
            headers: {
                host: 'fixture.test',
                origin: 'http://fixture.test',
                'content-type': 'application/json',
                'x-or3-plugin-intent': 'plugin',
            },
        }));
    }

    beforeEach(async () => {
        store = createMemoryPluginConnectionStore();
        fixtures.service = new PluginConnectionService({
            store,
            secret: 'disposable-fixture-encryption-key',
        });
        memberships = new Map([
            ['alice:ws-a', 'owner'], ['alice:ws-b', 'editor'],
            ['bob:ws-a', 'editor'], ['bob:ws-b', 'owner'],
        ]);
        ids = {};
        for (const [userId, workspaceId] of [['alice', 'ws-a'], ['alice', 'ws-b'], ['bob', 'ws-a']]) {
            const created = await fixtures.service.create({
                ownerUserId: userId!, workspaceId: workspaceId!, pluginId: 'fixture.plugin',
                providerId: 'fixture', label: `${userId}-${workspaceId}`, scopes: [],
                credential: 'disposable-fixture-value',
            });
            if (created.status !== 'created') throw new Error('Fixture creation failed');
            ids[`${userId}:${workspaceId}`] = created.view.id;
        }
        const router = createRouter();
        router.get('/connections', listRoute);
        router.delete('/connections/:id', deleteRoute);
        request = toWebHandler(createApp().use(router));
    });

    it('lists only the acting owner and active workspace without credential material', async () => {
        select('alice', 'ws-a');
        const response = await call('GET');
        expect(response.status).toBe(200);
        const body = await response.json();
        expect(body.connections.map((connection: { id: string }) => connection.id)).toEqual([ids['alice:ws-a']]);
        expect(JSON.stringify(body)).not.toContain('disposable-fixture-value');
        expect(JSON.stringify(body)).not.toContain('secretCiphertext');
    });

    it.each([
        ['different owner', 'bob', 'ws-a', false, false],
        ['switched workspace', 'alice', 'ws-b', false, false],
        ['removed member using another workspace', 'alice', 'ws-b', true, false],
        ['removed active member', 'alice', 'ws-a', true, false],
        ['downgraded viewer', 'alice', 'ws-a', false, true],
    ])('refuses deletion by a %s and preserves the stored credential', async (_case, user, workspace, removed, downgraded) => {
        if (removed) memberships.delete('alice:ws-a');
        if (downgraded) memberships.set('alice:ws-a', 'viewer');
        select(user as string, workspace as string);
        const target = ids['alice:ws-a']!;
        const response = await call('DELETE', target);
        expect(response.status).toBe(403);
        expect(await store.get(target)).not.toBeNull();
    });

    it.each([['alice', 'ws-a'], ['alice', 'ws-b'], ['bob', 'ws-a']])(
        'allows %s to delete their own connection in %s', async (user, workspace) => {
            select(user, workspace);
            const target = ids[`${user}:${workspace}`]!;
            const response = await call('DELETE', target);
            expect(response.status).toBe(200);
            expect(await response.json()).toEqual({ ok: true });
            expect(await store.get(target)).toBeNull();
            expect((await fixtures.service!.list({ ownerUserId: user, workspaceId: workspace })).length).toBe(0);
        }
    );
});
