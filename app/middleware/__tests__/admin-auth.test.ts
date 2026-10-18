import { beforeEach, describe, expect, it, vi } from 'vitest';

const navigateToMock = vi.fn((path: string) => path);
const cachedSession = { data: { value: undefined as AdminSessionResponse | undefined } };

vi.mock('#app', () => ({
    defineNuxtRouteMiddleware: (handler: unknown) => handler,
    navigateTo: (path: string) => navigateToMock(path),
    useNuxtData: () => cachedSession,
    createError: (error: unknown) => error,
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
        cachedSession.data.value = undefined;
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
        expect(cachedSession.data.value).toEqual({
            authenticated: true,
            kind: 'super_admin',
        });
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

    it.each([503, 502, undefined])('preserves auth identity and reports temporary unavailability for %s', async (status) => {
        cachedSession.data.value = { authenticated: true, kind: 'super_admin' };
        setRequestFetch(async () => { throw { status }; });
        const middleware = (await import('../admin-auth')).default as (
            to: { path: string }
        ) => Promise<unknown>;

        await expect(middleware({ path: '/admin/system' })).rejects.toMatchObject({ statusCode: 503 });
        expect(navigateToMock).not.toHaveBeenCalled();
        expect(cachedSession.data.value?.authenticated).toBe(true);
    });

    it('bounds auth lookup without automatically retrying during shutdown', async () => {
        setRequestFetch(async () => ({ authenticated: true, kind: 'super_admin' }));
        const middleware = (await import('../admin-auth')).default as (
            to: { path: string }
        ) => Promise<unknown>;
        await middleware({ path: '/admin/system' });
        expect(requestFetchMock).toHaveBeenCalledWith('/api/admin/auth/session', expect.objectContaining({
            retry: 0,
            timeout: 3000,
        }));
    });

    it.each([401, 403])('clears cached identity when authentication is rejected with %s', async (status) => {
        cachedSession.data.value = { authenticated: true, kind: 'super_admin' };
        setRequestFetch(async () => { throw { status }; });
        const middleware = (await import('../admin-auth')).default as (
            to: { path: string }
        ) => Promise<unknown>;
        await expect(middleware({ path: '/admin/system' })).resolves.toBe('/admin/login');
        expect(cachedSession.data.value).toBeUndefined();
    });
});
