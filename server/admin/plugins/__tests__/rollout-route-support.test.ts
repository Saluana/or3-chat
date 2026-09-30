import { describe, expect, it, vi } from 'vitest';
import { resolve } from 'node:path';

const digest = `sha256-${'a'.repeat(64)}`;
const pointerSelection = vi.fn();
const policyRead = vi.fn();
const accessGet = vi.hoisted(() => vi.fn(async () => ({ ownerUserId: 'owner', deleted: false })));
vi.mock('../../stores/registry', () => ({
    getWorkspaceSettingsStore: () => ({ get: async () => null, set: async () => undefined }),
    getWorkspaceAccessStore: () => ({ getWorkspace: accessGet }),
}));
vi.mock('../package-store', () => ({
    ImmutablePluginPackageStore: class {
        packagePath() { return resolve(import.meta.dirname, '../../../../examples/plugins/dashboard-insights-v2'); }
        runPluginOperation(_id: string, fn: () => unknown) { return fn(); }
        verifyStoredPackage() { throw new Error('damaged package'); }
    },
}));
vi.mock('../package-pointer-store', () => ({ PluginPackagePointerStore: class { readStartupSelection() { return pointerSelection(); } } }));
vi.mock('../site-policy', () => ({ SitePluginPolicyStore: class { read() { return policyRead(); } } }));
vi.mock('../site-policy-service', () => ({ ensureSitePolicyMigrated: async () => undefined, signedRelease: async () => { throw new Error('registry down'); } }));
vi.mock('../rollout-store', () => ({ PluginRolloutStore: class {} }));
vi.mock('../../../utils/plugins/acquisition/route-support', () => ({ listAllWorkspaceIds: async () => [] }));
vi.mock('../../../utils/plugins/connections/resolve', () => ({ resolveConnectionService: () => ({ service: {}, durable: false }) }));
vi.mock('../../../utils/plugins/setup/state', () => ({ loadSetupState: async () => ({ packageDigest: digest, status: { status: 'blocked' } }) }));
vi.mock('../../../utils/plugins/isolation/activation-registry', () => ({ revokeHostActivationsForPluginWorkspace: vi.fn() }));

const { rolloutCoordinatorFor, rolloutCandidateFor } = await import('../rollout-route-support');

describe('real package setup classification', () => {
    it('uses verified creation facts for normal-user provisioning without an admin workspace query', async () => {
        accessGet.mockRejectedValueOnce(new Error('admin membership required'));
        const created = { id: 'ws-new', name: 'New', ownerUserId: 'owner', createdAt: 1, deleted: false, memberCount: 1 };
        const coordinator = rolloutCoordinatorFor({ context: {} } as never, created);
        expect(await coordinator.deps.getWorkspace('ws-new')).toEqual(created);
        expect(await coordinator.deps.checkSetup('ws-new', 'or3-workflows', digest)).toBe('ready');
        expect(accessGet).not.toHaveBeenCalled();
        accessGet.mockReset();
        accessGet.mockResolvedValue({ ownerUserId: 'owner', deleted: false });
    });
    it('allows a trusted host package with no setup descriptors', async () => {
        const coordinator = rolloutCoordinatorFor({ context: {} } as never);
        expect(await coordinator.deps.checkSetup('ws-1', 'or3-workflows', digest)).toBe('ready');
    });

    it('can preview disabling a managed plugin even when its package is unreadable', async () => {
        pointerSelection.mockResolvedValue({ status: 'blocked', pointer: { revision: 4, current: { packageDigest: digest } }, selected: null });
        policyRead.mockResolvedValue({ approvedRelease: { version: '1.0.0', authoritySha256: `sha256-${'b'.repeat(64)}` }, catalogVisible: false });
        const { candidate } = await rolloutCandidateFor('or3-workflows', true);
        expect(candidate.packageDigest).toBe(digest);
        const coordinator = rolloutCoordinatorFor({ context: {} } as never);
        expect(await coordinator.deps.selectedPointer('or3-workflows', false)).toEqual({ packageDigest: digest, revision: 4 });
    });

    it('can disable by plugin identity when no readable package or policy remains', async () => {
        pointerSelection.mockResolvedValue({ status: 'blocked', pointer: null, selected: null });
        policyRead.mockRejectedValue(new Error('corrupt policy'));
        const { candidate } = await rolloutCandidateFor('or3-workflows', true);
        const coordinator = rolloutCoordinatorFor({ context: {} } as never);
        expect(candidate.packageDigest).toMatch(/^sha256-0{64}$/);
        expect(await coordinator.deps.selectedPointer('or3-workflows', false)).toEqual({ packageDigest: candidate.packageDigest, revision: 0 });
    });
});
