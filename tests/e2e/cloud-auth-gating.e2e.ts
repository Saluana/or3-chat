import { test, expect } from '@playwright/test';

test.describe('Cloud Auth Gating', () => {
    test('all cloud probes enforce the active deployment auth policy', async ({ page }) => {
        await page.goto('/_tests/_test-cloud-auth-gating');
        await page.waitForLoadState('networkidle');

        await page.getByTestId('run-auth-probes').click();

        await expect(page.getByTestId('probe-table')).toBeVisible();
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

        await expect(page.getByTestId('auth-overall-pass')).toHaveText('pass');
    });
});
