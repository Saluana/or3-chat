import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionContext } from '../../app/core/hooks/hook-types';

const useSessionContextMock = vi.fn();
const useLockPageRuntimeConfigMock = vi.fn();
const useStateMock = vi.fn();

vi.mock('#imports', () => ({
    useState: (key: string, init?: () => number) => useStateMock(key, init),
}));

vi.mock('~/composables/auth/useSessionContext', () => ({
    useSessionContext: () => useSessionContextMock(),
}));

vi.mock('~/core/lock-page/runtime', async () => {
    const actual = await vi.importActual<typeof import('~/core/lock-page/runtime')>(
        '~/core/lock-page/runtime'
    );

    return {
        ...actual,
        useLockPageRuntimeConfig: () => useLockPageRuntimeConfigMock(),
    };
});

function createSession(overrides: Partial<SessionContext> = {}): SessionContext {
    return {
        authenticated: true,
        provider: 'basic-auth',
        providerUserId: 'provider-user-1',
        user: {
            id: 'user-1',
            email: 'user@example.com',
        },
        workspace: {
            id: 'workspace-1',
            name: 'Workspace',
        },
        role: 'owner',
        ...overrides,
    };
}

describe('resolveLockPageAccess', () => {
    beforeEach(() => {
        const state = { value: 0 };
        useLockPageRuntimeConfigMock.mockReset().mockReturnValue({
            ssrAuthEnabled: true,
            enabled: true,
            adapter: 'default',
            route: '/welcome',
            adminBasePath: '/admin',
            guestAccessEnabled: false,
            authProvider: 'basic-auth',
        });
        useSessionContextMock.mockReset();
        useStateMock.mockReset().mockImplementation((_key: string, init?: () => number) => {
            if (state.value === 0 && typeof init === 'function') {
                state.value = init();
            }
            return state;
        });
        vi.resetModules();
    });

    it('revalidates stale authenticated cache and returns a session error when refresh fails', async () => {
        const refresh = vi.fn().mockRejectedValue(new Error('stale 429'));
        useSessionContextMock.mockReturnValue({
            data: {
                value: {
                    session: createSession(),
                    appAccessAllowed: true,
                },
            },
            pending: { value: false },
            error: { value: null },
            refresh,
        });

        const { resolveLockPageAccess } = await import(
            '../../app/core/lock-page/access'
        );

        await expect(resolveLockPageAccess()).resolves.toMatchObject({
            allowed: false,
            reason: 'session-error',
            errorMessage: 'stale 429',
        });
        expect(refresh).toHaveBeenCalledTimes(1);
    });

    it('uses fresh validated cache without re-fetching when within ttl', async () => {
        useStateMock.mockReset().mockImplementation((_key: string) => ({
            value: Date.now(),
        }));
        const refresh = vi.fn();
        useSessionContextMock.mockReturnValue({
            data: {
                value: {
                    session: createSession(),
                    appAccessAllowed: true,
                },
            },
            pending: { value: false },
            error: { value: null },
            refresh,
        });

        const { resolveLockPageAccess } = await import(
            '../../app/core/lock-page/access'
        );

        await expect(resolveLockPageAccess()).resolves.toMatchObject({
            allowed: true,
            reason: 'authenticated',
        });
        expect(refresh).not.toHaveBeenCalled();
    });

    it('denies authenticated sessions when app access is denied after refresh', async () => {
        const refresh = vi.fn().mockResolvedValue(undefined);
        useSessionContextMock.mockReturnValue({
            data: {
                value: {
                    session: createSession(),
                    appAccessAllowed: false,
                },
            },
            pending: { value: false },
            error: { value: null },
            refresh,
        });

        const { resolveLockPageAccess } = await import(
            '../../app/core/lock-page/access'
        );

        await expect(resolveLockPageAccess()).resolves.toMatchObject({
            allowed: false,
            reason: 'forbidden',
        });
    });
});
