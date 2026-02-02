import { test, expect } from '@playwright/test';

test.describe('Sidebar Overlap Reproduction', () => {
    test.use({ viewport: { width: 820, height: 1180 } }); // iPad Air width approx

    test('Chat content should not be occluded by sidebar', async ({ page }) => {
        await page.goto('/');

        // 1. Identify Sidebar and Chat Container
        // Sidebar usu. has id="sidebar" or class "sidebar"
        // Chat container usu. has class "chat-container" or similar
        const sidebar = page.locator('#sidebar');
        const chatContainer = page.locator('main'); // Assuming main is used, or we find a large container

        await expect(sidebar).toBeVisible();
        
        // 2. Get bounding boxes
        const sidebarBox = await sidebar.boundingBox();
        const chatBox = await chatContainer.boundingBox();

        if (sidebarBox && chatBox) {
            console.log('Sidebar Right:', sidebarBox.x + sidebarBox.width);
            console.log('Chat Left:', chatBox.x);

            // 3. Check for overlap
            // If Sidebar is on top (z-index) and fixed/absolute, then overlap means Chat Left < Sidebar Right
            // If they are flex siblings, Chat Left should be >= Sidebar Right.
            
            // We want to verify that the text content of the chat is not covered.
            // Let's assume standard layout: Sidebar | Chat
            expect(chatBox.x).toBeGreaterThanOrEqual(sidebarBox.x + sidebarBox.width - 1); // tolerance
        }
    });
});
