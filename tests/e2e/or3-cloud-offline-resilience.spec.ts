import { test, expect } from '@playwright/test';

test.describe('OR3 Cloud Offline Resilience (E2E)', () => {
    test('queues local ops while offline and updates UI state', async ({
        page,
    }) => {
        await page.goto('/_tests/_test-offline-resilience');
        await page.waitForLoadState('networkidle');

        const pendingOpsValue = page
            .getByTestId('pending-ops')
            .locator('.stat-value');

        const initialPending = Number(await pendingOpsValue.innerText());

        await page.getByTestId('go-offline').click();
        await expect(page.locator('.status-text')).toHaveText('SIMULATED OFFLINE');

        await page.getByTestId('create-thread').click();

        await expect
            .poll(async () => Number(await pendingOpsValue.innerText()))
            .toBeGreaterThan(initialPending);

        await page.getByTestId('create-message').click();
        await page.getByTestId('change-setting').click();

        const log = page.getByTestId('test-log');
        await expect(log).toContainText('Simulated OFFLINE');
        await expect(log).toContainText('Created thread: offline-thread-');
        await expect(log).toContainText('Created message: offline-msg-');
        await expect(log).toContainText('Changed setting: kv:test_offline_setting');

        await page.getByTestId('go-online').click();
        await expect(page.getByText('Phase: complete')).toBeVisible();
        await expect(log).toContainText('Simulated ONLINE');
    });
});

