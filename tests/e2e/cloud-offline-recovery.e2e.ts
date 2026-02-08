import { test, expect } from '@playwright/test';

test.describe('Cloud Offline Recovery', () => {
    test('offline edits converge after reconnect without notification storm', async ({ page }) => {
        await test.step('open offline recovery harness', async () => {
            await page.goto('/_tests/_test-cloud-offline-recovery');
            await page.waitForLoadState('networkidle');
        });

        await test.step('run scenario', async () => {
            await page.getByTestId('run-offline-scenario').click();

            await expect(page.getByTestId('phase')).toContainText('complete');
            await expect(page.getByTestId('scenario-pass')).toHaveText('pass');
            await expect(page.getByTestId('invariant-queue-empty')).toContainText('true');
            await expect(page.getByTestId('invariant-counts-match')).toContainText('true');
            await expect(page.getByTestId('invariant-notify-stable')).toContainText('true');
        });
    });

    test('manual offline->online sequence preserves queue and flush invariants', async ({ page }) => {
        await page.goto('/_tests/_test-cloud-offline-recovery');
        await page.waitForLoadState('networkidle');

        await page.getByTestId('offline-reset').click();
        await page.getByTestId('go-offline').click();
        await page.getByTestId('create-local-edit').click();
        await page.getByTestId('create-local-edit').click();

        await expect(page.getByTestId('phase')).toContainText('offline');
        await expect(page.getByTestId('local-ops-created')).toHaveText('2');
        await expect(page.getByTestId('queued-ops')).toHaveText('2');

        await page.getByTestId('go-online-and-flush').click();

        await expect(page.getByTestId('phase')).toContainText('complete');
        await expect(page.getByTestId('queued-ops')).toHaveText('0');
        await expect(page.getByTestId('flushed-ops')).toHaveText('2');
        await expect(page.getByTestId('notification-count')).toHaveText('1');
        await expect(page.getByTestId('scenario-pass')).toHaveText('pass');
    });
});
