import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { H3Event } from 'h3';

const readBodyMock = vi.fn();
const setResponseHeaderMock = vi.fn();
const setHeaderMock = vi.fn();

vi.mock('h3', () => ({
    defineEventHandler: (handler: unknown) => handler,
    readBody: readBodyMock,
    getHeader: (
        event: { node?: { req?: { headers?: Record<string, string> } } },
        name: string
    ) => {
        const headers = event?.node?.req?.headers ?? {};
        return headers[name] ?? headers[name.toLowerCase()];
    },
    setResponseHeader: setResponseHeaderMock,
    setHeader: setHeaderMock,
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

function successfulPushResult(opId: string) {
    return {
        results: [{ opId, success: true, serverVersion: 7 }],
        serverVersion: 7,
    };
}

describe('POST /api/sync/push', () => {
    beforeEach(() => {
        readBodyMock.mockReset();
        setResponseHeaderMock.mockReset();
        setHeaderMock.mockReset();
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
        pushMock.mockReset().mockImplementation(
            async (
                _event: H3Event,
                batch: { ops: Array<{ stamp: { opId: string } }> }
            ) => ({
                results: batch.ops.map((op) => ({
                    opId: op.stamp.opId,
                    success: true,
                    serverVersion: 7,
                })),
                serverVersion: 7,
            })
        );
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

    it('returns mixed 200 results when put payload fails table schema', async () => {
        const handler = (await import('../push.post')).default as (event: H3Event) => Promise<unknown>;
        const body = makeBaseBody() as any;
        body.ops[0]!.payload = { id: 'm1', role: 'user' };
        readBodyMock.mockResolvedValue(body);

        await expect(handler(makeEvent())).resolves.toMatchObject({
            results: [
                {
                    opId: STAMP_1.opId,
                    success: false,
                    errorCode: 'VALIDATION_ERROR',
                },
            ],
            serverVersion: 0,
        });
        expect(pushMock).not.toHaveBeenCalled();
        expect(recordSyncRequestMock).toHaveBeenCalledWith('user-1', 'sync:push');
    });

    it('accepts sync payloads larger than the former 64KB limit', async () => {
        const handler = (await import('../push.post')).default as (event: H3Event) => Promise<unknown>;
        const body = makeBaseBody();
        (body.ops[0]!.payload as Record<string, unknown>).data = {
            content: 'x'.repeat(120 * 1024),
        };
        readBodyMock.mockResolvedValue(body);

        await expect(handler(makeEvent())).resolves.toEqual(
            successfulPushResult(STAMP_1.opId)
        );
    });

    it('rejects sync payloads larger than 256KB without reaching a provider', async () => {
        const handler = (await import('../push.post')).default as (event: H3Event) => Promise<unknown>;
        const body = makeBaseBody();
        (body.ops[0]!.payload as Record<string, unknown>).data = {
            content: 'x'.repeat(257 * 1024),
        };
        readBodyMock.mockResolvedValue(body);

        await expect(handler(makeEvent())).resolves.toMatchObject({
            results: [
                {
                    opId: STAMP_1.opId,
                    success: false,
                    errorCode: 'OVERSIZED',
                },
            ],
            serverVersion: 0,
        });
        expect(pushMock).not.toHaveBeenCalled();
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

        await expect(handler(makeEvent())).resolves.toEqual(
            successfulPushResult(
                'a1b2c3d4-5678-4abc-8def-123456789002'
            )
        );
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

        await expect(handler(makeEvent())).resolves.toEqual(
            successfulPushResult(STAMP_1.opId)
        );

        expect(pushMock).toHaveBeenCalledWith(expect.anything(), body);
        expect(recordSyncRequestMock).toHaveBeenCalledWith('user-1', 'sync:push');
    });

    it('accepts camelCase payloads and forwards snake_case normalized payloads', async () => {
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
                        postType: 'markdown',
                        deleted: false,
                        createdAt: 1,
                        updatedAt: 1,
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

        await expect(handler(makeEvent())).resolves.toEqual(
            successfulPushResult(
                'a1b2c3d4-5678-4abc-8def-123456789003'
            )
        );
        const firstCall = pushMock.mock.calls[0]?.[1] as
            | { ops?: Array<{ payload?: Record<string, unknown> }> }
            | undefined;
        const payload = firstCall?.ops?.[0]?.payload;
        expect(payload?.post_type).toBe('markdown');
        expect(payload?.created_at).toBe(1);
        expect(payload?.updated_at).toBe(1);
        expect(payload).not.toHaveProperty('postType');
        expect(payload).not.toHaveProperty('createdAt');
        expect(payload).not.toHaveProperty('updatedAt');

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
                        post_type: 'markdown',
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

        await expect(handler(makeEvent())).resolves.toEqual(
            successfulPushResult(
                'a1b2c3d4-5678-4abc-8def-123456789004'
            )
        );
    });

    it.each([
        ['missing', { results: [], serverVersion: 7 }],
        [
            'duplicate',
            {
                results: [
                    {
                        opId: STAMP_1.opId,
                        success: true,
                        serverVersion: 7,
                    },
                    {
                        opId: STAMP_1.opId,
                        success: true,
                        serverVersion: 7,
                    },
                ],
                serverVersion: 7,
            },
        ],
    ])('returns 502 for %s operation IDs in adapter results', async (_label, response) => {
        const handler = (await import('../push.post')).default as (
            event: H3Event
        ) => Promise<unknown>;
        readBodyMock.mockResolvedValue(makeBaseBody());
        pushMock.mockResolvedValue(response);

        await expect(handler(makeEvent())).rejects.toMatchObject({
            statusCode: 502,
        });
        expect(recordSyncRequestMock).toHaveBeenCalledWith('user-1', 'sync:push');
    });

    it('returns mixed 200 results for a valid op beside an invalid sibling', async () => {
        const handler = (await import('../push.post')).default as (event: H3Event) => Promise<unknown>;
        const invalidStamp = {
            ...STAMP_1,
            opId: 'a1b2c3d4-5678-4abc-8def-123456789099',
        };
        const body = makeBaseBody();
        body.ops.push({
            ...body.ops[0]!,
            id: 'pending-op-invalid',
            pk: 'm-bad',
            payload: { id: 'm-bad', role: 'user' } as never,
            stamp: invalidStamp,
        });
        readBodyMock.mockResolvedValue(body);

        const result = await handler(makeEvent()) as {
            results: Array<{ opId: string; success: boolean; errorCode?: string }>;
            serverVersion: number;
        };
        expect(result.results).toHaveLength(2);
        expect(result.results[0]).toMatchObject({
            opId: STAMP_1.opId,
            success: true,
        });
        expect(result.results[1]).toMatchObject({
            opId: invalidStamp.opId,
            success: false,
            errorCode: 'VALIDATION_ERROR',
        });
        expect(pushMock).toHaveBeenCalledTimes(1);
        expect(pushMock.mock.calls[0]?.[1]?.ops).toHaveLength(1);
    });

    it('returns 413 when the declared content-length exceeds the batch ceiling', async () => {
        const handler = (await import('../push.post')).default as (event: H3Event) => Promise<unknown>;
        const event = {
            context: {},
            node: { req: { headers: { 'content-length': String(3 * 1024 * 1024) } } },
        } as H3Event;

        await expect(handler(event)).rejects.toMatchObject({ statusCode: 413 });
        expect(pushMock).not.toHaveBeenCalled();
    });
});
