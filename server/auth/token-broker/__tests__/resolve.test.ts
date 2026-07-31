import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { H3Event } from 'h3';
import { testRuntimeConfig } from '../../../../tests/setup';
import {
    resolveProviderToken,
    _resetProviderTokenCache,
    _getProviderTokenCacheKeysForTest,
} from '../resolve';

const getProviderTokenMock = vi.hoisted(() => vi.fn());
const getProviderTokenBrokerMock = vi.hoisted(() => vi.fn());
const resolveSessionContextMock = vi.hoisted(() => vi.fn());

vi.mock('../registry', () => ({
    getProviderTokenBroker: getProviderTokenBrokerMock as any,
}));

vi.mock('../../session', () => ({
    resolveSessionContext: resolveSessionContextMock,
}));

function makeEvent(headers?: Record<string, string>): H3Event {
    return {
        context: {},
        node: {
            req: {
                headers: headers ?? {},
            },
        },
    } as H3Event;
}

describe('resolveProviderToken', () => {
    beforeEach(() => {
        _resetProviderTokenCache();
        getProviderTokenMock.mockReset().mockResolvedValue('token-1');
        getProviderTokenBrokerMock.mockReset().mockImplementation(() => ({
            getProviderToken: getProviderTokenMock,
        }));
        resolveSessionContextMock.mockReset().mockResolvedValue({
            authenticated: true,
            provider: 'clerk',
            providerUserId: 'provider-user-1',
            user: { id: 'user-1' },
            workspace: { id: 'workspace-1', name: 'Workspace' },
            role: 'owner',
            expiresAt: '2026-01-01T01:00:00.000Z',
            deploymentAdmin: false,
            authorizationRevision: 4,
        });

        testRuntimeConfig.value = {
            ...testRuntimeConfig.value,
            auth: {
                ...testRuntimeConfig.value.auth,
                provider: 'convex',
                tokenCacheTtlMs: 10_000,
            },
        };
    });

    it('selects broker by configured runtime provider', async () => {
        await resolveProviderToken(makeEvent({ cookie: 'session=a' }), {
            providerId: 'convex',
            template: 'convex-sync',
        });

        expect(getProviderTokenBrokerMock).toHaveBeenCalledWith('convex');
    });

    it('falls back to clerk provider id when config provider is missing', async () => {
        testRuntimeConfig.value = {
            ...testRuntimeConfig.value,
            auth: {
                ...testRuntimeConfig.value.auth,
                provider: '',
            },
        };

        await resolveProviderToken(makeEvent({ cookie: 'session=a' }), {
            providerId: 'convex',
            template: 'convex-sync',
        });

        expect(getProviderTokenBrokerMock).toHaveBeenCalledWith('clerk');
    });

    it('returns null when broker is not registered', async () => {
        getProviderTokenBrokerMock.mockReturnValue(null);

        await expect(
            resolveProviderToken(makeEvent({ cookie: 'session=a' }), {
                providerId: 'convex',
                template: 'convex-sync',
            })
        ).resolves.toBeNull();
    });

    it('forwards exact token request payload to broker', async () => {
        const request = { providerId: 'convex', template: 'convex-sync' };

        await resolveProviderToken(makeEvent({ cookie: 'session=a' }), request);

        expect(getProviderTokenMock).toHaveBeenCalledWith(expect.anything(), request);
    });

    it('reuses broker token for equivalent request scope', async () => {
        const request = { providerId: 'convex', template: 'convex-sync' };

        const tokenA = await resolveProviderToken(makeEvent({ cookie: 'session=a' }), request);
        const tokenB = await resolveProviderToken(makeEvent({ cookie: 'session=a' }), request);

        expect(tokenA).toBe('token-1');
        expect(tokenB).toBe('token-1');
        expect(getProviderTokenMock).toHaveBeenCalledTimes(1);
    });

    it('does not reuse cache across different request scopes', async () => {
        const request = { providerId: 'convex', template: 'convex-sync' };

        await resolveProviderToken(makeEvent({ cookie: 'session=a' }), request);
        await resolveProviderToken(makeEvent({ cookie: 'session=b' }), request);

        expect(getProviderTokenMock).toHaveBeenCalledTimes(2);
    });

    it('stores only an opaque digest of bearer and cookie credentials in keys', async () => {
        const cookie = 'or3_session=top-secret-cookie';
        await resolveProviderToken(makeEvent({ cookie }), {
            providerId: 'convex',
            template: 'convex-sync',
        });

        const keys = _getProviderTokenCacheKeysForTest();
        expect(keys).toHaveLength(1);
        expect(keys[0]).toContain('credential-sha256=');
        expect(keys[0]).toContain('authorization-revision=4');
        expect(keys[0]).not.toContain(cookie);
        expect(keys[0]).not.toContain('top-secret-cookie');
    });

    it('does not reuse a token after the authorization revision changes', async () => {
        const event = makeEvent({ authorization: 'Bearer top-secret-token' });
        const request = { providerId: 'convex', template: 'convex-sync' };

        await resolveProviderToken(event, request);
        resolveSessionContextMock.mockResolvedValue({
            ...(await resolveSessionContextMock.mock.results[0]!.value),
            authorizationRevision: 5,
        });
        await resolveProviderToken(event, request);

        expect(getProviderTokenMock).toHaveBeenCalledTimes(2);
        expect(_getProviderTokenCacheKeysForTest().join('\n')).not.toContain(
            'top-secret-token'
        );
    });

    it('does not cache provider tokens for unauthenticated requests', async () => {
        resolveSessionContextMock.mockResolvedValue({ authenticated: false });

        await resolveProviderToken(makeEvent({ cookie: 'session=guest' }), {
            providerId: 'convex',
        });
        await resolveProviderToken(makeEvent({ cookie: 'session=guest' }), {
            providerId: 'convex',
        });

        expect(getProviderTokenMock).toHaveBeenCalledTimes(2);
        expect(_getProviderTokenCacheKeysForTest()).toEqual([]);
    });

    it('expires cached tokens after ttl', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
        testRuntimeConfig.value = {
            ...testRuntimeConfig.value,
            auth: {
                ...testRuntimeConfig.value.auth,
                tokenCacheTtlMs: 100,
            },
        };
        const request = { providerId: 'convex', template: 'convex-sync' };

        await resolveProviderToken(makeEvent({ cookie: 'session=a' }), request);
        vi.setSystemTime(new Date('2026-01-01T00:00:00.200Z'));
        await resolveProviderToken(makeEvent({ cookie: 'session=a' }), request);

        expect(getProviderTokenMock).toHaveBeenCalledTimes(2);
        vi.useRealTimers();
    });
});
