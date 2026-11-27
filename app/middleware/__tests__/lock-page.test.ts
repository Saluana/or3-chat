import { beforeEach, describe, expect, it, vi } from 'vitest';

type TestRoute = {
    path: string;
    fullPath: string;
    meta: Record<string, unknown>;
};

const navigateToMock = vi.fn((target: unknown, _options?: unknown) => target);
const abortNavigationMock = vi.fn(() => false);
const resolveLockPageAccessMock = vi.fn();
const useLockPageRuntimeConfigMock = vi.fn();
const isAdminRouteMock = vi.fn();
const sanitizeLockPageRedirectTargetMock = vi.fn(
    (value: unknown, _fallback?: string) => value
);

vi.mock('#app', () => ({
    abortNavigation: abortNavigationMock,
    defineNuxtRouteMiddleware: (handler: unknown) => handler,
    navigateTo: (target: unknown, options?: unknown) =>
        navigateToMock(target, options),
}));

vi.mock('~/core/lock-page/access', () => ({
    resolveLockPageAccess: () => resolveLockPageAccessMock(),
}));

vi.mock('~/core/lock-page/runtime', () => ({
    useLockPageRuntimeConfig: () => useLockPageRuntimeConfigMock(),
    isAdminRoute: (...args: unknown[]) => isAdminRouteMock(...args),
    sanitizeLockPageRedirectTarget: (value: unknown, fallback: string) =>
        sanitizeLockPageRedirectTargetMock(value, fallback),
}));

describe('lock-page middleware', () => {
    beforeEach(() => {
        vi.resetModules();
        navigateToMock.mockClear();
        abortNavigationMock.mockClear();
        resolveLockPageAccessMock.mockReset();
        useLockPageRuntimeConfigMock.mockReset();
        isAdminRouteMock.mockReset();
        sanitizeLockPageRedirectTargetMock.mockReset();
        sanitizeLockPageRedirectTargetMock.mockImplementation((value: unknown) => value);
        useLockPageRuntimeConfigMock.mockReturnValue({
            ssrAuthEnabled: true,
            enabled: true,
            route: '/welcome',
            adminBasePath: '/admin',
        });
        isAdminRouteMock.mockReturnValue(false);
    });

    it('does nothing when the feature is disabled', async () => {
        useLockPageRuntimeConfigMock.mockReturnValue({
            ssrAuthEnabled: true,
            enabled: false,
            route: '/welcome',
            adminBasePath: '/admin',
        });

        const middleware = (await import('../lock-page.global')).default as (
            to: TestRoute
        ) => Promise<unknown>;

        await expect(
            middleware({ path: '/', fullPath: '/', meta: { lockPageProtected: true } })
        ).resolves.toBeUndefined();
        expect(resolveLockPageAccessMock).not.toHaveBeenCalled();
    });

    it('bypasses admin routes', async () => {
        isAdminRouteMock.mockReturnValue(true);
        const middleware = (await import('../lock-page.global')).default as (
            to: TestRoute
        ) => Promise<unknown>;

        await expect(
            middleware({ path: '/admin', fullPath: '/admin', meta: {} })
        ).resolves.toBeUndefined();
        expect(resolveLockPageAccessMock).not.toHaveBeenCalled();
    });

    it('bypasses the lock page route itself', async () => {
        const middleware = (await import('../lock-page.global')).default as (
            to: TestRoute
        ) => Promise<unknown>;

        await expect(
            middleware({ path: '/welcome', fullPath: '/welcome', meta: {} })
        ).resolves.toBeUndefined();
        expect(resolveLockPageAccessMock).not.toHaveBeenCalled();
    });

    it('bypasses routes without explicit lock page meta', async () => {
        const middleware = (await import('../lock-page.global')).default as (
            to: TestRoute
        ) => Promise<unknown>;

        await expect(
            middleware({ path: '/images', fullPath: '/images', meta: {} })
        ).resolves.toBeUndefined();
        expect(resolveLockPageAccessMock).not.toHaveBeenCalled();
    });

    it('allows protected routes when access is granted', async () => {
        resolveLockPageAccessMock.mockResolvedValue({
            allowed: true,
            reason: 'authenticated',
            session: { authenticated: true },
        });
        const middleware = (await import('../lock-page.global')).default as (
            to: TestRoute
        ) => Promise<unknown>;

        await expect(
            middleware({ path: '/chat', fullPath: '/chat', meta: { lockPageProtected: true } })
        ).resolves.toBeUndefined();
        expect(navigateToMock).not.toHaveBeenCalled();
    });

    it('keeps an already opened app route without admitting another while a check is throttled', async () => {
        resolveLockPageAccessMock.mockResolvedValue({
            allowed: false,
            reason: 'session-rate-limited',
            session: { authenticated: true },
        });
        const middleware = (await import('../lock-page.global')).default as (
            to: TestRoute, from: TestRoute
        ) => Promise<unknown>;
        const current = { path: '/chat', fullPath: '/chat', meta: { lockPageProtected: true } };
        const destination = { path: '/billing', fullPath: '/billing', meta: { lockPageProtected: true } };
        await expect(middleware(destination, current)).resolves.toBe(false);
        expect(navigateToMock).not.toHaveBeenCalled();

        const initial = { path: '/', fullPath: '/', meta: {} };
        await expect(middleware(destination, initial)).resolves.toEqual({ path: '/welcome', query: { next: '/billing' } });
    });

    it('redirects denied visitors to the lock page with next query', async () => {
        resolveLockPageAccessMock.mockResolvedValue({
            allowed: false,
            reason: 'unauthenticated',
            session: null,
        });
        sanitizeLockPageRedirectTargetMock.mockReturnValue('/chat/123');
        const middleware = (await import('../lock-page.global')).default as (
            to: TestRoute
        ) => Promise<unknown>;

        await expect(
            middleware({ path: '/chat/123', fullPath: '/chat/123', meta: { lockPageProtected: true } })
        ).resolves.toEqual({
            path: '/welcome',
            query: {
                next: '/chat/123',
            },
        });
        expect(navigateToMock).toHaveBeenCalledWith(
            {
                path: '/welcome',
                query: {
                    next: '/chat/123',
                },
            },
            { replace: true }
        );
    });

    it('rechecks access when navigating within an already admitted route', async () => {
        resolveLockPageAccessMock.mockResolvedValue({ allowed: false });
        const middleware = (await import('../lock-page.global')).default as unknown as (
            to: TestRoute & { matched: unknown[] }, from: TestRoute & { matched: unknown[] }
        ) => Promise<unknown>;
        const record = { path: '/chat/:id?' };
        const from = { path: '/chat/1', fullPath: '/chat/1', meta: { lockPageProtected: true }, matched: [record] };
        const to = { ...from, path: '/chat/2', fullPath: '/chat/2' };
        await expect(middleware(to, from)).resolves.toEqual({ path: '/welcome', query: { next: '/chat/2' } });
        expect(resolveLockPageAccessMock).toHaveBeenCalledOnce();
    });
});
