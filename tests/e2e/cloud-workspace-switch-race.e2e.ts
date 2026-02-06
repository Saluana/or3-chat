import { test, expect } from '@playwright/test';

test.describe('Cloud Workspace Switch Race', () => {
    test('standard workspace switching race keeps data isolated and stable', async ({ page }) => {
        await page.goto('/_tests/_test-cloud-workspace-switch-race');
        await page.waitForLoadState('networkidle');

        await page.getByTestId('run-switch-race').click();

        await expect(page.getByTestId('phase')).toHaveText('complete', { timeout: 20000 });
        await expect(page.getByTestId('scenario-pass')).toHaveText('pass');
        await expect(page.getByTestId('ws-a-threads')).toHaveText('2');
        await expect(page.getByTestId('ws-b-threads')).toHaveText('3');
        await expect(page.getByTestId('invariant-stable-read')).toHaveText('true');
        await expect(page.getByTestId('unhandled-errors')).toHaveText('0');
        await expect(page.getByTestId('db-closed-console-errors')).toHaveText('0');
    });

    test('stress switching does not crash subscriptions or queue processing', async ({ page }) => {
        await page.goto('/_tests/_test-cloud-workspace-switch-race');
        await page.waitForLoadState('networkidle');

        await page.getByTestId('run-switch-race-stress').click();

        await expect(page.getByTestId('phase')).toHaveText('complete', { timeout: 30000 });
        await expect(page.getByTestId('scenario-pass')).toHaveText('pass');
        await expect(page.getByTestId('switch-count')).toHaveText('64');
        await expect(page.getByTestId('transfer-completed')).toHaveText('true');
        await expect(page.getByTestId('unhandled-errors')).toHaveText('0');
    });
});
