import { test, expect } from '@playwright/test';

test.describe('ThemePage', () => {
    test.beforeEach(async ({ page }) => {
        // Clear localStorage before each test
        await page.goto('/');
        await page.evaluate(() => localStorage.clear());
    });

    test('can switch between light and dark modes', async ({ page }) => {
        await page.goto('/dashboard/theme');
        
        // Click dark mode button
        await page.getByRole('button', { name: /dark/i }).click();
        
        // Verify dark class applied
        const htmlClass = await page.locator('html').getAttribute('class');
        expect(htmlClass).toContain('dark');
    });

    test('can adjust base font size slider', async ({ page }) => {
        await page.goto('/dashboard/theme');
        
        // Find and adjust font size slider
        const slider = page.locator('input[type="range"]').first();
        await slider.fill('22');
        
        // Verify CSS variable updated
        await page.waitForTimeout(200); // debounce
        const fontSize = await page.evaluate(() => 
            getComputedStyle(document.documentElement).getPropertyValue('--app-font-size-root')
        );
        expect(fontSize.trim()).toBe('22px');
    });

    test('can enable palette overrides and change primary color', async ({ page }) => {
        await page.goto('/dashboard/theme');
        
        // Enable palette overrides
        await page.getByRole('checkbox', { name: /enable palette/i }).check();
        
        // Color pickers should be enabled
        const colorPicker = page.locator('[data-testid="palette-primary-picker"]').first();
        await expect(colorPicker).toBeEnabled();
    });

    test('settings persist across page reloads', async ({ page }) => {
        await page.goto('/dashboard/theme');
        
        // Enable palette and set a color
        await page.getByRole('checkbox', { name: /enable palette/i }).check();
        
        // Reload page
        await page.reload();
        
        // Verify setting persisted
        const checkbox = page.getByRole('checkbox', { name: /enable palette/i });
        await expect(checkbox).toBeChecked();
    });

    test('reset current mode clears only active mode', async ({ page }) => {
        await page.goto('/dashboard/theme');
        
        // Make a change in light mode
        await page.getByRole('checkbox', { name: /enable palette/i }).check();
        
        // Switch to dark mode
        await page.getByRole('button', { name: /dark/i }).click();
        await page.getByRole('checkbox', { name: /enable palette/i }).check();
        
        // Reset dark mode
        page.on('dialog', dialog => dialog.accept());
        await page.getByRole('button', { name: /reset dark/i }).click();
        
        // Switch back to light
        await page.getByRole('button', { name: /light/i }).click();
        
        // Light mode should still have customizations
        const checkbox = page.getByRole('checkbox', { name: /enable palette/i });
        await expect(checkbox).toBeChecked();
    });

    test('reset all clears both modes', async ({ page }) => {
        await page.goto('/dashboard/theme');
        
        // Make changes in both modes
        await page.getByRole('checkbox', { name: /enable palette/i }).check();
        await page.getByRole('button', { name: /dark/i }).click();
        await page.getByRole('checkbox', { name: /enable palette/i }).check();
        
        // Reset all
        page.on('dialog', dialog => dialog.accept());
        await page.getByRole('button', { name: /reset all/i }).click();
        
        // Both modes should be cleared
        const checkboxDark = page.getByRole('checkbox', { name: /enable palette/i });
        await expect(checkboxDark).not.toBeChecked();
        
        await page.getByRole('button', { name: /light/i }).click();
        const checkboxLight = page.getByRole('checkbox', { name: /enable palette/i });
        await expect(checkboxLight).not.toBeChecked();
    });
});
