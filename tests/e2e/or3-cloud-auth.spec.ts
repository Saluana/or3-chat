import { test, expect } from '@playwright/test';

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
        await page.goto('/admin/login');

        await page.getByPlaceholder('Enter username').fill(adminCredentials.username);
        await page.getByPlaceholder('Enter password').fill(adminCredentials.password);
        await page.getByRole('button', { name: /sign in/i }).click();

        await page.waitForURL('**/admin/workspaces');

        const sessionResponse = await page.request.get('/api/admin/auth/session');
        expect(sessionResponse.ok()).toBeTruthy();

        const sessionPayload = await sessionResponse.json();
        expect(sessionPayload).toEqual({ authenticated: true, kind: 'super_admin' });
    });
});
