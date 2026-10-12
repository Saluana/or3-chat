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
    // Complete first-run onboarding before testing pointer events beneath it.
    await page.goto('/?welcome=1');
    await page.getByRole('button', { name: 'Dismiss welcome', exact: true }).click();
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

test('mobile commands run on the first tap', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 740 });
    await openPalette(page);
    await page.getByRole('option', { name: 'New document Create a new document', exact: true }).click();
    await expect(palette(page)).toBeHidden();
    await expect(page.getByRole('textbox', { name: 'Document title', exact: true })).toBeVisible();
});

test('mobile previews preserve search, reopen safely, and open the selected document', async ({ page }, info) => {
    // Create the record through the real command and document editor.
    await openPalette(page);
    await query(page).fill('cmd: new document');
    await expect(page.getByRole('option', { name: 'New document Create a new document', exact: true })).toBeVisible();
    await query(page).press('Enter');
    const title = page.getByRole('textbox', { name: 'Document title', exact: true });
    await expect(title).toBeVisible();
    await title.fill('Mobile preview checklist');
    await title.press('Tab');

    await page.setViewportSize({ width: 390, height: 740 });
    await page.getByRole('button', { name: 'Open sidebar', exact: true }).click();
    await page.getByRole('button', { name: 'Search everything', exact: true }).click();
    await expect(palette(page)).toBeVisible();
    await query(page).fill('doc: Mobile preview checklist');
    const result = page.getByRole('option', { name: /Mobile preview checklist/ });
    await expect(result).toBeVisible();
    const scrollBefore = await page.locator('.or3-palette-results').evaluate(element => element.scrollTop);
    await result.click();
    const sheet = page.getByRole('dialog', { name: 'Result preview', exact: true });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole('heading', { name: 'Mobile preview checklist', exact: true })).toBeVisible();
    await expect(query(page)).not.toBeFocused();
    // The visible grab handle must dismiss the sheet, not pan the palette.
    const handle = sheet.locator('span.h-1.w-10');
    await expect(handle).toBeVisible();
    // Finish the entry animation before measuring the handle for the drag.
    await sheet.evaluate(element => {
        for (const animation of element.getAnimations({ subtree: true })) animation.finish();
    });
    const handleBox = (await handle.boundingBox())!;
    const sheetTop = (await sheet.boundingBox())!.y;
    const touchSession = await page.context().newCDPSession(page);
    const touch = async (type: 'touchStart' | 'touchMove' | 'touchEnd' | 'touchCancel', offset = 0) => {
        await touchSession.send('Input.dispatchTouchEvent', {
            type,
            touchPoints: type === 'touchEnd' || type === 'touchCancel' ? [] : [{
                x: handleBox.x + handleBox.width / 2,
                y: handleBox.y + handleBox.height / 2 + offset,
            }],
        });
    };
    // A real touch stream must move the sheet without the scroll guard
    // swallowing it. A cancelled drag must snap back instead of dismissing.
    await touch('touchStart');
    await touch('touchMove', 140);
    await expect.poll(async () => (await sheet.boundingBox())!.y).toBeGreaterThan(sheetTop + 100);
    await touch('touchCancel');
    await expect(sheet).toBeVisible();
    await expect.poll(async () => (await sheet.boundingBox())!.y).toBeCloseTo(sheetTop, 0);

    await touch('touchStart');
    await touch('touchMove', 25);
    // Holding still before release is not a flick, even after a quick move.
    await page.waitForTimeout(120);
    await touch('touchEnd');
    await expect(sheet).toBeVisible();
    await expect.poll(async () => (await sheet.boundingBox())!.y).toBeCloseTo(sheetTop, 0);
    await touchSession.detach();

    await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + 160, { steps: 10 });
    await page.mouse.up();
    await expect(sheet).toBeHidden();
    await expect(query(page)).toHaveValue('doc: Mobile preview checklist');
    expect(await page.locator('.or3-palette-results').evaluate(element => element.scrollTop)).toBe(scrollBefore);

    // A second tap after dismissal must preview again, not execute the old
    // desktop second-click action.
    await result.click();
    await expect(sheet).toBeVisible();
    const path = info.outputPath('mobile-document-preview.png');
    await page.screenshot({ path, animations: 'disabled' });
    await info.attach('mobile-document-preview', { path, contentType: 'image/png' });
    await sheet.getByRole('button', { name: 'Open', exact: true }).click();
    await expect(palette(page)).toBeHidden();
    await expect(sheet).toBeHidden();
    await expect(title).toHaveValue('Mobile preview checklist');
    await expect(page.getByTestId('sidebar')).toHaveAttribute('inert', '');
    await expect(page.getByTestId('sidebar')).not.toBeInViewport();
    await expect(title).toBeInViewport();

    // The existing More sheet uses the same handle behavior and must retain
    // its own close animation and reopen correctly after dragging.
    await page.getByRole('button', { name: 'Open sidebar', exact: true }).click();
    await page.getByRole('button', { name: 'More options', exact: true }).click();
    const moreSheet = page.locator('#mobile-nav-more-sheet');
    await expect(moreSheet).toBeVisible();
    const moreHandle = (await moreSheet.locator('.more-sheet-handle-hit').boundingBox())!;
    await page.mouse.move(moreHandle.x + moreHandle.width / 2, moreHandle.y + moreHandle.height / 2);
    await page.mouse.down();
    await page.mouse.move(moreHandle.x + moreHandle.width / 2, moreHandle.y + 160, { steps: 10 });
    await page.mouse.up();
    await expect(moreSheet).toBeHidden();
    await page.getByRole('button', { name: 'More options', exact: true }).click();
    await expect(moreSheet).toBeInViewport();
    await page.getByRole('button', { name: 'Close more menu', exact: true }).click({ position: { x: 10, y: 10 } });
    await expect(moreSheet).toBeHidden();
});

test.describe('iOS keyboard scrolling', () => {
    test.use({
        hasTouch: true,
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_5 like Mac OS X) AppleWebKit/605.1.15 Version/26.5 Mobile/15E148 Safari/604.1',
    });

    test('routes keyboard-era swipes into results and prevents page panning', async ({ page }, info) => {
        await page.setViewportSize({ width: 390, height: 740 });
        await page.evaluate(() => {
            const viewport = Object.assign(new EventTarget(), {
                width: innerWidth, height: 320, offsetTop: 0, offsetLeft: 0, scale: 1,
            });
            Object.defineProperty(window, 'visualViewport', { configurable: true, value: viewport });
            window.dispatchEvent(new Event('resize'));
        });
        await openPalette(page);
        const results = page.locator('.or3-palette-results');
        await expect(page.getByRole('option').first()).toBeVisible();
        await expect.poll(() => results.evaluate(el => el.clientHeight)).toBeLessThan(320);
        await palette(page).evaluate(element => {
            for (const animation of element.closest('[role="dialog"]')!.getAnimations({ subtree: true })) animation.finish();
        });
        const background = await page.evaluate(() => ({ x: scrollX, y: scrollY }));
        const queryTop = (await query(page).boundingBox())!.y;
        const swipe = async (selector: string, ending: 'flick' | 'stationary' | 'tiny-move' | 'held' = 'flick') => page.locator(selector).evaluate(async (element, ending) => {
            const target = element.querySelector('[role="option"]') ?? element;
            const send = (type: string, y: number) => {
                const touch = { identifier: 1, target, clientX: 180, clientY: y };
                const event = Object.assign(new Event(type, { bubbles: true, cancelable: true }), {
                    touches: type === 'touchend' ? [] : [touch], changedTouches: [touch],
                });
                target.dispatchEvent(event);
                return event.defaultPrevented;
            };
            send('touchstart', 260);
            await new Promise(resolve => setTimeout(resolve, 16));
            send('touchmove', 200);
            await new Promise(resolve => setTimeout(resolve, 16));
            send('touchmove', 140);
            await new Promise(resolve => setTimeout(resolve, 16));
            const prevented = send('touchmove', 100);
            if (ending !== 'flick') {
                // WebKit can deliver a last stationary/subpixel sample as a
                // finger lifts. It must not erase the speed of the swipe.
                await new Promise(resolve => setTimeout(resolve, ending === 'held' ? 140 : 16));
                send('touchmove', ending === 'tiny-move' ? 99.8 : 100);
            }
            send('touchend', 100);
            return { prevented, releaseScroll: element.scrollTop };
        }, ending);

        // Dispatch the touch stream directly: native iOS may pan the root
        // instead of scrolling the target while a text field is focused.
        const released = await swipe('.or3-palette-results', 'stationary');
        expect(released.releaseScroll).toBeGreaterThan(100);
        // The list must coast after release, then stop immediately when the
        // user touches it again, while keeping the keyboard and page in place.
        await expect.poll(() => results.evaluate(el => el.scrollTop)).toBeGreaterThan(released.releaseScroll + 30);
        const interrupted = await results.evaluate(async element => {
            const touch = { identifier: 2, target: element, clientX: 180, clientY: 200 };
            element.dispatchEvent(Object.assign(new Event('touchstart', { bubbles: true }), { touches: [touch], changedTouches: [touch] }));
            const stopped = element.scrollTop;
            await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
            const afterFrames = element.scrollTop;
            element.dispatchEvent(Object.assign(new Event('touchcancel', { bubbles: true }), { touches: [], changedTouches: [touch] }));
            return { stopped, afterFrames };
        });
        expect(interrupted.afterFrames).toBe(interrupted.stopped);
        await results.evaluate(el => { el.scrollTop = 0; });
        const tinyRelease = await swipe('.or3-palette-results', 'tiny-move');
        await expect.poll(() => results.evaluate(el => el.scrollTop)).toBeGreaterThan(tinyRelease.releaseScroll + 30);
        // A deliberate pause before lifting should still stop the list.
        const held = await swipe('.or3-palette-results', 'held');
        const afterHold = await results.evaluate(async element => {
            await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
            return element.scrollTop;
        });
        expect(afterHold).toBe(held.releaseScroll);
        await expect(query(page)).toBeFocused();
        expect((await swipe('.or3-palette-query')).prevented).toBe(true);
        expect(await page.evaluate(() => ({ x: scrollX, y: scrollY }))).toEqual(background);
        expect((await query(page).boundingBox())!.y).toBe(queryTop);

        await page.locator('.or3-palette-filters').evaluate(element => {
            for (const [type, x] of [['touchstart', 280], ['touchmove', 100], ['touchend', 100]] as const) {
                const touch = { identifier: 1, target: element, clientX: x, clientY: 80 };
                element.dispatchEvent(Object.assign(new Event(type, { bubbles: true, cancelable: true }), {
                    touches: type === 'touchend' ? [] : [touch], changedTouches: [touch],
                }));
            }
        });
        expect(await page.locator('.or3-palette-filters').evaluate(el => el.scrollLeft)).toBeGreaterThan(100);

        // Reaching the end must not hand the gesture to the background page.
        await results.evaluate(el => { el.scrollTop = el.scrollHeight; });
        expect((await swipe('.or3-palette-results')).prevented).toBe(true);
        expect(await page.evaluate(() => ({ x: scrollX, y: scrollY }))).toEqual(background);
        const path = info.outputPath('ios-keyboard-contained-scroll.png');
        await page.screenshot({ path, animations: 'disabled' });
        await info.attach('ios-keyboard-contained-scroll', { path, contentType: 'image/png' });
        await page.getByRole('button', { name: 'Close search', exact: true }).click();
        await expect(palette(page)).toBeHidden();
        await page.getByRole('button', { name: 'Open sidebar', exact: true }).click();
        await expect(page.getByRole('dialog', { name: 'Navigation', exact: true })).toBeVisible();
    });
});
