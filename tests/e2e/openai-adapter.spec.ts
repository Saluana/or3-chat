import { expect, test, type Page } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

type Captured = { path: string; credential: string; model?: unknown; keys: string[]; messageKeys: string[];
    reasoningEffort?: unknown; maxCompletionTokens?: unknown; includeUsage?: unknown; tools: string[] };

test.skip(process.env.OR3_OPENAI_E2E !== 'true', 'Run through scripts/test/run-openai-adapter-e2e.ts.');

async function openAiSettings(page: Page) {
    await page.goto('/chat?dashboard=core:settings&page=ai-settings');
    await expect(page.getByRole('heading', { name: 'OpenAI', exact: true })).toBeVisible({ timeout: 45_000 });
}

async function chooseModel(page: Page, name: string) {
    await page.getByRole('button', { name: 'Settings', exact: true }).last().click();
    await page.getByRole('button', { name: 'Current model' }).click();
    await page.getByText(name, { exact: true }).click();
    await page.getByRole('button', { name: 'Use model' }).click();
}

async function send(page: Page, text: string) {
    const input = page.getByRole('textbox', { name: 'Message input' });
    await input.click();
    await input.fill(text);
    await input.press('Enter');
}

test('a personal OpenAI key chats directly while OpenRouter keeps working', async ({ page }, info) => {
    test.setTimeout(240_000);
    const origin = new URL(info.project.use.baseURL!).origin;
    const fixture = process.env.OR3_OPENAI_E2E_FIXTURE_URL!;
    const captured = async () => ((await (await page.request.get(`${fixture}/__capture`)).json()) as { requests: Captured[] }).requests;
    const key = `sk-e2e-${crypto.randomUUID().replaceAll('-', '')}`;
    expect((await page.request.post(`${fixture}/__key`, { data: key })).ok()).toBe(true);
    expect((await page.request.post('/api/basic-auth/sign-in', { headers: { origin }, data: {
        email: process.env.OR3_OPENAI_E2E_EMAIL, password: process.env.OR3_OPENAI_E2E_PASSWORD,
    } })).ok()).toBe(true);

    // The key goes to the account vault; the browser never reads it back.
    await openAiSettings(page);
    await expect(page.getByText('No OpenAI key saved.')).toBeVisible();
    await page.getByLabel('OpenAI API key').fill(key);
    await page.getByRole('button', { name: 'Save key' }).click();
    await expect(page.getByText('Your OpenAI key is saved.')).toBeVisible();
    // New chats start with every tool on, so router-bound tools are visible in the requests.
    await page.getByRole('switch', { name: 'Enable all tools by default' }).click();
    await expect(page.getByRole('switch', { name: 'Enable all tools by default' })).toHaveAttribute('aria-checked', 'true');
    const status = await page.request.post('/api/openai/credentials', { headers: { origin, 'x-or3-cloud-intent': 'mutation',
        'x-or3-account': JSON.stringify(await page.evaluate(async () => {
            const session = (await (await fetch('/api/auth/session')).json()).session;
            return [session.provider, session.user.id];
        })) }, data: { operation: 'status' } });
    expect(JSON.stringify(await status.json())).not.toContain(key);

    // One fast model serves titles, autocomplete and memory; OpenAI IDs take no routing variant.
    // Saving it is a deployment-admin action, checked against the OpenAI catalog with the saved key.
    expect((await page.request.post('/api/admin/auth/login', { headers: { origin, 'x-or3-admin-intent': 'admin' },
        data: { username: 'openai-adapter-admin', password: process.env.OR3_OPENAI_E2E_ADMIN_PASSWORD } })).ok()).toBe(true);
    await openAiSettings(page);
    await page.getByRole('button', { name: 'Fast Model', exact: true }).click();
    await page.getByText('gpt-e2e-mini (OpenAI key)', { exact: true }).click();
    await expect(page.getByText('@openai/gpt-e2e-mini', { exact: true })).toBeVisible();
    await expect(page.getByRole('combobox', { name: 'Fast model routing' })).toHaveCount(0);
    expect(await (await page.request.get('/api/openrouter/title-model')).json()).toEqual({ model: '@openai/gpt-e2e-mini' });

    await page.goto('/chat');
    await chooseModel(page, 'gpt-e2e-mini (OpenAI key)');
    await send(page, 'openai:hello');
    await expect(page.getByText('OpenAI fixture reply')).toBeVisible({ timeout: 45_000 });
    const openAi = (await captured()).filter(request => request.path === '/v1/chat/completions' && request.includeUsage === true).at(-1);
    expect(openAi).toMatchObject({ credential: 'personal-openai', model: 'gpt-e2e-mini', includeUsage: true });
    expect(typeof openAi!.maxCompletionTokens).toBe('number');
    for (const field of ['max_tokens', 'reasoning', 'modalities', 'provider', 'plugins', 'usage', '_context', '_threadId'])
        expect(openAi!.keys).not.toContain(field);
    expect(openAi!.messageKeys.every(field => ['role', 'content', 'name', 'tool_calls', 'tool_call_id'].includes(field))).toBe(true);
    // Delegation and model search use OpenRouter credentials, so an OpenAI chat never offers them.
    expect(openAi!.tools.length).toBeGreaterThan(0);
    expect(openAi!.tools).not.toContain('delegate_chat');
    expect(openAi!.tools).not.toContain('search_models');
    // The new chat is named by the OpenAI fast model.
    await expect(page.getByText('Fixture title').first()).toBeVisible({ timeout: 30_000 });
    const title = (await captured()).find(request => request.path === '/v1/chat/completions' && request.includeUsage === undefined);
    expect(title).toMatchObject({ credential: 'personal-openai', model: 'gpt-e2e-mini' });
    expect(title!.keys).not.toContain('stream_options');

    // Saved project memories are classified by OpenAI's Decisions API with the same key.
    const workspaceId = await page.evaluate(async () => (await (await fetch('/api/auth/session')).json()).session.workspace.id as string);
    const classified = await page.request.post('/api/openrouter/classify-memory', { headers: { origin, 'x-or3-cloud-intent': 'mutation' },
        data: { workspaceId, state: { memory: 'We agreed to use SQLite for the project database.', messages: [] } } });
    expect(await classified.json()).toMatchObject({ kind: 'decision', model: 'gpt-6-luna' });
    expect((await captured()).filter(request => request.path === '/v1/decisions').at(-1)).toMatchObject({ credential: 'personal-openai', model: 'gpt-6-luna' });

    // The same chat continues on OpenRouter with the instance key.
    await chooseModel(page, 'Fixture Router');
    await send(page, 'openrouter:hello');
    await expect(page.getByText('OpenRouter fixture reply')).toBeVisible({ timeout: 45_000 });
    const openRouter = (await captured()).filter(request => request.path === '/api/v1/chat/completions').at(-1);
    expect(openRouter).toMatchObject({ credential: 'instance-openrouter', model: 'fixture/router' });
    await page.screenshot({ path: resolve(process.env.OR3_OPENAI_E2E_OUTPUT!, 'openai-and-openrouter-chat.png') });

    // Without a personal or instance OpenAI key, the server refuses OpenAI models.
    await openAiSettings(page);
    await page.getByRole('button', { name: 'Remove key' }).click();
    await expect(page.getByText('No OpenAI key saved.')).toBeVisible();
    const refused = await page.request.post('/api/openrouter/stream', { headers: { origin, 'x-or3-cloud-intent': 'mutation' },
        data: { model: '@openai/gpt-e2e-mini', messages: [{ role: 'user', content: 'no key' }], stream: true } });
    expect(refused.status()).toBe(400);
    const refusal = (await refused.json() as { error?: { code?: string } }).error;
    expect(refusal?.code).toBe('ERR_AUTH');
    const models = await page.request.post('/api/openai/models', { headers: { origin, 'x-or3-cloud-intent': 'mutation' }, data: {} });
    expect(await models.json()).toEqual([]);

    const receipt = { openAi, title, memoryKind: (await classified.json() as { kind?: string }).kind, openRouter, refusedStatus: refused.status(), refusalCode: refusal?.code,
        upstreamRequests: (await captured()).length };
    await writeFile(resolve(process.env.OR3_OPENAI_E2E_OUTPUT!, 'receipt.json'), JSON.stringify(receipt, null, 2));
    await info.attach('openai-adapter-receipt', { contentType: 'application/json', body: JSON.stringify(receipt) });
});
