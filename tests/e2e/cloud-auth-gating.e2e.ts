import { test, expect } from '@playwright/test';

test.describe('Cloud Auth Gating', () => {
    test('static mode hides cloud SSR endpoints and SSR mode enforces auth', async ({ page }) => {
        await page.goto('/_tests/_test-cloud-auth-gating');
        await page.waitForLoadState('networkidle');

        await page.getByTestId('run-auth-probes').click();

        await expect(page.getByTestId('probe-table')).toBeVisible();
        await expect(page.getByTestId('probe-status-auth-session')).not.toHaveText('pending');
        await expect(page.getByTestId('probe-status-sync-pull')).not.toHaveText('pending');
        await expect(page.getByTestId('probe-status-sync-push')).not.toHaveText('pending');
        await expect(page.getByTestId('probe-status-storage-presign-upload')).not.toHaveText('pending');

        await expect(page.getByTestId('auth-overall-pass')).toHaveText('pass');
    });

    test('each probe row reports pass with a resolved HTTP status', async ({ page }) => {
        await page.goto('/_tests/_test-cloud-auth-gating');
        await page.waitForLoadState('networkidle');

        await page.getByTestId('run-auth-probes').click();

        const probeIds = [
            'auth-session',
            'sync-pull',
            'sync-push',
            'storage-presign-upload',
        ];

        for (const id of probeIds) {
            await expect(page.getByTestId(`probe-status-${id}`)).not.toHaveText('pending');
            await expect(page.getByTestId(`probe-pass-${id}`)).toHaveText('pass');
        }
    });
});
