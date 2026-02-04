import { test, expect } from '@playwright/test';

test.describe('OR3 Cloud Full Stack Harness (E2E)', () => {
    test('runs the full-stack local harness test', async ({ page }) => {
        await page.goto('/_tests/_test-full-stack');
        await page.waitForLoadState('networkidle');

        const runButton = page.getByRole('button', { name: /run e2e test/i });
        await runButton.click();

        // Completion: button enabled again and all steps resolved
        await expect(runButton).toBeEnabled();
        await expect(page.locator('.e2e-step.step-success')).toHaveCount(5);
        await expect(page.locator('.e2e-step.step-error')).toHaveCount(0);
    });
});

