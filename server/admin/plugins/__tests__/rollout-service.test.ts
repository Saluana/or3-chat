import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PluginRolloutStore } from '../rollout-store';
import { PluginRolloutCoordinator } from '../rollout-service';
import { SitePluginPolicyStore } from '../site-policy';
import type { WorkspaceSettingsStore } from '../../stores/types';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });
const digest = `sha256-${'a'.repeat(64)}` as const;
const authority = `sha256-${'b'.repeat(64)}` as const;

async function harness(count: number) {
    const root = await mkdtemp(join(tmpdir(), 'or3-rollout-service-'));
    roots.push(root);
    const values = new Map<string, string>();
    const settings: WorkspaceSettingsStore = {
        get: async (ws, key) => values.get(`${ws}:${key}`) ?? null,
        set: async (ws, key, value) => { values.set(`${ws}:${key}`, value); },
        compareAndSet: async (ws, key, expected, next) => {
            const id = `${ws}:${key}`;
            if ((values.get(id) ?? null) !== expected) return false;
            values.set(id, next);
            return true;
        },
    };
    const workspaces = Array.from({ length: count }, (_, index) => `ws-${index}`);
    const policies = new SitePluginPolicyStore(root);
    await policies.save('acme.test', 0, { catalogVisible: true, approvedRelease: {
        releaseId: 'rel_test', version: '1.0.0', packageTreeSha256: digest, authoritySha256: authority,
        display: { name: 'Test', summary: '', publisherName: '', category: 'automation', tags: [] },
    }, futureDefault: null }, 'admin');
    const records = new PluginRolloutStore(root);
    let setupBlocked = new Set<string>();
    const deps = {
        policies, records, settings,
        listAllWorkspaceIds: async () => workspaces,
        getWorkspace: async (id: string) => workspaces.includes(id) ? { id, name: id, deleted: false, createdAt: 0, memberCount: 1, ownerUserId: 'owner' } : null,
        selectedPointer: async () => ({ packageDigest: digest, revision: 7 }),
        withPluginLock: async <T>(_pluginId: string, fn: () => Promise<T>) => fn(),
        checkSetup: async (id: string) => setupBlocked.has(id) ? 'required' as const : 'ready' as const,
    };
    const candidate = { requestedGrants: [], releaseId: 'rel_test', packageDigest: digest, authoritySha256: authority, authority: null };
    return { root, values, workspaces, policies, records, deps, candidate, setSetupBlocked: (ids: string[]) => { setupBlocked = new Set(ids); } };
}

describe('request-driven rollout', () => {
    it('accounts for 1,000 workspaces in batches of at most 25 after a service restart', async () => {
        const h = await harness(1000);
        let service = new PluginRolloutCoordinator(h.deps);
        const preview = await service.createPreview({ pluginId: 'acme.test', actorId: 'admin', selection: { kind: 'all-existing' }, enabled: true, includeFutureWorkspaces: false, approvedGrants: [], candidate: h.candidate });
        expect(preview.targets).toHaveLength(1000);
        await service.start(preview.id, h.candidate);
        for (let i = 0; i < 10; i++) await service.continue(preview.id, h.candidate);
        service = new PluginRolloutCoordinator(h.deps);
        for (let i = 0; i < 30; i++) await service.continue(preview.id, h.candidate);
        const final = await h.records.page(preview.id);
        expect(final?.status).toBe('completed');
        expect(final).not.toBeNull();
        expect(final!.counts.applied + final!.counts['already-applied']).toBe(1000);
        expect(final?.counts.pending).toBe(0);
        expect(h.values.get('ws-999:plugins.enabled')).toContain('acme.test');
    });

    it('leaves setup-blocked workspaces disabled and retries only unresolved targets', async () => {
        const h = await harness(3);
        h.setSetupBlocked(['ws-1']);
        const service = new PluginRolloutCoordinator(h.deps);
        const preview = await service.createPreview({ pluginId: 'acme.test', actorId: 'admin', selection: { kind: 'all-existing' }, enabled: true, includeFutureWorkspaces: true, approvedGrants: [], candidate: h.candidate });
        await service.start(preview.id, h.candidate);
        await service.continue(preview.id, h.candidate);
        expect((await h.records.page(preview.id))?.counts.blocked).toBe(1);
        expect(h.values.has('ws-1:plugins.enabled')).toBe(false);
        expect((await h.policies.read('acme.test'))?.futureDefault?.enabled).toBe(true);
        h.setSetupBlocked([]);
        await service.retry(preview.id, h.candidate);
        await service.continue(preview.id, h.candidate);
        expect((await h.records.page(preview.id))?.counts.blocked).toBe(0);
        expect(h.values.get('ws-1:plugins.enabled')).toContain('acme.test');
    });

    it('retries a setup-blocked target after its rollout permission review was saved', async () => {
        const h = await harness(1);
        const candidate = { ...h.candidate, requestedGrants: ['settings.read'] };
        h.setSetupBlocked(['ws-0']);
        const service = new PluginRolloutCoordinator(h.deps);
        const preview = await service.createPreview({ pluginId: 'acme.test', actorId: 'admin',
            selection: { kind: 'all-existing' }, enabled: true, includeFutureWorkspaces: false,
            approvedGrants: ['settings.read'], candidate });
        await service.start(preview.id, candidate);
        await service.continue(preview.id, candidate);
        expect((await h.records.page(preview.id))?.counts.blocked).toBe(1);
        expect(h.values.has('ws-0:plugins.grants.acme.test')).toBe(true);
        h.setSetupBlocked([]);
        await service.retry(preview.id, candidate);
        await service.continue(preview.id, candidate);
        expect((await h.records.page(preview.id))?.counts.applied).toBe(1);
        expect(await h.deps.settings.get('ws-0', 'plugins.enabled')).toContain('acme.test');
    });

    it('reconciles a committed write after a lost response and sends the activation signal on retry', async () => {
        const h = await harness(1);
        const originalCas = h.deps.settings.compareAndSet!;
        let loseResponse = true;
        h.deps.settings.compareAndSet = async (...args) => {
            const applied = await originalCas(...args);
            if (applied && loseResponse) {
                loseResponse = false;
                throw new Error('response lost after commit');
            }
            return applied;
        };
        const signalled: string[] = [];
        const service = new PluginRolloutCoordinator({ ...h.deps, onApplied: async (id) => { signalled.push(id); } });
        const preview = await service.createPreview({ pluginId: 'acme.test', actorId: 'admin', selection: { kind: 'all-existing' }, enabled: true, includeFutureWorkspaces: false, approvedGrants: [], candidate: h.candidate });
        await service.start(preview.id, h.candidate);
        await service.continue(preview.id, h.candidate);
        expect((await h.records.page(preview.id))?.counts.failed).toBe(1);
        expect(h.values.get('ws-0:plugins.enabled')).toContain('acme.test');
        await service.retry(preview.id, h.candidate);
        await service.continue(preview.id, h.candidate);
        expect((await h.records.page(preview.id))?.counts['already-applied']).toBe(1);
        expect(signalled).toEqual(['ws-0']);
    });

    it('records a committed enablement when a post-commit admin hook fails', async () => {
        const h = await harness(1);
        const service = new PluginRolloutCoordinator({ ...h.deps, onApplied: async () => { throw new Error('observer unavailable'); } });
        const preview = await service.createPreview({ pluginId: 'acme.test', actorId: 'admin',
            selection: { kind: 'all-existing' }, enabled: true, includeFutureWorkspaces: false,
            approvedGrants: [], candidate: h.candidate });
        await service.start(preview.id, h.candidate);
        await service.continue(preview.id, h.candidate);
        expect((await h.records.page(preview.id))?.counts.applied).toBe(1);
        expect(h.values.get('ws-0:plugins.enabled')).toContain('acme.test');
    });

    it('preserves a newer workspace permission restriction made after preview', async () => {
        const h = await harness(1);
        const candidate = { ...h.candidate, requestedGrants: ['settings.read'] };
        const service = new PluginRolloutCoordinator(h.deps);
        const preview = await service.createPreview({ pluginId: 'acme.test', actorId: 'admin', selection: { kind: 'all-existing' }, enabled: true, includeFutureWorkspaces: false, approvedGrants: ['settings.read'], candidate });
        const newerRestriction = '{"newer":"restriction"}';
        h.values.set('ws-0:plugins.grants.acme.test', newerRestriction);
        await service.start(preview.id, candidate);
        await service.continue(preview.id, candidate);
        expect((await h.records.page(preview.id))?.counts.blocked).toBe(1);
        expect(h.values.get('ws-0:plugins.grants.acme.test')).toBe(newerRestriction);
        expect(h.values.has('ws-0:plugins.enabled')).toBe(false);
    });

    it('refuses a stale preview after approval changes and leaves every workspace untouched', async () => {
        const h = await harness(2);
        const service = new PluginRolloutCoordinator(h.deps);
        const preview = await service.createPreview({ pluginId: 'acme.test', actorId: 'admin', selection: { kind: 'all-existing' }, enabled: true, includeFutureWorkspaces: true, approvedGrants: [], candidate: h.candidate });
        const policy = (await h.policies.read('acme.test'))!;
        await h.policies.save('acme.test', policy.revision, { catalogVisible: false, approvedRelease: policy.approvedRelease, futureDefault: null }, 'other-admin');
        await expect(service.start(preview.id, h.candidate)).rejects.toMatchObject({ code: 'rollout-preview-stale' });
        expect(h.values.size).toBe(0);
        expect((await h.records.read(preview.id))?.status).toBe('preview');
    });

    it('does not provision a future default removed after workspace creation began', async () => {
        const h = await harness(1);
        const service = new PluginRolloutCoordinator(h.deps);
        const captured = (await h.policies.read('acme.test'))!;
        const futureDefault = { enabled: true, packageTreeSha256: digest, authoritySha256: authority, approvedGrants: [] };
        const withFuture = await h.policies.save('acme.test', captured.revision, { catalogVisible: true, approvedRelease: captured.approvedRelease, futureDefault }, 'admin');
        await h.policies.save('acme.test', withFuture.revision, { catalogVisible: true, approvedRelease: captured.approvedRelease, futureDefault: null }, 'other-admin');
        await expect(service.createPreview({ pluginId: 'acme.test', actorId: 'workspace-provisioning', selection: { kind: 'selected', workspaceIds: ['ws-0'] }, enabled: true, includeFutureWorkspaces: false, approvedGrants: [], candidate: h.candidate,
            provisioningGuard: { policyRevision: withFuture.revision, futureDefault },
        })).rejects.toMatchObject({ code: 'rollout-preview-stale' });
        expect(h.values.size).toBe(0);
    });

    it('does not replay completed workspace writes when start and continue are retried', async () => {
        const h = await harness(1);
        const service = new PluginRolloutCoordinator(h.deps);
        const preview = await service.createPreview({ pluginId: 'acme.test', actorId: 'admin', selection: { kind: 'all-existing' }, enabled: true, includeFutureWorkspaces: false, approvedGrants: [], candidate: h.candidate });
        await service.start(preview.id, h.candidate);
        await service.start(preview.id, h.candidate);
        const first = await service.continue(preview.id, h.candidate);
        const second = await service.continue(preview.id, h.candidate);
        expect(first.status).toBe('completed');
        expect(second.revision).toBe(first.revision);
        expect((await h.records.page(preview.id))?.counts.applied).toBe(1);
    });

    it('does not restart a cancelled rollout from a stale retry', async () => {
        const h = await harness(2);
        const service = new PluginRolloutCoordinator(h.deps);
        const preview = await service.createPreview({ pluginId: 'acme.test', actorId: 'admin', selection: { kind: 'all-existing' }, enabled: true, includeFutureWorkspaces: false, approvedGrants: [], candidate: h.candidate });
        await service.start(preview.id, h.candidate);
        await service.cancel(preview.id);
        await expect(service.retry(preview.id, h.candidate)).rejects.toMatchObject({ code: 'rollout-invalid' });
        expect((await h.records.read(preview.id))?.status).toBe('cancelled');
        expect(h.values.size).toBe(0);
    });

    it('disables existing workspaces even when the site approval file is corrupt', async () => {
        const h = await harness(2);
        h.values.set('ws-0:plugins.enabled', '["acme.test"]');
        h.values.set('ws-1:plugins.enabled', '["acme.test"]');
        await writeFile(join(h.root, '.plugin-admin', 'acme.test.json'), '{broken');
        const service = new PluginRolloutCoordinator(h.deps);
        const preview = await service.createPreview({ pluginId: 'acme.test', actorId: 'admin', selection: { kind: 'all-existing' }, enabled: false, includeFutureWorkspaces: false, approvedGrants: [], candidate: h.candidate });
        await service.start(preview.id, h.candidate);
        await service.continue(preview.id, h.candidate);
        expect((await h.records.page(preview.id))?.counts.applied).toBe(2);
        expect(h.values.get('ws-0:plugins.enabled')).toBe('[]');
        expect(h.values.get('ws-1:plugins.enabled')).toBe('[]');
    });

    it('rejects a stale mutation revision after another administrator advances the rollout', async () => {
        const h = await harness(1);
        const service = new PluginRolloutCoordinator(h.deps);
        const preview = await service.createPreview({ pluginId: 'acme.test', actorId: 'admin', selection: { kind: 'all-existing' }, enabled: true, includeFutureWorkspaces: false, approvedGrants: [], candidate: h.candidate });
        const started = await service.start(preview.id, h.candidate, preview.revision);
        await expect(service.cancel(preview.id, preview.revision)).rejects.toMatchObject({ code: 'rollout-conflict' });
        expect((await h.records.read(preview.id))?.revision).toBe(started.revision);
    });

    it('keeps cancellation behind an uncertain provider write until its result is known', async () => {
        const h = await harness(1);
        let releaseWrite!: () => void;
        let enteredWrite!: () => void;
        const writeGate = new Promise<void>((resolve) => { releaseWrite = resolve; });
        const entered = new Promise<void>((resolve) => { enteredWrite = resolve; });
        const originalCas = h.deps.settings.compareAndSet!;
        h.deps.settings.compareAndSet = async (...args) => {
            if (args[1] === 'plugins.enabled') { enteredWrite(); await writeGate; }
            return originalCas(...args);
        };
        let tail = Promise.resolve();
        let lockRequests = 0;
        let cancelQueued!: () => void;
        const queued = new Promise<void>((resolve) => { cancelQueued = resolve; });
        const service = new PluginRolloutCoordinator({ ...h.deps, withPluginLock: async <T>(_id: string, fn: () => Promise<T>) => {
            if (++lockRequests === 3) cancelQueued();
            const preceding = tail;
            let releaseLock!: () => void;
            tail = new Promise<void>((resolve) => { releaseLock = resolve; });
            await preceding;
            try { return await fn(); } finally { releaseLock(); }
        } });
        const preview = await service.createPreview({ pluginId: 'acme.test', actorId: 'admin', selection: { kind: 'all-existing' }, enabled: true, includeFutureWorkspaces: false, approvedGrants: [], candidate: h.candidate });
        await service.start(preview.id, h.candidate);
        try {
            let continuationReturned = false;
            const continuing = service.continue(preview.id, h.candidate).then((value) => { continuationReturned = true; return value; });
            await entered;
            let cancelled = false;
            const cancelling = service.cancel(preview.id).then(() => { cancelled = true; });
            await queued;
            await new Promise<void>((resolve) => setTimeout(resolve, 8_200));
            expect(continuationReturned).toBe(false);
            expect(cancelled).toBe(false);
            releaseWrite();
            await continuing;
            await cancelling;
            expect((await h.records.read(preview.id))?.status).toBe('completed');
        } finally {
            releaseWrite();
        }
    }, 15_000);
});
