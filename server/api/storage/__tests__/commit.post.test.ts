import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { H3Event } from 'h3';

const readBodyMock = vi.fn();
const setResponseHeaderMock = vi.fn();

vi.mock('h3', async () => ({
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
    }),
}));

vi.mock('../../../auth/can', () => ({
    requireCan: vi.fn(),
}));

vi.mock('../../../utils/auth/is-ssr-auth-enabled', () => ({
    isSsrAuthEnabled: () => true,
}));

vi.mock('../../../utils/storage/is-storage-enabled', () => ({
    isStorageEnabled: () => true,
}));

const checkSyncRateLimitMock = vi.fn();
const recordSyncRequestMock = vi.fn();

vi.mock('../../../utils/sync/rate-limiter', () => ({
    checkSyncRateLimit: (...args: unknown[]) => checkSyncRateLimitMock(...args),
    recordSyncRequest: (...args: unknown[]) => recordSyncRequestMock(...args),
}));

const commitMock = vi.fn().mockResolvedValue(undefined);
vi.mock('../../../storage/gateway/resolve', () => ({
    getActiveStorageGatewayAdapterOrThrow: () => ({
        commit: commitMock,
    }),
}));

vi.mock('../../../utils/storage/metrics', () => ({
    recordUploadComplete: vi.fn(),
}));

function makeEvent(): H3Event {
    return { context: {}, node: { req: { headers: {} } } } as H3Event;
}

describe('POST /api/storage/commit rate limiting', () => {
    beforeEach(() => {
        readBodyMock.mockReset();
        setResponseHeaderMock.mockReset();
        checkSyncRateLimitMock.mockReset();
        recordSyncRequestMock.mockReset();
        commitMock.mockReset();
    });

    it('returns 429 when rate limit is exceeded', async () => {
        const handler = (await import('../commit.post')).default as (
            event: H3Event
        ) => Promise<unknown>;

        readBodyMock.mockResolvedValue({
            workspace_id: 'ws-1',
            hash: 'hash-1',
            storage_id: 'storage-1',
            storage_provider_id: 'convex',
            mime_type: 'image/png',
            size_bytes: 100,
            name: 'file.png',
            kind: 'image',
        });

        checkSyncRateLimitMock.mockReturnValue({
            allowed: false,
            remaining: 0,
            retryAfterMs: 2000,
        });

        await expect(handler(makeEvent())).rejects.toMatchObject({
            statusCode: 429,
        });

        expect(setResponseHeaderMock).toHaveBeenCalledWith(
            expect.anything(),
            'Retry-After',
            2
        );
    });
});
