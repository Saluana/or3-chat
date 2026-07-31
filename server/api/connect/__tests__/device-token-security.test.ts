import { beforeEach, describe, expect, it, vi } from 'vitest';

const setResponseHeaderMock = vi.fn();
vi.mock('h3', () => ({
    defineEventHandler: (handler: unknown) => handler,
    getRequestIP: () => '203.0.113.10',
    setResponseHeader: (...args: unknown[]) =>
        setResponseHeaderMock(...args),
    createError: (options: {
        statusCode: number;
        statusMessage: string;
    }) =>
        Object.assign(new Error(options.statusMessage), {
            statusCode: options.statusCode,
        }),
}));

const readLimitedJsonBodyMock = vi.fn();
vi.mock('../../../utils/security/limited-json-body', () => ({
    readLimitedJsonBody: (...args: unknown[]) =>
        readLimitedJsonBodyMock(...args),
}));

const getAuthorizationMock = vi.fn();
const rotateAuthorizationMock = vi.fn();
vi.mock('../../../connect/store/require', () => ({
    requireConnectStore: () => ({
        getAuthorizationByDeviceHash: getAuthorizationMock,
        rotateAuthorizationCredential: rotateAuthorizationMock,
    }),
}));

const checkAndRecordMock = vi.fn();
vi.mock('../../../connect/rate-limit', () => ({
    getConnectRateLimitProvider: () => ({
        checkAndRecord: checkAndRecordMock,
    }),
}));

vi.mock('../../../connect/config', () => ({
    getConnectServerConfig: () => ({
        encryptionKey:
            'device-token-test-encryption-key-that-is-long-enough',
    }),
}));

vi.mock('../../../connect/helpers', () => ({
    noStore: vi.fn(),
    parseConnectHost: () => ({}),
}));

vi.mock('../../../connect/crypto', () => ({
    hashConnectSecret: (value: string) => `hash:${value}`,
    decryptConnectCredential: () => ({
        accountId: 'user-one',
        workspaceId: 'workspace-one',
        environmentId: 'environment-one',
        controlToken: 'token',
    }),
    encryptConnectCredential: () => 'v2.rotated',
    isLegacyConnectCredentialEnvelope: () => false,
}));

async function handler() {
    return (await import('../device/token.post')).default as (
        event: unknown
    ) => Promise<unknown>;
}

describe('Connect device token public endpoint security', () => {
    beforeEach(() => {
        vi.resetModules();
        setResponseHeaderMock.mockReset();
        readLimitedJsonBodyMock.mockReset().mockResolvedValue({
            deviceCode: 'd'.repeat(43),
            host: {},
        });
        getAuthorizationMock.mockReset().mockResolvedValue({
            _id: 'authorization-one',
            status: 'pending',
            host: {},
            expires_at: Date.now() + 60_000,
        });
        rotateAuthorizationMock.mockReset().mockResolvedValue(true);
        checkAndRecordMock
            .mockReset()
            .mockResolvedValue({ allowed: true, remaining: 10 });
    });

    it('allows a compliant three-second poll budget', async () => {
        const tokenHandler = await handler();
        await expect(tokenHandler({})).resolves.toEqual({
            status: 'pending',
            retryAfter: 3,
        });
        expect(checkAndRecordMock).toHaveBeenCalledTimes(2);
        expect(checkAndRecordMock.mock.calls[0]?.[1]).toEqual({
            windowMs: 60_000,
            maxRequests: 60,
        });
        expect(checkAndRecordMock.mock.calls[1]?.[1]).toEqual({
            windowMs: 60_000,
            maxRequests: 30,
        });
    });

    it('returns protocol slow_down and Retry-After before a throttled poll hits storage', async () => {
        checkAndRecordMock.mockResolvedValueOnce({
            allowed: false,
            remaining: 0,
            retryAfterMs: 4_100,
        });
        const tokenHandler = await handler();
        await expect(tokenHandler({})).resolves.toEqual({
            status: 'slow_down',
            error: 'slow_down',
            retryAfter: 5,
        });
        expect(setResponseHeaderMock).toHaveBeenCalledWith(
            {},
            'Retry-After',
            5
        );
        expect(readLimitedJsonBodyMock).not.toHaveBeenCalled();
        expect(getAuthorizationMock).not.toHaveBeenCalled();
    });

    it('charges invalid-code traffic to a global provider-backed budget', async () => {
        getAuthorizationMock.mockResolvedValue(null);
        const tokenHandler = await handler();
        await expect(tokenHandler({})).resolves.toEqual({
            status: 'expired',
        });
        expect(checkAndRecordMock).toHaveBeenCalledWith(
            'connect:token:invalid:global',
            { windowMs: 60_000, maxRequests: 300 }
        );
    });
});
