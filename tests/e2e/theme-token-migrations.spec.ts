import { readFile, rm, writeFile } from 'node:fs/promises';
import { expect, test, webkit, type Page, type TestInfo } from '@playwright/test';

type ThemeName = 'blank' | 'retro' | 'cyberpunk';
type ColorMode = 'light' | 'dark';

const themes: ThemeName[] = ['blank', 'retro', 'cyberpunk'];
const modes: ColorMode[] = ['light', 'dark'];
const viewports = [
    { name: 'desktop', width: 1280, height: 900, mobile: false },
    { name: 'mobile', width: 390, height: 844, mobile: true },
] as const;

const chatViewports = [
    { width: 320, height: 568 },
    { width: 360, height: 640 },
    { width: 390, height: 844 },
    { width: 430, height: 932 },
    { width: 640, height: 480 },
    { width: 767, height: 1024 },
    { width: 768, height: 1024 },
    { width: 820, height: 1180 },
    { width: 1024, height: 768 },
    { width: 1440, height: 900 },
    { width: 1920, height: 1080 },
    { width: 2560, height: 1440 },
    { width: 844, height: 390 },
    // Reduced available height while a phone keyboard is visible.
    { width: 390, height: 320 },
];

async function openResponsiveChat(
    page: Page,
    theme: ThemeName,
    mode: ColorMode,
    dismissWelcome = true,
): Promise<void> {
    // Layout checks must never invoke an instance's configured AI provider.
    await page.route(/(?:openrouter\.ai\/|\/api\/openrouter\/)/, async (route) => {
        if (route.request().method() === 'POST') await route.abort('blockedbyclient');
        else await route.continue();
    });
    await page.context().addCookies([
        { name: 'or3_active_theme', value: theme, domain: '127.0.0.1', path: '/' },
        {
            name: 'or3_workspace_profile_v1',
            value: encodeURIComponent(JSON.stringify({
                version: 1, workspaceId: 'local', profileId: 'standard-or3',
            })),
            domain: '127.0.0.1', path: '/',
        },
    ]);
    await page.addInitScript(({ theme, mode }) => {
        localStorage.setItem('activeTheme', theme);
        localStorage.setItem('theme', mode);
    }, { theme, mode });
    await page.goto('/chat');
    await expect(page.getByRole('textbox', { name: 'Message input' }).first())
        .toBeVisible({ timeout: 30_000 });
    const dismiss = page.getByRole('button', { name: 'Dismiss welcome' });
    if (dismissWelcome && await dismiss.isVisible()) await dismiss.click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
}

async function expectComposerFits(page: Page): Promise<void> {
    await expect.poll(() => page.locator('.chat-input-main:visible').evaluateAll((elements) =>
        elements.every((element) => {
            const pane = element.closest('.chat-container-root');
            if (!pane) return false;
            const bounds = element.getBoundingClientRect();
            const paneBounds = pane.getBoundingClientRect();
            return bounds.left >= paneBounds.left - 1 &&
                bounds.right <= paneBounds.right + 1 &&
                bounds.top >= paneBounds.top && bounds.bottom <= innerHeight + 1 &&
                bounds.height < innerHeight * 0.65;
        })
    )).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth))
        .toBeLessThanOrEqual(page.viewportSize()!.width);
    for (const button of await page.locator('.chat-input-main:visible')
        .getByRole('button', { name: /^(Add attachments|Settings|Send message)$/ }).all()) {
        await expect(button).toBeInViewport({ ratio: 1 });
        await expect.poll(() => button.evaluate((element) => {
            const bounds = element.getBoundingClientRect();
            return element.contains(document.elementFromPoint(
                bounds.left + bounds.width / 2, bounds.top + bounds.height / 2
            ));
        })).toBe(true);
    }
}

async function captureChat(page: Page, info: TestInfo, name: string): Promise<void> {
    const path = info.outputPath(`${name}.png`);
    await page.screenshot({ path, animations: 'disabled', scale: 'css' });
    await info.attach(name, { path, contentType: 'image/png' });
    // Playwright copies path attachments; keep the report copy only.
    await rm(path);
    if (name.includes('keyboard')) {
        const frame = await page.evaluate(() => ({
            layout: { width: innerWidth, height: innerHeight },
            visible: { width: visualViewport!.width, height: visualViewport!.height, top: visualViewport!.offsetTop },
        }));
        const metadataPath = info.outputPath(`${name}-viewport.json`);
        await writeFile(metadataPath, JSON.stringify(frame));
        await info.attach(`${name}-viewport`, { path: metadataPath, contentType: 'application/json' });
        await rm(metadataPath);
    }
}

// Dialogs are exercised through the same controls users open them with. These
// cases guard clipping, unusable touch actions, and lost focus across resizes.
async function expectDialogFits(page: Page, name: string): Promise<void> {
    const dialog = page.getByRole('dialog', { name, exact: true });
    await expect(dialog).toBeVisible();
    await expect.poll(() => dialog.evaluate((element) => {
        const r = element.getBoundingClientRect();
        return r.left >= -1 && r.top >= -1 && r.right <= innerWidth + 1 &&
            r.bottom <= innerHeight + 1 && element.scrollWidth <= element.clientWidth + 1;
    })).toBe(true);
    for (const button of await dialog.locator('[data-slot="header"] button:visible, [data-slot="footer"] button:visible').all()) {
        await expect(button).toBeInViewport({ ratio: 1 });
        if (page.viewportSize()!.width < 768) {
            expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
        }
    }
}

async function expectDialogFocusLoop(page: Page, name: string): Promise<void> {
    const dialog = page.getByRole('dialog', { name, exact: true });
    for (let i = 0; i < 16; i++) {
        await page.keyboard.press(i < 12 ? 'Tab' : 'Shift+Tab');
        await expect.poll(() => dialog.evaluate((element) => {
            const focused = document.activeElement;
            if (!focused || !element.contains(focused)) return false;
            const r = focused.getBoundingClientRect();
            return r.top >= -1 && r.bottom <= innerHeight + 1 &&
                r.left >= -1 && r.right <= innerWidth + 1;
        })).toBe(true);
    }
}

async function expectSearchChoicesVisible(page: Page): Promise<void> {
    const palette = page.getByRole('dialog', { name: 'Command palette', exact: true });
    const second = palette.getByRole('option').nth(1);
    await expect(second).toBeVisible();
    await expect.poll(() => second.evaluate(element => {
        const results = element.closest('.or3-palette-results')!;
        const r = element.getBoundingClientRect();
        const viewport = results.getBoundingClientRect();
        return r.top >= viewport.top - 1 && r.bottom <= viewport.bottom + 1;
    })).toBe(true);
}

async function runPaletteCommand(page: Page, label: string): Promise<void> {
    await page.keyboard.press('ControlOrMeta+k');
    const palette = page.getByRole('dialog', { name: 'Command palette', exact: true });
    await palette.getByRole('combobox').fill(label);
    await palette.getByRole('option', { name: new RegExp(`^${label} `) }).first().click();
    await palette.getByRole('group', { name: 'Result actions', exact: true })
        .getByRole('button', { name: label, exact: true }).click();
    await expect(palette).toBeHidden();
}

test.describe('responsive modal layouts', () => {
    for (const theme of themes) test(`${theme} dialogs follow Safari keyboard height and panning`, async ({ page }, info) => {
        await page.setViewportSize({ width: 390, height: 844 });
        await page.addInitScript(() => {
            const viewport = Object.assign(new EventTarget(), {
                width: innerWidth, height: innerHeight, offsetTop: 0, offsetLeft: 0, scale: 1,
            });
            Object.defineProperty(window, 'visualViewport', { configurable: true, value: viewport });
        });
        await openResponsiveChat(page, theme, 'light', false);
        const welcome = page.locator('[data-welcome-card]');
        await expect(welcome).toBeVisible();
        const dismiss = welcome.getByRole('button', { name: 'Dismiss welcome' });
        expect((await dismiss.boundingBox())!.height).toBeGreaterThanOrEqual(44);
        expect((await dismiss.boundingBox())!.width).toBeGreaterThanOrEqual(44);
        await welcome.getByLabel('OpenRouter API key', { exact: true }).focus();
        await page.evaluate(() => {
            Object.assign(window.visualViewport!, { height: 320, offsetTop: 74 });
            window.visualViewport!.dispatchEvent(new Event('resize'));
        });
        await expect.poll(() => welcome.evaluate(el => {
            const r = el.getBoundingClientRect();
            return r.top >= 73 && r.bottom <= 395 && r.left >= 16 && r.right <= innerWidth - 16;
        })).toBe(true);
        const helperText = welcome.locator('p').filter({ hasText: 'Your key never leaves this browser.' });
        const keyInput = welcome.getByLabel('OpenRouter API key', { exact: true });
        for (const control of [helperText, keyInput, dismiss]) {
            await expect.poll(() => control.evaluate(el => {
                const r = el.getBoundingClientRect();
                const viewport = window.visualViewport!;
                return r.top >= viewport.offsetTop - 1 && r.bottom <= viewport.offsetTop + viewport.height + 1;
            })).toBe(true);
        }
        await keyInput.fill('invalid-audit-key');
        await welcome.getByRole('button', { name: 'Save', exact: true }).click();
        await expect(welcome.getByRole('alert')).toBeVisible();
        await expect(keyInput).toHaveAttribute('aria-invalid', 'true');
        await keyInput.fill('');
        await captureChat(page, info, `modal-${theme}-light-390x844-keyboard-welcome`);
        await page.evaluate(() => {
            Object.assign(window.visualViewport!, { height: 844, offsetTop: 0 });
            window.visualViewport!.dispatchEvent(new Event('resize'));
        });
        await page.getByRole('button', { name: 'Dismiss welcome' }).click();
        await page.getByRole('button', { name: 'Open sidebar', exact: true }).click();
        await page.getByRole('button', { name: 'Create your first project', exact: true }).click();
        const dialog = page.getByRole('dialog', { name: 'New Project', exact: true });
        await dialog.getByRole('textbox', { name: 'Title', exact: true }).fill('Keyboard-safe project');
        const setFrame = async (height: number, offsetTop: number, scale = 1) => {
            await page.evaluate(({ height, offsetTop, scale }) => {
                Object.assign(window.visualViewport!, { width: innerWidth, height, offsetTop, scale });
                window.visualViewport!.dispatchEvent(new Event('resize'));
                window.visualViewport!.dispatchEvent(new Event('scroll'));
            }, { height, offsetTop, scale });
        };
        const fitsFrame = (name: string) => page.getByRole('dialog', { name, exact: true }).evaluate(element => {
            const viewport = window.visualViewport!;
            const r = element.getBoundingClientRect();
            return r.top >= viewport.offsetTop - 1 && r.bottom <= viewport.offsetTop + viewport.height + 1;
        });
        for (const offset of [74, 110]) {
            await setFrame(320, offset);
            await expect.poll(() => fitsFrame('New Project')).toBe(true);
            await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeVisible();
        }
        await captureChat(page, info, `modal-${theme}-light-390x844-keyboard-project`);
        await setFrame(844, 0);
        await setFrame(422, 100, 2);
        await expect.poll(() => dialog.evaluate(el => !el.getAttribute('style')?.includes('!important'))).toBe(true);
        await setFrame(844, 0);
        await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
        await page.keyboard.press('ControlOrMeta+k');
        await setFrame(320, 74);
        await expect.poll(() => fitsFrame('Command palette')).toBe(true);
        await expect(page.locator('.or3-palette-preview')).toBeHidden();
        await expectSearchChoicesVisible(page);
        await captureChat(page, info, `modal-${theme}-light-390x844-keyboard-search`);
        await page.setViewportSize({ width: 844, height: 390 });
        await setFrame(190, 0);
        const palette = page.getByRole('dialog', { name: 'Command palette', exact: true });
        const closeSearch = palette.getByRole('button', { name: 'Close search', exact: true });
        await expect(closeSearch).toBeVisible();
        await expect.poll(() => palette.getByRole('option').first().evaluate(el => {
            const r = el.getBoundingClientRect();
            return r.top >= 0 && r.bottom <= 190;
        })).toBe(true);
        await palette.getByRole('button', { name: 'Show result actions', exact: true }).click();
        await expect(palette.getByRole('group', { name: 'Result actions (active)', exact: true })).toBeVisible();
        await palette.getByRole('button', { name: 'Return to search results', exact: true }).click();
        await expect(palette.getByRole('option').first()).toBeVisible();
        await captureChat(page, info, `modal-${theme}-light-844x390-keyboard-landscape-search`);
        await closeSearch.click();
        await expect(palette).toBeHidden();
    });

    for (const theme of themes) for (const mode of modes) {
        test(`${theme} ${mode} dialogs fit phones, tablets, desktops and short screens`, async ({ page }, info) => {
            test.setTimeout(180_000);
            await page.setViewportSize({ width: 390, height: 844 });
            await openResponsiveChat(page, theme, mode);
            await page.getByRole('button', { name: 'Open sidebar', exact: true }).click();
            const projectTrigger = page.getByRole('button', { name: 'Create your first project', exact: true });
            await projectTrigger.focus();
            await projectTrigger.click();
            const project = page.getByRole('dialog', { name: 'New Project', exact: true });
            await project.getByRole('textbox', { name: 'Title', exact: true }).fill('Responsive project');
            await project.getByRole('textbox', { name: 'Description', exact: true }).fill('Long project description '.repeat(50));
            for (const size of chatViewports) {
                await page.setViewportSize(size);
                await captureChat(page, info, `modal-${theme}-${mode}-${size.width}x${size.height}-project`);
                await expectDialogFits(page, 'New Project');
            }
            await page.setViewportSize({ width: 390, height: 320 });
            await expectDialogFocusLoop(page, 'New Project');
            await project.getByRole('button', { name: 'Cancel', exact: true }).click();
            await expect(project).toBeHidden();
            // Resizing closed the mobile drawer; restoration must choose a visible control.
            await expect(page.getByRole('button', { name: 'Open sidebar', exact: true })).toBeFocused();

            await runPaletteCommand(page, 'Open dashboard');
            for (const size of chatViewports) {
                await page.setViewportSize(size);
                await captureChat(page, info, `modal-${theme}-${mode}-${size.width}x${size.height}-dashboard`);
                await expectDialogFits(page, 'Dashboard');
            }
            await page.getByRole('dialog', { name: 'Dashboard', exact: true }).getByRole('button', { name: 'Close', exact: true }).click();
            await expect(page.getByRole('dialog', { name: 'Dashboard', exact: true })).toBeHidden();

            await runPaletteCommand(page, 'New system prompt');
            await expect(page.locator('[data-test="system-prompts-editor"]')).toBeVisible();
            for (const size of chatViewports) {
                await page.setViewportSize(size);
                await captureChat(page, info, `modal-${theme}-${mode}-${size.width}x${size.height}-prompt-editor`);
                await expectDialogFits(page, 'System Prompts');
            }
            const prompts = page.getByRole('dialog', { name: 'System Prompts', exact: true });
            await prompts.getByRole('textbox', { name: 'Untitled Prompt', exact: true }).fill('Responsive library prompt');
            await prompts.getByRole('button', { name: 'Back to list', exact: true }).click();
            await prompts.getByRole('button', { name: 'Back to prompts', exact: true }).click();
            for (const size of chatViewports) {
                await page.setViewportSize(size);
                await captureChat(page, info, `modal-${theme}-${mode}-${size.width}x${size.height}-prompt-library`);
                await expectDialogFits(page, 'System Prompts');
                await expect(prompts.getByRole('button', { name: 'Prompt actions', exact: true })).toBeInViewport();
            }
            await page.getByRole('button', { name: 'Close system prompts', exact: true }).click();
            await expect(page.getByRole('dialog', { name: 'System Prompts', exact: true })).toBeHidden();

            await page.keyboard.press('ControlOrMeta+k');
            for (const size of chatViewports) {
                await page.setViewportSize(size);
                await captureChat(page, info, `modal-${theme}-${mode}-${size.width}x${size.height}-search`);
                await expectDialogFits(page, 'Command palette');
                await expect(page.getByRole('listbox', { name: 'Search results' })).toBeInViewport();
                if (size.height <= 500) await expect(page.locator('.or3-palette-preview')).toBeHidden();
                if (size.height === 320) await expectSearchChoicesVisible(page);
            }
            await page.setViewportSize({ width: 390, height: 320 });
            const palette = page.getByRole('dialog', { name: 'Command palette', exact: true });
            await palette.getByRole('combobox').fill('Responsive library prompt');
            const promptResult = palette.getByRole('option', { name: /^Responsive library prompt / }).first();
            await expect(promptResult).toBeVisible();
            for (let move = 0; move < 8 && await promptResult.getAttribute('aria-selected') !== 'true'; move++) {
                await page.keyboard.press('ArrowDown');
            }
            await expect(promptResult).toHaveAttribute('aria-selected', 'true');
            const secondary = palette.getByRole('button', { name: 'Open prompt library', exact: true });
            await expect(secondary).toBeHidden();
            await palette.getByRole('button', { name: 'Show more actions', exact: true }).click();
            await expect(secondary).toBeFocused();
            await expect(secondary).toBeInViewport({ ratio: 1 });
            await captureChat(page, info, `modal-${theme}-${mode}-390x320-search-expanded-actions`);
            await palette.getByRole('combobox').focus();
            await expect(secondary).toBeHidden();
            await page.keyboard.press('Escape');
        });
    }

    for (const theme of themes) {
        test(`${theme} documentation navigation has reachable dismissal and a focus trap`, async ({ page }, info) => {
            test.setTimeout(60_000);
            await page.setViewportSize({ width: 390, height: 844 });
            await openResponsiveChat(page, theme, 'light');
            await page.goto('/documentation/start/overview');
            const trigger = page.getByRole('button', { name: 'Open navigation', exact: true });
            await expect(trigger).toBeVisible({ timeout: 30_000 });
            const dialog = page.getByRole('dialog', { name: 'Documentation navigation', exact: true });
            await expect(async () => {
                if (!await dialog.isVisible()) await trigger.click();
                await expect(dialog).toBeVisible({ timeout: 1000 });
            }).toPass({ timeout: 30_000 });
            const close = dialog.getByRole('button', { name: 'Close navigation', exact: true });
            await expect(close).toBeVisible();
            for (const size of [{ width: 320, height: 568 }, { width: 390, height: 320 }]) {
                await page.setViewportSize(size);
                await captureChat(page, info, `modal-${theme}-light-${size.width}x${size.height}-documentation`);
                await expectDialogFits(page, 'Documentation navigation');
                await expect(close).toBeInViewport({ ratio: 1 });
                await expectDialogFocusLoop(page, 'Documentation navigation');
            }
            await close.click();
            await expect(dialog).toBeHidden();
            await expect(page.getByRole('button', { name: 'Open navigation', exact: true })).toBeFocused();
        });

        test(`${theme} mobile sheets and tab switcher keep keyboard focus inside`, async ({ page }, info) => {
            test.setTimeout(60_000);
            await page.setViewportSize({ width: 390, height: 844 });
            await openResponsiveChat(page, theme, 'light');
            await page.getByRole('button', { name: 'Open sidebar', exact: true }).click();
            const more = page.getByRole('button', { name: 'More options', exact: true });
            await more.focus();
            await more.click();
            for (const size of [{ width: 320, height: 568 }, { width: 390, height: 320 }]) {
                await page.setViewportSize(size);
                await captureChat(page, info, `modal-${theme}-light-${size.width}x${size.height}-more`);
                await expectDialogFits(page, 'More');
                await expectDialogFocusLoop(page, 'More');
            }
            await page.keyboard.press('Escape');
            await expect(page.getByRole('dialog', { name: 'More', exact: true })).toBeHidden();
            await expect(more).toBeFocused();
            await page.keyboard.press('Escape');
            const tabs = page.getByRole('button', { name: /^Open tabs, current:/ });
            await tabs.focus();
            await tabs.click();
            for (const size of [{ width: 320, height: 568 }, { width: 390, height: 320 }]) {
                await page.setViewportSize(size);
                await captureChat(page, info, `modal-${theme}-light-${size.width}x${size.height}-tabs`);
                await expectDialogFits(page, 'Open tabs');
            }
            await page.setViewportSize({ width: 1440, height: 900 });
            await expect(page.getByRole('dialog', { name: 'Open tabs', exact: true })).toBeHidden();
            await expect(page.locator('.workspace-tab').first()).toBeVisible();
            await page.setViewportSize({ width: 390, height: 320 });
            await tabs.click();
            await expectDialogFocusLoop(page, 'Open tabs');
            await page.keyboard.press('Escape');
            await expect(page.getByRole('dialog', { name: 'Open tabs', exact: true })).toBeHidden();
            await expect(tabs).toBeFocused();
        });

        test(`${theme} model catalog nested dialogs dismiss one layer and retain focus`, async ({ page }, info) => {
            test.setTimeout(180_000);
            await page.setViewportSize({ width: 390, height: 844 });
            await page.addInitScript(() => localStorage.setItem('openrouter_model_catalog_v1', JSON.stringify({
                fetchedAt: Date.now(),
                data: [{ id: 'audit/model', name: 'Audit model', description: 'Long model description '.repeat(70), context_length: 32000, pricing: { prompt: '0', completion: '0' } }],
            })));
            await openResponsiveChat(page, theme, 'dark');
            await page.getByRole('button', { name: 'Settings', exact: true }).last().click();
            await page.getByRole('button', { name: /^Model catalog/ }).click();
            const catalog = page.getByRole('dialog', { name: 'Model catalog', exact: true });
            await expect(catalog).toBeVisible();
            for (const size of chatViewports) {
                await page.setViewportSize(size);
                await captureChat(page, info, `modal-${theme}-dark-${size.width}x${size.height}-catalog`);
                await expectDialogFits(page, 'Model catalog');
                await expect(catalog.getByRole('option').first()).toBeInViewport();
            }
            await page.setViewportSize({ width: 390, height: 844 });
            const filterTrigger = catalog.getByRole('button', { name: 'Open filters', exact: true });
            await filterTrigger.focus();
            await filterTrigger.click();
            await page.setViewportSize({ width: 390, height: 320 });
            await captureChat(page, info, `modal-${theme}-dark-390x320-catalog-filters`);
            await expectDialogFits(page, 'Filters');
            await expectDialogFocusLoop(page, 'Filters');
            await page.keyboard.press('Escape');
            await expect(page.getByRole('dialog', { name: 'Filters', exact: true })).toBeHidden();
            await expect(catalog).toBeVisible();
            await expect(filterTrigger).toBeFocused();
            await catalog.getByRole('option').first().click();
            await captureChat(page, info, `modal-${theme}-dark-390x320-catalog-details`);
            await expectDialogFits(page, 'Model details');
            await expectDialogFocusLoop(page, 'Model details');
            await page.keyboard.press('Escape');
            await expect(page.getByRole('dialog', { name: 'Model details', exact: true })).toBeHidden();
            await expect(catalog).toBeVisible();
        });

        test(`${theme} image preview is a keyboard accessible bounded modal`, async ({ browser, browserName }, info) => {
            test.setTimeout(90_000);
            const options = { viewport: { width: 390, height: 844 }, hasTouch: true };
            const profile = browserName === 'webkit' ? info.outputPath('image-browser-profile') : null;
            const context = profile ? await webkit.launchPersistentContext(profile, options) : await browser.newContext(options);
            const page = context.pages()[0] ?? await context.newPage();
            try {
                await openResponsiveChat(page, theme, 'light');
                await runPaletteCommand(page, 'Open image library');
                await page.locator('input[type="file"]').setInputFiles({
                    name: 'Responsive preview.png', mimeType: 'image/png',
                    buffer: await readFile('public/screenshots/blank-theme-preview.png'),
                });
                const trigger = page.getByRole('button', { name: 'View Responsive preview.png', exact: true }).first();
                await expect(trigger).toBeVisible({ timeout: 15_000 });
                await trigger.focus();
                await trigger.click();
                const preview = page.getByRole('dialog', { name: 'Image preview', exact: true });
                await expect(preview).toBeVisible();
                for (const size of [{ width: 320, height: 568 }, { width: 390, height: 320 }, { width: 844, height: 390 }, { width: 1920, height: 1080 }]) {
                    await page.setViewportSize(size);
                    await captureChat(page, info, `modal-${theme}-light-${size.width}x${size.height}-image-preview`);
                    await expectDialogFits(page, 'Image preview');
                    await expect(preview.getByRole('button', { name: 'Close image preview', exact: true })).toBeInViewport({ ratio: 1 });
                    await expect(preview.getByRole('img', { name: 'Responsive preview.png', exact: true })).toBeInViewport({ ratio: 1 });
                }
                await page.setViewportSize({ width: 390, height: 320 });
                await expectDialogFocusLoop(page, 'Image preview');
                await page.keyboard.press('Escape');
                await expect(preview).toBeHidden();
                await expect(trigger).toBeFocused();
                await trigger.click();
                await expect(preview.getByRole('img', { name: 'Responsive preview.png', exact: true })).toBeVisible();
                await preview.getByRole('button', { name: 'Close image preview', exact: true }).click();
                await expect(preview).toBeHidden();
            } finally {
                await context.close();
                if (profile) await rm(profile, { recursive: true, force: true });
            }
        });

        test(`${theme} nested prompt confirmation confines focus and cancels safely`, async ({ page }, info) => {
            test.setTimeout(90_000);
            await page.setViewportSize({ width: 320, height: 568 });
            await openResponsiveChat(page, theme, 'light');
            await runPaletteCommand(page, 'New system prompt');
            const parent = page.getByRole('dialog', { name: 'System Prompts', exact: true });
            await parent.getByRole('textbox', { name: 'Untitled Prompt', exact: true }).fill('Responsive prompt ' + 'X'.repeat(160));
            await parent.getByRole('button', { name: 'Back to list', exact: true }).click();
            await parent.getByRole('button', { name: 'Back to prompts', exact: true }).click();
            await parent.getByRole('button', { name: 'Prompt actions', exact: true }).click();
            await page.getByRole('button', { name: 'Delete', exact: true }).click();
            const confirmation = page.getByRole('dialog', { name: 'Delete system prompt?', exact: true });
            await expect(confirmation).toBeVisible();
            await page.setViewportSize({ width: 390, height: 320 });
            await captureChat(page, info, `modal-${theme}-light-390x320-prompt-confirmation`);
            await expectDialogFits(page, 'Delete system prompt?');
            await expectDialogFocusLoop(page, 'Delete system prompt?');
            await page.keyboard.press('Escape');
            await expect(confirmation).toBeHidden();
            await expect(parent).toBeVisible();
            await expect(parent.getByRole('button', { name: 'Prompt actions', exact: true })).toBeVisible();
        });
    }
});

async function openThemeStudio(page: Page, isMobile: boolean): Promise<void> {
    await page.context().addCookies([
        {
            name: 'or3_workspace_profile_v1',
            value: encodeURIComponent(
                JSON.stringify({
                    version: 1,
                    workspaceId: 'local',
                    profileId: 'standard-or3',
                })
            ),
            domain: '127.0.0.1',
            path: '/',
        },
    ]);
    await page.addInitScript(() => {
        localStorage.removeItem('or3:user-theme-overrides:light');
        localStorage.removeItem('or3:user-theme-overrides:dark');
        localStorage.removeItem('or3:user-theme-accessibility');
    });
    await page.goto('/chat');

    const dashboard = page.getByRole('button', {
        name: 'Dashboard',
        exact: true,
    });
    if (isMobile) {
        const openSidebar = page.getByRole('button', {
            name: 'Open sidebar',
            exact: true,
        });
        await expect(openSidebar).toBeVisible({ timeout: 30_000 });
        await openSidebar.click();
        await expect.poll(async () => (await dashboard.boundingBox())?.x ?? -1)
            .toBeGreaterThanOrEqual(0);
    }
    await expect(dashboard).toBeVisible({ timeout: 30_000 });
    await dashboard.click();

    const title = page.getByRole('heading', { name: 'Theme studio' });
    if (await title.isVisible()) return;

    const dashboardDialog = page.getByRole('dialog', { name: 'Dashboard' });
    const settings = dashboardDialog.getByRole('button', {
        name: 'Settings',
        exact: true,
    });
    await expect(settings).toBeVisible({ timeout: 30_000 });
    await settings.click();

    const themeSettings = dashboardDialog.getByRole('button', {
        name: /Theme Settings/i,
    });
    await expect(themeSettings).toBeVisible({ timeout: 30_000 });
    await themeSettings.click();
    await expect(title).toBeVisible({ timeout: 30_000 });
}

async function selectThemeAndMode(
    page: Page,
    theme: ThemeName,
    mode: ColorMode
): Promise<void> {
    await page.getByRole('tab', { name: 'Theme' }).click();
    await page.locator(`#dashboard-theme-btn-${theme}`).click();

    const root = page.locator('html');
    await expect(root).toHaveAttribute('data-theme', theme);

    await page
        .getByRole('button', {
            name: mode === 'light' ? 'Light' : 'Dark',
            exact: true,
        })
        .click();
    await expect.poll(async () =>
        root.evaluate((element) => element.classList.contains('dark'))
    ).toBe(mode === 'dark');
}

async function cssVariable(page: Page, name: string): Promise<string> {
    return page.locator('html').evaluate(
        (element, variable) =>
            getComputedStyle(element).getPropertyValue(variable).trim(),
        name
    );
}

async function expectWorkspaceTabTextFits(
    page: Page,
    expectedHeight: string
): Promise<void> {
    const tab = page.locator('.workspace-tab').first();
    const title = tab.locator('.workspace-tab-title');
    await expect(tab).toHaveCSS('height', expectedHeight);
    await expect(title).toHaveCSS('line-height', '16.25px');

    const bounds = await tab.evaluate((element) => {
        const title = element.querySelector<HTMLElement>('.workspace-tab-title');
        if (!title) return null;
        title.textContent = 'gyp';
        const tabBounds = element.getBoundingClientRect();
        const titleBounds = title.getBoundingClientRect();
        return {
            titleTop: titleBounds.top - tabBounds.top,
            titleBottom: titleBounds.bottom - tabBounds.top,
            tabHeight: tabBounds.height,
            textOverflows: title.scrollHeight > title.clientHeight,
        };
    });

    expect(bounds).not.toBeNull();
    expect(bounds!.titleTop).toBeGreaterThan(0);
    expect(bounds!.titleBottom).toBeLessThanOrEqual(bounds!.tabHeight);
    expect(bounds!.textOverflows).toBe(false);
}

test.setTimeout(120_000);

test.describe('chat responsive layout', () => {
    for (const theme of themes) test(`${theme} composer follows the visible viewport when Safari opens its keyboard`, async ({ page }, info) => {
        await page.setViewportSize({ width: 390, height: 844 });
        await page.addInitScript(() => {
            const viewport = Object.assign(new EventTarget(), {
                width: innerWidth, height: innerHeight, offsetTop: 0, offsetLeft: 0, scale: 1,
            });
            Object.defineProperty(window, 'visualViewport', { configurable: true, value: viewport });
        });
        await openResponsiveChat(page, theme, 'light');
        const editor = page.getByRole('textbox', { name: 'Message input' }).first();
        await editor.fill('Safari keyboard draft '.repeat(60));
        const setVisualFrame = async (height: number, offsetTop: number, scale = 1) => {
            await page.evaluate(({ height, offsetTop, scale }) => {
                Object.assign(window.visualViewport!, { height, offsetTop, scale });
                window.visualViewport!.dispatchEvent(new Event('resize'));
                window.visualViewport!.dispatchEvent(new Event('scroll'));
            }, { height, offsetTop, scale });
        };
        const fitsVisualFrame = () => page.locator('.chat-input-main').first().evaluate((element) => {
            const viewport = window.visualViewport!;
            const r = element.getBoundingClientRect();
            return r.top >= viewport.offsetTop - 1 &&
                r.bottom <= viewport.offsetTop + viewport.height + 1 &&
                Array.from(element.querySelectorAll('button')).filter((button) => button.getClientRects().length)
                    .every((button) => {
                        const b = button.getBoundingClientRect();
                        return b.top >= viewport.offsetTop - 1 && b.bottom <= viewport.offsetTop + viewport.height + 1;
                    });
        });
        await setVisualFrame(360, 74);
        await expect.poll(fitsVisualFrame).toBe(true);
        await expect(page.locator('#page-container')).toHaveCSS('height', '360px');
        await captureChat(page, info, 'safari-keyboard-visible-frame');
        await setVisualFrame(360, 110);
        await expect.poll(fitsVisualFrame).toBe(true);
        await page.setViewportSize({ width: 844, height: 390 });
        await setVisualFrame(190, 0);
        await expect.poll(fitsVisualFrame).toBe(true);
        await captureChat(page, info, 'safari-landscape-keyboard-visible-frame');
        // Expanded landscape Safari chrome can leave just 56 CSS pixels.
        await setVisualFrame(56, 0);
        await expect.poll(fitsVisualFrame).toBe(true);
        await captureChat(page, info, 'safari-smallest-keyboard-visible-frame');
        await page.setViewportSize({ width: 390, height: 844 });
        await setVisualFrame(844, 0);
        await expectComposerFits(page);
        await expect(editor).toContainText('Safari keyboard draft');
        // Pinch zoom must retain normal layout and permit viewport panning.
        await setVisualFrame(422, 100, 2);
        await expect(page.locator('#page-container')).toHaveCSS('height', '844px');
    });

    for (const theme of themes) {
        for (const mode of modes) {
            test(`${theme} ${mode} keeps drafts and split-pane controls usable at every size`, async ({ page }, info) => {
                await openResponsiveChat(page, theme, mode);
                for (const viewport of chatViewports) {
                    await page.setViewportSize(viewport);
                    const input = page.getByRole('textbox', { name: 'Message input' }).first();
                    await input.fill('');
                    await expectComposerFits(page);
                    await captureChat(page, info, `empty-${viewport.width}x${viewport.height}`);
                    // Wrapped prose exercises internal scrolling without WebKit
                    // synthesizing Enter-to-send for fill() line breaks.
                    await input.fill('A long draft with several lines and an unbroken URL: https://example.com/' +
                        'long-path-segment'.repeat(30) + ' More draft content.'.repeat(100));
                    await expectComposerFits(page);
                    const editor = page.locator('.chat-input-editor-container:visible').first();
                    const overflow = await editor.evaluate((element) => ({
                        width: element.scrollWidth - element.clientWidth,
                        height: element.scrollHeight - element.clientHeight,
                    }));
                    expect(overflow.width).toBeLessThanOrEqual(1);
                    expect(overflow.height).toBeGreaterThan(0);
                    await captureChat(page, info, `draft-${viewport.width}x${viewport.height}`);
                }

                await page.setViewportSize({ width: 1440, height: 900 });
                await page.getByRole('textbox', { name: 'Message input' }).fill('');
                await page.getByRole('button', { name: 'New split', exact: true }).click();
                await expect(page.locator('.chat-input-main:visible')).toHaveCount(2);
                for (const viewport of [{ width: 1024, height: 768 }, { width: 768, height: 1024 }]) {
                    await page.setViewportSize(viewport);
                    await expectComposerFits(page);
                    await captureChat(page, info, `split-${viewport.width}x${viewport.height}`);
                }
            });
        }

        test(`${theme} touch attachments and settings remain reachable`, async ({ browser, browserName }, info) => {
            const options = {
                viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true,
            };
            // WebKit's ephemeral contexts reject IndexedDB Blob writes. Exercise
            // local attachment persistence with an isolated disk profile instead.
            const profile = browserName === 'webkit' ? info.outputPath('browser-profile') : null;
            const context = profile
                ? await webkit.launchPersistentContext(profile, options)
                : await browser.newContext(options);
            const page = await context.newPage();
            try {
                await openResponsiveChat(page, theme, 'light');
                const controls = page.locator('.chat-input-main')
                    .getByRole('button', { name: /^(Add attachments|Settings|Send message)$/ });
                for (const button of await controls.all()) {
                    const bounds = await button.boundingBox();
                    expect(bounds!.width).toBeGreaterThanOrEqual(44);
                    expect(bounds!.height).toBeGreaterThanOrEqual(44);
                }

                const chooser = page.waitForEvent('filechooser');
                await page.getByRole('button', { name: 'Add attachments' }).click();
                await (await chooser).setFiles(Array.from({ length: 8 }, (_, index) => ({
                    name: `attachment-${index}.png`, mimeType: 'image/png',
                    // Distinct source bytes keep attachment identities independent.
                    buffer: Buffer.concat([
                        Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64'),
                        Buffer.from([index]),
                    ]),
                })));
                const remove = page.getByRole('button', { name: 'Remove image', exact: true });
                await expect(remove).toHaveCount(8);
                await expect(remove.first()).toHaveCSS('opacity', '1');
                await expectComposerFits(page);
                await captureChat(page, info, 'touch-attachments');
                const input = page.getByRole('textbox', { name: 'Message input' });
                await input.fill('A draft with attachments.\n'.repeat(30));
                for (const viewport of [{ width: 320, height: 568 }, { width: 390, height: 320 }]) {
                    await page.setViewportSize(viewport);
                    await expectComposerFits(page);
                    await captureChat(page, info, `attachments-draft-${viewport.width}x${viewport.height}`);
                }
                await input.fill('');
                await page.setViewportSize({ width: 390, height: 844 });
                for (let index = 8; index > 0; index--) {
                    await remove.first().click();
                    await expect(remove).toHaveCount(index - 1);
                }

                await page.setViewportSize({ width: 430, height: 932 });
                await page.getByRole('button', { name: 'Settings', exact: true }).click();
                const settings = page.locator('.chat-settings-popover');
                await expect(settings).toBeInViewport({ ratio: 1 });
                await expect(page.getByRole('button', { name: 'Current model', exact: true })).toBeVisible();
                await page.getByRole('button', { name: 'Close chat settings' }).click();
                await page.setViewportSize({ width: 844, height: 390 });
                await page.getByRole('button', { name: 'Settings', exact: true }).click();
                await expect(settings).toBeInViewport({ ratio: 1 });
                await captureChat(page, info, 'landscape-settings');
                await page.getByRole('button', { name: 'Close chat settings' }).click();
                await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeFocused();
            } finally {
                await context.close();
                if (profile) await rm(profile, { recursive: true, force: true });
            }
        });
    }

    test('mobile navigation contains focus and closes when the desktop becomes narrow', async ({ page }, info) => {
        await page.setViewportSize({ width: 1280, height: 900 });
        await openResponsiveChat(page, 'blank', 'light');
        await page.setViewportSize({ width: 390, height: 844 });
        const sidebar = page.getByTestId('sidebar');
        await expect(sidebar).toHaveAttribute('inert', '');
        const open = page.getByRole('button', { name: 'Open sidebar', exact: true });
        await open.click();
        await expect.poll(() => sidebar.evaluate((element) => element.contains(document.activeElement)))
            .toBe(true);
        for (const viewport of [{ width: 390, height: 844 }, { width: 390, height: 320 }]) {
            await page.setViewportSize(viewport);
            for (let index = 0; index < 18; index++) {
                await page.keyboard.press('Tab');
                expect(await sidebar.evaluate((element) => element.contains(document.activeElement)))
                    .toBe(true);
                await expect(page.locator(':focus')).toBeInViewport({ ratio: 1 });
            }
            await captureChat(page, info, `mobile-navigation-${viewport.height}`);
        }
        await page.keyboard.press('Escape');
        await expect(sidebar).toHaveAttribute('inert', '');
        await expect(open).toBeFocused();
        await page.setViewportSize({ width: 768, height: 1024 });
        await expect(open).toBeHidden();
        await expect(sidebar).not.toHaveAttribute('inert', '');
        await expectComposerFits(page);
    });
});

for (const theme of themes) {
    for (const mode of modes) {
        for (const viewport of viewports) {
            test.describe(`${theme} ${mode} ${viewport.name}`, () => {
                test('applies the appearance tokens live', async ({
                    browser,
                }) => {
                    const context = await browser.newContext({
                        viewport: {
                            width: viewport.width,
                            height: viewport.height,
                        },
                        isMobile: viewport.mobile,
                        hasTouch: viewport.mobile,
                    });
                    const page = await context.newPage();

                    try {
                        await openThemeStudio(page, viewport.mobile);
                        await selectThemeAndMode(page, theme, mode);

                        if (!viewport.mobile) {
                            await expectWorkspaceTabTextFits(page, '32px');
                        }

                        await page.getByRole('tab', { name: 'Shape' }).click();
                        const appearance = page.locator(
                            '#dashboard-theme-appearance-section'
                        );
                        const toggles = appearance.locator(
                            'input[type="checkbox"]'
                        );
                        await toggles.nth(0).check();
                        await appearance
                            .locator('#theme-density-preset')
                            .selectOption('compact');
                        await expect(page.locator('html')).toHaveAttribute(
                            'data-density',
                            'compact'
                        );
                        expect(
                            await cssVariable(
                                page,
                                '--app-control-height-small'
                            )
                        ).toBe('28px');
                        expect(
                            await cssVariable(page, '--app-space-section')
                        ).toBe('12px');

                        const densityControl = appearance.locator(
                            '#theme-density-preset'
                        );
                        await expect(densityControl).toHaveCSS(
                            'min-height',
                            viewport.mobile ? '44px' : '32px'
                        );

                        if (!viewport.mobile) {
                            await expectWorkspaceTabTextFits(page, '28px');
                            await expect(
                                page.locator('.workspace-chrome').first()
                            ).toHaveCSS('padding-top', '4px');
                            await expect(
                                page.locator('.page-link-btn').first()
                            ).toHaveCSS('min-height', '64px');

                            await appearance
                                .locator('#theme-density-preset')
                                .selectOption('spacious');
                            await expectWorkspaceTabTextFits(page, '36px');
                        }

                        await toggles.nth(1).check();
                        await appearance
                            .locator('#theme-elevation-preset')
                            .selectOption('flat');
                        await expect(page.locator('html')).toHaveAttribute(
                            'data-elevation',
                            'flat'
                        );
                        expect(
                            await cssVariable(page, '--app-elevation-low')
                        ).toBe('none');
                        expect(
                            await cssVariable(page, '--app-elevation-high')
                        ).toBe('none');

                        await page.getByRole('tab', { name: 'Advanced' }).click();
                        const focusSlider = page.getByLabel(
                            'Focus ring thickness'
                        );
                        await focusSlider.click();
                        await focusSlider.press('End');
                        await expect
                            .poll(() =>
                                cssVariable(page, '--app-focus-ring-width')
                            )
                            .toBe('4px');

                        await page
                            .getByLabel('Motion preference')
                            .selectOption('reduced');
                        await expect(page.locator('html')).toHaveAttribute(
                            'data-motion-resolved',
                            'reduced'
                        );
                        expect(
                            await cssVariable(
                                page,
                                '--app-motion-duration-fast'
                            )
                        ).toBe('100ms');

                        await page.getByRole('tab', { name: 'Theme' }).focus();
                        await expect(
                            page.getByRole('tab', { name: 'Theme' })
                        ).toHaveCSS('outline-width', '4px');
                        await expect(
                            page.getByRole('tab', { name: 'Theme' })
                        ).toHaveCSS('transition-duration', '0.1s');

                        if (!viewport.mobile) {
                            await page
                                .getByRole('button', {
                                    name: 'Close',
                                    exact: true,
                                })
                                .click();
                            const search = page.getByRole('textbox', {
                                name: 'Search chats, documents, and projects',
                            });
                            await search.click();
                            await expect(search).toHaveCSS(
                                'outline-style',
                                'none'
                            );
                        }
                    } finally {
                        await context.close().catch(() => undefined);
                    }
                });
            });
        }
    }
}
