import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createApp, createRouter, toNodeListener } from 'h3';
import { initializeSqliteDb, destroySqliteDb, _resetForTest } from '../../../../../../../or3-provider-sqlite/src/runtime/server/db/kysely';
import { runMigrations } from '../../../../../../../or3-provider-sqlite/src/runtime/server/db/migrate';
import { SqliteAuthWorkspaceStore } from '../../../../../../../or3-provider-sqlite/src/runtime/server/auth/sqlite-auth-workspace-store';
import { createSqliteWorkspaceAccessStore, createSqliteWorkspaceSettingsStore } from '../../../../../../../or3-provider-sqlite/src/runtime/server/admin/stores/sqlite-store';
import { PluginRolloutCoordinator } from '../../../../../admin/plugins/rollout-service';
import { PluginRolloutStore } from '../../../../../admin/plugins/rollout-store';
import { SitePluginPolicyStore } from '../../../../../admin/plugins/site-policy';
import { ImmutablePluginPackageStore } from '../../../../../admin/plugins/package-store';
import { getEnabledPlugins } from '../../../../../admin/plugins/workspace-plugin-store';
import { rolloutMutationStatus } from '../../../../../admin/plugins/rollout-route-error';

const harness = vi.hoisted(() => ({ coordinator: null as PluginRolloutCoordinator | null }));
const authGate = vi.hoisted(() => vi.fn(async () => ({ principal: { kind: 'super_admin', username: 'test-admin' } })));
const digest = `sha256-${'a'.repeat(64)}`;
const authority = `sha256-${'b'.repeat(64)}`;
const candidate = { requestedGrants: [], releaseId: 'rel_route', packageDigest: digest, authoritySha256: authority, authority: null };
vi.mock('../../../../../admin/api', () => ({ requireAdminApiContext: authGate }));
vi.mock('../../../../../admin/plugins/rollout-route-support', () => ({
    rolloutCandidateFor: async () => ({ candidate, release: { version: '1.0.0', requestedGrants: [] }, policy: null }),
    rolloutCoordinatorFor: () => harness.coordinator,
}));

const { default: previewRoute } = await import('../index.post');
const { default: startRoute } = await import('../[operationId]/start.post');
const { default: continueRoute } = await import('../[operationId]/continue.post');
const { default: cancelRoute } = await import('../[operationId]/cancel.post');

let root = '';
let server: Server | null = null;
afterEach(async () => {
    await new Promise<void>((resolve) => server?.close(() => resolve()) ?? resolve());
    server = null;
    harness.coordinator = null;
    await destroySqliteDb();
    if (root) await rm(root, { recursive: true, force: true });
    root = '';
});

describe('rollout HTTP routes with SQLite provider', () => {
    it('previews and resumes 1,000 exact targets through HTTP after a SQLite reconnect', async () => {
        root = await mkdtemp(join(tmpdir(), 'or3-rollout-http-'));
        _resetForTest();
        const dbPath = join(root, 'route.db');
        await runMigrations(await initializeSqliteDb({ path: dbPath }));
        let access = createSqliteWorkspaceAccessStore();
        let settings = createSqliteWorkspaceSettingsStore();
        const auth = new SqliteAuthWorkspaceStore();
        const { userId } = await auth.getOrCreateUser({ provider: 'basic-auth', providerUserId: 'route-owner' });
        const workspaceIds: string[] = [];
        for (let index = 0; index < 1000; index += 1) {
            const { workspaceId } = await access.createWorkspace({ name: `Route workspace ${index}`, ownerUserId: userId });
            workspaceIds.push(workspaceId);
        }
        const policies = new SitePluginPolicyStore(root);
        await policies.save('acme.test', 0, { catalogVisible: true, approvedRelease: {
            releaseId: 'rel_route', version: '1.0.0', packageTreeSha256: digest as `sha256-${string}`,
            authoritySha256: authority as `sha256-${string}`,
            display: { name: 'Test', summary: '', publisherName: '', category: 'automation', tags: [] },
        }, futureDefault: null }, 'test-admin');
        const records = new PluginRolloutStore(root);
        const packageStore = new ImmutablePluginPackageStore(root);
        const dependencies = {
            policies, records, settings,
            listAllWorkspaceIds: async () => workspaceIds,
            getWorkspace: (id) => access.getWorkspace({ workspaceId: id }),
            selectedPointer: async () => ({ packageDigest: digest, revision: 1 }),
            withPluginLock: (pluginId, fn) => packageStore.runPluginOperation(pluginId, fn),
            checkSetup: async () => 'ready',
        } satisfies ConstructorParameters<typeof PluginRolloutCoordinator>[0];
        harness.coordinator = new PluginRolloutCoordinator(dependencies);
        const router = createRouter();
        router.post('/api/admin/plugins/rollouts', previewRoute);
        router.post('/api/admin/plugins/rollouts/:operationId/start', startRoute);
        router.post('/api/admin/plugins/rollouts/:operationId/continue', continueRoute);
        router.post('/api/admin/plugins/rollouts/:operationId/cancel', cancelRoute);
        const app = createApp();
        app.use(router);
        server = createServer(toNodeListener(app));
        await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
        const address = server.address();
        if (!address || typeof address === 'string') throw new Error('No test server address');
        const base = `http://127.0.0.1:${address.port}/api/admin/plugins/rollouts`;
        const startedAt = Date.now();
        const post = async (url: string, body: unknown) => {
            const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
            return { status: response.status, data: await response.json() as Record<string, unknown> };
        };
        const preview = await post(base, { pluginId: 'acme.test', selection: { kind: 'all-existing' }, enabled: true, includeFutureWorkspaces: false });
        expect(preview.status).toBe(200);
        const operation = preview.data.preview as { id: string; revision: number };
        const start = await post(`${base}/${operation.id}/start`, { expectedRevision: operation.revision });
        expect(start.status).toBe(200);
        const started = start.data.operation as { revision: number };
        let current = started as { revision: number; status?: string; counts?: Record<string, number> };
        let requests = 0;
        while (current.status !== 'completed' && requests < 50) {
            const continued = await post(`${base}/${operation.id}/continue`, { expectedRevision: current.revision });
            expect(continued.status).toBe(200);
            current = continued.data.operation as typeof current;
            requests += 1;
            if (requests === 10) {
                await destroySqliteDb();
                _resetForTest();
                await initializeSqliteDb({ path: dbPath });
                access = createSqliteWorkspaceAccessStore();
                settings = createSqliteWorkspaceSettingsStore();
                harness.coordinator = new PluginRolloutCoordinator({ ...dependencies, settings });
            }
        }
        expect(current.status).toBe('completed');
        expect(current.counts?.applied).toBe(1000);
        expect(requests).toBe(40);
        expect(await getEnabledPlugins(settings, workspaceIds[999]!)).toContain('acme.test');
        const stale = await post(`${base}/${operation.id}/continue`, { expectedRevision: started.revision });
        expect(stale.status).toBe(409);
        authGate.mockRejectedValueOnce(Object.assign(new Error('Forbidden'), { statusCode: 403 }));
        const unauthorized = await post(base, { pluginId: 'acme.test', selection: { kind: 'all-existing' }, enabled: true, includeFutureWorkspaces: false });
        expect(unauthorized.status).toBe(403);
        const disablePreview = await post(base, { pluginId: 'acme.test', selection: { kind: 'selected', workspaceIds: workspaceIds.slice(0, 26) }, enabled: false, includeFutureWorkspaces: false });
        expect(disablePreview.status).toBe(200);
        const disabling = disablePreview.data.preview as { id: string; revision: number };
        const disableStart = await post(`${base}/${disabling.id}/start`, { expectedRevision: disabling.revision });
        expect(disableStart.status).toBe(200);
        let releaseWrite: (() => void) | undefined;
        const heldWrite = new Promise<void>((resolve) => { releaseWrite = resolve; });
        const delayedSettings = createSqliteWorkspaceSettingsStore();
        const originalCas = delayedSettings.compareAndSet!.bind(delayedSettings);
        delayedSettings.compareAndSet = async (workspaceId, key, expectedValue, nextValue) => {
            if (workspaceId === workspaceIds[0] && key === 'plugins.enabled') await heldWrite;
            return originalCas(workspaceId, key, expectedValue, nextValue);
        };
        harness.coordinator = new PluginRolloutCoordinator({ ...dependencies, settings: delayedSettings });
        let pending: { status: number; data: Record<string, unknown> };
        try {
            const response = await fetch(`${base}/${disabling.id}/continue`, {
                method: 'POST', headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ expectedRevision: (disableStart.data.operation as { revision: number }).revision }),
                signal: AbortSignal.timeout(10_000),
            });
            pending = { status: response.status, data: await response.json() as Record<string, unknown> };
            expect(pending.status).toBe(202);
            expect(pending.data.processing).toBe(true);
            expect((pending.data.operation as { counts: Record<string, number> }).counts.pending).toBe(26);
        } finally {
            releaseWrite?.();
        }
        await expect.poll(async () => (await records.read(disabling.id))?.revision).toBe((disableStart.data.operation as { revision: number }).revision + 1);
        const beforeCancel = await records.read(disabling.id);
        expect(beforeCancel?.status).toBe('running');
        const cancelled = await post(`${base}/${disabling.id}/cancel`, { expectedRevision: beforeCancel!.revision });
        expect(cancelled.status).toBe(200);
        await expect.poll(async () => (await records.read(disabling.id))?.status).toBe('cancelled');
        expect(await getEnabledPlugins(settings, workspaceIds[0]!)).not.toContain('acme.test');
        expect(await getEnabledPlugins(settings, workspaceIds[25]!)).toContain('acme.test');
        const failedPreview = await post(base, { pluginId: 'acme.test', selection: { kind: 'selected', workspaceIds: [workspaceIds[25]] }, enabled: false, includeFutureWorkspaces: false });
        const failedOperation = failedPreview.data.preview as { id: string; revision: number };
        let rejectLock!: (reason: unknown) => void;
        const heldLock = new Promise<never>((_, reject) => { rejectLock = reject; });
        harness.coordinator = new PluginRolloutCoordinator({ ...dependencies,
            withPluginLock: async <T>() => heldLock as Promise<T> });
        const failedPending = await post(`${base}/${failedOperation.id}/start`, { expectedRevision: failedOperation.revision });
        expect(failedPending.status).toBe(202);
        expect(rolloutMutationStatus(failedOperation.id)?.processing).toBe(true);
        rejectLock(Object.assign(new Error('The reviewed release changed'), { code: 'rollout-preview-stale' }));
        await expect.poll(() => rolloutMutationStatus(failedOperation.id)?.failure).toContain('reviewed release changed');
        expect(rolloutMutationStatus(failedOperation.id)?.processing).toBe(false);
        await mkdir(join(process.cwd(), 'output'), { recursive: true });
        await writeFile(join(process.cwd(), 'output', 'plugin-rollout-route-qualification.json'), JSON.stringify({
            provider: 'sqlite', targetCount: 1000, routeContinuations: requests,
            sqliteConnectionReopenedAfter: 10, staleRevisionRejected: true, unauthorizedRouteRejected: true,
            delayedWriteReturnedPending: pending.status === 202,
            delayedWriteCommittedAfterResponse: true, cancellationKeptRemainingWorkspace: true,
            failedPendingRequestObservable: rolloutMutationStatus(failedOperation.id)?.processing === false,
            counts: current.counts, durationMs: Date.now() - startedAt,
        }, null, 2));
    }, 60_000);
});
