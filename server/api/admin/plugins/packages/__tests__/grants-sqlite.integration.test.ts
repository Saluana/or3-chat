import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createApp, createRouter, toNodeListener } from 'h3';
import { initializeSqliteDb, destroySqliteDb, _resetForTest } from '../../../../../../../or3-provider-sqlite/src/runtime/server/db/kysely';
import { runMigrations } from '../../../../../../../or3-provider-sqlite/src/runtime/server/db/migrate';
import { SqliteAuthWorkspaceStore } from '../../../../../../../or3-provider-sqlite/src/runtime/server/auth/sqlite-auth-workspace-store';
import { createSqliteWorkspaceAccessStore, createSqliteWorkspaceSettingsStore } from '../../../../../../../or3-provider-sqlite/src/runtime/server/admin/stores/sqlite-store';
import { ImmutablePluginPackageStore } from '../../../../../admin/plugins/package-store';
import { getPluginGrantReview, setPluginEnabled } from '../../../../../admin/plugins/workspace-plugin-store';
import type { WorkspaceSettingsStore } from '../../../../../admin/stores/types';

const testState = vi.hoisted(() => ({
    settings: null as WorkspaceSettingsStore | null,
    root: '', workspaceIds: [] as string[],
}));
const pluginId = 'or3.sample-utility';
const digest = `sha256-${'a'.repeat(64)}` as const;
const authoritySha256 = `sha256-${'b'.repeat(64)}` as const;
const candidate = { requestedGrants: ['settings.read'], releaseId: 'rel_bulk', packageDigest: digest,
    authoritySha256, authority: null };
vi.mock('../../../../../admin/api', () => ({ requireAdminApiContext: async () => ({
    principal: { kind: 'super_admin', username: 'test-admin' }, session: { workspace: { id: testState.workspaceIds[0] }, user: { id: 'test-admin' } },
}) }));
vi.mock('../../../../../admin/workspace-target', () => ({ resolveAdminWorkspaceTarget: (context: { session: { workspace: { id: string } } }) => context.session.workspace.id }));
vi.mock('../../../../../admin/stores/registry', () => ({ getWorkspaceSettingsStore: () => testState.settings }));
vi.mock('../../../../../admin/plugins/package-operation-support', () => ({ pluginPackageServices: () => ({
    settings: testState.settings, packages: new ImmutablePluginPackageStore(testState.root), pointers: { readPointer: async () => null },
}) }));
vi.mock('../../../../../admin/plugins/site-policy-service', () => ({ isSiteReleaseStillApproved: async () => true }));
vi.mock('../../../../../utils/plugins/acquisition/route-support', () => ({
    listAllWorkspaceIds: async () => testState.workspaceIds,
    registryClientFor: () => ({ resolveRelease: async () => ({ ok: true, value: { document: {
        releaseId: candidate.releaseId, requestedGrants: candidate.requestedGrants,
        packageTreeSha256: digest, authoritySha256,
    } } }) }),
}));
vi.mock('../../../../../utils/plugins/acquisition/config', () => ({ acquisitionConfig: () => ({}) }));
vi.mock('../../../../../utils/plugins/acquisition/registry-state', () => ({ RegistryStateStore: class { async read() { return { acceptedAdvisorySequence: 0 }; } } }));
vi.mock('../../../../../utils/plugins/acquisition/route-identity', () => ({ requesterIdentity: () => 'test-admin' }));

const { default: grantsRoute } = await import('../[pluginId]/grants.post');
let server: Server | null = null;
afterEach(async () => {
    await new Promise<void>((resolve) => server?.close(() => resolve()) ?? resolve());
    server = null;
    await destroySqliteDb();
    if (testState.root) await rm(testState.root, { recursive: true, force: true });
    testState.root = ''; testState.settings = null; testState.workspaceIds = [];
});

describe('deployment permission approval over HTTP and SQLite', () => {
    it('bounds 1,000 writes, reports a partial failure, and retries the same enabled set', async () => {
        _resetForTest();
        testState.root = await mkdtemp(join(tmpdir(), 'or3-grants-sqlite-'));
        await runMigrations(await initializeSqliteDb({ path: join(testState.root, 'grants.db') }));
        const access = createSqliteWorkspaceAccessStore();
        const rawSettings = createSqliteWorkspaceSettingsStore();
        const auth = new SqliteAuthWorkspaceStore();
        const { userId } = await auth.getOrCreateUser({ provider: 'basic-auth', providerUserId: 'grant-owner' });
        for (let index = 0; index < 1000; index++) {
            const { workspaceId } = await access.createWorkspace({ name: `Grant workspace ${index}`, ownerUserId: userId });
            testState.workspaceIds.push(workspaceId);
            await setPluginEnabled(rawSettings, workspaceId, pluginId, true);
        }
        let activeWrites = 0;
        let maxConcurrentWrites = 0;
        let failOne = true;
        const failedId = testState.workspaceIds[500]!;
        testState.settings = { get: rawSettings.get.bind(rawSettings), set: rawSettings.set.bind(rawSettings),
            compareAndSet: async (workspaceId, key, expected, next) => {
            activeWrites += 1;
            maxConcurrentWrites = Math.max(maxConcurrentWrites, activeWrites);
            try {
                if (failOne && workspaceId === failedId && key.startsWith('plugins.grants.')) throw new Error('disposable provider fault');
                await new Promise((resolve) => setTimeout(resolve, 2));
                return await rawSettings.compareAndSet!(workspaceId, key, expected, next);
            } finally { activeWrites -= 1; }
        } };
        const router = createRouter();
        router.post('/api/admin/plugins/packages/:pluginId/grants', grantsRoute);
        const app = createApp(); app.use(router);
        server = createServer(toNodeListener(app));
        await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
        const address = server.address();
        if (!address || typeof address === 'string') throw new Error('No test server address');
        const endpoint = `http://127.0.0.1:${address.port}/api/admin/plugins/packages/${pluginId}/grants`;
        const enabledIds = [...testState.workspaceIds].sort();
        const fingerprint = `sha256-${createHash('sha256').update(JSON.stringify(enabledIds)).digest('hex')}`;
        const body = { approvedGrants: ['settings.read'], expectedPackageDigest: digest, expectedAuthoritySha256: authoritySha256,
            version: '2.0.0', deploymentWide: true, expectedEnabledWorkspaceSha256: fingerprint };
        const post = async () => {
            const response = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
            return { status: response.status, data: await response.json() as Record<string, unknown> };
        };
        const startedAt = Date.now();
        const partial = await post();
        expect(partial.status, JSON.stringify(partial.data)).toBe(503);
        expect(maxConcurrentWrites).toBeLessThanOrEqual(25);
        expect(maxConcurrentWrites).toBeGreaterThan(1);
        expect((await getPluginGrantReview(rawSettings, failedId, pluginId, candidate)).status).not.toBe('current');
        failOne = false;
        const completed = await post();
        expect(completed.status).toBe(200);
        expect(completed.data.reviewedWorkspaces).toBe(1000);
        expect((await getPluginGrantReview(rawSettings, failedId, pluginId, candidate)).status).toBe('current');
        await mkdir(join(process.cwd(), 'output'), { recursive: true });
        await writeFile(join(process.cwd(), 'output', 'plugin-grants-route-qualification.json'), JSON.stringify({
            provider: 'sqlite', targetCount: 1000, firstStatus: partial.status, retryStatus: completed.status,
            failedWorkspaceIndex: 500, maxConcurrentWrites, durationMs: Date.now() - startedAt,
        }, null, 2));
    }, 90_000);
});
