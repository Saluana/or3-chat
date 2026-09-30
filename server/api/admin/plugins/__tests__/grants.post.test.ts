import { describe, expect, it, vi, beforeEach } from 'vitest';
import { createHash } from 'node:crypto';

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
const enabledMock = vi.fn();
const listWorkspaceIdsMock = vi.fn();
const siteApprovedMock = vi.fn();
const localAdmissionMock = vi.fn();
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

vi.mock('../../../../admin/stores/registry', () => ({
    getWorkspaceSettingsStore: () => ({}),
}));

vi.mock('../../../../admin/plugins/package-operation-support', () => ({
    pluginPackageServices: () => ({
        settings: {},
        pointers: { readPointer: (...args: unknown[]) => readPointerMock(...args) },
        packages: {
            packagePath: () => '/tmp/does-not-need-to-exist',
            verifyStoredPackage: async () => undefined,
            runPluginOperation: async (_pluginId: string, work: () => Promise<unknown>) => work(),
        },
    }),
    packageGrantCandidate: (...args: unknown[]) => candidateMock(...args),
    readPackageManifest: (...args: unknown[]) => readManifestMock(...args),
}));

vi.mock('../../../../admin/plugins/workspace-plugin-store', () => ({
    setPluginGrantReview: (...args: unknown[]) => setReviewMock(...args),
    getEnabledPlugins: (...args: unknown[]) => enabledMock(...args),
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
    listAllWorkspaceIds: (...args: unknown[]) => listWorkspaceIdsMock(...args),
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
vi.mock('../../../../admin/plugins/site-policy-service', () => ({
    isSiteReleaseStillApproved: (...args: unknown[]) => siteApprovedMock(...args),
}));
vi.mock('../../../../admin/plugins/local-admission', () => ({
    readLocalAdmission: (...args: unknown[]) => localAdmissionMock(...args),
}));

async function callRoute(hook: () => Promise<void> = async () => undefined): Promise<Record<string, unknown>> {
    const handler = (await import('../packages/[pluginId]/grants.post')).default;
    return (await handler({
        context: { adminHooks: { doAction: hook } },
    } as never)) as Record<string, unknown>;
}

describe('grant consent route', () => {
    it('returns saved approvals when an optional post-commit observer fails', async () => {
        body = { approvedGrants: [], expectedPackageDigest: DIGEST_A, expectedAuthoritySha256: AUTHORITY_A };
        const response = await callRoute(async () => { throw new Error('observer unavailable'); });
        expect(response.ok).toBe(true);
        expect(response.reviewedWorkspaces).toBe(1);
    });
    beforeEach(() => {
        listWorkspaceIdsMock.mockReset().mockResolvedValue(['ws-1', 'ws-2', 'ws-3']);
        siteApprovedMock.mockReset().mockResolvedValue(true);
        localAdmissionMock.mockReset().mockResolvedValue(null);
        enabledMock.mockReset().mockImplementation(async (_settings: unknown, workspaceId: string) =>
            workspaceId === 'ws-2' ? ['or3.sample-utility'] : []);
        readManifestMock.mockReset();
        readManifestMock.mockResolvedValue({ version: '0.1.0' });
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

    it('refuses consent after the displayed workspace changes before any grant write', async () => {
        body = { ...body, expectedWorkspaceId: 'ws-previous' };
        await expect(callRoute()).rejects.toMatchObject({ statusCode: 409 });
        expect(setReviewMock).not.toHaveBeenCalled();
    });

    it('reviews the selected release even while an update candidate is staged', async () => {
        readPointerMock.mockResolvedValue({
            candidate: { packageDigest: DIGEST_A },
            current: { packageDigest: DIGEST_B },
        });
        body = { ...body, target: 'current', expectedPackageDigest: DIGEST_B, expectedAuthoritySha256: AUTHORITY_B };
        resolveReleaseMock.mockResolvedValue({ ok: true, value: { document: {
            releaseId: 'rel_current', packageTreeSha256: DIGEST_B,
            authoritySha256: AUTHORITY_B, requestedGrants: ['settings.read'],
            authority: AUTHORITY_DESCRIPTOR,
        } } });
        candidateMock.mockResolvedValue({
            requestedGrants: ['settings.read'], releaseId: 'rel_current',
            packageDigest: DIGEST_B, authoritySha256: AUTHORITY_B,
            authority: AUTHORITY_DESCRIPTOR,
        });
        await expect(callRoute()).resolves.toMatchObject({ ok: true });
        expect(setReviewMock).toHaveBeenCalledWith({}, 'ws-1', 'or3.sample-utility',
            expect.objectContaining({ candidate: expect.objectContaining({ packageDigest: DIGEST_B }) }));
    });

    it('reviews a selected locally admitted release without looking it up in the marketplace', async () => {
        readPointerMock.mockResolvedValue({ current: { packageDigest: DIGEST_B }, candidate: null });
        body = { ...body, target: 'current', expectedPackageDigest: DIGEST_B, expectedAuthoritySha256: AUTHORITY_B };
        localAdmissionMock.mockResolvedValue({ pluginId: 'or3.sample-utility', packageDigest: DIGEST_B });
        resolveReleaseMock.mockRejectedValue(new Error('unpublished'));
        candidateMock.mockResolvedValue({ requestedGrants: ['settings.read'], releaseId: null,
            packageDigest: DIGEST_B, authoritySha256: AUTHORITY_B, authority: AUTHORITY_DESCRIPTOR });
        await expect(callRoute()).resolves.toMatchObject({ ok: true });
        expect(resolveReleaseMock).not.toHaveBeenCalled();
    });

    it('reviews enabled workspaces and the disabled initiating canary without enabling it', async () => {
        body = { ...body, deploymentWide: true, version: '1.0.0', expectedEnabledWorkspaceSha256: `sha256-${createHash('sha256').update(JSON.stringify(['ws-2'])).digest('hex')}` };
        const result = await callRoute();
        expect(result.reviewedWorkspaces).toBe(2);
        expect(setReviewMock.mock.calls.map(call => call[1])).toEqual(['ws-1', 'ws-2']);
    });

    it('names a partial deployment approval so the same release can be retried', async () => {
        enabledMock.mockResolvedValue(['or3.sample-utility']);
        body = { ...body, deploymentWide: true, version: '1.0.0', expectedEnabledWorkspaceSha256: `sha256-${createHash('sha256').update(JSON.stringify(['ws-1', 'ws-2', 'ws-3'])).digest('hex')}` };
        setReviewMock.mockResolvedValueOnce({
            approvedGrants: ['settings.read'], packageDigest: DIGEST_A, authoritySha256: AUTHORITY_A,
        }).mockRejectedValueOnce(new Error('store unavailable'));
        await expect(callRoute()).rejects.toMatchObject({
            statusCode: 503,
            data: { code: 'workspace-grant-write-failed', workspaceId: 'ws-2', reviewedWorkspaces: 2 },
        });
    });

    it('refuses a stale deployment target set before writing any approval', async () => {
        body = { ...body, deploymentWide: true, version: '1.0.0', expectedEnabledWorkspaceSha256: DIGEST_A };
        await expect(callRoute()).rejects.toMatchObject({ statusCode: 409, data: { code: 'enabled-workspace-set-changed' } });
        expect(setReviewMock).not.toHaveBeenCalled();
    });

    it('refuses deployment approval when the exact site release changed', async () => {
        siteApprovedMock.mockResolvedValue(false);
        body = { ...body, deploymentWide: true, version: '1.0.0',
            expectedEnabledWorkspaceSha256: `sha256-${createHash('sha256').update(JSON.stringify(['ws-2'])).digest('hex')}` };
        await expect(callRoute()).rejects.toMatchObject({ statusCode: 409, data: { code: 'site-approval-required' } });
        expect(setReviewMock).not.toHaveBeenCalled();
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
