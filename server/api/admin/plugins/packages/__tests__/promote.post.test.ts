import { describe, expect, it, vi } from 'vitest';

const digest = `sha256-${'a'.repeat(64)}`;
const mocks = vi.hoisted(() => ({ promote: vi.fn(), setPluginEnabled: vi.fn().mockResolvedValue([]) }));
vi.mock('h3', () => ({
    defineEventHandler: (handler: unknown) => handler,
    getRouterParam: () => 'acme.test',
    readBody: async () => ({ candidateDigest: digest }),
    createError: (input: { statusCode: number; statusMessage: string }) => Object.assign(new Error(input.statusMessage), input),
}));
vi.mock('../../../../../admin/api', () => ({ requireAdminApiContext: async () => ({ session: { user: { id: 'admin' } } }) }));
vi.mock('../../../../../admin/workspace-target', () => ({ resolveAdminWorkspaceTarget: () => 'ws-admin' }));
vi.mock('../../../../../admin/stores/registry', () => ({ getWorkspaceSettingsStore: () => ({}) }));
vi.mock('../../../../../admin/plugins/package-operation-support', () => ({
    pluginPackageServices: () => ({
        packages: { packagePath: () => '/unused', runPluginOperation: async (_id: string, fn: () => Promise<unknown>) => fn() },
        settings: {}, migration: { getStateVersion: async () => 1 }, promotion: { promote: mocks.promote },
    }),
    readPackageManifest: async () => ({ version: '1.0.0' }),
    packageGrantCandidate: async () => ({ packageDigest: digest, authoritySha256: digest }),
    readPackageGrantReview: async () => ({ status: 'current' }),
    readPluginStateSnapshot: async () => ({}), restorePluginStateSnapshot: async () => undefined,
}));
vi.mock('../../../../../admin/plugins/workspace-plugin-store', () => ({ getEnabledPlugins: async () => [], setPluginEnabled: mocks.setPluginEnabled }));
vi.mock('../../../../../utils/plugins/acquisition/route-support', () => ({
    acquisitionServiceFor: async () => ({ listForPlugin: async () => [], preflightWorkspaces: async () => ({ blocking: [] }) }),
    listAllWorkspaceIds: async () => [],
}));
vi.mock('../../../../../utils/plugins/acquisition/route-identity', () => ({ requesterIdentity: () => 'admin' }));
vi.mock('../../../../../utils/plugins/setup/settings-store', () => ({ promoteScopedSetupValues: async () => null }));
vi.mock('../../../../../admin/plugins/local-admission', () => ({ readLocalAdmission: async () => ({ digest }) }));
vi.mock('../../../../../admin/plugins/site-policy-service', () => ({ isSiteReleaseStillApproved: async () => true, signedRelease: async () => null }));

const { default: route } = await import('../[pluginId]/promote.post');

describe('promotion commit response', () => {
    it('reports a committed promotion even when the optional admin hook fails afterward', async () => {
        mocks.promote.mockResolvedValue({ status: 'promoted', wasInstalled: true, pointer: { current: { packageDigest: digest } } });
        const event = { context: { adminHooks: { doAction: async () => { throw new Error('hook failed'); } } } };
        await expect(route(event as never)).resolves.toMatchObject({ ok: true, status: 'promoted' });
    });
    it('reports pending workspace enablement when the selected version committed but enablement failed', async () => {
        mocks.promote.mockResolvedValue({ status: 'promoted', wasInstalled: false, pointer: { current: { packageDigest: digest } } });
        mocks.setPluginEnabled.mockRejectedValueOnce(new Error('provider unavailable'));
        const event = { context: {} };
        await expect(route(event as never)).resolves.toMatchObject({
            ok: true, status: 'promoted', workspaceEnablement: 'pending',
        });
    });
    it('refuses a blocked promotion instead of reporting it as a successful HTTP response', async () => {
        mocks.promote.mockResolvedValue({ status: 'blocked', stage: 'workspaces', code: 'workspace-preflight-blocked' });
        await expect(route({ context: {} } as never)).rejects.toMatchObject({
            statusCode: 409,
        });
    });
});
