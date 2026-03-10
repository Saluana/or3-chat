import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionContext } from '../../app/core/hooks/hook-types';

const useSessionContextMock = vi.fn();
const useLockPageRuntimeConfigMock = vi.fn();

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
        vi.resetModules();
    });

    it('keeps authenticated cached sessions allowed when a stale refresh error exists', async () => {
        useSessionContextMock.mockReturnValue({
            data: {
                value: {
                    session: createSession(),
                    appAccessAllowed: true,
                },
            },
            pending: { value: false },
            error: { value: new Error('stale 429') },
            refresh: vi.fn(),
        });

        const { resolveLockPageAccess } = await import(
            '../../app/core/lock-page/access'
        );

        await expect(resolveLockPageAccess()).resolves.toMatchObject({
            allowed: true,
            reason: 'authenticated',
        });
    });

    it('denies authenticated cached sessions when app access is denied', async () => {
        useSessionContextMock.mockReturnValue({
            data: {
                value: {
                    session: createSession(),
                    appAccessAllowed: false,
                },
            },
            pending: { value: false },
            error: { value: null },
            refresh: vi.fn(),
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
