import { describe, expect, it, vi, beforeEach } from 'vitest';

/**
 * Consent is only meaningful if the requested authority comes from the release
 * itself. The route must never take the requested set from the request body,
 * and must fail closed when neither the staged candidate nor the signed release
 * metadata can be read.
 */
const readManifestMock = vi.fn();
const readPointerMock = vi.fn();
const setReviewMock = vi.fn();
const resolveReleaseMock = vi.fn();
let body: Record<string, unknown> = {};

vi.mock('h3', () => ({
    defineEventHandler: (handler: unknown) => handler,
    createError: (options: {
        statusCode: number;
        statusMessage?: string;
        data?: unknown;
    }) => Object.assign(new Error(options.statusMessage ?? 'error'), options),
    readBody: async () => body,
    getRouterParam: () => 'or3.sample-utility',
}));

vi.mock('../../../../admin/api', () => ({
    requireAdminApiContext: async () => ({
        principal: { kind: 'super_admin', username: 'admin' },
        session: { workspace: { id: 'ws-1' }, user: { id: 'admin' } },
    }),
}));

vi.mock('../../../../admin/workspace-target', () => ({
    resolveAdminWorkspaceTarget: () => 'ws-1',
}));

vi.mock('../../../../admin/stores/registry', () => ({
    getWorkspaceSettingsStore: () => ({}),
}));

vi.mock('../../../../admin/plugins/package-operation-support', () => ({
    pluginPackageServices: () => ({
        settings: {},
        pointers: { readPointer: (...args: unknown[]) => readPointerMock(...args) },
        packages: { packagePath: () => '/tmp/does-not-need-to-exist' },
    }),
    readPackageManifest: (...args: unknown[]) => readManifestMock(...args),
}));

vi.mock('../../../../admin/plugins/workspace-plugin-store', () => ({
    setPluginGrantReview: (...args: unknown[]) => setReviewMock(...args),
}));

vi.mock('../../../../utils/plugins/acquisition/config', () => ({
    acquisitionConfig: () => ({ registryOrigin: 'https://registry.test', releaseKeys: [] }),
}));

vi.mock('../../../../utils/plugins/acquisition/registry-state', () => ({
    RegistryStateStore: class {
        async read() {
            return { acceptedAdvisorySequence: 0, quarantinedReleases: {} };
        }
    },
}));

vi.mock('../../../../utils/plugins/acquisition/route-support', () => ({
    registryClientFor: () => ({
        resolveRelease: (...args: unknown[]) => resolveReleaseMock(...args),
    }),
}));

vi.mock('../../../../utils/plugins/acquisition/route-identity', () => ({
    requesterIdentity: () => 'super_admin:admin',
}));

async function callRoute(): Promise<Record<string, unknown>> {
    const handler = (await import('../packages/[pluginId]/grants.post')).default;
    return (await handler({
        context: { adminHooks: { doAction: async () => undefined } },
    } as never)) as Record<string, unknown>;
}

describe('grant consent route', () => {
    beforeEach(() => {
        readManifestMock.mockReset().mockResolvedValue({
            requestedGrants: ['settings.read', 'settings.write'],
        });
        readPointerMock.mockReset().mockResolvedValue({
            candidate: { packageDigest: `sha256-${'a'.repeat(64)}` },
        });
        setReviewMock.mockReset().mockResolvedValue({
            requestedGrants: ['settings.read', 'settings.write'],
            approvedGrants: ['settings.read'],
            revision: 'g1',
            status: 'current',
        });
        resolveReleaseMock.mockReset();
        body = { approvedGrants: ['settings.read'] };
    });

    it('records consent for the candidate manifest authority', async () => {
        const result = await callRoute();
        expect(result.ok).toBe(true);
        expect(setReviewMock).toHaveBeenCalledWith(
            {},
            'ws-1',
            'or3.sample-utility',
            expect.objectContaining({
                requestedGrants: ['settings.read', 'settings.write'],
                approvedGrants: ['settings.read'],
                reviewedBy: 'super_admin:admin',
            })
        );
    });

    it('refuses grants the release does not request', async () => {
        body = { approvedGrants: ['documents.write'] };
        await expect(callRoute()).rejects.toMatchObject({ statusCode: 400 });
        expect(setReviewMock).not.toHaveBeenCalled();
    });

    it('falls back to the signed release metadata when nothing is staged', async () => {
        readPointerMock.mockResolvedValue(null);
        resolveReleaseMock.mockResolvedValue({
            ok: true,
            value: { document: { requestedGrants: ['settings.read'] } },
        });
        body = { approvedGrants: ['settings.read'], version: '1.0.0' };

        const result = await callRoute();
        expect(result.ok).toBe(true);
        expect(resolveReleaseMock).toHaveBeenCalledWith({
            expectation: { pluginId: 'or3.sample-utility', version: '1.0.0' },
        });
    });

    it('fails closed when the signed authority cannot be verified', async () => {
        readPointerMock.mockResolvedValue(null);
        resolveReleaseMock.mockResolvedValue({
            ok: false,
            failure: { code: 'registry-unreachable', message: 'Registry is unreachable' },
        });

        await expect(callRoute()).rejects.toMatchObject({
            statusCode: 409,
            data: { code: 'registry-unreachable' },
        });
        expect(setReviewMock).not.toHaveBeenCalled();
    });
});
