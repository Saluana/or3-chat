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

const resolveHitlRequestMock = vi.fn();
vi.mock('../../../utils/workflows/hitl-store', () => ({
    resolveHitlRequest: resolveHitlRequestMock as any,
}));

const checkSyncRateLimitMock = vi.fn();
const recordSyncRequestMock = vi.fn();
vi.mock('../../../utils/sync/rate-limiter', () => ({
    checkSyncRateLimit: checkSyncRateLimitMock as any,
    recordSyncRequest: recordSyncRequestMock as any,
}));

function makeEvent(): H3Event {
    return { context: {}, node: { req: { headers: {} } } } as H3Event;
}

describe('POST /api/workflows/hitl', () => {
    beforeEach(() => {
        readBodyMock.mockReset().mockResolvedValue({
            requestId: 'req-1',
            jobId: 'job-1',
            action: 'approve',
            data: { notes: 'ok' },
        });
        setResponseHeaderMock.mockReset();
        resolveSessionContextMock.mockReset().mockResolvedValue({
            authenticated: true,
            user: { id: 'user-1' },
            workspace: { id: 'ws-1' },
        });
        requireCanMock.mockReset();
        isSsrAuthEnabledMock.mockReset().mockReturnValue(true);
        resolveHitlRequestMock.mockReset().mockResolvedValue(true);
        checkSyncRateLimitMock.mockReset().mockReturnValue({
            allowed: true,
            remaining: 100,
        });
        recordSyncRequestMock.mockReset();
    });

    it('resolves HITL request and records rate-limit accounting', async () => {
        const handler = (await import('../hitl.post')).default as (
            event: H3Event
        ) => Promise<unknown>;

        const result = await handler(makeEvent());

        expect(result).toEqual({ ok: true });
        expect(resolveHitlRequestMock).toHaveBeenCalledWith(
            'req-1',
            expect.objectContaining({
                requestId: 'req-1',
                action: 'approve',
            }),
            'user-1',
            'ws-1',
            'job-1'
        );
        expect(recordSyncRequestMock).toHaveBeenCalledWith(
            'user-1',
            'workflow:hitl'
        );
    });

    it('requires jobId', async () => {
        const handler = (await import('../hitl.post')).default as (
            event: H3Event
        ) => Promise<unknown>;
        readBodyMock.mockResolvedValue({
            requestId: 'req-1',
            action: 'approve',
        });

        await expect(handler(makeEvent())).rejects.toMatchObject({
            statusCode: 400,
        });
        expect(resolveHitlRequestMock).not.toHaveBeenCalled();
    });

    it('returns 404 when request cannot be resolved', async () => {
        const handler = (await import('../hitl.post')).default as (
            event: H3Event
        ) => Promise<unknown>;
        resolveHitlRequestMock.mockResolvedValue(false);

        await expect(handler(makeEvent())).rejects.toMatchObject({
            statusCode: 404,
        });
    });

    it('returns 429 when rate limit is exceeded', async () => {
        const handler = (await import('../hitl.post')).default as (
            event: H3Event
        ) => Promise<unknown>;
        checkSyncRateLimitMock.mockReturnValue({
            allowed: false,
            retryAfterMs: 2200,
        });

        await expect(handler(makeEvent())).rejects.toMatchObject({
            statusCode: 429,
        });
        expect(setResponseHeaderMock).toHaveBeenCalledWith(
            expect.anything(),
            'Retry-After',
            3
        );
    });
});
