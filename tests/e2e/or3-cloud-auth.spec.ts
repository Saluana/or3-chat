import { test, expect } from '@playwright/test';
import { rm } from 'fs/promises';
import { join } from 'path';
import { writeAdminCredentials } from '../../server/admin/auth/credentials';
import { hashPassword } from '../../server/admin/auth/hash';

const adminCredentials = {
    username: 'admin',
    password: 'password',
};

test.describe('OR3 Cloud Auth Integration', () => {
    test('Base app exposes auth session endpoint and login UI', async ({ page }) => {
        const response = await page.request.get('/api/auth/session');
        expect(response.ok()).toBeTruthy();

        const payload = await response.json();
        expect(payload).toEqual({ session: null });

        const cacheControl = response.headers()['cache-control'];
        expect(cacheControl).toContain('no-store');

        await page.goto('/');
        await page.waitForLoadState('networkidle');

        await expect(page.getByRole('button', { name: 'Sign In' })).toBeVisible();
    });

    test('Admin routes redirect unauthenticated users to login', async ({ page }) => {
        await page.goto('/admin');
        await page.waitForLoadState('networkidle');

        expect(page.url()).toContain('/admin/login');
        await expect(page.getByRole('heading', { name: /admin login/i })).toBeVisible();
    });

    test('Admin login establishes a session', async ({ page }) => {
        const sessionProbe = await page.request.get('/api/admin/auth/session');
        if (sessionProbe.status() === 404) {
            test.skip(true, 'Admin is disabled in this environment');
        }

        // Ensure credentials bootstrap from env for deterministic tests
        await rm(join(process.cwd(), '.data', 'admin-credentials.json'), { force: true });
        await writeAdminCredentials({
            username: adminCredentials.username,
            password_hash_bcrypt: await hashPassword(adminCredentials.password),
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
        });

        const loginResponse = await page.request.post('/api/admin/auth/login', {
            data: {
                username: adminCredentials.username,
                password: adminCredentials.password,
            },
            headers: {
                origin: 'http://localhost:3000',
                'x-or3-admin-intent': 'admin',
            },
        });

        if (!loginResponse.ok()) {
            const text = await loginResponse.text();
            throw new Error(`Admin login failed: ${loginResponse.status()} ${text}`);
        }

        const setCookie = loginResponse.headers()['set-cookie'];
        expect(setCookie).toBeTruthy();

        const cookieValue = setCookie.split(';')[0];
        const [cookieName, cookieVal] = cookieValue.split('=');

        await page.context().addCookies([
            {
                name: cookieName.trim(),
                value: (cookieVal ?? '').trim(),
                domain: 'localhost',
                path: '/',
            },
        ]);

        await page.goto('/admin/workspaces');

        const sessionResponse = await page.request.get('/api/admin/auth/session');
        expect(sessionResponse.ok()).toBeTruthy();

        const sessionPayload = await sessionResponse.json();
        expect(sessionPayload.authenticated).toBe(true);
        expect(['super_admin', 'workspace_admin']).toContain(sessionPayload.kind);
    });
});
