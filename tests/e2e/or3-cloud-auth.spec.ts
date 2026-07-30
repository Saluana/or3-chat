import { test, expect } from '@playwright/test';
import { isAbsolute, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';

const adminCredentials = {
    username: process.env.OR3_ADMIN_E2E_USERNAME ?? '',
    password: process.env.OR3_ADMIN_E2E_PASSWORD ?? '',
};

function isTempDataDirectory(candidate: string): boolean {
    if (!isAbsolute(candidate)) return false;

    const resolved = resolve(candidate);
    const tempRoots = [
        resolve(tmpdir()),
        '/tmp',
        '/private/tmp',
        '/var/folders',
        '/private/var/folders',
    ];
    return tempRoots.some(
        (root) =>
            resolved.startsWith(`${root}${sep}or3-admin-auth-e2e-`)
    );
}

const configuredAdminDataDir = process.env.OR3_ADMIN_DATA_DIR ?? '';
const isolatedAdminHarnessReady =
    process.env.OR3_ADMIN_AUTH_E2E_HARNESS === 'true' &&
    isTempDataDirectory(configuredAdminDataDir) &&
    resolve(configuredAdminDataDir) !== resolve(process.cwd(), '.data') &&
    Boolean(adminCredentials.username && adminCredentials.password);

test.describe('OR3 Cloud Auth Integration', () => {
    test('Base app exposes auth session endpoint and login UI', async ({ page }) => {
        const response = await page.request.get('/api/auth/session');
        expect(response.ok()).toBeTruthy();

        const payload = await response.json();
        expect(payload).toEqual({
            session: null,
            appAccessAllowed: false,
        });

        const cacheControl = response.headers()['cache-control'];
        expect(cacheControl).toContain('no-store');

        await page.goto('/');
        await page.waitForLoadState('networkidle');

        await expect(
            page.getByRole('button', { name: /sign in|login/i })
        ).toBeVisible();
    });

    test('Admin routes redirect unauthenticated users to login', async ({ page }) => {
        await page.goto('/admin');
        await page.waitForLoadState('networkidle');

        expect(page.url()).toContain('/admin/login');
        await expect(page.getByRole('heading', { name: /admin login/i })).toBeVisible();
    });

    test('Admin login establishes a session', async ({ page }) => {
        test.skip(
            !isolatedAdminHarnessReady,
            'Requires OR3_ADMIN_AUTH_E2E_HARNESS=true, credentials, and an absolute temporary OR3_ADMIN_DATA_DIR'
        );

        const sessionProbe = await page.request.get('/api/admin/auth/session');
        if (sessionProbe.status() === 404) {
            test.skip(true, 'Admin is disabled in this environment');
        }

        await page.goto('/admin/login');
        const origin = new URL(page.url()).origin;

        const loginResponse = await page.request.post('/api/admin/auth/login', {
            data: {
                username: adminCredentials.username,
                password: adminCredentials.password,
            },
            headers: {
                origin,
                'x-or3-admin-intent': 'admin',
            },
        });

        if (!loginResponse.ok()) {
            const text = await loginResponse.text();
            throw new Error(`Admin login failed: ${loginResponse.status()} ${text}`);
        }

        expect(loginResponse.headers()['set-cookie']).toBeTruthy();

        await page.goto('/admin/workspaces');

        const sessionResponse = await page.request.get('/api/admin/auth/session');
        expect(sessionResponse.ok()).toBeTruthy();

        const sessionPayload = await sessionResponse.json();
        expect(sessionPayload.authenticated).toBe(true);
        expect(['super_admin', 'workspace_admin']).toContain(sessionPayload.kind);
    });
});
