import { expect, test, type Page } from '@playwright/test';

const palette = (page: Page) => page.locator('[data-test="command-palette"]');
const query = (page: Page) =>
    page.locator('[data-test="command-palette-input"]');

async function openPalette(page: Page): Promise<void> {
    await page.keyboard.press(
        process.platform === 'darwin' ? 'Meta+K' : 'Control+K'
    );
    await expect(palette(page)).toBeVisible();
    await expect(query(page)).toBeFocused();
}

async function waitForPaletteHydration(page: Page): Promise<void> {
    const trigger = page
        .getByRole('button', { name: 'Open command palette' })
        .first();
    await expect(trigger).toBeVisible();
    await expect(async () => {
        await trigger.click();
        await expect(palette(page)).toBeVisible({ timeout: 1_000 });
    }).toPass({ timeout: 30_000 });
    await page.keyboard.press('Escape');
    await expect(palette(page)).toBeHidden();
}

test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForPaletteHydration(page);
});

test('opens globally, traps one overlay, and restores focus on Escape', async ({
    page,
}) => {
    const trigger = page.getByRole('button', {
        name: 'Open command palette',
    }).first();
    await expect(trigger).toBeVisible();
    await trigger.focus();
    await openPalette(page);

    await page.keyboard.press(
        process.platform === 'darwin' ? 'Meta+K' : 'Control+K'
    );
    await expect(palette(page)).toHaveCount(1);
    await expect(query(page)).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(palette(page)).toBeHidden();
    await expect(trigger).toBeFocused();
});

test('requires two clicks and locks the first-click preview selection', async ({
    page,
}) => {
    await openPalette(page);
    const options = page.getByRole('option');
    await expect(options.first()).toBeVisible({ timeout: 30_000 });

    const first = options.first();
    await first.click();
    await expect(palette(page)).toBeVisible();
    await expect(first).toHaveAttribute('aria-selected', 'true');

    if ((await options.count()) > 1) {
        await options.nth(1).hover();
        await expect(first).toHaveAttribute('aria-selected', 'true');
    }

    await first.click();
    await expect(palette(page)).toBeHidden();
});

test('fits the mobile viewport without horizontal overflow', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 740 });
    await openPalette(page);

    const box = await palette(page).boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.width).toBeLessThanOrEqual(390);
    const scrollWidth = await palette(page).evaluate(
        (element) => element.scrollWidth
    );
    expect(scrollWidth).toBeLessThanOrEqual(390);
});

test('typing a new query cannot execute a stale result with Enter', async ({ page }, info) => {
    await openPalette(page);
    await expect(page.getByRole('option', { name: 'New chat Start a new chat thread', exact: true })).toBeVisible();
    const tabsBefore = await page.getByRole('tab').count();
    await query(page).fill('zzzz-no-result-browser-qa');
    await query(page).press('Enter');
    await expect(palette(page)).toBeVisible();
    await expect(page.getByRole('option')).toHaveCount(0);
    await expect(page.getByRole('tab')).toHaveCount(tabsBefore);
    const path = info.outputPath('palette-immediate-enter.png');
    await page.screenshot({ path, animations: 'disabled' });
    await info.attach('palette-immediate-enter', { path, contentType: 'image/png' });
});
