/**
 * Playwright test for Phase 4 - Retro Theme Visual Verification
 * 
 * This test verifies that the retro theme looks correct after migration
 * to the refined theme system.
 */

import { test, expect } from '@playwright/test';

test.describe('Retro Theme Visual Verification', () => {
    test.beforeEach(async ({ page }) => {
        // Navigate to the home page
        await page.goto('/');
        
        // Wait for the page to be fully loaded
        await page.waitForLoadState('networkidle');
        
        // Give extra time for fonts and theme to load
        await page.waitForTimeout(2000);
    });

    test('Home page renders with retro theme styles', async ({ page }) => {
        // Take a full page screenshot
        await page.screenshot({ 
            path: './test-results/retro-theme-home.png',
            fullPage: true 
        });
        
        // Verify retro styles are applied
        // Check if theme-btn class exists
        const retroBtn = await page.locator('.theme-btn').first();
        if (await retroBtn.count() > 0) {
            await expect(retroBtn).toBeVisible();
            
            // Verify retro button has correct styling
            const btnStyles = await retroBtn.evaluate((el) => {
                const computed = window.getComputedStyle(el);
                return {
                    border: computed.border,
                    borderRadius: computed.borderRadius,
                    boxShadow: computed.boxShadow,
                };
            });
            
            // Retro buttons should have 2px border and 3px border-radius
            expect(btnStyles.borderRadius).toContain('3px');
            console.log('Retro button styles:', btnStyles);
        }
        
        // Check if or3-prose class exists (renamed from prose-retro)
        const proseElement = await page.locator('.or3-prose').first();
        if (await proseElement.count() > 0) {
            await expect(proseElement).toBeVisible();
            console.log('or3-prose class found - prose styles successfully renamed');
        }
    });

    test('Theme demo page renders correctly', async ({ page }) => {
        // Navigate to theme demo page
        await page.goto('/theme-demo');
        await page.waitForLoadState('networkidle');
        await page.waitForTimeout(1000);
        
        // Take a screenshot of the theme demo
        await page.screenshot({ 
            path: './test-results/retro-theme-demo.png',
            fullPage: true 
        });
        
        // Verify page loaded successfully
        await expect(page.locator('h1')).toContainText(/theme/i);
    });

    test('CSS variables are loaded correctly', async ({ page }) => {
        // Check if Material Design CSS variables are set
        const rootStyles = await page.evaluate(() => {
            const root = document.documentElement;
            const computed = window.getComputedStyle(root);
            return {
                primary: computed.getPropertyValue('--md-primary'),
                surface: computed.getPropertyValue('--md-surface'),
                inverseSurface: computed.getPropertyValue('--md-inverse-surface'),
            };
        });
        
        console.log('CSS Variables:', rootStyles);
        
        // All these should have values
        expect(rootStyles.primary).toBeTruthy();
        expect(rootStyles.surface).toBeTruthy();
        expect(rootStyles.inverseSurface).toBeTruthy();
    });

    test('Retro shadow utility class works', async ({ page }) => {
        // Find an element with retro-shadow class
        const shadowElement = await page.locator('.theme-shadow').first();
        
        if (await shadowElement.count() > 0) {
            const styles = await shadowElement.evaluate((el) => {
                const computed = window.getComputedStyle(el);
                return {
                    boxShadow: computed.boxShadow,
                };
            });
            
            console.log('Retro shadow styles:', styles);
            
            // Retro shadow should have offset of 2px 2px
            expect(styles.boxShadow).toContain('2px 2px');
        }
    });
});
