import { expect, test } from '@playwright/test';

test.setTimeout(120_000);

test('swaps adjacent panes and keeps blank-theme pane edges visible', async ({
    page,
}, testInfo) => {
    await page.context().addCookies([
        {
            name: 'or3_active_theme',
            value: 'blank',
            domain: '127.0.0.1',
            path: '/',
        },
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
        localStorage.setItem('activeTheme', 'blank');
    });

    await expect(async () => {
        await page.goto('/chat');
        await expect(page.getByRole('button', { name: 'New split' })).toBeVisible({
            timeout: 10_000,
        });
    }).toPass({ timeout: 70_000 });
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'blank');
    await page.getByRole('button', { name: 'New split' }).click();

    const panes = page.locator('.pane-container > [role="tabpanel"]');
    await expect(panes).toHaveCount(2);
    const originalIds = await panes.evaluateAll((elements) =>
        elements.map((element) => element.id)
    );
    expect(originalIds[0]).toBeTruthy();
    expect(originalIds[1]).toBeTruthy();
    expect(originalIds[0]).not.toBe(originalIds[1]);

    const handle = page.locator('.pane-resize-handle');
    const swap = page.getByRole('button', { name: 'Swap left and right panes' });
    await expect(swap).toBeHidden();

    await handle.hover({ position: { x: 4, y: 48 } });
    await expect(swap).toBeVisible();
    await panes.first().hover({ position: { x: 48, y: 100 } });
    await expect(swap).toBeHidden();

    await handle.focus();
    await expect(swap).toBeVisible();
    await panes.first().focus();
    await expect(swap).toBeHidden();

    const activeId = await page.locator('.pane-container > .pane-active').getAttribute('id');
    await handle.hover({ position: { x: 4, y: 48 } });

    const screenshot = testInfo.outputPath('blank-pane-divider-hover.png');
    await page.screenshot({ path: screenshot });
    await testInfo.attach('blank-pane-divider-hover', {
        path: screenshot,
        contentType: 'image/png',
    });

    await swap.click();

    await expect.poll(async () =>
        panes.evaluateAll((elements) => elements.map((element) => element.id))
    ).toEqual([...originalIds].reverse());
    await expect(page.locator('.pane-container > .pane-active')).toHaveAttribute('id', activeId!);

    const edge = await panes.nth(1).evaluate((element) => {
        const style = getComputedStyle(element);
        return {
            width: style.borderRightWidth,
            style: style.borderRightStyle,
            color: style.borderRightColor,
            top: style.borderTopWidth,
        };
    });
    expect(edge.width).toBe('1px');
    expect(edge.style).toBe('solid');
    expect(edge.color).not.toBe('rgba(0, 0, 0, 0)');
    expect(edge.top).toBe('1px');

    await page.reload();
    await expect(panes).toHaveCount(2);
    await expect.poll(async () =>
        panes.evaluateAll((elements) => elements.map((element) => element.id))
    ).toEqual([...originalIds].reverse());
});
