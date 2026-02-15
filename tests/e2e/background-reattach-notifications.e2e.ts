import { test, expect } from '@playwright/test';

test.describe('Background Reattach + Notifications', () => {
    test('reattachment resumes updates and suppresses completion notification while attached', async ({ page }) => {
        await page.goto('/_tests/_test-background-reattach-notify');
        await page.waitForLoadState('networkidle');

        await page.getByTestId('bg-rn-run-reattach').click();

        await expect(page.getByTestId('bg-rn-result-label')).toContainText('reattach');
        await expect(page.getByTestId('bg-rn-reattach-observed')).toHaveText('true');
        await expect(page.getByTestId('bg-rn-notification-count')).toHaveText('0');
        await expect(page.getByTestId('bg-rn-content-preview')).toContainText('hello world');
        await expect(page.getByTestId('bg-rn-scenario-pass')).toHaveText('true');
    });

    test('detached completion emits a notification', async ({ page }) => {
        await page.goto('/_tests/_test-background-reattach-notify');
        await page.waitForLoadState('networkidle');

        await page.getByTestId('bg-rn-run-notify').click();

        await expect(page.getByTestId('bg-rn-result-label')).toContainText('notification');
        await expect(page.getByTestId('bg-rn-notification-count')).toHaveText('1');
        await expect(page.getByTestId('bg-rn-reattach-observed')).toHaveText('false');
        await expect(page.getByTestId('bg-rn-scenario-pass')).toHaveText('true');
    });
});
