import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    config: vi.fn(), listPointerIds: vi.fn(), listPolicies: vi.fn(), migrate: vi.fn(),
    settingsGet: vi.fn(), settingsSet: vi.fn(), candidate: vi.fn(), coordinator: vi.fn(), preview: vi.fn(), start: vi.fn(), continue: vi.fn(),
}));

vi.mock('#imports', () => ({ useRuntimeConfig: mocks.config }));
vi.mock('../../admin/plugins/package-store', () => ({ ImmutablePluginPackageStore: class {} }));
vi.mock('../../admin/plugins/package-pointer-store', () => ({ PluginPackagePointerStore: class { listPluginIds() { return mocks.listPointerIds(); } } }));
vi.mock('../../admin/plugins/site-policy', () => ({ SitePluginPolicyStore: class { list() { return mocks.listPolicies(); } } }));
vi.mock('../../admin/plugins/site-policy-service', () => ({ ensureSitePolicyMigrated: mocks.migrate }));
vi.mock('../../admin/stores/registry', () => ({ getWorkspaceSettingsStore: () => ({ get: mocks.settingsGet, set: mocks.settingsSet }) }));
vi.mock('../../admin/plugins/rollout-route-support', () => ({
    rolloutCandidateFor: mocks.candidate,
    rolloutCoordinatorFor: mocks.coordinator,
}));

const { provisionWorkspaceDefaults } = await import('../provisioning');

beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset();
    mocks.config.mockReturnValue({ plugins: { defaultEnabled: ['acme.marketplace'] } });
    mocks.listPointerIds.mockResolvedValue([]);
    mocks.listPolicies.mockResolvedValue([{ pluginId: 'acme.marketplace', catalogVisible: false, futureDefault: null }]);
    mocks.migrate.mockResolvedValue(undefined);
    mocks.settingsGet.mockResolvedValue(null);
    mocks.settingsSet.mockResolvedValue(undefined);
    mocks.coordinator.mockReturnValue({ createPreview: mocks.preview, start: mocks.start, continue: mocks.continue });
});

describe('new workspace plugin defaults', () => {
    it('does not enable a site-hidden marketplace plugin from source default configuration', async () => {
        await provisionWorkspaceDefaults({ context: {} } as never, 'ws-new');
        expect(mocks.settingsSet).not.toHaveBeenCalled();
        expect(mocks.preview).not.toHaveBeenCalled();
    });

    it('journals an approved future default for the newly created workspace', async () => {
        const digest = `sha256-${'a'.repeat(64)}`;
        const authority = `sha256-${'b'.repeat(64)}`;
        mocks.listPolicies.mockResolvedValue([{ pluginId: 'acme.marketplace', catalogVisible: true,
            approvedRelease: { packageTreeSha256: digest, authoritySha256: authority },
            futureDefault: { enabled: true, packageTreeSha256: digest, authoritySha256: authority, approvedGrants: [] },
        }]);
        mocks.candidate.mockResolvedValue({ candidate: { packageDigest: digest, authoritySha256: authority } });
        mocks.preview.mockResolvedValue({ id: 'rol_test' });
        mocks.continue.mockResolvedValue({ targets: [{ outcome: { state: 'applied' } }] });
        const result = await provisionWorkspaceDefaults({ context: {} } as never, 'ws-new', { ownerUserId: 'owner', name: 'New workspace' });
        expect(result.warnings).toEqual([]);
        expect(mocks.coordinator).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
            id: 'ws-new', ownerUserId: 'owner', name: 'New workspace',
        }));
        expect(mocks.preview).toHaveBeenCalledWith(expect.objectContaining({
            selection: { kind: 'selected', workspaceIds: ['ws-new'] },
            includeFutureWorkspaces: false,
        }));
        expect(mocks.start).toHaveBeenCalledWith('rol_test', expect.any(Object));
        expect(mocks.continue).toHaveBeenCalledWith('rol_test', expect.any(Object));
    });

    it('returns the created workspace with a repair operation when setup blocks it', async () => {
        const digest = `sha256-${'a'.repeat(64)}`;
        const authority = `sha256-${'b'.repeat(64)}`;
        mocks.listPolicies.mockResolvedValue([{ pluginId: 'acme.marketplace', catalogVisible: true,
            approvedRelease: { packageTreeSha256: digest, authoritySha256: authority },
            futureDefault: { enabled: true, packageTreeSha256: digest, authoritySha256: authority, approvedGrants: [] },
        }]);
        mocks.candidate.mockResolvedValue({ candidate: { packageDigest: digest, authoritySha256: authority } });
        mocks.preview.mockResolvedValue({ id: 'rol_test' });
        mocks.continue.mockResolvedValue({ targets: [{ outcome: { state: 'blocked' } }] });
        const result = await provisionWorkspaceDefaults({ context: {} } as never, 'ws-new');
        expect(result.warnings).toEqual([expect.stringContaining('rollout rol_test')]);
        expect(mocks.settingsSet).toHaveBeenCalledWith('ws-new', 'plugins.provisioning.repairs', JSON.stringify([{
            pluginId: 'acme.marketplace',
            operationId: 'rol_test',
            message: result.warnings[0],
        }]));
    });

    it('returns the created workspace while a provider write remains pending', async () => {
        vi.useFakeTimers();
        try {
            const digest = `sha256-${'a'.repeat(64)}`;
            const authority = `sha256-${'b'.repeat(64)}`;
            mocks.listPolicies.mockResolvedValue([{ pluginId: 'acme.marketplace', catalogVisible: true,
                approvedRelease: { packageTreeSha256: digest, authoritySha256: authority },
                futureDefault: { enabled: true, packageTreeSha256: digest, authoritySha256: authority, approvedGrants: [] },
            }]);
            mocks.candidate.mockResolvedValue({ candidate: { packageDigest: digest, authoritySha256: authority } });
            mocks.preview.mockResolvedValue({ id: 'rol_pending' });
            mocks.start.mockResolvedValue(undefined);
            mocks.continue.mockReturnValue(new Promise(() => {}));
            const result = provisionWorkspaceDefaults({ context: {} } as never, 'ws-new');
            await vi.advanceTimersByTimeAsync(8_001);
            await expect(result).resolves.toMatchObject({ warnings: [expect.stringContaining('rol_pending')] });
            expect(mocks.settingsSet).toHaveBeenCalledWith('ws-new', 'plugins.provisioning.repairs',
                expect.stringContaining('rol_pending'));
        } finally { vi.useRealTimers(); }
    });

    it('records later defaults for repair when an earlier rollout exceeds the request budget', async () => {
        vi.useFakeTimers();
        try {
            const digest = `sha256-${'a'.repeat(64)}`;
            const authority = `sha256-${'b'.repeat(64)}`;
            mocks.listPolicies.mockResolvedValue(['first.plugin', 'second.plugin'].map((pluginId) => ({
                pluginId, catalogVisible: true, revision: 1,
                approvedRelease: { packageTreeSha256: digest, authoritySha256: authority },
                futureDefault: { enabled: true, packageTreeSha256: digest, authoritySha256: authority, approvedGrants: [] },
            })));
            mocks.candidate.mockResolvedValue({ candidate: { packageDigest: digest, authoritySha256: authority } });
            mocks.preview.mockImplementation(async ({ pluginId }) => ({ id: `rollout-${pluginId}` }));
            mocks.start.mockResolvedValue(undefined);
            mocks.continue.mockReturnValue(new Promise(() => {}));
            const pending = provisionWorkspaceDefaults({ context: {} } as never, 'ws-new');
            await vi.advanceTimersByTimeAsync(8_001);
            await pending;
            const repairs = JSON.parse(mocks.settingsSet.mock.calls.at(-1)![2]);
            expect(repairs.map((entry: { pluginId: string }) => entry.pluginId)).toEqual(['first.plugin', 'second.plugin']);
        } finally { vi.useRealTimers(); }
    });

    it('does not start a default rollout when its repair reference cannot be persisted', async () => {
        const digest = `sha256-${'a'.repeat(64)}`;
        const authority = `sha256-${'b'.repeat(64)}`;
        mocks.listPolicies.mockResolvedValue([{ pluginId: 'acme.marketplace', catalogVisible: true,
            approvedRelease: { packageTreeSha256: digest, authoritySha256: authority },
            futureDefault: { enabled: true, packageTreeSha256: digest, authoritySha256: authority, approvedGrants: [] },
        }]);
        mocks.candidate.mockResolvedValue({ candidate: { packageDigest: digest, authoritySha256: authority } });
        mocks.preview.mockResolvedValue({ id: 'rol_untracked' });
        mocks.settingsSet.mockRejectedValue(new Error('settings unavailable'));

        const result = await provisionWorkspaceDefaults({ context: {} } as never, 'ws-new');

        expect(result.warnings).toEqual(expect.arrayContaining([
            expect.stringContaining('repair details could not be saved'),
        ]));
        expect(mocks.start).not.toHaveBeenCalled();
        expect(mocks.continue).not.toHaveBeenCalled();
    });
});
