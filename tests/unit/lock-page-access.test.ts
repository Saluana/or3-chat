import { describe, expect, it } from 'vitest';
import type { SessionContext } from '../../app/core/hooks/hook-types';
import { evaluateLockPageAccess } from '../../app/core/lock-page/access';
import type { LockPageRuntimeConfig } from '../../app/core/lock-page/runtime';

const baseConfig: LockPageRuntimeConfig = {
    ssrAuthEnabled: true,
    enabled: true,
    adapter: 'default',
    route: '/welcome',
    adminBasePath: '/admin',
    guestAccessEnabled: false,
    authProvider: 'basic-auth',
};

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

describe('evaluateLockPageAccess', () => {
    it('allows access when SSR auth is disabled', () => {
        const result = evaluateLockPageAccess({
            config: {
                ...baseConfig,
                ssrAuthEnabled: false,
            },
            session: null,
        });

        expect(result.allowed).toBe(true);
        expect(result.reason).toBe('ssr-auth-disabled');
    });

    it('allows access when the lock page is disabled', () => {
        const result = evaluateLockPageAccess({
            config: {
                ...baseConfig,
                enabled: false,
            },
            session: null,
        });

        expect(result.allowed).toBe(true);
        expect(result.reason).toBe('disabled');
    });

    it('allows authenticated sessions', () => {
        const result = evaluateLockPageAccess({
            config: baseConfig,
            session: createSession(),
            appAccessAllowed: true,
        });

        expect(result.allowed).toBe(true);
        expect(result.reason).toBe('authenticated');
    });

    it('denies authenticated sessions that fail workspace.read access', () => {
        const result = evaluateLockPageAccess({
            config: baseConfig,
            session: createSession(),
            appAccessAllowed: false,
        });

        expect(result.allowed).toBe(false);
        expect(result.reason).toBe('forbidden');
    });

    it('allows guests when guest access is enabled', () => {
        const result = evaluateLockPageAccess({
            config: {
                ...baseConfig,
                guestAccessEnabled: true,
            },
            session: null,
        });

        expect(result.allowed).toBe(true);
        expect(result.reason).toBe('guest-allowed');
    });

    it('denies unauthenticated access when guest access is disabled', () => {
        const result = evaluateLockPageAccess({
            config: baseConfig,
            session: null,
        });

        expect(result.allowed).toBe(false);
        expect(result.reason).toBe('unauthenticated');
    });

    it('fails closed when session resolution errors', () => {
        const result = evaluateLockPageAccess({
            config: {
                ...baseConfig,
                guestAccessEnabled: true,
            },
            session: null,
            hadSessionError: true,
        });

        expect(result.allowed).toBe(false);
        expect(result.reason).toBe('session-error');
    });
});
