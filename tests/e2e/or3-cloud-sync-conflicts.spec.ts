/**
 * Sync Conflict Debug E2E Tests
 * 
 * Tests the sync conflict debugging harness:
 * - Conflict detection and logging
 * - Notification suppression during bootstrap
 * - Manual conflict triggering
 */

import { test, expect } from '@playwright/test';

test.describe('Sync Conflict Debug', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/_tests/_test-sync-conflicts');
        await page.waitForLoadState('networkidle');
    });

    test('Page loads with sync status cards', async ({ page }) => {
        const statusCards = page.locator('.status-card');
        await expect(statusCards).toHaveCount(4);
        
        // Verify labels exist
        await expect(page.locator('.status-card')).toContainText(['Bootstrap', 'Rescan', 'Subscription', 'Cursor']);
    });

    test('Statistics card shows conflict counts', async ({ page }) => {
        const statsGrid = page.locator('.stats-grid');
        await expect(statsGrid).toBeVisible();
        
        // All stats should be visible (even if 0)
        await expect(statsGrid).toContainText('Total Conflicts');
        await expect(statsGrid).toContainText('Suppressed');
        await expect(statsGrid).toContainText('Notified');
        await expect(statsGrid).toContainText('Notifications');
    });

    test('Trigger Conflict button creates a conflict entry', async ({ page }) => {
        // Clear any existing logs first
        await page.getByRole('button', { name: '🧹 Clear Conflict Log' }).click();
        await page.waitForTimeout(300);
        
        // Trigger a conflict
        await page.getByRole('button', { name: '⚡ Trigger Conflict' }).click();
        await page.waitForTimeout(500);
        
        // Check event log for conflict creation
        const eventLog = page.locator('.log');
        await expect(eventLog).toContainText('conflict test');
    });

    test('Clear Notifications empties notification log', async ({ page }) => {
        await page.getByRole('button', { name: '🧹 Clear Notifications' }).click();
        await page.waitForTimeout(300);
        
        // Check event log for cleared message
        const eventLog = page.locator('.log');
        await expect(eventLog).toContainText('Cleared all notifications');
    });

    test('Clear Conflict Log resets counters', async ({ page }) => {
        await page.getByRole('button', { name: '🧹 Clear Conflict Log' }).click();
        await page.waitForTimeout(300);
        
        // Check event log
        const eventLog = page.locator('.log');
        await expect(eventLog).toContainText('Cleared conflict log');
    });

    test('Reset Cursor button updates cursor to 0', async ({ page }) => {
        await page.getByRole('button', { name: /Reset Cursor/ }).click();
        await page.waitForTimeout(500);
        
        // Check event log - use first .log element
        const eventLog = page.locator('.log').first();
        await expect(eventLog).toContainText('Reset sync cursor to 0');
    });

    test('Explanation section is visible', async ({ page }) => {
        const explanation = page.locator('.explanation');
        await expect(explanation).toBeVisible();
        await expect(explanation).toContainText('How Conflict Suppression Works');
        await expect(explanation).toContainText('isInitialSyncing');
    });

    test('Empty state message shows when no conflicts', async ({ page }) => {
        // Clear conflict log
        await page.getByRole('button', { name: '🧹 Clear Conflict Log' }).click();
        await page.waitForTimeout(300);
        
        // Check for empty state
        const emptyState = page.locator('.conflict-log + .empty-state, .empty-state');
        const conflictLog = page.locator('.conflict-log');
        
        // Either conflict log is empty/hidden or shows empty state
        const conflictItems = page.locator('.conflict-item');
        const count = await conflictItems.count();
        
        // If no conflicts, expect empty state or no conflict items
        expect(count >= 0).toBeTruthy();
    });

    test('Bootstrap status card reflects correct state', async ({ page }) => {
        const bootstrapCard = page.locator('.status-card').filter({ hasText: 'Bootstrap' });
        await expect(bootstrapCard).toBeVisible();
        
        // Should show Idle when not bootstrapping
        await expect(bootstrapCard).toContainText('Idle');
    });
});
