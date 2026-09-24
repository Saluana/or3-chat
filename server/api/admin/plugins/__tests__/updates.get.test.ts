import { beforeEach, describe, expect, it, vi } from 'vitest';

const listSelectedMock = vi.fn();
const latestVersionMock = vi.fn();
const resolveReleaseMock = vi.fn();
const configuredMock = vi.fn();
const pinMock = vi.fn();
const catalogMock = vi.fn();
const entitlementsMock = vi.fn();
const enabledMock = vi.fn();
const reviewMock = vi.fn();
const currentAuthorityMock = vi.fn();

vi.mock('../../../../utils/plugins/marketplace/update-pins', () => ({ readUpdatePin: (...args: unknown[]) => pinMock(...args) }));
vi.mock('../../../../admin/library/route-support', () => ({ libraryLinkServiceFor: async () => ({ service: { entitlements: entitlementsMock } }) }));

vi.mock('h3', () => ({
    defineEventHandler: (handler: unknown) => handler,
}));

vi.mock('../../../../admin/api', () => ({
    requireAdminApiContext: async () => ({ session: { user: { id: 'user-1' } } }),
}));

vi.mock('../../../../admin/stores/registry', () => ({
    getWorkspaceSettingsStore: () => ({}),
}));
vi.mock('../../../../admin/plugins/workspace-plugin-store', () => ({
    getEnabledPlugins: (...args: unknown[]) => enabledMock(...args),
    getPluginGrantReview: (...args: unknown[]) => reviewMock(...args),
}));

vi.mock('../../../../admin/plugins/package-operation-support', () => ({
    pluginPackageServices: () => ({ packages: {}, pointers: {} }),
    packageGrantCandidate: (...args: unknown[]) => currentAuthorityMock(...args),
}));

vi.mock('../../../../admin/plugins/package-route-catalog', () => ({
    PluginPackageRouteCatalog: class {
        async listSelected() {
            return await listSelectedMock();
        }
    },
}));

vi.mock('../../../../utils/plugins/marketplace/service', () => ({
    marketplaceRegistryConfigured: () => configuredMock(),
    readCatalogEntry: (...args: unknown[]) => catalogMock(...args),
}));

vi.mock('../../../../utils/plugins/acquisition/config', () => ({
    acquisitionConfig: () => ({ registryOrigin: 'https://registry.test' }),
}));

vi.mock('../../../../utils/plugins/acquisition/route-support', () => ({
    registryClientFor: () => ({ resolveRelease: (...args: unknown[]) => resolveReleaseMock(...args) }),
    listAllWorkspaceIds: async () => ['ws-1', 'ws-2'],
}));

vi.mock('../../../../utils/plugins/acquisition/registry-state', () => ({
    RegistryStateStore: class {
        async read() {
            return { acceptedAdvisorySequence: 0, quarantinedReleases: {} };
        }
    },
}));

function readyPackage(pluginId: string, version: string) {
    return { status: 'ready', pluginId, manifest: { version } };
}

async function callRoute(): Promise<{
    configured: boolean;
    plugins: readonly {
        pluginId: string;
        status: string;
        latestVersion: string | null;
        reason?: string;
        release?: { authoritySha256: string; approvalRequired: boolean };
    }[];
}> {
    const handler = (await import('../updates.get')).default;
    return (await handler({} as never)) as never;
}

describe('plugin update check', () => {
    beforeEach(() => {
        enabledMock.mockReset().mockResolvedValue(['or3.model-compare']);
        reviewMock.mockReset().mockResolvedValue({ status: 'current', approvedGrants: ['documents.read'] });
        currentAuthorityMock.mockReset().mockResolvedValue({ authority: null });
        pinMock.mockReset().mockResolvedValue(null);
        entitlementsMock.mockReset().mockResolvedValue({ configured: true, linked: false });
        catalogMock.mockReset().mockImplementation(async (...args: unknown[]) => {
            const version = await latestVersionMock(...args);
            return version ? { price: { kind: 'free' }, releases: [{ version }] } : null;
        });
        listSelectedMock.mockReset().mockResolvedValue([
            readyPackage('or3.model-compare', '1.2.0'),
            readyPackage('or3.document-utilities', '2.0.0'),
            readyPackage('or3.sample', '3.0.0'),
        ]);
        configuredMock.mockReset().mockReturnValue(true);
        latestVersionMock.mockReset();
        latestVersionMock.mockImplementation(async (pluginId: string) => {
            if (pluginId === 'or3.model-compare') return '1.3.0';
            if (pluginId === 'or3.document-utilities') return '2.0.0';
            if (pluginId === 'or3.sample') return '3.1.0';
            return null;
        });
        resolveReleaseMock.mockReset().mockImplementation(async (input: { expectation: { pluginId: string } }) => {
            if (input.expectation.pluginId === 'or3.sample') {
                return {
                    ok: false,
                    failure: { code: 'release-quarantined', message: 'This release is quarantined.' },
                };
            }
            return {
                ok: true,
                value: {
                    document: {
                        releaseId: `rel_${input.expectation.pluginId}`,
                        version: '1.3.0',
                        archiveSha256: `sha256-${'a'.repeat(64)}`,
                        authoritySha256: `sha256-${'b'.repeat(64)}`,
                        requestedGrants: ['documents.read'],
                        publishedAt: '2026-01-01T00:00:00.000Z',
                    },
                },
            };
        });
    });

    it('discovers a newer release, ignores an up-to-date package, and reports a blocked one', async () => {
        const result = await callRoute();
        const byId = new Map(result.plugins.map((entry) => [entry.pluginId, entry]));

        expect(byId.get('or3.model-compare')).toMatchObject({
            status: 'update-available',
            installedVersion: '1.2.0',
            latestVersion: '1.3.0',
            release: { authoritySha256: `sha256-${'b'.repeat(64)}`, approvalRequired: false },
        });
        expect(byId.get('or3.document-utilities')).toMatchObject({
            status: 'up-to-date',
            installedVersion: '2.0.0',
            latestVersion: '2.0.0',
        });
        expect(byId.get('or3.sample')).toMatchObject({
            status: 'blocked',
            reason: 'This release is quarantined.',
        });
    });

    it('asks for one deployment approval when any enabled workspace lacks review', async () => {
        reviewMock.mockImplementation(async (_settings: unknown, workspaceId: string) => ({
            status: workspaceId === 'ws-2' ? 'stale' : 'current',
            approvedGrants: ['documents.read'],
        }));
        expect((await callRoute()).plugins[0]?.release?.approvalRequired).toBe(true);
    });

    it('shows the exact new access in an expanded authority update', async () => {
        const authority = {
            trust: 'isolated-client', grants: ['documents.read'], features: [], engines: [],
            destinations: [], connectionScopes: [], dataScopes: [], writes: [], setupHooks: [], dependencies: [],
        };
        currentAuthorityMock.mockResolvedValue({ authority });
        reviewMock.mockResolvedValue({ status: 'stale', approvedGrants: [] });
        resolveReleaseMock.mockResolvedValue({ ok: true, value: { document: {
            releaseId: 'rel_2', version: '1.3.0', archiveSha256: `sha256-${'a'.repeat(64)}`,
            packageTreeSha256: `sha256-${'c'.repeat(64)}`,
            authoritySha256: `sha256-${'b'.repeat(64)}`, requestedGrants: ['documents.read'],
            authority: { ...authority, destinations: [{ host: 'api.example.com', methods: ['GET'], pathPrefixes: ['/'] }] },
            publishedAt: '2026-01-01T00:00:00.000Z', profile: 'or3-portable-client-v1',
        } } });
        expect((await callRoute()).plugins[0]?.release).toMatchObject({
            approvalRequired: true,
            addedAccess: [{ kind: 'host-added', detail: 'api.example.com' }],
        });
    });

    it('reports installations as unknown when no registry is configured', async () => {
        configuredMock.mockReturnValue(false);
        const result = await callRoute();
        expect(result.configured).toBe(false);
        expect(result.plugins.every((entry) => entry.status === 'unknown')).toBe(true);
        expect(latestVersionMock).not.toHaveBeenCalled();
    });

    it('reports a per-plugin failure without failing the whole check', async () => {
        latestVersionMock.mockRejectedValue(new Error('Registry unreachable'));
        const result = await callRoute();
        expect(result.plugins).toHaveLength(3);
        expect(result.plugins.every((entry) => entry.status === 'unknown')).toBe(true);
        expect(result.plugins[0]?.reason).toContain('Registry unreachable');
    });
    it('respects an explicit installed-version pin', async () => {
        listSelectedMock.mockResolvedValue([readyPackage('or3.model-compare', '1.2.0')]);
        pinMock.mockResolvedValue('1.2.0');
        catalogMock.mockResolvedValue({ price: { kind: 'free' }, releases: [{ version: '1.3.0' }, { version: '1.2.0' }] });
        expect((await callRoute()).plugins[0]?.status).toBe('up-to-date');
        expect(resolveReleaseMock).not.toHaveBeenCalled();
    });

    it('does not advertise a paid update to an unlinked user', async () => {
        listSelectedMock.mockResolvedValue([readyPackage('or3.model-compare', '1.2.0')]);
        catalogMock.mockResolvedValue({ price: { kind: 'paid' }, releases: [{ version: '1.3.0' }] });
        expect((await callRoute()).plugins[0]).toMatchObject({ status: 'blocked', reason: 'This release requires Library coverage.' });
    });

    it('falls back to a compatible covered release using semantic ordering', async () => {
        listSelectedMock.mockResolvedValue([readyPackage('or3.model-compare', '1.2.0')]);
        catalogMock.mockResolvedValue({ price: { kind: 'free' }, releases: [{ version: '1.9.0' }, { version: '1.10.0' }] });
        resolveReleaseMock.mockImplementation(async ({ expectation }: { expectation: { version: string } }) => expectation.version === '1.10.0'
            ? { ok: false, failure: { message: 'Unsupported engine' } }
            : { ok: true, value: { document: { releaseId: 'rel_9', version: '1.9.0', requestedGrants: [] } } });
        expect((await callRoute()).plugins[0]).toMatchObject({ status: 'update-available', latestVersion: '1.9.0' });
        expect(resolveReleaseMock.mock.calls[0]?.[0].expectation.version).toBe('1.10.0');
    });

});
