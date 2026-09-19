import { describe, expect, it, vi, beforeEach } from 'vitest';

/**
 * Consent is only meaningful if the requested authority comes from the release
 * itself. The route must never take the requested set from the request body,
 * must bind the approval to the candidate the reviewer saw, and must fail
 * closed when neither the staged candidate nor the signed release metadata can
 * be read.
 */
const readManifestMock = vi.fn();
const readPointerMock = vi.fn();
const setReviewMock = vi.fn();
const resolveReleaseMock = vi.fn();
const listOperationsMock = vi.fn();
const candidateMock = vi.fn();
let body: Record<string, unknown> = {};

const DIGEST_A = `sha256-${'a'.repeat(64)}`;
const DIGEST_B = `sha256-${'b'.repeat(64)}`;
const AUTHORITY_A = `sha256-${'1'.repeat(64)}`;
const AUTHORITY_B = `sha256-${'2'.repeat(64)}`;
const AUTHORITY_DESCRIPTOR = {
    trust: 'isolated-client',
    grants: [],
    features: [],
    engines: [],
    destinations: [],
    connectionScopes: [],
    dataScopes: [],
    writes: [],
    setupHooks: [],
    dependencies: [],
};

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
    packageGrantCandidate: (...args: unknown[]) => candidateMock(...args),
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
    acquisitionServiceFor: () => ({
        listForPlugin: (...args: unknown[]) => listOperationsMock(...args),
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
        readManifestMock.mockReset();
        readPointerMock.mockReset().mockResolvedValue({
            candidate: { packageDigest: DIGEST_A },
        });
        listOperationsMock.mockReset().mockResolvedValue([]);
        candidateMock.mockReset().mockResolvedValue({
            requestedGrants: ['settings.read', 'settings.write'],
            releaseId: 'rel_1',
            packageDigest: DIGEST_A,
            authoritySha256: AUTHORITY_A,
            authority: {
                trust: 'isolated-client',
                grants: ['settings.read', 'settings.write'],
                features: [],
                engines: [],
                destinations: [],
                connectionScopes: [],
                dataScopes: [],
                writes: [],
                setupHooks: [],
                dependencies: [],
            },
        });
        setReviewMock.mockReset().mockResolvedValue({
            requestedGrants: ['settings.read', 'settings.write'],
            approvedGrants: ['settings.read'],
            revision: 'g1',
            status: 'current',
            packageDigest: DIGEST_A,
            authoritySha256: AUTHORITY_A,
        });
        resolveReleaseMock.mockReset();
        body = {
            approvedGrants: ['settings.read'],
            expectedPackageDigest: DIGEST_A,
            expectedAuthoritySha256: AUTHORITY_A,
        };
    });

    it('records consent bound to the candidate digest and authority', async () => {
        const result = await callRoute();
        expect(result.ok).toBe(true);
        expect(setReviewMock).toHaveBeenCalledWith(
            {},
            'ws-1',
            'or3.sample-utility',
            expect.objectContaining({
                candidate: expect.objectContaining({
                    packageDigest: DIGEST_A,
                    authoritySha256: AUTHORITY_A,
                    authority: expect.objectContaining({ trust: 'isolated-client' }),
                }),
                approvedGrants: ['settings.read'],
                reviewedBy: 'super_admin:admin',
            })
        );
    });

    it('refuses grants the release does not request', async () => {
        body = {
            approvedGrants: ['documents.write'],
            expectedPackageDigest: DIGEST_A,
            expectedAuthoritySha256: AUTHORITY_A,
        };
        await expect(callRoute()).rejects.toMatchObject({ statusCode: 400 });
        expect(setReviewMock).not.toHaveBeenCalled();
    });

    it('refuses a candidate that changed since the permissions were displayed', async () => {
        body = {
            approvedGrants: ['settings.read'],
            expectedPackageDigest: DIGEST_B,
            expectedAuthoritySha256: AUTHORITY_A,
        };
        await expect(callRoute()).rejects.toMatchObject({
            statusCode: 409,
            data: { code: 'candidate-digest-mismatch' },
        });
        expect(setReviewMock).not.toHaveBeenCalled();
    });

    it('accepts the signed artifact digest recorded for the staged candidate', async () => {
        listOperationsMock.mockResolvedValue([
            {
                candidateDigest: DIGEST_A,
                release: { releaseId: 'rel_1', authoritySha256: AUTHORITY_A },
            },
        ]);
        body = {
            approvedGrants: ['settings.read'],
            expectedPackageDigest: DIGEST_A,
            expectedAuthoritySha256: AUTHORITY_A,
        };
        await expect(callRoute()).resolves.toMatchObject({ ok: true });
    });

    it('refuses an authority that changed since the permissions were displayed', async () => {
        body = {
            approvedGrants: ['settings.read'],
            expectedPackageDigest: DIGEST_A,
            expectedAuthoritySha256: AUTHORITY_B,
        };
        await expect(callRoute()).rejects.toMatchObject({
            statusCode: 409,
            data: { code: 'authority-mismatch' },
        });
        expect(setReviewMock).not.toHaveBeenCalled();
    });

    it('falls back to the signed release metadata when nothing is staged', async () => {
        readPointerMock.mockResolvedValue(null);
        resolveReleaseMock.mockResolvedValue({
            ok: true,
            value: {
                document: {
                    releaseId: 'rel_2',
                    requestedGrants: ['settings.read'],
                    archiveSha256: DIGEST_B,
                    packageTreeSha256: DIGEST_B,
                    authoritySha256: AUTHORITY_B,
                },
            },
        });
        body = {
            approvedGrants: ['settings.read'],
            expectedPackageDigest: DIGEST_B,
            expectedAuthoritySha256: AUTHORITY_B,
            version: '1.0.0',
        };

        const result = await callRoute();
        expect(result.ok).toBe(true);
        expect(resolveReleaseMock).toHaveBeenCalledWith({
            expectation: { pluginId: 'or3.sample-utility', version: '1.0.0' },
        });
        expect(setReviewMock).toHaveBeenCalledWith(
            {},
            'ws-1',
            'or3.sample-utility',
            expect.objectContaining({
                candidate: expect.objectContaining({
                    releaseId: 'rel_2',
                    packageDigest: DIGEST_B,
                    authoritySha256: AUTHORITY_B,
                    authority: null,
                }),
            })
        );
    });

    it('refuses a signed release whose authority changed since display', async () => {
        readPointerMock.mockResolvedValue(null);
        resolveReleaseMock.mockResolvedValue({
            ok: true,
            value: {
                document: {
                    releaseId: 'rel_2',
                    requestedGrants: ['settings.read'],
                    archiveSha256: DIGEST_B,
                    packageTreeSha256: DIGEST_B,
                    authoritySha256: AUTHORITY_B,
                },
            },
        });
        body = {
            approvedGrants: ['settings.read'],
            expectedPackageDigest: DIGEST_B,
            expectedAuthoritySha256: AUTHORITY_A,
        };
        await expect(callRoute()).rejects.toMatchObject({
            statusCode: 409,
            data: { code: 'authority-mismatch' },
        });
        expect(setReviewMock).not.toHaveBeenCalled();
    });

    it('persists the complete signed authority descriptor for an unstaged review', async () => {
        readPointerMock.mockResolvedValue(null);
        resolveReleaseMock.mockResolvedValue({
            ok: true,
            value: {
                document: {
                    releaseId: 'rel_2',
                    requestedGrants: [],
                    archiveSha256: DIGEST_B,
                    packageTreeSha256: DIGEST_B,
                    authoritySha256: AUTHORITY_B,
                    authority: AUTHORITY_DESCRIPTOR,
                },
            },
        });
        body = {
            approvedGrants: [],
            expectedPackageDigest: DIGEST_B,
            expectedAuthoritySha256: AUTHORITY_B,
        };
        await expect(callRoute()).resolves.toMatchObject({ ok: true });
        expect(setReviewMock).toHaveBeenCalledWith(
            {},
            'ws-1',
            'or3.sample-utility',
            expect.objectContaining({
                candidate: expect.objectContaining({ authority: AUTHORITY_DESCRIPTOR }),
            })
        );
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
