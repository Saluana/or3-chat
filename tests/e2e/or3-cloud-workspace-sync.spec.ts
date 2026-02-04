import { test, expect } from '@playwright/test';

test.describe('OR3 Cloud Workspace Sync (E2E)', () => {
    test('runs the workspace isolation suite', async ({ page }) => {
        await page.goto('/_tests/_test-workspace-sync');
        await page.waitForLoadState('networkidle');

        const runButton = page.getByTestId('run-all-tests');
        await runButton.click();

        // Wait for suite completion (button re-enabled)
        await expect(runButton).toBeEnabled();

        await expect(page.locator('.result-item.failed')).toHaveCount(0);
        await expect(page.locator('.results-summary')).toHaveText(
            /5\s*\/\s*5 tests passed/
        );
    });
});

