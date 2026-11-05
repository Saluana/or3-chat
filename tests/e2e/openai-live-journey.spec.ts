import { expect, test, type Page } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

test.skip(process.env.OR3_OPENAI_LIVE_E2E !== 'true', 'Run with the opt-in OpenAI live journey harness.');

async function send(page: Page, text: string) {
    const input = page.getByRole('textbox', { name: 'Message input' });
    await input.fill(text);
    await input.press('Enter');
}

test('real OpenAI conversation, retry, tab navigation and document persistence', async ({ page }, info) => {
    test.setTimeout(240_000);
    const background = process.env.OR3_OPENAI_E2E_BACKGROUND !== 'false';
    const browserProblems: string[] = [];
    const requests: Array<{ background: boolean; model: unknown; roles: string[] }> = [];
    page.on('pageerror', error => browserProblems.push(`pageerror: ${error.message}`));
    page.on('console', message => { if (message.type() === 'warning' || message.type() === 'error') browserProblems.push(`${message.type()}: ${message.text()}`); });
    page.on('request', request => {
        if (request.method() !== 'POST' || !request.url().endsWith('/api/openrouter/stream')) return;
        const body = request.postDataJSON() as { model?: unknown; _background?: boolean; messages?: Array<{ role: string }> };
        requests.push({ model: body.model, background: body._background === true, roles: (body.messages ?? []).map(message => message.role) });
    });
    const origin = new URL(info.project.use.baseURL!).origin;
    expect((await page.request.post('/api/basic-auth/sign-in', { headers: { origin }, data: {
        email: process.env.OR3_OPENAI_E2E_EMAIL, password: process.env.OR3_OPENAI_E2E_PASSWORD,
    } })).ok()).toBe(true);
    await page.goto('/chat');
    await expect(page.getByRole('textbox', { name: 'Message input' })).toBeVisible({ timeout: 45_000 });
    const catalog = await page.request.post('/api/openai/models', { headers: { origin, 'x-or3-cloud-intent': 'mutation' }, data: {} });
    expect(catalog.status()).toBe(200);
    expect((await catalog.json() as Array<{ id: string }>).some(model => model.id === '@openai/gpt-5.4-mini')).toBe(true);
    await page.getByRole('button', { name: 'Settings', exact: true }).last().click();
    await page.getByRole('button', { name: 'Current model' }).click();
    await page.getByText('gpt-5.4-mini (OpenAI key)', { exact: true }).click({ timeout: 45_000 });
    await page.getByRole('button', { name: 'Use model' }).click();

    await send(page, 'Reply with the single word COBALT and nothing else.');
    const first = page.locator('.chat-message-container.cm-assistant').last();
    await expect(first).toContainText(/COBALT/i, { timeout: 60_000 });
    await expect(first.getByRole('button', { name: 'Retry message' })).toBeEnabled({ timeout: 60_000 });
    await send(page, 'What was the single word you just answered? Reply with that word only.');
    await expect(page.locator('.chat-message-container.cm-assistant')).toHaveCount(2, { timeout: 60_000 });
    const second = page.locator('.chat-message-container.cm-assistant').last();
    await expect(second).toContainText(/COBALT/i, { timeout: 60_000 });
    await expect(second.getByRole('button', { name: 'Retry message' })).toBeEnabled({ timeout: 60_000 });
    expect(requests[1]?.roles.filter(role => role !== 'system').slice(-3)).toEqual(['user', 'assistant', 'user']);
    const beforeRetry = requests.length;
    await second.hover();
    await second.getByRole('button', { name: 'Retry message' }).click();
    await expect.poll(() => requests.length, { timeout: 60_000 }).toBeGreaterThan(beforeRetry);
    await expect(second).toContainText(/COBALT/i, { timeout: 60_000 });
    await expect(second.getByRole('button', { name: 'Retry message' })).toBeEnabled({ timeout: 60_000 });

    if (background) {
        const originalTabId = await page.getByRole('tab', { selected: true }).getAttribute('id');
        const admission = page.waitForRequest(request => request.url().endsWith('/api/openrouter/stream') && request.method() === 'POST'
            && request.postDataJSON()?._background === true, { timeout: 30_000 });
        await send(page, 'Write a numbered list of twenty short sentences about the color cobalt.');
        await admission;
        await expect(page.getByRole('button', { name: 'Stop generation', exact: true })).toBeVisible({ timeout: 30_000 });
        await page.locator('.workspace-tab-new').click();
        await expect(page.getByRole('tab', { selected: true })).not.toHaveAttribute('id', originalTabId!);
        await page.locator(`[id="${originalTabId}"]`).click();
        const answer = page.locator('.chat-message-container.cm-assistant').last();
        await expect(answer.getByRole('button', { name: 'Retry message' })).toBeEnabled({ timeout: 90_000 });
        await expect(answer).toContainText(/cobalt/i);
    }

    const answer = page.locator('.chat-message-container.cm-assistant').last();
    const answerText = (await answer.innerText()).trim();
    await answer.hover();
    await answer.getByRole('button', { name: 'Create document' }).click();
    await expect(page.getByRole('textbox', { name: 'Document body' })).toContainText(/cobalt/i, { timeout: 30_000 });
    await page.reload();
    await expect(page.getByRole('textbox', { name: 'Document body' })).toContainText(/cobalt/i, { timeout: 30_000 });
    expect(requests.length).toBeGreaterThanOrEqual(background ? 4 : 3);
    expect(requests.every(request => request.model === '@openai/gpt-5.4-mini' && request.background === background)).toBe(true);
    const receipt = { background, requests, answerText, browserProblems };
    await page.screenshot({ path: resolve(process.env.OR3_OPENAI_E2E_OUTPUT!, `live-document-${background ? 'background' : 'foreground'}.png`) });
    await writeFile(resolve(process.env.OR3_OPENAI_E2E_OUTPUT!, 'live-receipt.json'), JSON.stringify(receipt, null, 2));
    await info.attach('openai-live-journey', { contentType: 'application/json', body: JSON.stringify(receipt) });
    expect(browserProblems).toEqual([]);
});
