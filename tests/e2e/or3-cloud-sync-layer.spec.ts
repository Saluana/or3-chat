import { test, expect } from '@playwright/test';

test.describe('OR3 Cloud Sync Layer E2E', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/_tests/_test-sync-e2e');
        await expect(page.getByTestId('active-workspace')).toHaveText('workspace-a');
        await page.getByTestId('reset-workspace').click();
        await expect(page.getByTestId('threads-count')).toHaveText('0');
    });

    test('scopes data per workspace and preserves DB names', async ({ page }) => {
        await page.getByTestId('create-thread').click();
        await expect(page.getByTestId('threads-count')).toHaveText('1');
        await expect(page.getByTestId('db-name')).toHaveText(/or3-db-workspace-a/);

        await page.getByTestId('workspace-b').click();
        await expect(page.getByTestId('active-workspace')).toHaveText('workspace-b');
        await expect(page.getByTestId('threads-count')).toHaveText('0');
        await expect(page.getByTestId('db-name')).toHaveText(/or3-db-workspace-b/);

        await page.getByTestId('create-thread').click();
        await expect(page.getByTestId('threads-count')).toHaveText('1');

        await page.getByTestId('workspace-a').click();
        await expect(page.getByTestId('active-workspace')).toHaveText('workspace-a');
        await expect(page.getByTestId('threads-count')).toHaveText('1');
    });

    test('captures ops, suppresses pending messages, and writes tombstones', async ({ page }) => {
        const pendingOps = page.getByTestId('pending-ops-count');
        const tombstones = page.getByTestId('tombstones-count');

        await expect(pendingOps).toHaveText('0');
        await expect(tombstones).toHaveText('0');

        await page.getByTestId('create-thread').click();
        await expect(pendingOps).toHaveText('1');

        await page.getByTestId('create-pending-message').click();
        await expect(pendingOps).toHaveText('1');

        await page.getByTestId('create-message').click();
        await expect(pendingOps).toHaveText('2');

        await page.getByTestId('create-blocked-kv').click();
        await expect(pendingOps).toHaveText('2');

        await page.getByTestId('delete-thread').click();
        await expect(pendingOps).toHaveText('3');
        await expect(tombstones).toHaveText('1');
    });
});
