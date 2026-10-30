import { readFileSync } from 'node:fs';
import { parse } from 'dotenv';
import { expect, test, type Route } from '@playwright/test';

// An isolated browser context, no screenshots or traces, and a strict request
// allowlist prevent the disposable key from appearing in retained artifacts.
test.use({ screenshot: 'off', trace: 'off', video: 'off' });
test.setTimeout(180_000);

test('delegates to a chosen model, opens its live chat, and resumes the parent', async ({ page }) => {
    const envPath = process.env.OR3_LIVE_ENV_PATH;
    if (!envPath) throw new Error('OR3_LIVE_ENV_PATH is required.');
    const key = parse(readFileSync(envPath)).OPENROUTER_API_KEY;
    if (!key) throw new Error('OPENROUTER_API_KEY is missing from the environment file.');
    const calls: { model: string; reasoning: unknown; toolNames: string[] }[] = [];
    const allowedModels = new Set(['~openai/gpt-luna-latest', 'openai/gpt-6-luna',
        'deepseek/deepseek-v4.1-flash', 'deepseek/deepseek-v4.1-flash:nitro']);
    let releaseChild!: () => void;
    const holdChild = new Promise<void>(resolve => { releaseChild = resolve; });
    const guardRequest = async (route: Route) => {
        if (route.request().method() !== 'POST') { await route.continue(); return; }
        const body = route.request().postDataJSON() as Record<string, any>;
        const model = String(body.model || '');
        if (!allowedModels.has(model) || calls.length >= 8 || JSON.stringify(body).length > 100_000) {
            await route.abort('blockedbyclient');
            return;
        }
        calls.push({ model, reasoning: body.reasoning, toolNames: Array.isArray(body.tools)
            ? body.tools.map((tool: any) => String(tool.function?.name || '')) : [] });
        // Cap paid output and hold the child briefly so the live pane can be
        // inspected before allowing its real OpenRouter request to proceed.
        body.max_tokens = Math.min(Number(body.max_tokens) || 1024, 1024);
        if (model === 'deepseek/deepseek-v4.1-flash' && JSON.stringify(body.messages).includes('CALM HERON'))
            await holdChild;
        await route.continue({ postData: JSON.stringify(body) });
    };
    await page.route('**/api/v1/chat/completions', guardRequest);
    await page.route('**/api/openrouter/stream', guardRequest);
    await page.goto('/');
    await page.getByRole('button', { name: 'Use an existing API key' }).click();
    await page.getByRole('textbox', { name: 'OpenRouter API key' }).fill(key)
        .catch(() => { throw new Error('Could not enter the OpenRouter key.'); });
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByRole('textbox', { name: 'OpenRouter API key' })).toHaveCount(0);
    const input = page.getByRole('textbox', { name: 'Message input' });
    await input.fill('Use the delegate_chat tool to create a new chat using model deepseek/deepseek-v4.1-flash with low reasoning. Ask it to reply exactly CALM HERON. Wait for it, then report its answer.');
    await page.getByRole('button', { name: 'Send message', exact: true }).click();
    try {
        const openChild = page.getByRole('button', { name: /Open .* chat in a new pane/ }).filter({ hasText: 'working for' }).first();
        await expect(openChild).toBeVisible({ timeout: 100_000 });
        await expect(openChild).toContainText(/working for \d+(?:s|m|h)/);
        await openChild.click();
        await expect(page.getByRole('textbox', { name: 'Message input' })).toHaveCount(2);
        await expect.poll(() => calls.some(call => call.model === 'deepseek/deepseek-v4.1-flash')).toBe(true);
        await expect(page.getByRole('button', { name: 'Stop generation', exact: true }).first()).toBeVisible();
        releaseChild();
        await expect(page.getByRole('button', { name: /Open .* chat in a new pane/ }).filter({ hasText: 'worked for' }).first())
            .toBeVisible({ timeout: 100_000 });
        const panels = page.getByRole('tabpanel');
        await expect(panels.first().locator('[data-msg-id]').filter({ hasText: 'CALM HERON' }).last()).toBeVisible({ timeout: 100_000 });
        await expect(panels.last().locator('[data-msg-id]').filter({ hasText: 'CALM HERON' }).last()).toBeVisible({ timeout: 100_000 });
        await expect(page.getByRole('button', { name: 'Stop generation', exact: true })).toHaveCount(0, { timeout: 100_000 });
        // Keep the child pane mounted while the parent delegates a follow-up
        // with a different model. Its composer must adopt that same selection.
        const childId = await page.evaluate(async () => {
            const db = await new Promise<IDBDatabase>((resolve, reject) => {
                const request = indexedDB.open('or3-db');
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error);
            });
            try {
                const threads = await new Promise<{ id: string }[]>((resolve, reject) => {
                    const request = db.transaction('threads').objectStore('threads').getAll();
                    request.onsuccess = () => resolve(request.result);
                    request.onerror = () => reject(request.error);
                });
                return threads.find(thread => thread.id.startsWith('delegated-'))?.id;
            } finally { db.close(); }
        });
        expect(childId).toBeTruthy();
        await page.setViewportSize({ width: 790, height: 900 });
        await panels.last().getByRole('button', { name: 'Settings', exact: true }).click();
        await expect(page.getByLabel('Current model')).toContainText(/DeepSeek.*V4\.1.*Flash|deepseek-v4\.1-flash/i);
        await page.keyboard.press('Escape');
        await panels.first().getByRole('textbox', { name: 'Message input' }).fill(
            `Use delegate_chat to continue thread ${childId} with model openai/gpt-6-luna and low reasoning. Ask it to reply exactly BRIGHT RIVER. Wait for it and report its answer.`,
        );
        await panels.first().getByRole('button', { name: 'Send message', exact: true }).click();
        await expect(panels.last().locator('[data-msg-id]').filter({ hasText: 'BRIGHT RIVER' }).last()).toBeVisible({ timeout: 100_000 });
        await expect(page.getByRole('button', { name: 'Stop generation', exact: true })).toHaveCount(0, { timeout: 100_000 });
        await expect(panels.last().locator('[data-msg-id]')).toHaveCount(4);
        await panels.last().getByRole('button', { name: 'Settings', exact: true }).click();
        await expect(page.getByLabel('Current model')).toContainText(/GPT.?6.*Luna|gpt-6-luna/i);
        expect(calls.some(call => call.model === 'openai/gpt-6-luna')).toBe(true);
        const child = calls.find(call => call.model === 'deepseek/deepseek-v4.1-flash');
        expect(child).toBeDefined();
        expect(child?.reasoning).toMatchObject({ effort: 'low' });
        expect(child?.toolNames).not.toContain('delegate_chat');
        expect(calls.some(call => call.toolNames.includes('delegate_chat'))).toBe(true);
        console.log(`Live OpenRouter requests: ${calls.length}; models: ${[...new Set(calls.map(call => call.model))].join(', ')}`);
    } finally { releaseChild(); }
});
