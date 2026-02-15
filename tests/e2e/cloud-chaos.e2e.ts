import { test, expect } from '@playwright/test';

test.describe('Cloud Chaos', () => {
    test('intermittent adapter failures recover without corruption', async ({ page }) => {
        await page.goto('/_tests/_test-cloud-chaos');
        await page.waitForLoadState('networkidle');

        await page.getByTestId('chaos-reset').click();
        await page.getByTestId('chaos-run-batch').click();

        await expect(page.getByTestId('processed-count')).not.toHaveText('0');
        await expect(page.getByTestId('integrity-pass')).toHaveText('true');
        await expect(page.getByTestId('chaos-log')).toContainText(/Processed|Batch halted|Batch completed/);
    });

    test('circuit opens under sustained failure and reset returns to healthy baseline', async ({ page }) => {
        await page.goto('/_tests/_test-cloud-chaos');
        await page.waitForLoadState('networkidle');

        await page.getByTestId('failure-rate').fill('100');
        await page.getByTestId('chaos-run-batch').click();

        await expect(page.getByTestId('circuit-state')).toHaveText('open');
        await expect(page.getByTestId('processed-count')).toHaveText('0');
        await expect(page.getByTestId('failed-count')).not.toHaveText('0');

        await page.getByTestId('chaos-reset').click();

        await expect(page.getByTestId('circuit-state')).toHaveText('closed');
        await expect(page.getByTestId('processed-count')).toHaveText('0');
        await expect(page.getByTestId('failed-count')).toHaveText('0');
        await expect(page.getByTestId('queue-remaining')).toHaveText('12');
    });
});
