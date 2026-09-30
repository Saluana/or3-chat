import { beforeEach, describe, expect, it, vi } from 'vitest';

const body = vi.fn();
const approve = vi.fn();
const readPolicy = vi.fn();
const writeEnabled = vi.fn();
const readSelection = vi.fn();
const listExtensions = vi.fn();
vi.mock('h3', () => ({
    defineEventHandler: (handler: unknown) => handler,
    readBody: (...args: unknown[]) => body(...args),
    createError: (options: { statusCode: number; statusMessage: string }) => Object.assign(new Error(options.statusMessage), options),
}));
vi.mock('../../../../admin/api', () => ({ requireAdminApiContext: async () => ({ principal: { kind: 'super_admin' } }) }));
vi.mock('../../../../admin/workspace-target', () => ({ assertExpectedAdminWorkspace: () => undefined, resolveAdminWorkspaceTarget: () => 'ws-1' }));
vi.mock('../../../../admin/stores/registry', () => ({ getWorkspaceSettingsStore: () => ({}) }));
vi.mock('../../../../admin/plugins/workspace-plugin-store', () => ({ setPluginEnabled: (...args: unknown[]) => writeEnabled(...args) }));
vi.mock('../../../../utils/plugins/isolation/activation-registry', () => ({ revokeHostActivationsForPluginWorkspace: () => undefined }));
vi.mock('../../../../admin/plugins/package-store', () => ({ ImmutablePluginPackageStore: class { runPluginOperation(_id: string, action: () => Promise<unknown>) { return action(); } } }));
vi.mock('../../../../admin/plugins/package-pointer-store', () => ({ PluginPackagePointerStore: class {
    readStartupSelection() { return readSelection(); }
} }));
vi.mock('../../../../admin/plugins/package-route-catalog', () => ({ PluginPackageRouteCatalog: class {
    readManifest() { return Promise.resolve({ status: 'ready', manifest: { version: '1.0.0' } }); }
} }));
vi.mock('../../../../admin/plugins/local-admission', () => ({ readLocalAdmission: async () => null }));
vi.mock('../../../../admin/extensions/extension-manager', () => ({ listInstalledExtensions: () => listExtensions() }));
vi.mock('../../../../admin/plugins/site-policy-service', () => ({ approvedSiteRelease: (...args: unknown[]) => approve(...args) }));
vi.mock('../../../../admin/plugins/site-policy', () => ({ SitePluginPolicyStore: class { read() { return readPolicy(); } } }));

describe('workspace plugin enablement', () => {
    beforeEach(() => {
        body.mockReset().mockResolvedValue({ pluginId: 'acme.test', enabled: true });
        approve.mockReset();
        readPolicy.mockReset().mockResolvedValue({ catalogVisible: true, revision: 4 });
        writeEnabled.mockReset().mockResolvedValue(['acme.test']);
        readSelection.mockReset().mockResolvedValue({ status: 'ready', selectedSlot: 'current', selected: { packageDigest: `sha256-${'a'.repeat(64)}` } });
        listExtensions.mockReset().mockResolvedValue([]);
    });

    it('distinguishes missing approval from an unavailable verification service', async () => {
        const handler = (await import('../workspace-enable.post')).default;
        approve.mockResolvedValueOnce(null);
        await expect(handler({ context: {} } as never)).rejects.toMatchObject({ statusCode: 409 });
        approve.mockRejectedValueOnce(new Error('registry unreachable'));
        await expect(handler({ context: {} } as never)).rejects.toMatchObject({ statusCode: 503 });
        expect(writeEnabled).not.toHaveBeenCalled();
    });

    it('writes only after verifying the exact selected digest and current policy', async () => {
        approve.mockResolvedValue({ revision: 4, approvedRelease: { packageTreeSha256: `sha256-${'a'.repeat(64)}` } });
        const handler = (await import('../workspace-enable.post')).default;
        await expect(handler({ context: {} } as never)).resolves.toMatchObject({ ok: true, enabled: ['acme.test'] });
        expect(writeEnabled).toHaveBeenCalledOnce();
    });

    it('allows disabling a plugin whose selected package cannot start', async () => {
        body.mockResolvedValue({ pluginId: 'acme.test', enabled: false });
        readSelection.mockResolvedValue({ status: 'blocked', selected: { packageDigest: `sha256-${'a'.repeat(64)}` } });
        const handler = (await import('../workspace-enable.post')).default;
        await expect(handler({ context: {} } as never)).resolves.toMatchObject({ ok: true });
        expect(writeEnabled).toHaveBeenCalledWith({}, 'ws-1', 'acme.test', false);
    });

    it('refuses to enable a candidate-only package or unreadable pointer', async () => {
        const handler = (await import('../workspace-enable.post')).default;
        readSelection.mockResolvedValueOnce({ status: 'inactive', pointer: { candidate: { packageDigest: `sha256-${'a'.repeat(64)}` } }, selected: null });
        await expect(handler({ context: {} } as never)).rejects.toMatchObject({ statusCode: 409 });
        readSelection.mockRejectedValueOnce(new Error('disk read failed'));
        await expect(handler({ context: {} } as never)).rejects.toMatchObject({ statusCode: 503 });
        expect(writeEnabled).not.toHaveBeenCalled();
    });

    it('keeps an explicitly installed legacy source plugin enableable', async () => {
        const handler = (await import('../workspace-enable.post')).default;
        readSelection.mockResolvedValueOnce({ status: 'inactive', pointer: null, selected: null });
        listExtensions.mockResolvedValueOnce([{ kind: 'plugin', id: 'acme.test' }]);
        await expect(handler({ context: {} } as never)).resolves.toMatchObject({ ok: true });
        expect(writeEnabled).toHaveBeenCalledOnce();
    });
});
