import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
    await page.route('**/api/__or3-e2e/models*', route => route.fulfill({ json: { data: [], links: { next: null }, total_count: 0 } }));
});

test('document quick action edits persist after leaving the fields and reloading', async ({ page }, info) => {
    await page.goto('/__or3-document-journey-test');
    await expect(page.getByRole('textbox', { name: 'Document body' })).toBeVisible();
    await page.getByRole('button', { name: 'Document AI settings', exact: true }).click();
    await page.getByRole('button', { name: 'Add action', exact: true }).click();
    await page.getByRole('textbox', { name: 'Quick action label', exact: true }).fill('Journey quick action');
    await page.getByRole('textbox', { name: 'Quick action label', exact: true }).press('Tab');
    await page.getByRole('textbox', { name: 'Quick action prompt', exact: true }).fill('Preserve the scratch section and summarize it.');
    await page.getByRole('textbox', { name: 'Quick action prompt', exact: true }).press('Tab');
    await page.getByRole('button', { name: 'Done', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Edit Journey quick action', exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('textbox', { name: 'Document body' })).toBeVisible();
    await page.getByRole('button', { name: 'Document AI settings', exact: true }).click();
    await page.getByRole('button', { name: 'Edit Journey quick action', exact: true }).click();
    await expect(page.getByRole('textbox', { name: 'Quick action label', exact: true })).toHaveValue('Journey quick action');
    await expect(page.getByRole('textbox', { name: 'Quick action prompt', exact: true })).toHaveValue('Preserve the scratch section and summarize it.');
    const path = info.outputPath('quick-action-reloaded.png');
    await page.screenshot({ path, animations: 'disabled' });
    await info.attach('quick-action-reloaded', { path, contentType: 'image/png' });
});

test('outline navigation positions headings below the toolbar in the document viewport', async ({ page }, info) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/__or3-document-journey-test');
    const body = page.getByRole('textbox', { name: 'Document body' });
    await expect(body).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('.editor-toolbar')).not.toHaveClass(/editor-toolbar--compact/);
    await body.click();
    await body.press('ControlOrMeta+A');
    await body.evaluate((element) => {
        const clipboardData = new DataTransfer();
        const paragraphs = '<p>Section content with enough space to exercise document scrolling.</p>'.repeat(16);
        clipboardData.setData('text/html', `<h1>Opening section</h1>${paragraphs}<h2>Middle section</h2>${paragraphs}<h2>Final section</h2>${paragraphs}`);
        element.dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }));
    });
    await expect(page.getByTestId('persisted-document-body')).toContainText('Final section');

    for (const size of [{ width: 1440, height: 900 }, { width: 800, height: 600 }]) {
        await page.setViewportSize(size);
        if (size.width === 800) {
            await expect(page.getByRole('tree', { name: 'Document heading hierarchy' })).toBeHidden();
        }
        for (const title of ['Final section', 'Opening section', 'Middle section']) {
            if (!await page.getByRole('tree', { name: 'Document heading hierarchy' }).isVisible()) {
                await page.getByRole('button', { name: 'Outline & info', exact: true }).click();
            }
            await page.getByRole('treeitem').filter({ hasText: title }).click();
            const heading = body.getByRole('heading', { name: title, exact: true });
            await expect.poll(() => heading.evaluate(async element => {
                const viewport = element.closest('.editor-scroll')!;
                // Check the settled position, rather than a transient frame
                // while smooth scrolling or inspector reflow passes the target.
                for (let frame = 0; frame < 12; frame++) {
                    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
                    const offset = element.getBoundingClientRect().top - viewport.getBoundingClientRect().top;
                    if (Math.abs(offset - 24) > 1) return false;
                }
                return true;
            }), { message: `${title} stays aligned at ${size.width}x${size.height}` }).toBe(true);
            await expect(body).toBeFocused();
        }
        const path = info.outputPath(`outline-navigation-${size.width}x${size.height}.png`);
        await page.screenshot({ path, animations: 'disabled' });
        await info.attach('outline-navigation', { path, contentType: 'image/png' });
    }
});

test.skip(
    process.env.OR3_PRODUCTION_JOURNEY_TEST_HARNESS !== 'true',
    'Production journeys require OR3_PRODUCTION_JOURNEY_TEST_HARNESS=true'
);

for (const theme of ['blank', 'retro', 'cyberpunk']) {
    test(`${theme} document dialogs retain focus and fit short viewports`, async ({ page }, info) => {
        test.setTimeout(90_000);
        await page.context().addCookies([{ name: 'or3_active_theme', value: theme, domain: '127.0.0.1', path: '/' }]);
        await page.addInitScript((value) => { localStorage.setItem('activeTheme', value); localStorage.setItem('theme', 'light'); }, theme);
        await page.route(/(?:openrouter\.ai\/|\/api\/openrouter\/)/, route => route.request().method() === 'POST' ? route.abort() : route.continue());
        await page.setViewportSize({ width: 390, height: 844 });
        await page.goto('/__or3-document-journey-test');
        await expect(page.getByRole('textbox', { name: 'Document body' })).toBeVisible({ timeout: 30_000 });
        const settings = page.getByRole('button', { name: 'Document AI settings', exact: true });
        await settings.focus();
        await settings.click();
        const dialog = page.getByRole('dialog', { name: 'Document AI settings', exact: true });
        await expect(dialog).toBeVisible();
        for (const size of [{ width: 320, height: 568 }, { width: 390, height: 320 }, { width: 844, height: 390 }, { width: 1440, height: 900 }]) {
            await page.setViewportSize(size);
            const path = info.outputPath(`modal-${theme}-light-${size.width}x${size.height}-document-settings.png`);
            await page.screenshot({ path, animations: 'disabled', scale: 'css' });
            await info.attach('document-settings', { path, contentType: 'image/png' });
            await expect.poll(() => dialog.evaluate(e => {
                const r = e.getBoundingClientRect();
                return r.left >= -1 && r.top >= -1 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1 && e.scrollWidth <= e.clientWidth + 1;
            })).toBe(true);
            await expect(dialog.getByRole('button', { name: 'Close Document AI settings', exact: true })).toBeInViewport({ ratio: 1 });
        }
        await page.setViewportSize({ width: 390, height: 320 });
        for (let i = 0; i < 24; i++) {
            await page.keyboard.press('Tab');
            await expect.poll(() => dialog.evaluate(e => {
                const active = document.activeElement;
                if (!active || !e.contains(active)) return false;
                const r = active.getBoundingClientRect();
                return r.top >= -1 && r.bottom <= innerHeight + 1;
            })).toBe(true);
        }
        await page.keyboard.press('Escape');
        await expect(dialog).toBeHidden();
        await expect(settings).toBeFocused();
        await expect(page.getByRole('textbox', { name: 'Document body' })).toContainText('Initial document text.');
    });
}

test('autosaves the production document editor and restores title and content after reload', async ({
    page,
}) => {
    const inferenceRequests: string[] = [];
    await page.route('**/api/openrouter/stream', route => { inferenceRequests.push(route.request().url()); return route.fulfill({status:401, json:{error:'Sign in required'}}); });
    await page.goto('/__or3-document-journey-test');
    await expect(page.getByTestId('production-document-journey')).toBeVisible({
        timeout: 30_000,
    });

    const title = page.getByRole('textbox', { name: 'Document title' });
    const body = page.getByRole('textbox', { name: 'Document body' });
    await expect(title).toHaveValue('Journey draft', { timeout: 30_000 });
    await expect(body).toContainText('Initial document text.');

    await title.click();
    await title.press('ControlOrMeta+A');
    await title.pressSequentially('Persisted journey title');
    await title.press('Tab');
    await expect(page.getByTestId('persisted-document-title')).toHaveText(
        'Persisted journey title',
        { timeout: 10_000 }
    );
    await body.click();
    await body.press('ControlOrMeta+A');
    await body.pressSequentially('Autosaved browser document body.');
    await expect(page.getByTestId('persisted-document-body')).toHaveText(
        'Autosaved browser document body.',
        { timeout: 10_000 }
    );
    // Guest typing must stay local after the autocomplete debounce settles.
    await page.waitForTimeout(1600);
    expect(inferenceRequests).toEqual([]);
    await page.reload();
    await expect(
        page.getByRole('textbox', { name: 'Document title' })
    ).toHaveValue('Persisted journey title', { timeout: 30_000 });
    await expect(
        page.getByRole('textbox', { name: 'Document body' })
    ).toContainText('Autosaved browser document body.');
});
