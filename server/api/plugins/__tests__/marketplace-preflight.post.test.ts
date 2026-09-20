import { expect, it, vi } from 'vitest';

const preflight = vi.fn(async (input: unknown) => input);
vi.mock('h3', () => ({
    defineEventHandler: (handler: unknown) => handler,
    createError: (options: { statusMessage: string }) => new Error(options.statusMessage),
    setResponseHeader: vi.fn(),
}));
vi.mock('../../../auth/can', () => ({ requireSession: vi.fn(), requireCan: vi.fn() }));
vi.mock('../../../auth/session', () => ({
    resolveSessionContext: async () => ({ workspace: { id: 'workspace-2' } }),
}));
vi.mock('../../../utils/security/limited-json-body', () => ({
    readLimitedJsonBody: async () => ({ pluginId: 'or3sal.tasks', version: '0.2.0' }),
}));
vi.mock('../../../admin/stores/registry', () => ({ getWorkspaceSettingsStore: () => ({}) }));
vi.mock('../../../admin/plugins/workspace-plugin-store', () => ({ getEnabledPlugins: async () => [] }));
vi.mock('../../../admin/extensions/extension-manager', () => ({
    listInstalledExtensions: async () => [
        { kind: 'plugin', id: 'legacy.plugin' },
        { kind: 'theme', id: 'theme.test' },
    ],
}));
vi.mock('../../../admin/plugins/package-operation-support', () => ({
    pluginPackageServices: () => ({ packages: {}, pointers: {} }),
}));
vi.mock('../../../admin/plugins/package-route-catalog', () => ({
    PluginPackageRouteCatalog: class {
        async listSelected() {
            return [
                { status: 'ready', pluginId: 'or3sal.tasks' },
                { status: 'inactive', pluginId: 'candidate.only' },
            ];
        }
    },
}));
vi.mock('../../../utils/plugins/acquisition/config', () => ({
    acquisitionConfig: () => ({ registryOrigin: 'https://registry.test', installEnabled: true, releaseKeys: [{}] }),
}));
vi.mock('../../../utils/plugins/acquisition/registry-state', () => ({
    RegistryStateStore: class {
        async read() { return { acceptedAdvisorySequence: 0 }; }
    },
}));
vi.mock('../../../utils/plugins/marketplace/service', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../../utils/plugins/marketplace/service')>();
    return {
        ...actual,
        preflightMarketplaceInstall: async (input: Parameters<typeof actual.preflightMarketplaceInstall>[0]) => {
            preflight(input);
            return actual.preflightMarketplaceInstall(input);
        },
    };
});

it('includes installed V2 packages even when disabled in the requesting workspace', async () => {
    const handler = (await import('../marketplace/preflight.post')).default;
    const result = await handler({} as never);
    expect(result).toMatchObject({ status: 'blocked', blocks: [{ code: 'already-installed' }] });
    expect(preflight).toHaveBeenCalledWith(expect.objectContaining({
        workspaceId: 'workspace-2',
        installedPluginIds: ['legacy.plugin', 'or3sal.tasks'],
        enabledPluginIds: [],
    }));
});
