import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { H3Event } from 'h3';

const readBodyMock = vi.fn();
const getRouterParamMock = vi.fn();

const setResponseStatusMock = vi.fn();

vi.mock('h3', () => ({
    defineEventHandler: (handler: unknown) => handler,
    readBody: readBodyMock,
    getRouterParam: getRouterParamMock,
    setResponseStatus: setResponseStatusMock,
    getQuery: () => ({}),
    createError: (opts: { statusCode: number; statusMessage?: string }) => {
        const err = new Error(opts.statusMessage ?? 'Error') as Error & {
            statusCode: number;
        };
        err.statusCode = opts.statusCode;
        return err;
    },
}));

const requireAdminApiContextMock = vi.fn();
vi.mock('../../../../../admin/api', () => ({
    requireAdminApiContext: requireAdminApiContextMock as never,
}));

const resolveAdminWorkspaceTargetMock = vi.fn();
vi.mock('../../../../../admin/workspace-target', () => ({
    resolveAdminWorkspaceTarget: resolveAdminWorkspaceTargetMock as never,
}));

const checkRateLimitMock = vi.fn();
vi.mock('../../../../../utils/rate-limit', () => ({
    checkRateLimit: checkRateLimitMock as never,
}));

const acquisitionServiceForMock = vi.fn();
vi.mock('../../../../../utils/plugins/acquisition/route-support', () => ({
    acquisitionServiceFor: acquisitionServiceForMock as never,
}));

const recoverRunnerMock = vi.fn();
const operationListMock = vi.fn();
const operationReadMock = vi.fn();
vi.mock('../../../../../utils/plugins/acquisition/operation-store', () => ({
    PluginAcquisitionOperationError: class extends Error {},
    PluginAcquisitionOperationStore: class {
        recoverRemoteRunner(...args: unknown[]) { return recoverRunnerMock(...args); }
        list(...args: unknown[]) { return operationListMock(...args); }
        read(...args: unknown[]) { return operationReadMock(...args); }
    },
}));

const installRequestReadMock = vi.fn();
vi.mock('../../../../../admin/library/install-requests', () => ({
    LibraryInstallRequestStore: class { read(...args: unknown[]) { return installRequestReadMock(...args); } },
}));
const libraryStatusMock = vi.fn();
const workspaceAccessMock = {
    getWorkspace: vi.fn(),
    listMembers: vi.fn(),
};
vi.mock('../../../../../admin/stores/registry', () => ({
    getWorkspaceAccessStore: () => workspaceAccessMock,
}));
vi.mock('../../../../../admin/library/route-support', () => ({
    libraryLinkServiceFor: () => Promise.resolve({ service: { status: libraryStatusMock } }),
}));

const startMock = vi.fn();
const statusMock = vi.fn();

function makeEvent(): H3Event {
    return { context: {} } as H3Event;
}

function operationView(overrides: Record<string, unknown> = {}) {
    return {
        operationId: 'acq_abcdefgh',
        pluginId: 'alpha',
        workspaceId: 'ws-1',
        release: {releaseId: 'r1', archiveSha256: 'sha256-a', packageTreeSha256: 'sha256-b', manifestSha256: 'sha256-c', authoritySha256: 'sha256-d'},
        version: '1.0.0',
        stage: 'receipt-recorded',
        status: 'completed',
        percentComplete: 100,
        needsSetup: false,
        retryable: false,
        canceled: false,
        failure: null,
        updatedAt: 1,
        ...overrides,
    };
}

async function expectStatus(promise: Promise<unknown>, statusCode: number): Promise<void> {
    await expect(promise).rejects.toMatchObject({ statusCode });
}

describe('acquisition routes', () => {
    beforeEach(() => {
        requireAdminApiContextMock.mockReset().mockResolvedValue({
            principal: { kind: 'super_admin', username: 'root' },
        });
        resolveAdminWorkspaceTargetMock.mockReset().mockReturnValue('ws-1');
        checkRateLimitMock.mockReset().mockResolvedValue(true);
        acquisitionServiceForMock.mockReset().mockResolvedValue({
            start: startMock,
            status: statusMock,
            isInterrupted: vi.fn().mockResolvedValue(false),
            retry: vi.fn(),
            cancel: vi.fn(),
            // The start route hands the id back before doing the work; the run
            // itself continues in the background.
            advance: vi.fn().mockResolvedValue({ status: 'completed' }),
        });
        startMock.mockReset();
        statusMock.mockReset();
        recoverRunnerMock.mockReset();
        operationListMock.mockReset().mockResolvedValue([]);
        operationReadMock.mockReset();
        installRequestReadMock.mockReset();
        libraryStatusMock.mockReset();
        workspaceAccessMock.getWorkspace.mockReset().mockResolvedValue({ id: 'ws-1', deleted: false });
        workspaceAccessMock.listMembers.mockReset().mockResolvedValue([{ userId: 'buyer-local' }]);
    });

    it('rejects an invalid start body before touching the pipeline', async () => {
        readBodyMock.mockReset().mockResolvedValue({ pluginId: 'Alpha Bad' });
        const handler = (await import('../index.post')).default;

        await expectStatus(handler(makeEvent()), 400);
        expect(acquisitionServiceForMock).not.toHaveBeenCalled();
    });

    it('reports a pre-record refusal with its policy status and starts nothing', async () => {
        readBodyMock.mockReset().mockResolvedValue({ pluginId: 'alpha' });
        startMock.mockImplementation(async () => ({
            ok: false,
            failure: {
                code: 'registry-unconfigured',
                stage: 'resolved',
                message: 'Registry installation is not enabled on this instance.',
                retryable: false,
            },
        }));
        const handler = (await import('../index.post')).default;

        await expectStatus(handler(makeEvent()), 503);
    });

    it('returns the pipeline status view for a recorded start', async () => {
        readBodyMock.mockReset().mockResolvedValue({ pluginId: 'alpha', version: '1.0.0' });
        startMock.mockImplementation(async () => ({
            ok: true,
            operation: {
                operationId: 'acq_abcdefgh',
                pluginId: 'alpha',
                workspaceId: 'ws-1',
                release: {releaseId: 'r1', archiveSha256: 'sha256-a', packageTreeSha256: 'sha256-b', manifestSha256: 'sha256-c', authoritySha256: 'sha256-d'},
                version: '1.0.0',
                stage: 'receipt-recorded',
                status: 'completed',
                failure: null,
                cancelRequested: false,
                updatedAt: 1,
            },
        }));
        const handler = (await import('../index.post')).default;

        const response = (await handler(makeEvent())) as {
            ok: boolean;
            workspaceId: string;
            operation: { operationId: string; percentComplete: number };
        };
        expect(response.ok).toBe(true);
        expect(response.workspaceId).toBe('ws-1');
        expect(response.operation.operationId).toBe('acq_abcdefgh');
        expect(response.operation.percentComplete).toBe(100);
        expect(startMock).toHaveBeenCalledWith(
            expect.objectContaining({
                pluginId: 'alpha',
                version: '1.0.0',
                workspaceId: 'ws-1',
                requesterUserId: 'super_admin:root',
            })
        );
    });

    it('throttles acquisitions per acting admin', async () => {
        readBodyMock.mockReset().mockResolvedValue({ pluginId: 'alpha' });
        checkRateLimitMock.mockResolvedValue(false);
        const handler = (await import('../index.post')).default;

        await expectStatus(handler(makeEvent()), 429);
        expect(startMock).not.toHaveBeenCalled();
    });

    it('binds a delegated start to buyer link, exact release and current workspace', async () => {
        const requestId = `lir_${'a'.repeat(32)}`;
        const request = {
            id: requestId, buyerUserId: 'buyer-local', workspaceId: 'ws-1',
            linkId: 'link-1', accountId: 'buyer-central', releaseId: 'rel_fixture_1',
            pluginId: 'alpha', version: '1.0.0', archiveSha256: `sha256-${'a'.repeat(64)}`,
            expiresAt: Date.now() + 10_000,
        };
        requireAdminApiContextMock.mockResolvedValue({
            principal: { kind: 'super_admin', username: 'root' },
            session: { user: { id: 'admin-local' }, workspace: { id: 'ws-1' } },
        });
        readBodyMock.mockResolvedValue({ pluginId: 'alpha', version: '1.0.0', workspaceId: 'ws-1', installRequestId: requestId });
        installRequestReadMock.mockResolvedValue(request);
        libraryStatusMock.mockResolvedValue({ state: 'linked', link: { id: 'link-1', accountId: 'buyer-central' } });
        startMock.mockResolvedValue({ ok: true, operation: operationView() });
        const handler = (await import('../index.post')).default;

        await handler(makeEvent());
        expect(acquisitionServiceForMock).toHaveBeenCalledWith(expect.anything(), 'super_admin:root', 'buyer-local', expect.objectContaining({ requestId }));
        expect(startMock).toHaveBeenCalledWith(expect.objectContaining({
            pluginId: 'alpha', version: '1.0.0', workspaceId: 'ws-1',
            libraryGrant: expect.objectContaining({ requestId, buyerUserId: 'buyer-local', releaseId: 'rel_fixture_1' }),
        }));

        requireAdminApiContextMock.mockResolvedValue({
            principal: { kind: 'super_admin', username: 'root' },
            session: { user: { id: 'admin-local' }, workspace: { id: 'ws-other' } },
        });
        await expectStatus(handler(makeEvent()), 409);
        expect(startMock).toHaveBeenCalledTimes(1);

        requireAdminApiContextMock.mockResolvedValue({
            principal: { kind: 'super_admin', username: 'root' },
            session: { user: { id: 'admin-local' }, workspace: { id: 'ws-1' } },
        });
        workspaceAccessMock.listMembers.mockResolvedValue([]);
        await expectStatus(handler(makeEvent()), 409);
        expect(startMock).toHaveBeenCalledTimes(1);
    });

    it('rejects delegated starts after the buyer changes the Library link', async () => {
        const requestId = `lir_${'a'.repeat(32)}`;
        requireAdminApiContextMock.mockResolvedValue({
            principal: { kind: 'super_admin', username: 'root' },
            session: { user: { id: 'admin-local' }, workspace: { id: 'ws-1' } },
        });
        readBodyMock.mockResolvedValue({ pluginId: 'alpha', version: '1.0.0', workspaceId: 'ws-1', installRequestId: requestId });
        installRequestReadMock.mockResolvedValue({ id: requestId, buyerUserId: 'buyer-local', workspaceId: 'ws-1', linkId: 'link-1', accountId: 'buyer-central', pluginId: 'alpha', version: '1.0.0', expiresAt: Date.now() + 10_000 });
        libraryStatusMock.mockResolvedValue({ state: 'linked', link: { id: 'link-2', accountId: 'buyer-central' } });
        const handler = (await import('../index.post')).default;
        await expectStatus(handler(makeEvent()), 409);
        expect(startMock).not.toHaveBeenCalled();
    });

    it('retries a recorded delegated operation only in its buyer-approved workspace', async () => {
        const requestId = `lir_${'a'.repeat(32)}`;
        getRouterParamMock.mockReturnValue('acq_abcdefgh');
        operationReadMock.mockResolvedValue({ ...operationView(), requesterUserId: 'super_admin:root',
            libraryGrant: { requestId, buyerUserId: 'buyer-local', linkId: 'link-1', accountId: 'buyer-central', releaseId: 'rel_fixture_1', archiveSha256: `sha256-${'a'.repeat(64)}` } });
        requireAdminApiContextMock.mockResolvedValue({
            principal: { kind: 'super_admin', username: 'root' },
            session: { user: { id: 'admin-local' }, workspace: { id: 'ws-other' } },
        });
        const handler = (await import('../[operationId]/retry.post')).default;
        await expectStatus(handler(makeEvent()), 409);
        expect(acquisitionServiceForMock).not.toHaveBeenCalled();

        requireAdminApiContextMock.mockResolvedValue({
            principal: { kind: 'super_admin', username: 'root' },
            session: { user: { id: 'admin-local' }, workspace: { id: 'ws-1' } },
        });
        workspaceAccessMock.listMembers.mockResolvedValueOnce([]);
        await expectStatus(handler(makeEvent()), 409);
        expect(acquisitionServiceForMock).not.toHaveBeenCalled();

        const retryMock = vi.fn().mockResolvedValue(operationView());
        acquisitionServiceForMock.mockResolvedValue({ retry: retryMock });
        await handler(makeEvent());
        expect(acquisitionServiceForMock).toHaveBeenCalledWith(expect.anything(), 'super_admin:root', 'buyer-local', expect.objectContaining({ requestId }));
        expect(retryMock).toHaveBeenCalledWith('acq_abcdefgh');
    });

    it('returns 404 for an unknown operation instead of an empty status', async () => {
        getRouterParamMock.mockReset().mockReturnValue('acq_unknown0');
        statusMock.mockImplementation(async () => {
            throw new Error('No acquisition operation acq_unknown0 is recorded.');
        });
        const handler = (await import('../[operationId]/status.get')).default;

        await expectStatus(handler(makeEvent()), 404);
    });

    it('requires exact owner confirmation before recovering a remote runner', async () => {
        getRouterParamMock.mockReturnValue('acq_abcdefgh');
        const handler = (await import('../[operationId]/recover-runner.post')).default;
        readBodyMock.mockResolvedValue({ expectedOwnerId: 'wrong', confirmedHostStopped: true });
        await expectStatus(handler(makeEvent()), 400);
        expect(recoverRunnerMock).not.toHaveBeenCalled();

        const ownerId = 'e967b0db-bfe1-4c74-ae64-96c9d829c342';
        readBodyMock.mockResolvedValue({ expectedOwnerId: ownerId, confirmedHostStopped: true });
        recoverRunnerMock.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
        await expectStatus(handler(makeEvent()), 409);
        await expect(handler(makeEvent())).resolves.toMatchObject({ recovered: true });
        expect(recoverRunnerMock).toHaveBeenCalledWith('acq_abcdefgh', ownerId);
        expect(requireAdminApiContextMock).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
            ownerOnly: true, mutation: true, superAdminOnly: true,
        }));
    });

    it('serves a recorded status without running the pipeline', async () => {
        getRouterParamMock.mockReset().mockReturnValue('acq_abcdefgh');
        statusMock.mockResolvedValue({
            operationId: 'acq_abcdefgh',
            pluginId: 'alpha',
            release: {releaseId: 'r1', archiveSha256: 'sha256-a', packageTreeSha256: 'sha256-b', manifestSha256: 'sha256-c', authoritySha256: 'sha256-d'},
            version: '1.0.0',
            workspaceId: 'ws-1',
            stage: 'candidate-recorded',
            status: 'paused',
            failure: {
                code: 'setup-required',
                stage: 'candidate-recorded',
                message: 'This package needs setup.',
                retryable: true,
            },
            cancelRequested: false,
            updatedAt: 2,
        });
        const handler = (await import('../[operationId]/status.get')).default;

        const response = (await handler(makeEvent())) as {
            pluginId: string;
            operation: { needsSetup: boolean; status: string };
        };
        expect(response.pluginId).toBe('alpha');
        expect(response.operation.status).toBe('paused');
        expect(response.operation.needsSetup).toBe(true);
        void operationView();
    });
});
