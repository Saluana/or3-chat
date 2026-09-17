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

const startMock = vi.fn();
const statusMock = vi.fn();

function makeEvent(): H3Event {
    return { context: {} } as H3Event;
}

function operationView(overrides: Record<string, unknown> = {}) {
    return {
        operationId: 'acq_abcdefgh',
        pluginId: 'alpha',
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
            retry: vi.fn(),
            cancel: vi.fn(),
            // The start route hands the id back before doing the work; the run
            // itself continues in the background.
            advance: vi.fn().mockResolvedValue({ status: 'completed' }),
        });
        startMock.mockReset();
        statusMock.mockReset();
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

    it('returns 404 for an unknown operation instead of an empty status', async () => {
        getRouterParamMock.mockReset().mockReturnValue('acq_unknown0');
        statusMock.mockImplementation(async () => {
            throw new Error('No acquisition operation acq_unknown0 is recorded.');
        });
        const handler = (await import('../[operationId]/status.get')).default;

        await expectStatus(handler(makeEvent()), 404);
    });

    it('serves a recorded status without running the pipeline', async () => {
        getRouterParamMock.mockReset().mockReturnValue('acq_abcdefgh');
        statusMock.mockResolvedValue({
            operationId: 'acq_abcdefgh',
            pluginId: 'alpha',
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
