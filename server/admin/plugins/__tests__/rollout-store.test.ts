import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PluginRolloutStore } from '../rollout-store';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

describe('durable plugin rollout records', () => {
    it('removes long-expired unused previews while keeping a new operation', async () => {
        const root = await mkdtemp(join(tmpdir(), 'or3-rollout-'));
        roots.push(root);
        const store = new PluginRolloutStore(root);
        const input = {
            pluginId: 'acme.test', actorId: 'admin', packageDigest: `sha256-${'a'.repeat(64)}`,
            authoritySha256: `sha256-${'b'.repeat(64)}`, pointerRevision: 1, policyRevision: 2,
            enabled: true, includeFutureWorkspaces: false, approvedGrants: [], targets: [],
        };
        const old = await store.create(input);
        await store.replace({ ...old, revision: old.revision + 1, expiresAt: Date.now() - 8 * 24 * 60 * 60_000 });
        const current = await store.create(input);
        expect(await store.read(old.id)).toBeNull();
        expect(await store.read(current.id)).not.toBeNull();
    });

    it('persists a frozen target set, bounded status pages and revision conflicts', async () => {
        const root = await mkdtemp(join(tmpdir(), 'or3-rollout-'));
        roots.push(root);
        const store = new PluginRolloutStore(root);
        const record = await store.create({
            pluginId: 'acme.test', actorId: 'admin', packageDigest: `sha256-${'a'.repeat(64)}`,
            authoritySha256: `sha256-${'b'.repeat(64)}`, pointerRevision: 1, policyRevision: 2,
            enabled: true, includeFutureWorkspaces: false, approvedGrants: [],
            targets: Array.from({ length: 1000 }, (_, i) => ({ workspaceId: `ws-${i}`, enabledBefore: false, outcome: { state: 'pending' as const } })),
        });
        const reopened = new PluginRolloutStore(root);
        expect((await reopened.read(record.id))?.targets).toHaveLength(1000);
        expect(await reopened.page(record.id, 2, 25)).toMatchObject({ total: 1000, items: expect.arrayContaining([{ workspaceId: 'ws-25', enabledBefore: false, outcome: { state: 'pending' } }]) });
        await expect(store.replace({ ...record, revision: 8 })).rejects.toMatchObject({ code: 'rollout-conflict' });
    });

    it('lists failures across the entire rollout without paging through successful workspaces', async () => {
        const root = await mkdtemp(join(tmpdir(), 'or3-rollout-'));
        roots.push(root);
        const store = new PluginRolloutStore(root);
        const record = await store.create({
            pluginId: 'acme.test', actorId: 'admin', packageDigest: `sha256-${'a'.repeat(64)}`,
            authoritySha256: `sha256-${'b'.repeat(64)}`, pointerRevision: 1, policyRevision: 2,
            enabled: true, includeFutureWorkspaces: false, approvedGrants: [],
            targets: Array.from({ length: 1000 }, (_, index) => ({
                workspaceId: `ws-${index}`, enabledBefore: false,
                outcome: index === 999 || index === 501
                    ? { state: 'blocked' as const, code: 'setup-required', message: 'Configure the workspace.' }
                    : { state: 'applied' as const },
            })),
        });
        const failures = await store.page(record.id, 1, 25, 'problems');
        expect(failures?.filteredTotal).toBe(2);
        expect(failures?.items.map((item) => item.workspaceId)).toEqual(['ws-501', 'ws-999']);
        expect(failures?.counts.applied).toBe(998);
    });
});
