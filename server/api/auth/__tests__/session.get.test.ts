import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { H3Event } from 'h3';
import { testRuntimeConfig } from '../../../../tests/setup';

const setResponseHeaderMock = vi.fn();
const resolveSessionContextMock = vi.fn();
const isSsrAuthEnabledMock = vi.fn(() => true);
const checkSyncRateLimitMock = vi.fn();
const recordSyncRequestMock = vi.fn();
const getSyncRateLimitStatsMock = vi.fn();
const getClientIpMock = vi.fn(() => '127.0.0.1');
const normalizeProxyTrustConfigMock = vi.fn(() => ({}));
const canMock = vi.fn();
const resolveEntitlementsMock = vi.fn();

vi.mock('h3', () => ({
    defineEventHandler: (handler: unknown) => handler,
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
    resolveSessionContext: resolveSessionContextMock as any,
}));

vi.mock('../../../auth/can', () => ({
    can: canMock as any,
}));

vi.mock('../../../auth/entitlements/registry', () => ({
    resolveEntitlements: resolveEntitlementsMock as any,
}));

vi.mock('../../../utils/auth/is-ssr-auth-enabled', () => ({
    isSsrAuthEnabled: isSsrAuthEnabledMock as any,
}));

vi.mock('../../../utils/sync/rate-limiter', async (importOriginal) => ({
    ...await importOriginal<typeof import('../../../utils/sync/rate-limiter')>(),
    checkSyncRateLimit: checkSyncRateLimitMock,
    recordSyncRequest: recordSyncRequestMock,
    getSyncRateLimitStats: getSyncRateLimitStatsMock,
}));

vi.mock('../../../utils/net/request-identity', () => ({
    getClientIp: getClientIpMock as any,
    normalizeProxyTrustConfig: normalizeProxyTrustConfigMock as any,
}));

let SESSION_CACHE_CONTROL: string;
let handler: (event: H3Event) => Promise<unknown>;

function makeEvent(): H3Event {
    return {
        context: {},
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
    const globalAny = globalThis as typeof globalThis & {
        defineEventHandler?: (handler: unknown) => unknown;
        useRuntimeConfig?: () => unknown;
    };

    if (!globalAny.defineEventHandler) {
        globalAny.defineEventHandler = (handler) => handler;
    }
    globalAny.useRuntimeConfig = () => testRuntimeConfig.value;

    const mod = await import('../session.get');
    SESSION_CACHE_CONTROL = mod.SESSION_CACHE_CONTROL;
    handler = mod.default as (event: H3Event) => Promise<unknown>;
});

describe('GET /api/auth/session', () => {
    beforeEach(async () => {
        const { resetSyncRateLimits } = await import('../../../utils/sync/rate-limiter');
        resetSyncRateLimits();
        testRuntimeConfig.value.limits.operationRateLimits = {};
        setResponseHeaderMock.mockReset();
        resolveSessionContextMock.mockReset().mockResolvedValue({ authenticated: false });
        isSsrAuthEnabledMock.mockReset().mockReturnValue(true);
        checkSyncRateLimitMock.mockReset().mockReturnValue({ allowed: true });
        recordSyncRequestMock.mockReset();
        getSyncRateLimitStatsMock
            .mockReset()
            .mockReturnValue({ limit: 100, remaining: 99 });
        getClientIpMock.mockReset().mockReturnValue('127.0.0.1');
        normalizeProxyTrustConfigMock.mockReset().mockReturnValue({});
        canMock.mockReset().mockReturnValue({ allowed: true });
        resolveEntitlementsMock.mockReset().mockResolvedValue([]);
    });

    afterEach(async () => {
        const { resetSyncRateLimits } = await import('../../../utils/sync/rate-limiter');
        resetSyncRateLimits();
        vi.restoreAllMocks();
    });

    it('bounds concurrent anonymous session lookups and permits retry after expiry', async () => {
        const limiter = await vi.importActual<typeof import('../../../utils/sync/rate-limiter')>(
            '../../../utils/sync/rate-limiter'
        );
        checkSyncRateLimitMock.mockImplementation(limiter.checkSyncRateLimit);
        recordSyncRequestMock.mockImplementation(limiter.recordSyncRequest);
        getSyncRateLimitStatsMock.mockImplementation(limiter.getSyncRateLimitStats);
        testRuntimeConfig.value.limits.operationRateLimits = {
            'auth:session': { maxRequests: 2, windowMs: 60_000 },
        };
        let now = Date.now();
        vi.spyOn(Date, 'now').mockImplementation(() => now);
        let release!: () => void;
        const gate = new Promise<void>((resolve) => { release = resolve; });
        resolveSessionContextMock.mockImplementation(async () => {
            await gate;
            return { authenticated: false };
        });
        const requests = Array.from({ length: 3 }, () => handler(makeEvent()).then(
            () => 200,
            (error: { statusCode: number }) => error.statusCode
        ));
        try {
            await vi.waitFor(() => expect(resolveSessionContextMock.mock.calls.length).toBeGreaterThanOrEqual(2));
        } finally {
            release();
        }
        expect((await Promise.all(requests)).sort()).toEqual([200, 200, 429]);
        expect(resolveSessionContextMock).toHaveBeenCalledTimes(2);
        expect(setResponseHeaderMock).toHaveBeenCalledWith(expect.anything(), 'Retry-After', 60);
        expect(setResponseHeaderMock).toHaveBeenCalledWith(expect.anything(), 'X-RateLimit-Remaining', '0');

        now += 60_000;
        await expect(handler(makeEvent())).resolves.toEqual({ session: null, appAccessAllowed: false });
    });

    it('never allows caching session responses', () => {
        expect(SESSION_CACHE_CONTROL).toBe('no-store');
    });

    it('returns null session payload when SSR auth is disabled', async () => {
        isSsrAuthEnabledMock.mockReturnValue(false);

        await expect(handler(makeEvent())).resolves.toEqual({
            session: null,
            appAccessAllowed: false,
        });
        expect(setResponseHeaderMock).toHaveBeenCalledWith(
            expect.anything(),
            'Cache-Control',
            'no-store'
        );
    });

    it('includes workspace.read access in the session payload', async () => {
        resolveSessionContextMock.mockResolvedValue({
            authenticated: true,
            user: { id: 'user-1' },
            workspace: { id: 'workspace-1', name: 'Workspace' },
            role: 'owner',
        });
        canMock.mockReturnValue({ allowed: false });

        await expect(handler(makeEvent())).resolves.toEqual({
            session: {
                authenticated: true,
                user: { id: 'user-1' },
                workspace: { id: 'workspace-1', name: 'Workspace' },
                role: 'owner',
                entitlements: [],
            },
            appAccessAllowed: false,
        });
        expect(canMock).toHaveBeenCalledWith(
            expect.objectContaining({ authenticated: true }),
            'workspace.read',
            {
                kind: 'workspace',
                id: 'workspace-1',
            }
        );
    });

    it('includes resolved entitlements in the client session', async () => {
        const session = {
            authenticated: true,
            user: { id: 'user-1' },
            workspace: { id: 'workspace-1', name: 'Workspace' },
            role: 'owner',
        };
        resolveSessionContextMock.mockResolvedValue(session);
        resolveEntitlementsMock.mockResolvedValue(['paid', 'beta']);

        await expect(handler(makeEvent())).resolves.toMatchObject({
            session: {
                ...session,
                entitlements: ['paid', 'beta'],
            },
        });
        expect(resolveEntitlementsMock).toHaveBeenCalledWith(
            expect.anything(),
            session
        );
    });
});
