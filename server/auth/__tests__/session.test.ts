import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { H3Event } from 'h3';
import { registerAuthProvider } from '../registry';
import {
    resolveSessionContext,
    _resetSharedSessionCache,
    invalidateSharedSessionCacheForIdentity,
} from '../session';
import { testRuntimeConfig } from '../../../tests/setup';

const adminCheckerMock = vi.hoisted(() => ({
    checkDeploymentAdmin: vi.fn().mockResolvedValue(false),
}));

const providerGetSessionMock = vi.hoisted(() => vi.fn(async () => ({
    provider: 'test-provider',
    user: { id: 'user-1', email: 'user@test.com', displayName: 'User' },
    expiresAt: new Date(Date.now() + 60_000),
    claims: { exp: Math.floor(Date.now() / 1000) + 60 },
})));

const altProviderGetSessionMock = vi.hoisted(() => vi.fn(async () => ({
    provider: 'alt-provider',
    user: { id: 'user-alt', email: 'alt@test.com', displayName: 'Alt' },
    expiresAt: new Date(Date.now() + 60_000),
    claims: { exp: Math.floor(Date.now() / 1000) + 60 },
})));

const authWorkspaceStoreMock = vi.hoisted(() => ({
    getOrCreateUser: vi.fn().mockResolvedValue({ userId: 'user-1' }),
    getOrCreateDefaultWorkspace: vi.fn().mockResolvedValue({ workspaceId: 'ws-1', workspaceName: 'Default' }),
    getWorkspaceRole: vi.fn().mockResolvedValue('owner'),
}));

const getAuthWorkspaceStoreMock = vi.hoisted(() => vi.fn(() => authWorkspaceStoreMock));

vi.mock('../deployment-admin', () => ({
    getDeploymentAdminChecker: () => adminCheckerMock,
}));

vi.mock('../store/registry', () => ({
    getAuthWorkspaceStore: getAuthWorkspaceStoreMock as any,
}));

const PROVIDER_ID = 'test-provider';
const ALT_PROVIDER_ID = 'alt-provider';

registerAuthProvider({
    id: PROVIDER_ID,
    create: () => ({
        name: PROVIDER_ID,
        getSession: providerGetSessionMock as any,
    }),
});

registerAuthProvider({
    id: ALT_PROVIDER_ID,
    create: () => ({
        name: ALT_PROVIDER_ID,
        getSession: altProviderGetSessionMock as any,
    }),
});

function makeEvent(): H3Event {
    return {
        context: {},
        node: { req: { socket: { remoteAddress: '127.0.0.1' } } },
    } as H3Event;
}

describe('resolveSessionContext provisioning and caching', () => {
    beforeEach(() => {
        _resetSharedSessionCache();

        providerGetSessionMock.mockReset().mockResolvedValue({
            provider: PROVIDER_ID,
            user: { id: 'user-1', email: 'user@test.com', displayName: 'User' },
            expiresAt: new Date(Date.now() + 60_000),
            claims: { exp: Math.floor(Date.now() / 1000) + 60 },
        });

        altProviderGetSessionMock.mockReset().mockResolvedValue({
            provider: ALT_PROVIDER_ID,
            user: { id: 'user-alt', email: 'alt@test.com', displayName: 'Alt' },
            expiresAt: new Date(Date.now() + 60_000),
            claims: { exp: Math.floor(Date.now() / 1000) + 60 },
        });

        authWorkspaceStoreMock.getOrCreateUser.mockReset().mockResolvedValue({ userId: 'user-1' });
        authWorkspaceStoreMock.getOrCreateDefaultWorkspace.mockReset().mockResolvedValue({
            workspaceId: 'ws-1',
            workspaceName: 'Default',
        });
        authWorkspaceStoreMock.getWorkspaceRole.mockReset().mockResolvedValue('owner');
        getAuthWorkspaceStoreMock.mockReset().mockReturnValue(authWorkspaceStoreMock);

        adminCheckerMock.checkDeploymentAdmin.mockReset().mockResolvedValue(false);

        testRuntimeConfig.value = {
            ...testRuntimeConfig.value,
            auth: {
                ...testRuntimeConfig.value.auth,
                enabled: true,
                provider: PROVIDER_ID,
                sessionProvisioningFailure: 'throw',
            },
            public: {
                ...testRuntimeConfig.value.public,
                sync: { provider: 'convex' },
            },
        };
    });

    it('returns unauthenticated when sessionProvisioningFailure=unauthenticated', async () => {
        testRuntimeConfig.value = {
            ...testRuntimeConfig.value,
            auth: {
                ...testRuntimeConfig.value.auth,
                sessionProvisioningFailure: 'unauthenticated',
            },
        };

        authWorkspaceStoreMock.getOrCreateDefaultWorkspace.mockRejectedValueOnce(new Error('boom'));

        const session = await resolveSessionContext(makeEvent());
        expect(session.authenticated).toBe(false);
    });

    it('throws 503 when sessionProvisioningFailure=service-unavailable', async () => {
        testRuntimeConfig.value = {
            ...testRuntimeConfig.value,
            auth: {
                ...testRuntimeConfig.value.auth,
                sessionProvisioningFailure: 'service-unavailable',
            },
        };

        authWorkspaceStoreMock.getOrCreateDefaultWorkspace.mockRejectedValueOnce(new Error('boom'));

        await expect(resolveSessionContext(makeEvent())).rejects.toMatchObject({ statusCode: 503 });
    });

    it('throws original error when sessionProvisioningFailure=throw', async () => {
        authWorkspaceStoreMock.getOrCreateDefaultWorkspace.mockRejectedValueOnce(new Error('boom'));

        await expect(resolveSessionContext(makeEvent())).rejects.toThrow('boom');
    });

    it('returns unauthenticated when provider is not registered', async () => {
        testRuntimeConfig.value = {
            ...testRuntimeConfig.value,
            auth: {
                ...testRuntimeConfig.value.auth,
                provider: 'missing-provider',
            },
        };

        const event = makeEvent();
        const first = await resolveSessionContext(event);
        const second = await resolveSessionContext(event);

        expect(first).toEqual({ authenticated: false });
        expect(second).toEqual({ authenticated: false });
    });

    it('isolates request cache by provider and request id', async () => {
        const event = makeEvent();

        await resolveSessionContext(event);
        await resolveSessionContext(event);
        expect(providerGetSessionMock).toHaveBeenCalledTimes(1);

        testRuntimeConfig.value = {
            ...testRuntimeConfig.value,
            auth: {
                ...testRuntimeConfig.value.auth,
                provider: ALT_PROVIDER_ID,
            },
        };

        const altSession = await resolveSessionContext(event);
        expect(altSession.provider).toBe(ALT_PROVIDER_ID);
        expect(altProviderGetSessionMock).toHaveBeenCalledTimes(1);

        await resolveSessionContext(makeEvent());
        expect(altProviderGetSessionMock).toHaveBeenCalledTimes(2);
    });

    it('reuses workspace provisioning from shared cache across requests', async () => {
        testRuntimeConfig.value = {
            ...testRuntimeConfig.value,
            auth: {
                ...testRuntimeConfig.value.auth,
                sessionCacheTtlMs: 10_000,
            },
        };

        await resolveSessionContext(makeEvent());
        await resolveSessionContext(makeEvent());

        expect(authWorkspaceStoreMock.getOrCreateUser).toHaveBeenCalledTimes(1);
        expect(authWorkspaceStoreMock.getOrCreateDefaultWorkspace).toHaveBeenCalledTimes(1);
        expect(authWorkspaceStoreMock.getWorkspaceRole).toHaveBeenCalledTimes(1);
    });

    it('uses internal user id in session and preserves provider user id', async () => {
        authWorkspaceStoreMock.getOrCreateUser.mockResolvedValueOnce({
            userId: 'internal-user-42',
        });

        const session = await resolveSessionContext(makeEvent());

        expect(session.authenticated).toBe(true);
        expect(session.user?.id).toBe('internal-user-42');
        expect(session.providerUserId).toBe('user-1');
    });

    it('expires shared cache entries after ttl', async () => {
        vi.useFakeTimers();

        testRuntimeConfig.value = {
            ...testRuntimeConfig.value,
            auth: {
                ...testRuntimeConfig.value.auth,
                sessionCacheTtlMs: 100,
            },
        };

        await resolveSessionContext(makeEvent());
        vi.advanceTimersByTime(150);
        await resolveSessionContext(makeEvent());

        expect(authWorkspaceStoreMock.getOrCreateUser).toHaveBeenCalledTimes(2);
        vi.useRealTimers();
    });

    it('invalidates shared cache entries for a specific identity', async () => {
        testRuntimeConfig.value = {
            ...testRuntimeConfig.value,
            auth: {
                ...testRuntimeConfig.value.auth,
                sessionCacheTtlMs: 10_000,
            },
        };

        await resolveSessionContext(makeEvent());

        invalidateSharedSessionCacheForIdentity({
            provider: PROVIDER_ID,
            providerUserId: 'user-1',
        });

        await resolveSessionContext(makeEvent());

        expect(authWorkspaceStoreMock.getOrCreateUser).toHaveBeenCalledTimes(2);
        expect(authWorkspaceStoreMock.getOrCreateDefaultWorkspace).toHaveBeenCalledTimes(2);
        expect(authWorkspaceStoreMock.getWorkspaceRole).toHaveBeenCalledTimes(2);
    });

    it('throws when workspace store for provider is missing', async () => {
        testRuntimeConfig.value = {
            ...testRuntimeConfig.value,
            public: {
                ...testRuntimeConfig.value.public,
                sync: { provider: 'missing-store' },
            },
        };
        getAuthWorkspaceStoreMock.mockReturnValueOnce(null as any);

        await expect(resolveSessionContext(makeEvent())).rejects.toThrow('missing-store');
    });

    it('handles deployment admin checker failures via provisioning policy', async () => {
        adminCheckerMock.checkDeploymentAdmin.mockRejectedValueOnce(new Error('admin check failed'));

        await expect(resolveSessionContext(makeEvent())).rejects.toThrow('admin check failed');

        testRuntimeConfig.value = {
            ...testRuntimeConfig.value,
            auth: {
                ...testRuntimeConfig.value.auth,
                sessionProvisioningFailure: 'unauthenticated',
            },
        };
        adminCheckerMock.checkDeploymentAdmin.mockRejectedValueOnce(new Error('admin check failed'));

        const session = await resolveSessionContext(makeEvent());
        expect(session.authenticated).toBe(false);
    });
});
