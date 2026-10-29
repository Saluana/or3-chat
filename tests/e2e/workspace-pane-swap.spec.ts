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
    // Fresh local workspaces show onboarding before pane controls are usable.
    await page.getByRole('button', { name: 'Dismiss welcome', exact: true }).click();
    await expect(page.locator('[data-welcome-backdrop]')).toHaveCount(0);
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

    // Blank's first pane owns the internal divider; the shell owns outer seams.
    const edge = await panes.first().evaluate((element) => {
        const style = getComputedStyle(element);
        const scale = Number(getComputedStyle(document.body).zoom) || 1;
        return {
            width: parseFloat(style.borderRightWidth) * scale,
            style: style.borderRightStyle,
            color: style.borderRightColor,
            bottom: parseFloat(style.borderBottomWidth) * scale,
        };
    });
    expect(edge.width).toBeCloseTo(1, 2);
    expect(edge.style).toBe('solid');
    expect(edge.color).not.toBe('rgba(0, 0, 0, 0)');
    expect(edge.bottom).toBeCloseTo(1, 2);

    await page.reload();
    await expect(panes).toHaveCount(2);
    await expect.poll(async () =>
        panes.evaluateAll((elements) => elements.map((element) => element.id))
    ).toEqual([...originalIds].reverse());
});

test('restores workspace tabs without adding blank tabs when profiles change', async ({ page }) => {
    await expect(async () => {
        await page.goto('/chat');
        await expect(page.getByRole('button', { name: 'New split' })).toBeVisible({ timeout: 10_000 });
    }).toPass({ timeout: 70_000 });
    await page.getByRole('button', { name: 'Dismiss welcome', exact: true }).click();
    await page.getByRole('button', { name: 'New split' }).click();
    await page.getByRole('textbox', { name: 'Message input' }).first().fill('Keep this draft through profile changes');
    await page.locator('.chat-empty-state').last().getByRole('button', { name: 'Create a document', exact: true }).click();
    const createDocument = page.getByRole('dialog', { name: 'Create a document' });
    await createDocument.getByRole('textbox', { name: 'Title', exact: true }).fill('Profile transition document');
    await createDocument.getByRole('button', { name: 'Create', exact: true }).click();
    await expect(page.getByRole('textbox', { name: 'Document title' })).toHaveValue('Profile transition document');
    const tabs = page.locator('.workspace-tab-bar [role="tab"]');
    await expect(tabs).toHaveCount(3, { timeout: 30_000 });
    const originalTabs = await tabs.allTextContents();

    await page.getByRole('button', { name: 'Dashboard', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: /^Settings/ }).click();
    await page.getByRole('dialog').getByRole('button', { name: /^Workspace Profile/ }).click();
    const profile = page.getByRole('combobox', { name: 'Profile' });
    await profile.click();
    await page.getByRole('option', { name: 'Document Workspace' }).click();
    await page.getByRole('button', { name: 'Apply profile', exact: true }).click();
    await expect(profile).toContainText('Document Workspace');
    await profile.click();
    await page.getByRole('option', { name: 'Standard OR3' }).click();
    await page.getByRole('button', { name: 'Apply profile', exact: true }).click();
    await expect(profile).toContainText('Standard OR3');
    await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
    await expect(tabs).toHaveCount(3, { timeout: 30_000 });
    await expect.poll(() => tabs.allTextContents()).toEqual(originalTabs);
    await expect(page.getByRole('textbox', { name: 'Message input' }).first()).toContainText('Keep this draft through profile changes');
    await page.reload();
    await expect(tabs).toHaveCount(3, { timeout: 30_000 });
    await expect.poll(() => tabs.allTextContents()).toEqual(originalTabs);
    await expect(page.getByRole('textbox', { name: 'Message input' }).first()).toContainText('Keep this draft through profile changes');
});
