import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { initializeSqliteDb, destroySqliteDb, _resetForTest } from '../../../../../or3-provider-sqlite/src/runtime/server/db/kysely';
import { runMigrations } from '../../../../../or3-provider-sqlite/src/runtime/server/db/migrate';
import { SqliteAuthWorkspaceStore } from '../../../../../or3-provider-sqlite/src/runtime/server/auth/sqlite-auth-workspace-store';
import { createSqliteWorkspaceAccessStore, createSqliteWorkspaceSettingsStore } from '../../../../../or3-provider-sqlite/src/runtime/server/admin/stores/sqlite-store';
import { PluginRolloutStore } from '../rollout-store';
import { PluginRolloutCoordinator } from '../rollout-service';
import { SitePluginPolicyStore } from '../site-policy';
import { ImmutablePluginPackageStore } from '../package-store';
import { getEnabledPlugins, setPluginEnabled } from '../workspace-plugin-store';

const digest = `sha256-${'a'.repeat(64)}` as const;
const authority = `sha256-${'b'.repeat(64)}` as const;
let root = '';

afterEach(async () => {
    await destroySqliteDb();
    if (root) await rm(root, { recursive: true, force: true });
    root = '';
});

describe('SQLite-backed workspace rollout', () => {
    it('resumes 1,000 real workspace settings after restart while preserving a concurrent plugin choice', async () => {
        _resetForTest();
        root = await mkdtemp(join(tmpdir(), 'or3-rollout-sqlite-'));
        const dbPath = join(root, 'rollout.db');
        await runMigrations(await initializeSqliteDb({ path: dbPath }));
        let access = createSqliteWorkspaceAccessStore();
        let settings = createSqliteWorkspaceSettingsStore();
        const competingSettings = createSqliteWorkspaceSettingsStore();
        const auth = new SqliteAuthWorkspaceStore();
        const { userId } = await auth.getOrCreateUser({ provider: 'basic-auth', providerUserId: 'rollout-owner' });
        const workspaceIds: string[] = [];
        for (let index = 0; index < 1000; index += 1) {
            const { workspaceId } = await access.createWorkspace({ name: `Workspace ${index}`, ownerUserId: userId });
            workspaceIds.push(workspaceId);
        }
        const policies = new SitePluginPolicyStore(root);
        await policies.save('acme.test', 0, { catalogVisible: true, approvedRelease: {
            releaseId: 'rel_test', version: '1.0.0', packageTreeSha256: digest, authoritySha256: authority,
            display: { name: 'Test', summary: '', publisherName: '', category: 'automation', tags: [] },
        }, futureDefault: null }, 'admin');
        const records = new PluginRolloutStore(root);
        const packageStore = new ImmutablePluginPackageStore(root);
        const deps = {
            policies, records, settings,
            listAllWorkspaceIds: async () => workspaceIds,
            getWorkspace: (workspaceId: string) => access.getWorkspace({ workspaceId }),
            selectedPointer: async () => ({ packageDigest: digest, revision: 1 }),
            withPluginLock: <T>(pluginId: string, fn: () => Promise<T>) => packageStore.runPluginOperation(pluginId, fn),
            checkSetup: async () => 'ready' as const,
        };
        const candidate = { requestedGrants: [], releaseId: 'rel_test', packageDigest: digest, authoritySha256: authority, authority: null };
        let coordinator = new PluginRolloutCoordinator(deps);
        const startedAt = Date.now();
        const preview = await coordinator.createPreview({ pluginId: 'acme.test', actorId: 'admin', selection: { kind: 'all-existing' }, enabled: true, includeFutureWorkspaces: true, approvedGrants: [], candidate });
        await coordinator.start(preview.id, candidate);
        for (let index = 0; index < 10; index += 1) await coordinator.continue(preview.id, candidate);
        const competingId = workspaceIds[500]!;
        await setPluginEnabled(competingSettings, competingId, 'acme.other', true);
        await destroySqliteDb();
        _resetForTest();
        await initializeSqliteDb({ path: dbPath });
        access = createSqliteWorkspaceAccessStore();
        settings = createSqliteWorkspaceSettingsStore();
        coordinator = new PluginRolloutCoordinator({ ...deps, settings, getWorkspace: (workspaceId) => access.getWorkspace({ workspaceId }) });
        for (let index = 0; index < 30; index += 1) await coordinator.continue(preview.id, candidate);
        const result = await records.page(preview.id);
        expect(result?.status).toBe('completed');
        expect(result?.counts).toMatchObject({ applied: 1000, pending: 0, failed: 0, blocked: 0 });
        expect(await getEnabledPlugins(settings, competingId)).toEqual(['acme.other', 'acme.test']);
        expect((await policies.read('acme.test'))?.futureDefault?.enabled).toBe(true);
        await mkdir(join(process.cwd(), 'output'), { recursive: true });
        await writeFile(join(process.cwd(), 'output', 'plugin-rollout-qualification.json'), JSON.stringify({
            provider: 'sqlite', targetCount: 1000, continuationLimit: 25, sqliteConnectionReopened: true,
            competingChoicePreserved: true, counts: result?.counts, durationMs: Date.now() - startedAt,
        }, null, 2));
    }, 60_000);

    it('reports a future default saved before the rollout journal failed, even after cancellation', async () => {
        _resetForTest();
        root = await mkdtemp(join(tmpdir(), 'or3-rollout-future-'));
        await runMigrations(await initializeSqliteDb({ path: join(root, 'future.db') }));
        const access = createSqliteWorkspaceAccessStore();
        const settings = createSqliteWorkspaceSettingsStore();
        const auth = new SqliteAuthWorkspaceStore();
        const { userId } = await auth.getOrCreateUser({ provider: 'basic-auth', providerUserId: 'future-owner' });
        const { workspaceId } = await access.createWorkspace({ name: 'Future default recovery', ownerUserId: userId });
        const policies = new SitePluginPolicyStore(root);
        await policies.save('acme.test', 0, { catalogVisible: true, approvedRelease: {
            releaseId: 'rel_test', version: '1.0.0', packageTreeSha256: digest, authoritySha256: authority,
            display: { name: 'Test', summary: '', publisherName: '', category: 'automation', tags: [] },
        }, futureDefault: null }, 'admin');
        const records = new PluginRolloutStore(root);
        const packages = new ImmutablePluginPackageStore(root);
        const candidate = { requestedGrants: [], releaseId: 'rel_test', packageDigest: digest, authoritySha256: authority, authority: null };
        const coordinator = new PluginRolloutCoordinator({ policies, records, settings,
            listAllWorkspaceIds: async () => [workspaceId],
            getWorkspace: (id) => access.getWorkspace({ workspaceId: id }),
            selectedPointer: async () => ({ packageDigest: digest, revision: 1 }),
            withPluginLock: <T>(id: string, fn: () => Promise<T>) => packages.runPluginOperation(id, fn),
            checkSetup: async () => 'ready' as const,
        });
        const preview = await coordinator.createPreview({ pluginId: 'acme.test', actorId: 'admin',
            selection: { kind: 'all-existing' }, enabled: true, includeFutureWorkspaces: true,
            approvedGrants: [], candidate });
        const originalReplace = records.replace.bind(records);
        let loseJournal = true;
        records.replace = async (record) => {
            if (loseJournal) { loseJournal = false; throw new Error('journal response lost'); }
            return originalReplace(record);
        };
        await expect(coordinator.start(preview.id, candidate)).rejects.toThrow('journal response lost');
        expect((await records.read(preview.id))?.futureDefaultApplied).toBe(false);
        expect((await policies.read('acme.test'))?.futureDefault?.enabled).toBe(true);
        const cancelled = await coordinator.cancel(preview.id, preview.revision);
        expect(cancelled).toMatchObject({ status: 'cancelled', futureDefaultApplied: true });
        expect(await getEnabledPlugins(settings, workspaceId)).not.toContain('acme.test');
        await mkdir(join(process.cwd(), 'output'), { recursive: true });
        await writeFile(join(process.cwd(), 'output', 'plugin-rollout-future-default-recovery.json'), JSON.stringify({
            provider: 'sqlite', futureDefaultSaved: true, journalFailed: true,
            cancellationReportedSavedDefault: true, workspaceStayedDisabled: true,
        }, null, 2));
    });
});
