import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    readManifest: vi.fn(), localAdmission: vi.fn(), signedRelease: vi.fn(), candidate: vi.fn(), noSetup: vi.fn(),
    workspaceIds: [] as string[], enabled: new Set<string>(), selected: [] as unknown[],
}));
vi.mock('../package-operation-support', () => ({ readPackageManifest: mocks.readManifest, packageGrantCandidate: mocks.candidate }));
vi.mock('../local-admission', () => ({ readLocalAdmission: mocks.localAdmission }));
vi.mock('../site-policy-service', () => ({ signedRelease: mocks.signedRelease }));
vi.mock('../setup-readiness', () => ({ packageNeedsNoSetup: mocks.noSetup }));
vi.mock('../../stores/registry', () => ({ getWorkspaceAccessStore: () => ({}) }));
vi.mock('../../../utils/plugins/acquisition/route-support', () => ({ listAllWorkspaceIds: async () => mocks.workspaceIds }));
vi.mock('../workspace-plugin-store', () => ({
    getEnabledPlugins: async (_settings: unknown, workspaceId: string) => mocks.enabled.has(workspaceId) ? ['example', 'dependent'] : [],
    getPluginGrantReview: async () => ({ status: 'current' }),
}));
vi.mock('../package-route-catalog', () => ({ PluginPackageRouteCatalog: class { listSelected() { return mocks.selected; } } }));

const { prepareRollbackWorkspacePreflight } = await import('../rollback-workspaces');
const manifest = (id: string, version: string, required: { id: string; range: string; features: string[] }[] = []) => ({
    id, version, engines: { or3: '*', pluginApi: '*' }, trust: 'isolated-client', requestedGrants: [],
    features: { required: [], optional: [] }, dependencies: { required, optional: [] }, runtime: {},
});
afterEach(() => { mocks.workspaceIds = []; mocks.enabled.clear(); mocks.selected = []; mocks.signedRelease.mockReset(); });

describe('rollback release verification', () => {
    it('names every enabled workspace in the reviewed impact and omits disabled workspaces', async () => {
        mocks.workspaceIds = ['ws-one', 'ws-two', 'ws-disabled'];
        mocks.enabled = new Set(['ws-one', 'ws-two']);
        mocks.readManifest.mockResolvedValue(manifest('example', '0.1.0'));
        mocks.selected = [{ status: 'ready', pluginId: 'example', manifest: manifest('example', '0.2.0') }];
        mocks.localAdmission.mockResolvedValue({ digest: 'local' });
        mocks.candidate.mockResolvedValue({ requestedGrants: [] });
        mocks.noSetup.mockResolvedValue(true);
        const compatibility = { version: 1, reads: { minimum: 1, maximum: 1 }, rollback: 'safe' };
        const services = { packages: { packagePath: () => '/tmp/example' }, settings: {}, migration: { getStateVersion: async () => 1 } };
        const previous = { packageDigest: `sha256-${'a'.repeat(64)}`, stateCompatibility: compatibility };
        const preflight = await prepareRollbackWorkspacePreflight({} as never, services as never, 'example', previous as never);
        const impact = await preflight({ current: { stateCompatibility: compatibility } as never, previous: previous as never });
        expect(impact).toMatchObject({ checked: 2, enabledWorkspaceIds: ['ws-one', 'ws-two'], blocking: [] });
        const guarded = await prepareRollbackWorkspacePreflight({} as never, services as never, 'example', previous as never,
            { expectedEnabledWorkspaceSha256: `sha256-${'0'.repeat(64)}` });
        const stale = await guarded({ current: { stateCompatibility: compatibility } as never, previous: previous as never });
        expect(stale.blocking).toContainEqual({ workspaceId: '*', code: 'enabled-workspace-set-changed' });
    });
    it('blocks rollback when the previous release needs a missing or disabled dependency', async () => {
        mocks.workspaceIds = ['ws-one'];
        mocks.enabled = new Set(['ws-one']);
        mocks.readManifest.mockResolvedValue(manifest('example', '0.1.0', [{ id: 'missing', range: '^1.0.0', features: [] }]));
        mocks.selected = [{ status: 'ready', pluginId: 'example', manifest: manifest('example', '0.2.0') }];
        mocks.localAdmission.mockResolvedValue({ digest: 'local' });
        mocks.candidate.mockResolvedValue({ requestedGrants: [] });
        mocks.noSetup.mockResolvedValue(true);
        const compatibility = { version: 1, reads: { minimum: 1, maximum: 1 }, rollback: 'safe' };
        const previous = { packageDigest: `sha256-${'a'.repeat(64)}`, stateCompatibility: compatibility };
        const services = { packages: { packagePath: () => '/tmp/example' }, settings: {}, migration: { getStateVersion: async () => 1 } };
        const preflight = await prepareRollbackWorkspacePreflight({} as never, services as never, 'example', previous as never);
        const result = await preflight({ current: { stateCompatibility: compatibility } as never, previous: previous as never });
        expect(result.blocking).toContainEqual({ workspaceId: '*', code: 'package-dependency-blocked' });
        mocks.workspaceIds = [];
        mocks.enabled.clear();
        const emptyPreflight = await prepareRollbackWorkspacePreflight({} as never, services as never, 'example', previous as never);
        const withoutEnabledWorkspaces = await emptyPreflight({ current: { stateCompatibility: compatibility } as never, previous: previous as never });
        expect(withoutEnabledWorkspaces.blocking).toContainEqual({ workspaceId: '*', code: 'package-dependency-blocked' });
    });

    it('blocks rollback when it would break an enabled dependent', async () => {
        mocks.workspaceIds = ['ws-one'];
        mocks.enabled = new Set(['ws-one']);
        mocks.readManifest.mockResolvedValue(manifest('example', '1.0.0'));
        mocks.selected = [
            { status: 'ready', pluginId: 'example', manifest: manifest('example', '2.0.0') },
            { status: 'ready', pluginId: 'dependent', manifest: manifest('dependent', '1.0.0', [{ id: 'example', range: '^2.0.0', features: [] }]) },
        ];
        mocks.localAdmission.mockResolvedValue({ digest: 'local' });
        mocks.candidate.mockResolvedValue({ requestedGrants: [] });
        mocks.noSetup.mockResolvedValue(true);
        const compatibility = { version: 1, reads: { minimum: 1, maximum: 1 }, rollback: 'safe' };
        const previous = { packageDigest: `sha256-${'a'.repeat(64)}`, stateCompatibility: compatibility };
        const services = { packages: { packagePath: () => '/tmp/example' }, settings: {}, migration: { getStateVersion: async () => 1 } };
        const preflight = await prepareRollbackWorkspacePreflight({} as never, services as never, 'example', previous as never);
        const result = await preflight({ current: { stateCompatibility: compatibility } as never, previous: previous as never });
        expect(result.blocking).toContainEqual({ workspaceId: 'ws-one', code: 'package-dependency-blocked' });
    });
    it('rejects a quarantined marketplace release even when the site policy is absent', async () => {
        mocks.readManifest.mockResolvedValue({ version: '0.1.0' });
        mocks.localAdmission.mockResolvedValue(null);
        mocks.signedRelease.mockRejectedValue(Object.assign(new Error('Quarantined'), { code: 'release-quarantined' }));
        const services = { packages: { packagePath: () => '/tmp/example' } };
        const previous = { packageDigest: `sha256-${'a'.repeat(64)}` };
        await expect(prepareRollbackWorkspacePreflight({} as never, services as never, 'example', previous as never))
            .rejects.toMatchObject({ code: 'release-quarantined' });
        expect(mocks.signedRelease).toHaveBeenCalledWith('example', '0.1.0');
    });

    it('rechecks quarantine before the pointer commit even after a successful initial review', async () => {
        const previous = { packageDigest: `sha256-${'a'.repeat(64)}` };
        const release = { releaseId: 'rel_previous', packageTreeSha256: previous.packageDigest, authoritySha256: `sha256-${'b'.repeat(64)}` };
        mocks.readManifest.mockResolvedValue({ version: '0.1.0' });
        mocks.localAdmission.mockResolvedValue(null);
        mocks.signedRelease.mockReset().mockResolvedValueOnce(release).mockRejectedValueOnce(Object.assign(new Error('Quarantined'), { code: 'release-quarantined' }));
        mocks.candidate.mockResolvedValue({ requestedGrants: [] });
        mocks.noSetup.mockResolvedValue(true);
        const services = { packages: { packagePath: () => '/tmp/example' } };
        const preflight = await prepareRollbackWorkspacePreflight({} as never, services as never, 'example', previous as never);
        await expect(preflight({ current: {} as never, previous: previous as never }))
            .rejects.toMatchObject({ code: 'release-quarantined' });
    });
});
