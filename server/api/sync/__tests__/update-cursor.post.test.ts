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

const updateCursorMock = vi.fn();
const getActiveSyncGatewayAdapterMock = vi.fn();
vi.mock('../../../sync/gateway/registry', () => ({
    getActiveSyncGatewayAdapter: getActiveSyncGatewayAdapterMock as any,
}));

function makeEvent(): H3Event {
    return { context: {}, node: { req: { headers: {} } } } as H3Event;
}

function makeValidBody() {
    return {
        scope: { workspaceId: 'ws-1' },
        deviceId: 'device-1',
        version: 12,
    };
}

describe('POST /api/sync/update-cursor', () => {
    beforeEach(() => {
        readBodyMock.mockReset();
        setResponseHeaderMock.mockReset();
        resolveSessionContextMock.mockReset();
        requireCanMock.mockReset();
        isSsrAuthEnabledMock.mockReset().mockReturnValue(true);
        isSyncEnabledMock.mockReset().mockReturnValue(true);
        checkSyncRateLimitMock.mockReset().mockReturnValue({ allowed: true, remaining: 10 });
        recordSyncRequestMock.mockReset();
        getSyncRateLimitStatsMock.mockReset().mockReturnValue({ limit: 100, remaining: 99 });
        updateCursorMock.mockReset().mockResolvedValue(undefined);
        getActiveSyncGatewayAdapterMock.mockReset().mockReturnValue({
            id: 'adapter-1',
            updateCursor: updateCursorMock as any,
        });
        resolveSessionContextMock.mockResolvedValue({
            authenticated: true,
            user: { id: 'user-1' },
            workspace: { id: 'ws-1' },
        });
    });

    it('rejects missing scope/deviceId and negative version with 400', async () => {
        const handler = (await import('../update-cursor.post')).default as (event: H3Event) => Promise<unknown>;

        readBodyMock.mockResolvedValue({ version: -1 });
        await expect(handler(makeEvent())).rejects.toMatchObject({ statusCode: 400 });

        readBodyMock.mockResolvedValue({ scope: { workspaceId: 'ws-1' }, version: 2 });
        await expect(handler(makeEvent())).rejects.toMatchObject({ statusCode: 400 });
    });

    it('returns 404 when auth or sync is disabled', async () => {
        const handler = (await import('../update-cursor.post')).default as (event: H3Event) => Promise<unknown>;

        isSsrAuthEnabledMock.mockReturnValue(false);
        await expect(handler(makeEvent())).rejects.toMatchObject({ statusCode: 404 });

        isSsrAuthEnabledMock.mockReturnValue(true);
        isSyncEnabledMock.mockReturnValue(false);
        await expect(handler(makeEvent())).rejects.toMatchObject({ statusCode: 404 });
    });

    it('returns 401 when unauthenticated', async () => {
        const handler = (await import('../update-cursor.post')).default as (event: H3Event) => Promise<unknown>;
        readBodyMock.mockResolvedValue(makeValidBody());
        resolveSessionContextMock.mockResolvedValue({ authenticated: false });

        await expect(handler(makeEvent())).rejects.toMatchObject({ statusCode: 401 });
    });

    it('returns 403 when permission check fails', async () => {
        const handler = (await import('../update-cursor.post')).default as (event: H3Event) => Promise<unknown>;
        readBodyMock.mockResolvedValue(makeValidBody());
        requireCanMock.mockImplementation(() => {
            const err = new Error('Forbidden') as Error & { statusCode: number };
            err.statusCode = 403;
            throw err;
        });

        await expect(handler(makeEvent())).rejects.toMatchObject({ statusCode: 403 });
    });

    it('returns 429 with Retry-After when rate limited', async () => {
        const handler = (await import('../update-cursor.post')).default as (event: H3Event) => Promise<unknown>;
        readBodyMock.mockResolvedValue(makeValidBody());
        checkSyncRateLimitMock.mockReturnValue({ allowed: false, retryAfterMs: 1200 });

        await expect(handler(makeEvent())).rejects.toMatchObject({ statusCode: 429 });
        expect(setResponseHeaderMock).toHaveBeenCalledWith(expect.anything(), 'Retry-After', 2);
    });

    it('returns 500 when adapter is missing', async () => {
        const handler = (await import('../update-cursor.post')).default as (event: H3Event) => Promise<unknown>;
        readBodyMock.mockResolvedValue(makeValidBody());
        getActiveSyncGatewayAdapterMock.mockReturnValue(null);

        await expect(handler(makeEvent())).rejects.toMatchObject({ statusCode: 500 });
    });

    it('updates cursor with exact arguments and returns ok', async () => {
        const handler = (await import('../update-cursor.post')).default as (event: H3Event) => Promise<unknown>;
        const body = makeValidBody();
        readBodyMock.mockResolvedValue(body);

        await expect(handler(makeEvent())).resolves.toEqual({ ok: true });
        expect(updateCursorMock).toHaveBeenCalledWith(expect.anything(), body);
        expect(recordSyncRequestMock).toHaveBeenCalledWith('user-1', 'sync:cursor');
    });
});
