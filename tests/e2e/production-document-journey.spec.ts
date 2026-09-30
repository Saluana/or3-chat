import { expect, test } from '@playwright/test';

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
    await page.reload();
    await expect(
        page.getByRole('textbox', { name: 'Document title' })
    ).toHaveValue('Persisted journey title', { timeout: 30_000 });
    await expect(
        page.getByRole('textbox', { name: 'Document body' })
    ).toContainText('Autosaved browser document body.');
});
