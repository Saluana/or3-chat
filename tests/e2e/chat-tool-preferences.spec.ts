import { expect, test, type Locator, type Page, type Route } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { sseFrame } from './fixtures/chat-tool-script';

test.setTimeout(90_000);

async function setSwitch(toggle: Locator, checked: boolean) {
    if (await toggle.isChecked() !== checked) await toggle.click();
    await expect(toggle).toBeChecked({ checked });
}

async function settings(page: Page) {
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await expect(page.getByRole('switch', { name: 'Enable tools for this chat', exact: true })).toBeVisible();
}

test('chat tool suspension preserves selections, defaults and draft ownership across reloads', async ({ page }, info) => {
    const requests: { tools?: { function: { name: string } }[] }[] = [];
    const handleProvider = async (route: Route) => {
        if (route.request().url().includes('/chat/completions')) {
            requests.push(route.request().postDataJSON());
            await route.fulfill({ contentType: 'text/event-stream', body:
                sseFrame({ content: `Preference response ${requests.length}` }, 'stop') + 'data: [DONE]\n\n' });
        } else await route.fulfill({ json: { data: [], links: { next: null }, total_count: 0 } });
    };
    await page.route(/https?:\/\/(?!127\.0\.0\.1|localhost)/, handleProvider);
    await page.route('**/api/__or3-e2e/**', handleProvider);
    await page.route('**/api/openrouter/title', route => route.fulfill({ json: { title: 'Tool Preferences Journey' } }));
    await page.goto('/__or3-chat-tools-test?scenario=preferences');
    await expect(page.getByRole('textbox', { name: 'Message input' })).toBeVisible({ timeout: 60_000 });
    const master = page.getByRole('switch', { name: 'Enable tools for this chat', exact: true });
    async function send(text: string) {
        const response = requests.length + 1;
        await page.getByRole('textbox', { name: 'Message input' }).fill(text);
        await page.getByRole('button', { name: 'Send message', exact: true }).click();
        await expect(page.getByText(`Preference response ${response}`, { exact: true })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Send message', exact: true })).toBeVisible();
    }
    await settings(page);
    await expect(master).not.toBeChecked();
    await page.getByRole('button', { name: 'Close chat settings' }).click();
    await send('Tools start off');
    expect(requests.at(-1)?.tools ?? []).toEqual([]);

    await settings(page);
    await expect(master).toBeEnabled();
    const toggleBounds = (await master.boundingBox())!;
    const chevronBounds = (await page.getByRole('button', { name: 'Tools', exact: true })
        .locator('.chat-settings-option-chevron').boundingBox())!;
    const gap = chevronBounds.x - (toggleBounds.x + toggleBounds.width);
    expect(gap).toBeGreaterThanOrEqual(8);
    expect(gap).toBeLessThanOrEqual(12);
    // Tap just outside the visible track, inside its larger hit area.
    await page.mouse.click(toggleBounds.x - 4, toggleBounds.y + toggleBounds.height / 2);
    await expect(master).toBeChecked();
    await expect(page.getByRole('heading', { name: 'Chat settings', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Close chat settings' }).click();
    await page.getByRole('button', { name: 'Fail next tool save', exact: true }).click();
    await settings(page);
    await master.click();
    await expect(page.getByRole('alert').filter({ hasText: 'Could not save tool settings' })).toBeVisible();
    await expect(master).toBeChecked();
    await page.getByRole('button', { name: 'Tools', exact: true }).click();
    await page.getByRole('button', { name: /Other tools/ }).click();
    const categoryToggle = page.locator('#chat-tools-all');
    await expect(categoryToggle).toBeChecked();
    await setSwitch(categoryToggle, false);
    await expect(page.getByRole('switch', { name: 'Enable test_fail', exact: true })).not.toBeChecked();
    await setSwitch(categoryToggle, true);
    await setSwitch(page.getByRole('switch', { name: 'Enable test_echo', exact: true }), false);
    await expect(categoryToggle).not.toBeChecked();
    await page.getByRole('button', { name: 'Back to tools' }).click();
    await page.getByRole('button', { name: 'Back to chat settings' }).click();
    await setSwitch(master, false);
    await page.getByRole('button', { name: 'Close chat settings' }).click();
    await send('Suspended tools');
    expect(requests.at(-1)?.tools ?? []).toEqual([]);

    await page.reload();
    await expect(page.getByRole('textbox', { name: 'Message input' })).toBeVisible();
    await settings(page);
    await expect(master).not.toBeChecked();
    await setSwitch(master, true);
    await page.getByRole('button', { name: 'Close chat settings' }).click();
    await send('Restored tools');
    const names = requests.at(-1)!.tools!.map(tool => tool.function.name);
    expect(names).toContain('test_fail');
    expect(names).not.toContain('test_echo');

    await page.getByRole('button', { name: 'Switch conversation', exact: true }).click();
    await settings(page);
    await expect(master).not.toBeChecked();
    await page.getByRole('button', { name: 'Close chat settings' }).click();
    await page.getByRole('button', { name: 'AI defaults', exact: true }).click();
    const defaultToggle = page.getByRole('switch', { name: 'Enable all tools by default', exact: true });
    await expect(defaultToggle).not.toBeChecked();
    await setSwitch(defaultToggle, true);
    await expect(page.locator('#ai-tools-status')).toContainText('Saved');
    await page.reload();
    await page.getByRole('button', { name: 'AI defaults', exact: true }).click();
    await expect(defaultToggle).toBeChecked();
    await page.getByRole('button', { name: 'AI defaults', exact: true }).click();

    await settings(page);
    await expect(master).toBeChecked();
    await page.getByRole('button', { name: 'Tools', exact: true }).click();
    await page.getByRole('button', { name: /Other tools/ }).click();
    await expect(page.getByRole('switch', { name: 'Enable test_echo', exact: true })).not.toBeChecked();
    await page.getByRole('button', { name: 'Close chat settings' }).click();
    // Reopening during the exit animation would reuse the closing instance.
    await expect(page.getByRole('dialog', { name: 'Settings' })).toBeHidden();

    await page.getByRole('button', { name: 'New draft', exact: true }).click();
    await settings(page);
    await expect(master).toBeChecked();
    await setSwitch(master, false);
    await page.getByRole('button', { name: 'Close chat settings' }).click();
    await send('Draft keeps tools off');
    expect(requests.at(-1)?.tools ?? []).toEqual([]);
    await settings(page);
    await expect(master).not.toBeChecked();
    await expect(master).toBeEnabled();
    await page.screenshot({ path: info.outputPath('tool-preferences.png'), animations: 'disabled' });
    const receipt = info.outputPath('provider-requests.json');
    await writeFile(receipt, JSON.stringify(requests, null, 2) + '\n');
    await info.attach('provider-requests', { contentType: 'application/json', path: receipt });
});

test('mobile chat settings keep one sheet height through library and tools navigation', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 520 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.route(/https?:\/\/(?!127\.0\.0\.1|localhost)/, route =>
        route.fulfill({ json: { data: [], links: { next: null }, total_count: 0 } }),
    );
    await page.goto('/__or3-chat-tools-test?scenario=preferences');
    await expect(page.getByRole('textbox', { name: 'Message input' })).toBeVisible({ timeout: 60_000 });
    await settings(page);

    const sheet = page.getByRole('dialog', { name: 'Chat settings', exact: true });
    await expect(sheet).toBeVisible();
    const sheetHeight = () => sheet.evaluate(element => element.offsetHeight);
    const initialHeight = await sheetHeight();

    // Scroll to the lower actions without moving the sheet or its close button.
    const close = sheet.getByRole('button', { name: 'Close chat settings' });
    const lowerAction = sheet.getByRole('button', { name: /^System prompts/ });
    await lowerAction.scrollIntoViewIfNeeded();
    await expect(lowerAction).toBeInViewport({ ratio: 1 });
    await expect(close).toBeInViewport({ ratio: 1 });

    await lowerAction.click();
    const promptSearch = sheet.getByRole('textbox', { name: 'Search system prompts' });
    const promptAction = sheet.getByRole('button', { name: /^(Using|Switch to) / });
    await expect(promptAction).toBeVisible();
    expect(await sheetHeight()).toBe(initialHeight);
    await promptSearch.fill('unmatched test prompt 81759');
    await expect(sheet.getByText('No prompts match.')).toBeVisible();
    await expect(promptAction).toHaveCount(0);
    expect(await sheetHeight()).toBe(initialHeight);
    await promptSearch.clear();
    await expect(promptAction).toBeVisible();
    expect(await sheetHeight()).toBe(initialHeight);
    await sheet.getByRole('button', { name: 'Back to chat settings' }).click();

    await sheet.getByRole('button', { name: /^Model catalog/ }).click();
    await expect(sheet.getByRole('textbox', { name: 'Search models' })).toBeVisible();
    expect(await sheetHeight()).toBe(initialHeight);
    await sheet.getByRole('button', { name: 'Back to chat settings' }).click();

    await sheet.getByRole('button', { name: 'Tools', exact: true }).click();
    await expect(sheet.getByRole('heading', { name: 'Tools', exact: true })).toBeVisible();
    expect.soft(await sheetHeight(), 'Tools list should not resize the sheet').toBe(initialHeight);

    await sheet.getByRole('button', { name: /Other tools/ }).click();
    await expect(sheet.getByRole('heading', { name: 'Other tools', exact: true })).toBeVisible();
    expect.soft(await sheetHeight(), 'Tool category should not resize the sheet').toBe(initialHeight);

    await sheet.getByRole('button', { name: 'Back to tools' }).click();
    await sheet.getByRole('button', { name: 'Back to chat settings' }).click();
    await expect(sheet.getByRole('switch', { name: 'Enable tools for this chat', exact: true })).toBeVisible();
    expect(await sheetHeight()).toBe(initialHeight);
    await close.click();
    await expect(sheet).toBeHidden();
});
