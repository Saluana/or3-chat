import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { H3Event } from 'h3';

const setResponseHeaderMock = vi.fn();
const getRequestHeaderMock = vi.fn();
const readBodyMock = vi.fn();
const resolveSessionContextMock = vi.fn();
const requireCanMock = vi.fn();
const canMock = vi.fn(() => ({ allowed: true }));
const isSsrAuthEnabledMock = vi.fn(() => true);
const checkSyncRateLimitMock = vi.fn();
const recordSyncRequestMock = vi.fn();
const getClientIpMock = vi.fn(() => '127.0.0.1');
const getProxyRequestHostMock = vi.fn(() => 'chat.test');
const normalizeProxyTrustConfigMock = vi.fn(() => ({ trustProxy: false }));

vi.mock('h3', () => ({
    defineEventHandler: (handler: unknown) => handler,
    createError: (opts: {
        statusCode: number;
        statusMessage?: string;
        data?: unknown;
    }) => {
        const err = new Error(opts.statusMessage ?? 'Error') as Error & {
            statusCode: number;
            data?: unknown;
        };
        err.statusCode = opts.statusCode;
        err.data = opts.data;
        return err;
    },
    setResponseHeader: setResponseHeaderMock,
    getRequestHeader: getRequestHeaderMock,
    readBody: readBodyMock,
}));

vi.mock('../../../auth/session', () => ({
    resolveSessionContext: resolveSessionContextMock,
}));

vi.mock('../../../auth/can', () => ({
    requireCan: requireCanMock,
    can: canMock,
}));

vi.mock('../../../utils/auth/is-ssr-auth-enabled', () => ({
    isSsrAuthEnabled: isSsrAuthEnabledMock,
}));

vi.mock('../../../utils/sync/rate-limiter', () => ({
    checkSyncRateLimit: checkSyncRateLimitMock,
    recordSyncRequest: recordSyncRequestMock,
}));

vi.mock('../../../utils/net/request-identity', () => ({
    getClientIp: getClientIpMock,
    getProxyRequestHost: getProxyRequestHostMock,
    normalizeProxyTrustConfig: normalizeProxyTrustConfigMock,
}));

vi.mock('../../../utils/headers', () => ({
    setNoCacheHeaders: vi.fn(),
}));

vi.mock('../../../utils/or3-net/config', () => ({
    getOr3NetServerConfig: () => ({
        enabled: true,
        hostUrl: 'https://net.test',
        exchangeSecret: 'secret',
        exchangeIssuer: 'or3-chat',
        exchangeAudience: 'or3-net',
        exchangeTtlMs: 60_000,
        exchangeTimeoutMs: 10_000,
    }),
}));

let handler: (event: H3Event) => Promise<unknown>;

function makeEvent(): H3Event {
    return {
        context: {},
        method: 'POST',
        node: {
            req: {
                socket: {
                    remoteAddress: '127.0.0.1',
                },
            },
        },
    } as H3Event;
}

beforeAll(async () => {
    vi.stubGlobal('useRuntimeConfig', () => ({
        security: { proxy: {} },
        or3Net: {
            hostUrl: 'https://net.test',
            exchangeSecret: 'secret',
            exchangeIssuer: 'or3-chat',
            exchangeAudience: 'or3-net',
            exchangeTtlMs: 60_000,
        },
    }));

    const mod = await import('../exchange.post');
    handler = mod.default as (event: H3Event) => Promise<unknown>;
});

describe('POST /api/or3-net/exchange', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        setResponseHeaderMock.mockReset();
        getRequestHeaderMock.mockReset().mockImplementation((_, name: string) => {
            if (name === 'host') return 'chat.test';
            if (name === 'origin') return 'https://chat.test';
            return undefined;
        });
        readBodyMock.mockReset().mockResolvedValue({});
        resolveSessionContextMock.mockReset().mockResolvedValue({
            authenticated: true,
            user: { id: 'user-1' },
            workspace: { id: 'ws-1', name: 'Workspace 1' },
            role: 'owner',
        });
        requireCanMock.mockReset();
        canMock.mockReset().mockReturnValue({ allowed: true });
        isSsrAuthEnabledMock.mockReset().mockReturnValue(true);
        checkSyncRateLimitMock.mockReset().mockReturnValue({ allowed: true });
        recordSyncRequestMock.mockReset();
        getClientIpMock.mockReset().mockReturnValue('127.0.0.1');
        getProxyRequestHostMock.mockReset().mockReturnValue('chat.test');
        normalizeProxyTrustConfigMock.mockReset().mockReturnValue({ trustProxy: false });
        vi.stubGlobal(
            'fetch',
            vi.fn(async () =>
                new Response(
                    JSON.stringify({
                        token: 'net-token',
                        workspace_id: 'ws-1',
                        expires_at: '2099-01-01T00:00:00.000Z',
                        scopes: ['jobs:read'],
                    }),
                    {
                        status: 200,
                        headers: { 'Content-Type': 'application/json' },
                    }
                )
            )
        );
    });

    it('exchanges the active workspace session through OR3 Net', async () => {
        await expect(handler(makeEvent())).resolves.toEqual({
            token: 'net-token',
            workspace_id: 'ws-1',
            expires_at: '2099-01-01T00:00:00.000Z',
            scopes: ['jobs:read'],
        });

        expect(fetch).toHaveBeenCalledWith(
            'https://net.test/v1/auth/exchange',
            expect.objectContaining({
                method: 'POST',
            })
        );
        expect(recordSyncRequestMock).toHaveBeenCalledWith(
            '127.0.0.1',
            'auth:or3-net-exchange'
        );
    });

    it('rejects unauthenticated sessions', async () => {
        resolveSessionContextMock.mockResolvedValue({ authenticated: false });

        await expect(handler(makeEvent())).rejects.toMatchObject({
            statusCode: 401,
        });
    });

    it('rejects explicit workspace mismatches', async () => {
        readBodyMock.mockResolvedValue({ workspace_id: 'ws-other' });

        await expect(handler(makeEvent())).rejects.toMatchObject({
            statusCode: 403,
        });
    });

    it('rejects mutation requests without an origin or referer header', async () => {
        getRequestHeaderMock.mockImplementation((_, name: string) => {
            if (name === 'host') return 'chat.test';
            return undefined;
        });

        await expect(handler(makeEvent())).rejects.toMatchObject({
            statusCode: 403,
            message: 'Forbidden: Origin header required',
        });
        expect(fetch).not.toHaveBeenCalled();
    });

    it('returns 429 when rate limited', async () => {
        checkSyncRateLimitMock.mockReturnValue({
            allowed: false,
            retryAfterMs: 2_500,
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
