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

const resolveSessionContextMock = vi.fn();
vi.mock('../../../auth/session', () => ({
    resolveSessionContext: resolveSessionContextMock as any,
}));

const requireCanMock = vi.fn();
vi.mock('../../../auth/can', () => ({
    requireCan: requireCanMock as any,
}));

const isSsrAuthEnabledMock = vi.fn(() => true);
vi.mock('../../../utils/auth/is-ssr-auth-enabled', () => ({
    isSsrAuthEnabled: isSsrAuthEnabledMock as any,
}));

const isSyncEnabledMock = vi.fn(() => true);
vi.mock('../../../utils/sync/is-sync-enabled', () => ({
    isSyncEnabled: isSyncEnabledMock as any,
}));

const checkSyncRateLimitMock = vi.fn();
const recordSyncRequestMock = vi.fn();
const getSyncRateLimitStatsMock = vi.fn();

vi.mock('../../../utils/sync/rate-limiter', () => ({
    checkSyncRateLimit: checkSyncRateLimitMock as any,
    recordSyncRequest: recordSyncRequestMock as any,
    getSyncRateLimitStats: getSyncRateLimitStatsMock as any,
}));

const pushMock = vi.fn();
const getActiveSyncGatewayAdapterMock = vi.fn();
vi.mock('../../../sync/gateway/registry', () => ({
    getActiveSyncGatewayAdapter: getActiveSyncGatewayAdapterMock as any,
}));

function makeEvent(): H3Event {
    return { context: {}, node: { req: { headers: {} } } } as H3Event;
}

const STAMP_1 = {
    deviceId: 'dev-1',
    opId: 'a1b2c3d4-5678-4abc-8def-123456789001',
    hlc: '0000000000001:0000:dev-1',
    clock: 1,
};

function makeBaseBody() {
    return {
        scope: { workspaceId: 'ws-1' },
        ops: [
            {
                id: 'pending-op-1',
                tableName: 'messages',
                operation: 'put',
                pk: 'm1',
                payload: {
                    id: 'm1',
                    thread_id: 't1',
                    role: 'user',
                    index: 0,
                    order_key: '0000000000001:0000:dev-1',
                    deleted: false,
                    created_at: 1,
                    updated_at: 1,
                    clock: 1,
                },
                stamp: STAMP_1,
                createdAt: 1,
                attempts: 0,
                status: 'pending',
            },
        ],
    };
}

describe('POST /api/sync/push', () => {
    beforeEach(() => {
        readBodyMock.mockReset();
        setResponseHeaderMock.mockReset();
        resolveSessionContextMock.mockReset().mockResolvedValue({
            authenticated: true,
            user: { id: 'user-1' },
            workspace: { id: 'ws-1' },
        });
        requireCanMock.mockReset();
        isSsrAuthEnabledMock.mockReset().mockReturnValue(true);
        isSyncEnabledMock.mockReset().mockReturnValue(true);
        checkSyncRateLimitMock.mockReset().mockReturnValue({ allowed: true, remaining: 10 });
        recordSyncRequestMock.mockReset();
        getSyncRateLimitStatsMock.mockReset().mockReturnValue({ limit: 200, remaining: 100 });
        pushMock.mockReset().mockResolvedValue({ results: [], serverVersion: 7 });
        getActiveSyncGatewayAdapterMock.mockReset().mockReturnValue({
            id: 'adapter-1',
            push: pushMock as any,
        });
    });

    it('returns 404 when SSR auth is disabled', async () => {
        const handler = (await import('../push.post')).default as (event: H3Event) => Promise<unknown>;
        isSsrAuthEnabledMock.mockReturnValue(false);

        await expect(handler(makeEvent())).rejects.toMatchObject({ statusCode: 404 });
    });

    it('returns 404 when sync feature is disabled', async () => {
        const handler = (await import('../push.post')).default as (event: H3Event) => Promise<unknown>;
        isSyncEnabledMock.mockReturnValue(false);

        await expect(handler(makeEvent())).rejects.toMatchObject({ statusCode: 404 });
    });

    it('returns 400 for invalid PushBatchSchema', async () => {
        const handler = (await import('../push.post')).default as (event: H3Event) => Promise<unknown>;
        readBodyMock.mockResolvedValue({ scope: { workspaceId: 'ws-1' }, ops: 'bad' });

        await expect(handler(makeEvent())).rejects.toMatchObject({ statusCode: 400 });
    });

    it('returns 400 when put payload fails table schema', async () => {
        const handler = (await import('../push.post')).default as (event: H3Event) => Promise<unknown>;
        const body = makeBaseBody() as any;
        body.ops[0]!.payload = { id: 'm1', role: 'user' };
        readBodyMock.mockResolvedValue(body);

        await expect(handler(makeEvent())).rejects.toMatchObject({ statusCode: 400 });
    });

    it('accepts delete op without full payload fields', async () => {
        const handler = (await import('../push.post')).default as (event: H3Event) => Promise<unknown>;
        const body = {
            scope: { workspaceId: 'ws-1' },
            ops: [
                {
                    id: 'pending-op-2',
                    tableName: 'messages',
                    operation: 'delete',
                    pk: 'm1',
                    payload: { id: 'm1' },
                    stamp: {
                        ...STAMP_1,
                        opId: 'a1b2c3d4-5678-4abc-8def-123456789002',
                    },
                    createdAt: 2,
                    attempts: 0,
                    status: 'pending',
                },
            ],
        };
        readBodyMock.mockResolvedValue(body);

        await expect(handler(makeEvent())).resolves.toEqual({ results: [], serverVersion: 7 });
    });

    it('returns 401 when unauthenticated or missing user/workspace', async () => {
        const handler = (await import('../push.post')).default as (event: H3Event) => Promise<unknown>;
        readBodyMock.mockResolvedValue(makeBaseBody());

        resolveSessionContextMock.mockResolvedValue({ authenticated: false });
        await expect(handler(makeEvent())).rejects.toMatchObject({ statusCode: 401 });

        resolveSessionContextMock.mockResolvedValue({ authenticated: true, user: null, workspace: { id: 'ws-1' } });
        await expect(handler(makeEvent())).rejects.toMatchObject({ statusCode: 401 });

        resolveSessionContextMock.mockResolvedValue({ authenticated: true, user: { id: 'u' }, workspace: null });
        await expect(handler(makeEvent())).rejects.toMatchObject({ statusCode: 401 });
    });

    it('returns 403 when workspace.write check fails for scope.workspaceId', async () => {
        const handler = (await import('../push.post')).default as (event: H3Event) => Promise<unknown>;
        readBodyMock.mockResolvedValue(makeBaseBody());
        requireCanMock.mockImplementation(() => {
            const err = new Error('Forbidden') as Error & { statusCode: number };
            err.statusCode = 403;
            throw err;
        });

        await expect(handler(makeEvent())).rejects.toMatchObject({ statusCode: 403 });
        expect(requireCanMock).toHaveBeenCalledWith(
            expect.objectContaining({ authenticated: true }),
            'workspace.write',
            { kind: 'workspace', id: 'ws-1' }
        );
    });

    it('returns 429 with Retry-After when rate limited', async () => {
        const handler = (await import('../push.post')).default as (event: H3Event) => Promise<unknown>;
        readBodyMock.mockResolvedValue(makeBaseBody());
        checkSyncRateLimitMock.mockReturnValue({ allowed: false, retryAfterMs: 2100 });

        await expect(handler(makeEvent())).rejects.toMatchObject({ statusCode: 429 });
        expect(setResponseHeaderMock).toHaveBeenCalledWith(expect.anything(), 'Retry-After', 3);
    });

    it('sets rate-limit headers on allowed requests', async () => {
        const handler = (await import('../push.post')).default as (event: H3Event) => Promise<unknown>;
        readBodyMock.mockResolvedValue(makeBaseBody());

        await handler(makeEvent());

        expect(setResponseHeaderMock).toHaveBeenCalledWith(expect.anything(), 'X-RateLimit-Limit', '200');
        expect(setResponseHeaderMock).toHaveBeenCalledWith(expect.anything(), 'X-RateLimit-Remaining', '100');
    });

    it('returns 500 when adapter is not configured', async () => {
        const handler = (await import('../push.post')).default as (event: H3Event) => Promise<unknown>;
        readBodyMock.mockResolvedValue(makeBaseBody());
        getActiveSyncGatewayAdapterMock.mockReturnValue(null);

        await expect(handler(makeEvent())).rejects.toMatchObject({ statusCode: 500 });
    });

    it('passes adapter result through and records request', async () => {
        const handler = (await import('../push.post')).default as (event: H3Event) => Promise<unknown>;
        const body = makeBaseBody();
        readBodyMock.mockResolvedValue(body);

        await expect(handler(makeEvent())).resolves.toEqual({ results: [], serverVersion: 7 });

        expect(pushMock).toHaveBeenCalledWith(expect.anything(), body);
        expect(recordSyncRequestMock).toHaveBeenCalledWith('user-1', 'sync:push');
    });

    it('enforces snake_case payload for TABLE_PAYLOAD_SCHEMAS (posts)', async () => {
        const handler = (await import('../push.post')).default as (event: H3Event) => Promise<unknown>;

        readBodyMock.mockResolvedValue({
            scope: { workspaceId: 'ws-1' },
            ops: [
                {
                    id: 'pending-op-3',
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
                    stamp: {
                        ...STAMP_1,
                        opId: 'a1b2c3d4-5678-4abc-8def-123456789003',
                    },
                    createdAt: 3,
                    attempts: 0,
                    status: 'pending',
                },
            ],
        });

        await expect(handler(makeEvent())).resolves.toEqual({ results: [], serverVersion: 7 });

        readBodyMock.mockResolvedValue({
            scope: { workspaceId: 'ws-1' },
            ops: [
                {
                    id: 'pending-op-4',
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
                        ...STAMP_1,
                        opId: 'a1b2c3d4-5678-4abc-8def-123456789004',
                    },
                    createdAt: 4,
                    attempts: 0,
                    status: 'pending',
                },
            ],
        });

        await expect(handler(makeEvent())).rejects.toMatchObject({ statusCode: 400 });
    });
});
