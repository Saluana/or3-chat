import { beforeEach, describe, expect, it, vi } from 'vitest';

const navigateToMock = vi.fn((path: string) => path);

vi.mock('#app', () => ({
    defineNuxtRouteMiddleware: (handler: unknown) => handler,
    navigateTo: (path: string) => navigateToMock(path),
}));

type AdminSessionKind = 'super_admin' | 'workspace_admin';

type AdminSessionResponse = {
    authenticated: boolean;
    kind: AdminSessionKind;
};

const requestFetchMock = vi.fn();

function setRequestFetch(
    implementation: () => Promise<AdminSessionResponse>
): void {
    requestFetchMock.mockImplementation(implementation);
    vi.stubGlobal('useRequestFetch', () => requestFetchMock);
}

describe('admin-auth middleware', () => {
    beforeEach(() => {
        vi.resetModules();
        navigateToMock.mockClear();
        requestFetchMock.mockReset();
    });

    it('skips checks for the admin login page', async () => {
        const middleware = (await import('../admin-auth')).default as (
            to: { path: string }
        ) => Promise<unknown>;

        await expect(middleware({ path: '/admin/login' })).resolves.toBeUndefined();
        expect(requestFetchMock).not.toHaveBeenCalled();
    });

    it('allows super admins through', async () => {
        setRequestFetch(async () => ({ authenticated: true, kind: 'super_admin' }));
        const middleware = (await import('../admin-auth')).default as (
            to: { path: string }
        ) => Promise<unknown>;

        await expect(middleware({ path: '/admin/system' })).resolves.toBeUndefined();
        expect(navigateToMock).not.toHaveBeenCalled();
    });

    it('redirects workspace admins from /admin to workspace-scoped landing', async () => {
        setRequestFetch(async () => ({ authenticated: true, kind: 'workspace_admin' }));
        const middleware = (await import('../admin-auth')).default as (
            to: { path: string }
        ) => Promise<unknown>;

        await expect(middleware({ path: '/admin' })).resolves.toBe('/admin/plugins');
        expect(navigateToMock).toHaveBeenCalledWith('/admin/plugins');
    });

    it('allows workspace admins on workspace-scoped admin routes', async () => {
        setRequestFetch(async () => ({ authenticated: true, kind: 'workspace_admin' }));
        const middleware = (await import('../admin-auth')).default as (
            to: { path: string }
        ) => Promise<unknown>;

        await expect(middleware({ path: '/admin/plugins' })).resolves.toBeUndefined();
        expect(navigateToMock).not.toHaveBeenCalled();
    });

    it('redirects workspace admins away from deployment-scoped admin routes', async () => {
        setRequestFetch(async () => ({ authenticated: true, kind: 'workspace_admin' }));
        const middleware = (await import('../admin-auth')).default as (
            to: { path: string }
        ) => Promise<unknown>;

        await expect(middleware({ path: '/admin/system' })).resolves.toBe('/admin/plugins');
        expect(navigateToMock).toHaveBeenCalledWith('/admin/plugins');
    });

    it('redirects unauthenticated users to admin login', async () => {
        setRequestFetch(async () => {
            throw { status: 401 };
        });
        const middleware = (await import('../admin-auth')).default as (
            to: { path: string }
        ) => Promise<unknown>;

        await expect(middleware({ path: '/admin/plugins' })).resolves.toBe('/admin/login');
        expect(navigateToMock).toHaveBeenCalledWith('/admin/login');
    });
});
