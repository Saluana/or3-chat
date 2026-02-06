import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { H3Event } from 'h3';

const readBodyMock = vi.fn();
const setResponseHeaderMock = vi.fn();

vi.mock('h3', () => ({
    defineEventHandler: (handler: unknown) => handler,
    readBody: readBodyMock,
    setResponseHeader: setResponseHeaderMock,
    createError: (opts: { statusCode: number; statusMessage?: string }) => {
        const err = new Error(opts.statusMessage ?? 'Error') as Error & {
            statusCode: number;
        };
        err.statusCode = opts.statusCode;
        return err;
    },
}));

vi.mock('../../../auth/session', () => ({
    resolveSessionContext: vi.fn().mockResolvedValue({
        authenticated: true,
        user: { id: 'user-1' },
        workspace: { id: 'ws-1' },
    }),
}));

vi.mock('../../../auth/can', () => ({
    requireCan: vi.fn(),
}));

vi.mock('../../../utils/auth/is-ssr-auth-enabled', () => ({
    isSsrAuthEnabled: () => true,
}));

vi.mock('../../../utils/sync/is-sync-enabled', () => ({
    isSyncEnabled: () => true,
}));

const checkSyncRateLimitMock = vi.fn();
const recordSyncRequestMock = vi.fn();
const getSyncRateLimitStatsMock = vi.fn();

vi.mock('../../../utils/sync/rate-limiter', () => ({
    checkSyncRateLimit: (...args: unknown[]) => checkSyncRateLimitMock(...args),
    recordSyncRequest: (...args: unknown[]) => recordSyncRequestMock(...args),
    getSyncRateLimitStats: (...args: unknown[]) => getSyncRateLimitStatsMock(...args),
}));

const pushMock = vi.fn();

vi.mock('../../../sync/gateway/registry', () => ({
    getActiveSyncGatewayAdapter: () => ({
        id: 'adapter-1',
        push: (...args: unknown[]) => pushMock(...args),
    }),
}));

function makeEvent(): H3Event {
    return { context: {}, node: { req: { headers: {} } } } as H3Event;
}

const VALID_OP_STAMP = {
    deviceId: 'dev-1',
    opId: 'a1b2c3d4-5678-4abc-8def-123456789001',
    hlc: '0000000000001:0000:dev-1',
    clock: 1,
};

describe('POST /api/sync/push payload validation', () => {
    beforeEach(() => {
        readBodyMock.mockReset();
        setResponseHeaderMock.mockReset();
        checkSyncRateLimitMock.mockReset();
        recordSyncRequestMock.mockReset();
        getSyncRateLimitStatsMock.mockReset();
        pushMock.mockReset();

        checkSyncRateLimitMock.mockReturnValue({ allowed: true, remaining: 100 });
        getSyncRateLimitStatsMock.mockReturnValue({ limit: 200, remaining: 100 });
        pushMock.mockResolvedValue({ results: [], serverVersion: 0 });
    });

    it('accepts posts payloads in canonical wire shape (post_type)', async () => {
        const handler = (await import('../push.post')).default as (event: H3Event) => Promise<unknown>;

        readBodyMock.mockResolvedValue({
            scope: { workspaceId: 'ws-1' },
            ops: [
                {
                    id: 'pending-op-1',
                    tableName: 'posts',
                    operation: 'put',
                    pk: 'post-1',
                    payload: {
                        id: 'post-1',
                        title: 'Post',
                        content: 'Body',
                        post_type: 'markdown',
                        deleted: false,
                        created_at: 1,
                        updated_at: 1,
                        clock: 1,
                    },
                    stamp: VALID_OP_STAMP,
                    createdAt: 1,
                    attempts: 0,
                    status: 'pending',
                },
            ],
        });

        await expect(handler(makeEvent())).resolves.toEqual({ results: [], serverVersion: 0 });
        expect(pushMock).toHaveBeenCalledTimes(1);
    });

    it('rejects invalid posts payloads that use camelCase wire fields', async () => {
        const handler = (await import('../push.post')).default as (event: H3Event) => Promise<unknown>;

        readBodyMock.mockResolvedValue({
            scope: { workspaceId: 'ws-1' },
            ops: [
                {
                    id: 'pending-op-2',
                    tableName: 'posts',
                    operation: 'put',
                    pk: 'post-2',
                    payload: {
                        id: 'post-2',
                        title: 'Post',
                        content: 'Body',
                        postType: 'markdown',
                        deleted: false,
                        created_at: 1,
                        updated_at: 1,
                        clock: 1,
                    },
                    stamp: {
                        ...VALID_OP_STAMP,
                        opId: 'a1b2c3d4-5678-4abc-8def-123456789002',
                    },
                    createdAt: 1,
                    attempts: 0,
                    status: 'pending',
                },
            ],
        });

        await expect(handler(makeEvent())).rejects.toMatchObject({
            statusCode: 400,
        });
        expect(pushMock).toHaveBeenCalledTimes(0);
    });
});
