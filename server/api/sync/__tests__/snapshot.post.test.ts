import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { H3Event } from 'h3';

const readBodyMock = vi.fn();
const setResponseHeaderMock = vi.fn();
const setHeaderMock = vi.fn();
vi.mock('h3', () => ({
    defineEventHandler: (handler: unknown) => handler,
    readBody: readBodyMock,
    setResponseHeader: setResponseHeaderMock,
    setHeader: setHeaderMock,
    createError: (input: { statusCode: number; statusMessage?: string }) =>
        Object.assign(new Error(input.statusMessage), { statusCode: input.statusCode }),
}));

const resolveSessionContextMock = vi.fn();
vi.mock('../../../auth/session', () => ({ resolveSessionContext: resolveSessionContextMock }));
const requireCanMock = vi.fn();
vi.mock('../../../auth/can', () => ({ requireCan: requireCanMock }));
const isSsrAuthEnabledMock = vi.fn(() => true);
vi.mock('../../../utils/auth/is-ssr-auth-enabled', () => ({
    isSsrAuthEnabled: isSsrAuthEnabledMock,
}));
const isSyncEnabledMock = vi.fn(() => true);
vi.mock('../../../utils/sync/is-sync-enabled', () => ({ isSyncEnabled: isSyncEnabledMock }));

const checkSyncRateLimitMock = vi.fn();
const getSyncRateLimitStatsMock = vi.fn();
const recordSyncRequestMock = vi.fn();
vi.mock('../../../utils/sync/rate-limiter', () => ({
    checkSyncRateLimit: checkSyncRateLimitMock,
    getSyncRateLimitStats: getSyncRateLimitStatsMock,
    recordSyncRequest: recordSyncRequestMock,
}));

const snapshotMock = vi.fn();
const getActiveSyncGatewayAdapterMock = vi.fn();
vi.mock('../../../sync/gateway/registry', () => ({
    getActiveSyncGatewayAdapter: getActiveSyncGatewayAdapterMock,
}));

function event(): H3Event {
    return { context: {}, node: { req: { headers: {} } } } as H3Event;
}

const request = {
    scope: { workspaceId: 'ws-1' },
    pageSize: 100,
    tables: ['messages'],
};
const response = {
    workspaceId: 'ws-1',
    snapshotId: 'snapshot-1',
    highWatermark: 9,
    items: [],
    nextPageToken: null,
};

describe('POST /api/sync/snapshot', () => {
    beforeEach(() => {
        readBodyMock.mockReset().mockResolvedValue(request);
        setResponseHeaderMock.mockReset();
        setHeaderMock.mockReset();
        requireCanMock.mockReset();
        isSsrAuthEnabledMock.mockReset().mockReturnValue(true);
        isSyncEnabledMock.mockReset().mockReturnValue(true);
        resolveSessionContextMock.mockReset().mockResolvedValue({
            authenticated: true,
            user: { id: 'user-1' },
            workspace: { id: 'ws-1' },
        });
        checkSyncRateLimitMock.mockReset().mockReturnValue({ allowed: true });
        getSyncRateLimitStatsMock.mockReset().mockReturnValue({ limit: 120, remaining: 119 });
        recordSyncRequestMock.mockReset();
        snapshotMock.mockReset().mockResolvedValue(response);
        getActiveSyncGatewayAdapterMock.mockReset().mockReturnValue({ snapshot: snapshotMock });
    });

    it('validates, authorizes, bounds, and dispatches snapshot pages', async () => {
        const handler = (await import('../snapshot.post')).default as
            (input: H3Event) => Promise<unknown>;

        await expect(handler(event())).resolves.toEqual(response);
        expect(requireCanMock).toHaveBeenCalledWith(expect.anything(), 'workspace.read', {
            kind: 'workspace',
            id: 'ws-1',
        });
        expect(snapshotMock).toHaveBeenCalledWith(expect.anything(), request);
        expect(checkSyncRateLimitMock).toHaveBeenCalledWith('user-1', 'sync:snapshot');
        expect(recordSyncRequestMock).toHaveBeenCalledWith('user-1', 'sync:snapshot');
    });

    it('rejects malformed requests before provider dispatch', async () => {
        const handler = (await import('../snapshot.post')).default as
            (input: H3Event) => Promise<unknown>;
        readBodyMock.mockResolvedValue({ scope: { workspaceId: 'ws-1' }, pageSize: 0 });

        await expect(handler(event())).rejects.toMatchObject({ statusCode: 400 });
        expect(snapshotMock).not.toHaveBeenCalled();
    });

    it('fails closed when the active adapter has no snapshot capability', async () => {
        const handler = (await import('../snapshot.post')).default as
            (input: H3Event) => Promise<unknown>;
        getActiveSyncGatewayAdapterMock.mockReturnValue({});

        await expect(handler(event())).rejects.toMatchObject({ statusCode: 503 });
    });

    it('rejects malformed adapter output', async () => {
        const handler = (await import('../snapshot.post')).default as
            (input: H3Event) => Promise<unknown>;
        snapshotMock.mockResolvedValue({ highWatermark: -1 });

        await expect(handler(event())).rejects.toMatchObject({ statusCode: 502 });
        expect(recordSyncRequestMock).not.toHaveBeenCalled();
    });

    it.each([
        [
            'a different workspace',
            { ...response, workspaceId: 'ws-other' },
        ],
        [
            'unordered items',
            {
                ...response,
                items: [
                    {
                        kind: 'row',
                        tableName: 'threads',
                        pk: 'thread-1',
                        payload: {},
                        revision: {
                            clock: 1,
                            hlc: '1:0:d',
                            opId: 'op-thread',
                        },
                    },
                    {
                        kind: 'row',
                        tableName: 'messages',
                        pk: 'message-1',
                        payload: {},
                        revision: {
                            clock: 1,
                            hlc: '1:0:d',
                            opId: 'op-message',
                        },
                    },
                ],
            },
        ],
    ])('rejects adapter output with %s', async (_label, adapterResponse) => {
        const handler = (await import('../snapshot.post')).default as (
            input: H3Event
        ) => Promise<unknown>;
        snapshotMock.mockResolvedValue(adapterResponse);

        await expect(handler(event())).rejects.toMatchObject({
            statusCode: 502,
        });
        expect(recordSyncRequestMock).not.toHaveBeenCalled();
    });

    it('returns Retry-After when snapshot paging is rate limited', async () => {
        const handler = (await import('../snapshot.post')).default as
            (input: H3Event) => Promise<unknown>;
        checkSyncRateLimitMock.mockReturnValue({ allowed: false, retryAfterMs: 2100 });

        await expect(handler(event())).rejects.toMatchObject({ statusCode: 429 });
        expect(setResponseHeaderMock).toHaveBeenCalledWith(expect.anything(), 'Retry-After', 3);
    });
});
