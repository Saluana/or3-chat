import { expect, test, type Page } from '@playwright/test';

test.skip(
    process.env.OR3_PRODUCTION_JOURNEY_TEST_HARNESS !== 'true',
    'Production journeys require OR3_PRODUCTION_JOURNEY_TEST_HARNESS=true'
);

const chatPage = '/__or3-chat-journey-test';

async function openChat(page: Page): Promise<void> {
    await page.goto(chatPage);
    await expect(page.getByTestId('production-chat-journey')).toBeVisible({
        timeout: 30_000,
    });
    await expect(page.getByRole('textbox', { name: 'Message input' }))
        .toBeVisible({ timeout: 30_000 });
    // Warm Nuxt's lazily compiled chat graph before exercising persisted state.
    await page.reload();
    await expect(page.getByTestId('production-chat-journey')).toBeVisible({
        timeout: 30_000,
    });
    await expect(page.getByRole('textbox', { name: 'Message input' }))
        .toBeVisible({ timeout: 30_000 });
}

async function send(page: Page, message: string): Promise<void> {
    const input = page.getByRole('textbox', { name: 'Message input' });
    await input.fill(message);
    await page.getByRole('button', { name: 'Send message' }).click();
    await expect(page.getByText(message, { exact: true })).toBeVisible();
}

test.describe('production chat journey', () => {
    for (const theme of ['blank', 'retro', 'cyberpunk']) {
        test(`${theme} responsive messages preserve rich content and touch editing`, async ({ browser }, info) => {
            const context = await browser.newContext({
                viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
            });
            const page = await context.newPage();
            try {
                await context.addCookies([
                    { name: 'or3_active_theme', value: theme, domain: '127.0.0.1', path: '/' },
                ]);
                await page.addInitScript((theme) => localStorage.setItem('activeTheme', theme), theme);
                await openChat(page);
                await send(page, 'journey:responsive');
                await expect(page.getByText('End of layout sample.')).toBeVisible();
                await expect(page.getByRole('button', { name: 'Send message' })).toBeVisible();
                await page.mouse.move(0, 0);
                for (const button of await page.getByRole('button', {
                    name: /^(Copy message|Retry message|Branch conversation|Edit message)$/,
                }).all()) {
                    const bounds = await button.boundingBox();
                    expect(bounds!.x).toBeGreaterThanOrEqual(0);
                    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
                }
                const edit = page.getByRole('button', { name: 'Edit message' }).last();
                await expect(edit.locator('xpath=ancestor::*[contains(@class,"cm-action-group")]'))
                    .toHaveCSS('opacity', '1');
                await edit.click();
                const draft = page.locator('.cm-editor-assistant [contenteditable="true"]');
                await expect(draft).toBeVisible();
                await page.getByRole('button', { name: 'Cancel', exact: true }).click();
                for (const viewport of [{ width: 320, height: 568 }, { width: 844, height: 390 }, { width: 1920, height: 1080 }]) {
                    await page.setViewportSize(viewport);
                    expect(await page.evaluate(() => document.documentElement.scrollWidth))
                        .toBeLessThanOrEqual(viewport.width);
                    const markdown = page.locator('.cm-markdown-assistant');
                    await expect(markdown.locator('table')).toBeAttached();
                    await expect(markdown.locator('pre')).toBeAttached();
                    expect(await markdown.evaluate((element) => element.scrollWidth - element.clientWidth))
                        .toBeLessThanOrEqual(1);
                    const path = info.outputPath(`messages-${theme}-${viewport.width}x${viewport.height}.png`);
                    await page.screenshot({ path, animations: 'disabled' });
                    await info.attach('responsive-message', { path, contentType: 'image/png' });
                }
                await page.reload();
                await expect(page.getByText('End of layout sample.')).toBeVisible();
            } finally {
                await context.close();
            }
        });
    }

    test('can stop a continuation without losing the existing partial reply', async ({ page }) => {
        await openChat(page);
        await send(page, 'journey:stop');
        await expect(page.getByText('Partial response before stop.')).toBeVisible();
        await page.getByRole('button', { name: 'Stop generation' }).click();
        await expect(page.getByRole('button', { name: 'Send message' })).toBeVisible();
        await page.reload();
        await expect(page.getByText('Partial response before stop.')).toBeVisible();
        await page.getByRole('button', { name: 'Continue generation' }).click();
        await expect(page.getByRole('button', { name: 'Stop generation' })).toBeVisible();
        await page.getByRole('button', { name: 'Stop generation' }).click();
        await expect(page.getByRole('button', { name: 'Send message' })).toBeVisible();
        await page.reload();
        await expect(page.getByText('Partial response before stop.')).toBeVisible();
    });
    test('recovers a partial foreground response after refresh during streaming', async ({ page }) => {
        test.setTimeout(60_000);
        await openChat(page);
        await send(page, 'journey:refresh');
        await expect(page.getByText('Partial response before refresh. Ready to recover.')).toBeVisible();
        await page.reload();
        await expect(page.getByText('Partial response before refresh. Ready to recover.')).toBeVisible();
        await expect(page.getByRole('button', { name: 'Continue generation', exact: true }).last()).toBeVisible({ timeout: 35_000 });
        await expect(page.getByRole('button', { name: 'Send message' })).toBeVisible();
        await expect(page.getByText(/Late response from the old page/)).toHaveCount(0);
    });
    test('stops an admitted request before its outgoing filter resolves', async ({
        page,
    }) => {
        await openChat(page);
        const input = page.getByRole('textbox', { name: 'Message input' });
        await input.fill('journey:admission-stop');
        await page.getByRole('button', { name: 'Send message' }).click();
        await page.getByRole('button', { name: 'Stop generation' }).click();
        await expect(
            page.getByRole('button', { name: 'Send message' })
        ).toBeVisible();
        await expect(input).toHaveText('journey:admission-stop');
        await expect(
            page.getByText('Hello from deterministic stream.')
        ).toHaveCount(0);
    });

    test('retains the durable user turn and settles when filters remove model input', async ({
        page,
    }) => {
        await openChat(page);
        await send(page, 'journey:empty');
        await expect(
            page.getByRole('button', { name: 'Send message' })
        ).toBeVisible();
        await expect(
            page.getByRole('button', { name: 'Stop generation' })
        ).toHaveCount(0);
        await expect(
            page.getByText('Hello from deterministic stream.')
        ).toHaveCount(0);
        await page.reload();
        await expect(
            page.getByText('journey:empty', { exact: true })
        ).toBeVisible();
        await expect(
            page.getByRole('button', { name: 'Send message' })
        ).toBeVisible();
    });

    test('streams a response and restores its durable thread after reload', async ({
        page,
    }) => {
        await openChat(page);
        await send(page, 'journey:complete');

        await expect(
            page.getByRole('button', { name: 'Stop generation' })
        ).toBeVisible();
        await expect(page.getByText('Hello from deterministic stream.'))
            .toBeVisible();
        await expect(
            page.getByRole('button', { name: 'Send message' })
        ).toBeVisible();
        await expect(page.getByTestId('chat-journey-thread-id'))
            .not.toHaveText('new-thread');

        await page.reload();
        await expect(page.getByText('journey:complete', { exact: true }))
            .toBeVisible();
        await expect(page.getByText('Hello from deterministic stream.'))
            .toBeVisible();
    });

    test('stops an in-flight stream and persists only the accepted partial text', async ({
        page,
    }) => {
        await openChat(page);
        await send(page, 'journey:stop');

        await expect(page.getByText('Partial response before stop.'))
            .toBeVisible();
        await page.getByRole('button', { name: 'Stop generation' }).click();
        await expect(
            page.getByRole('button', { name: 'Send message' })
        ).toBeVisible();
        await page.waitForTimeout(1_400);
        await expect(page.getByText(/Late response that must be ignored/))
            .toHaveCount(0);

        await page.reload();
        await expect(page.getByText('Partial response before stop.'))
            .toBeVisible();
        await expect(page.getByText(/Late response that must be ignored/))
            .toHaveCount(0);
    });

    test('surfaces a stream error and retries the persisted user turn', async ({
        page,
    }) => {
        await openChat(page);
        await send(page, 'journey:error');

        await expect(page.getByText('Partial response before failure.'))
            .toBeVisible();
        const retry = page.getByRole('button', { name: 'Retry' }).last();
        await expect(retry).toBeVisible();
        await retry.click();

        await expect(page.getByText('Recovered after retry.')).toBeVisible();
        // Accepted retries supersede the selected turn; reload must not
        // resurrect the failed partial reply or duplicate its user prompt.
        await expect(page.getByText('Partial response before failure.'))
            .toHaveCount(0);
        await expect(page.getByText('journey:error', { exact: true })).toHaveCount(1);

        await page.reload();
        await expect(page.getByText('journey:error', { exact: true })).toHaveCount(1);
        await expect(page.getByText('Recovered after retry.')).toBeVisible();
        await expect(page.getByText('Partial response before failure.'))
            .toHaveCount(0);
    });
});
