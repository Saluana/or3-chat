import { test, expect } from '@playwright/test';

test.describe('OR3 Cloud Smoke Tests', () => {
    test('Homepage loads (or redirects if unauth)', async ({ page }) => {
        // Checking basic server availability
        await page.goto('/');
        
        // Since we don't have auth credentials in CI yet, 
        // we expect either the home page (if authed) or a redirect to login (if unauthed)
        // or the marketing page if that's the root.
        
        // Wait for network to settle
        await page.waitForLoadState('networkidle');
        
        const url = page.url();
        console.log('Final URL after load:', url);
        
        // Basic assertion: Page title shouldn't be empty or error
        const title = await page.title();
        console.log('Page title:', title);
        expect(title).toBeTruthy();
    });

    // We can't easily test full auth flows without mocking or valid creds in the runner,
    // so we'll rely on the manual "ruthless" review for deep auth testing.
    // This smoke test just ensures the app mounts and doesn't crash on startup.
});
