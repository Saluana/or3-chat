import { expect, test, type Page } from '@playwright/test';

type ThemeName = 'blank' | 'retro' | 'cyberpunk';
type ColorMode = 'light' | 'dark';

const themes: ThemeName[] = ['blank', 'retro', 'cyberpunk'];
const modes: ColorMode[] = ['light', 'dark'];
const viewports = [
    { name: 'desktop', width: 1280, height: 900, mobile: false },
    { name: 'mobile', width: 390, height: 844, mobile: true },
] as const;

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
