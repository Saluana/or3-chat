import { expect, test, type Page } from '@playwright/test';

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
        await expect(page.getByText('Partial response before failure.'))
            .toBeVisible();

        await page.reload();
        await expect(page.getByText('journey:error', { exact: true }).first())
            .toBeVisible();
        await expect(page.getByText('Recovered after retry.')).toBeVisible();
        await expect(page.getByText('Partial response before failure.'))
            .toBeVisible();
    });
});
