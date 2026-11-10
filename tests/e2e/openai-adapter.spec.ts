import { expect, test, type Page } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import Database from 'better-sqlite3';

type Captured = { path: string; credential: string; model?: unknown; stream?: unknown; keys: string[]; messageKeys: string[];
    reasoningEffort?: unknown; maxCompletionTokens?: unknown; includeUsage?: unknown; tools: string[]; roles?: string[]; inputKinds?: string[]; inputFiles?: { filename: string; hasData: boolean }[] };

test.skip(process.env.OR3_OPENAI_E2E !== 'true', 'Run through scripts/test/run-openai-adapter-e2e.ts.');

// Each AI setting opens from its row on the AI Settings list.
async function openAiSettings(page: Page, view: 'openai' | 'fast') {
    await page.goto('/chat?dashboard=core:settings&page=ai-settings');
    const row = page.locator(`#dashboard-ai-${view}-row`);
    await expect(row).toBeVisible({ timeout: 45_000 });
    await row.click();
}

async function chooseModel(page: Page, name: string) {
    await page.getByRole('button', { name: 'Settings', exact: true }).last().click();
    await page.getByRole('button', { name: 'Current model' }).click();
    const catalog = page.getByRole('dialog', { name: 'Model catalog', exact: true });
    await catalog.getByRole('listitem').filter({ hasText: name.replace(' (OpenAI key)', '') }).getByRole('button', { name: 'Use model', exact: true }).click();
}

async function send(page: Page, text: string, diagnose = false) {
    await expect(page.getByRole('button', { name: 'Stop generation', exact: true })).toHaveCount(0, { timeout: 45_000 });
    const input = page.getByRole('textbox', { name: 'Message input' });
    await input.click();
    await input.fill(text);
    await expect(page.getByRole('button', { name: 'Send message', exact: true })).toBeEnabled({ timeout: 45_000 });
    // Only the refusal turn needs this failure evidence. Keep it bounded and
    // record state and request categories, never editor content or credentials.
    const network: Array<{ event: string; category: string; elapsedMs: number; status?: number }> = [];
    const started = Date.now();
    const category = (url: string) => {
        const path = new URL(url).pathname;
        if (path === '/api/openrouter/stream') return 'chat-admission';
        if (/^\/api\/jobs\/[^/]+(?:\/stream)?$/.test(path)) return 'job';
        return null;
    };
    const onRequest = (request: import('@playwright/test').Request) => {
        const kind = category(request.url());
        if (kind && network.length < 100) network.push({ event: 'request', category: kind, elapsedMs: Date.now() - started });
    };
    const onResponse = (response: import('@playwright/test').Response) => {
        const kind = category(response.url());
        if (kind && network.length < 100) network.push({ event: 'response', category: kind, elapsedMs: Date.now() - started, status: response.status() });
    };
    const probe = diagnose ? await input.evaluateHandle((editor) => {
        const events: Array<Record<string, boolean | number | string>> = [];
        const start = performance.now();
        const snapshot = (event: string, key?: KeyboardEvent) => {
            if (events.length >= 100) return;
            const send = document.querySelector<HTMLButtonElement>('button[aria-label="Send message"]');
            events.push({ event, elapsedMs: Math.round(performance.now() - start),
                connected: editor.isConnected, focused: editor.contains(document.activeElement),
                hasContent: Boolean(editor.textContent?.trim()), sendPresent: Boolean(send),
                sendDisabled: send?.disabled ?? false,
                stopPresent: Boolean(document.querySelector('button[aria-label="Stop generation"]')),
                ...(key ? { defaultPrevented: key.defaultPrevented, targetInsideEditor: editor.contains(key.target as Node),
                    composing: key.isComposing, shift: key.shiftKey, trusted: key.isTrusted } : {}) });
        };
        const onKey = (event: KeyboardEvent) => {
            if (event.key !== 'Enter') return;
            snapshot(event.type, event);
            if (event.type === 'keydown') setTimeout(() => snapshot('keydown-after-dispatch', event), 0);
        };
        document.addEventListener('keydown', onKey, true);
        document.addEventListener('keyup', onKey, true);
        snapshot('ready');
        const timers = [100, 1000].map(delay => setTimeout(() => snapshot(`after-${delay}ms`), delay));
        return { finish() {
            snapshot('finish');
            for (const timer of timers) clearTimeout(timer);
            document.removeEventListener('keydown', onKey, true);
            document.removeEventListener('keyup', onKey, true);
            return events;
        } };
    }).catch(() => null) : null;
    if (probe) { page.on('request', onRequest); page.on('response', onResponse); }
    let failed = false;
    try {
        await input.press('Enter');
        await expect(input).not.toContainText(text, { timeout: 45_000 });
    } catch (error) {
        failed = true;
        throw error;
    } finally {
        if (diagnose) {
            page.off('request', onRequest); page.off('response', onResponse);
            // A diagnostic failure must never replace the original assertion.
            const events = probe ? await probe.evaluate(value => value.finish()).catch(() => null) : null;
            await probe?.dispose().catch(() => {});
            if (failed) {
                const path = test.info().outputPath('refusal-send-boundary.json');
                await writeFile(path, JSON.stringify({ events, network }, null, 2))
                    .then(() => test.info().attach('refusal-send-boundary', { path, contentType: 'application/json' }))
                    .catch(() => {});
            }
        }
    }
}

test('a personal OpenAI key chats directly while OpenRouter keeps working', async ({ page }, info) => {
    test.setTimeout(240_000);
    const browserProblems: string[] = [];
    const intentionalOfflineProblems: string[] = [];
    let intentionallyOffline = false;
    const jobStreams: Array<{ status: number; contentType: string; frames?: string }> = [];
    page.on('pageerror', error => browserProblems.push(`pageerror: ${error.message}`));
    page.on('console', message => {
        if (message.type() !== 'error' && message.type() !== 'warning') return;
        const problem = `${message.type()}: ${message.text()}`;
        if (intentionallyOffline && message.text().includes('net::ERR_INTERNET_DISCONNECTED')) intentionalOfflineProblems.push(problem);
        else browserProblems.push(problem);
    });
    page.on('response', response => { if (/\/api\/jobs\/[^/]+\/stream/.test(response.url())) {
        const record: { status: number; contentType: string; frames?: string } = { status: response.status(), contentType: response.headers()['content-type'] ?? '' };
        jobStreams.push(record);
        void response.text().then(text => { record.frames = text.slice(0, 1000); }).catch(() => {});
    } });
    const origin = new URL(info.project.use.baseURL!).origin;
    const fixture = process.env.OR3_OPENAI_E2E_FIXTURE_URL!;
    const captured = async () => ((await (await page.request.get(`${fixture}/__capture`)).json()) as { requests: Captured[] }).requests;
    const key = `sk-e2e-${crypto.randomUUID().replaceAll('-', '')}`;
    expect((await page.request.post(`${fixture}/__key`, { data: key })).ok()).toBe(true);
    expect((await page.request.post('/api/basic-auth/sign-in', { headers: { origin }, data: {
        email: process.env.OR3_OPENAI_E2E_EMAIL, password: process.env.OR3_OPENAI_E2E_PASSWORD,
    } })).ok()).toBe(true);

    // The key goes to the account vault; the browser never reads it back.
    await openAiSettings(page, 'openai');
    await expect(page.getByText('No OpenAI key saved.')).toBeVisible();
    await page.getByLabel('OpenAI API key').fill(key);
    await page.getByRole('button', { name: 'Save key' }).click();
    await expect(page.getByText('Your OpenAI key is saved.')).toBeVisible();
    await page.locator('#dashboard-back-button').click();
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
    await openAiSettings(page, 'fast');
    await page.getByRole('button', { name: 'Fast Model', exact: true }).click();
    await page.getByText('gpt-5.4-mini · OpenAI', { exact: true }).click();
    await expect(page.getByRole('button', { name: 'Fast Model', exact: true })).toContainText('gpt-5.4-mini · OpenAI');
    await expect(page.getByRole('combobox', { name: 'Fast model routing' })).toHaveCount(0);
    await expect.poll(async () => (await page.request.get('/api/openrouter/title-model')).json())
        .toEqual({ model: '@openai/gpt-5.4-mini' });

    await page.goto('/chat');
    await chooseModel(page, 'gpt-5.4-mini (OpenAI key)');
    await send(page, 'openai:hello');
    await expect(page.getByText('OpenAI fixture reply')).toBeVisible({ timeout: 45_000 });
    await expect.poll(() => page.evaluate(async () => {
        for (const database of await indexedDB.databases()) {
            if (!database.name) continue;
            const db = await new Promise<IDBDatabase>((resolve, reject) => {
                const request = indexedDB.open(database.name!);
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error);
            });
            if (!db.objectStoreNames.contains('messages')) { db.close(); continue; }
            const rows = await new Promise<Array<{ data?: { content?: string; usage?: { model?: string } } }>>((resolve, reject) => {
                const request = db.transaction('messages').objectStore('messages').getAll();
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error);
            });
            db.close();
            const match = rows.find(row => row.data?.content === 'OpenAI fixture reply');
            if (match?.data?.usage?.model) return match.data.usage.model;
        }
        return null;
    }), { timeout: 30_000 }).toBe('@openai/gpt-5.4-mini');
    const openAi = (await captured()).filter(request => request.path === '/v1/responses' && request.includeUsage === true).at(-1);
    expect(openAi).toMatchObject({ credential: 'personal-openai', model: 'gpt-5.4-mini', includeUsage: true });
    expect(typeof openAi!.maxCompletionTokens).toBe('number');
    for (const field of ['max_tokens', 'messages', 'modalities', 'provider', 'plugins', 'usage', '_context', '_threadId'])
        expect(openAi!.keys).not.toContain(field);
    expect(openAi!.messageKeys).toContain('role');
    // Delegation and model search use OpenRouter credentials, so an OpenAI chat never offers them.
    expect(openAi!.tools.length).toBeGreaterThan(0);
    expect(openAi!.tools).not.toContain('delegate_chat');
    expect(openAi!.tools).not.toContain('search_models');
    // The direct chat endpoint must retain image and PDF input parts on the Responses wire.
    const attachmentResponse = await page.request.post('/api/openrouter/stream', { headers: { origin, 'x-or3-cloud-intent': 'mutation' }, data: {
        model: '@openai/gpt-5.4-mini', stream: true, messages: [{ role: 'user', content: [
            { type: 'text', text: 'Inspect these attachments.' },
            { type: 'image_url', image_url: { url: 'data:image/png;base64,aGVsbG8=' } },
            { type: 'file', file: { filename: 'fixture.pdf', file_data: 'data:application/pdf;base64,JVBERi0xLjQ=' } },
        ] }],
    } });
    expect(attachmentResponse.ok()).toBe(true);
    await attachmentResponse.body();
    const attachmentRequest = (await captured()).filter(request => request.path === '/v1/responses').at(-1);
    expect(attachmentRequest!.inputKinds).toEqual(expect.arrayContaining(['input_text', 'input_image', 'input_file']));
    expect(attachmentRequest!.inputFiles).toEqual([{ filename: 'fixture.pdf', hasData: true }]);
    // A second turn must carry the first exchange, and retry must issue a new request.
    await send(page, 'openai:second');
    const secondReply = page.locator('.chat-message-container').filter({ hasText: 'OpenAI second fixture reply' });
    await expect(secondReply).toBeVisible({ timeout: 15_000 });
    const second = (await captured()).filter(request => request.path === '/v1/responses' && request.includeUsage === true).at(-1);
    expect(second!.roles).toEqual(expect.arrayContaining(['user', 'assistant']));
    const beforeRetry = (await captured()).filter(request => request.path === '/v1/responses' && request.includeUsage === true).length;
    await secondReply.hover();
    await secondReply.getByRole('button', { name: 'Retry message' }).click();
    await expect.poll(async () => (await captured()).filter(request => request.path === '/v1/responses' && request.includeUsage === true).length).toBeGreaterThan(beforeRetry);
    await expect(secondReply).toBeVisible({ timeout: 30_000 });
    await send(page, 'openai:tool');
    await expect(page.getByText('OpenAI tool round complete')).toBeVisible({ timeout: 45_000 });
    const toolFollowup = (await captured()).filter(request => request.path === '/v1/responses' && request.includeUsage === true).at(-1);
    expect(toolFollowup!.roles).toContain('tool');
    // A Responses refusal is visible text rather than an empty successful answer.
    await send(page, 'openai:refuse', true);
    await expect(page.getByText('Fixture refusal')).toBeVisible({ timeout: 30_000 });
    // A disconnect during admission must wait for connectivity and reuse the same send.
    const beforeOffline = (await captured()).filter(request => request.path === '/v1/responses' && request.includeUsage === true).length;
    let interrupted = false;
    await page.route('**/api/openrouter/stream', async route => {
        if (!interrupted) {
            interrupted = true;
            intentionallyOffline = true;
            await page.context().setOffline(true);
            await route.abort('internetdisconnected');
        } else await route.continue();
    });
    await send(page, 'openai:offline');
    await expect.poll(() => interrupted).toBe(true);
    await page.waitForTimeout(1500);
    await expect(page.getByText('Response status unknown')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Stop generation' })).toBeVisible();
    await page.context().setOffline(false);
    await page.unroute('**/api/openrouter/stream');
    intentionallyOffline = false;
    await expect.poll(async () => (await captured()).filter(request => request.path === '/v1/responses' && request.includeUsage === true).length, { timeout: 45_000 }).toBeGreaterThan(beforeOffline);
    await expect(page.getByText('OpenAI fixture reply').last()).toBeVisible({ timeout: 45_000 });
    // Responses must preserve the user's reasoning choice while using tools.
    await chooseModel(page, 'gpt-6-luna (OpenAI key)');
    await page.getByRole('button', { name: 'Settings', exact: true }).last().click();
    await page.getByRole('button', { name: 'Thinking level' }).click();
    await page.getByRole('option', { name: /Medium/ }).click();
    await expect(page.getByRole('button', { name: 'Thinking level' })).toContainText('Medium');
    await expect(page.getByText('OpenAI Chat Completions requires thinking off when tools are enabled for this model.')).toHaveCount(0);
    await page.getByRole('button', { name: 'Close chat settings' }).click();
    const beforeLuna = (await captured()).filter(request => request.path === '/v1/responses' && request.includeUsage === true).length;
    await send(page, 'openai:tool');
    await expect.poll(async () => (await captured()).filter(request => request.path === '/v1/responses' && request.includeUsage === true).length, { timeout: 45_000 }).toBeGreaterThanOrEqual(beforeLuna + 2);
    const luna = (await captured()).filter(request => request.model === 'gpt-6-luna' && request.includeUsage === true).at(-1);
    expect(luna).toMatchObject({ reasoningEffort: 'medium' });
    expect(luna!.roles).toContain('tool');
    await chooseModel(page, 'gpt-5.4-mini (OpenAI key)');
    // A real background job keeps running while the user switches workspace tabs.
    const backgroundAdmission = page.waitForRequest(request => request.url().endsWith('/api/openrouter/stream') && request.method() === 'POST'
        && request.postDataJSON()?._background === true, { timeout: 30_000 });
    await send(page, 'openai:hold');
    await backgroundAdmission;
    await expect(page.getByText('OpenAI background started')).toBeVisible({ timeout: 15_000 });
    intentionallyOffline = true;
    await page.context().setOffline(true);
    await page.waitForTimeout(1500);
    await expect(page.getByText('Reconnecting to the response…')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Stop generation' })).toBeVisible();
    await page.context().setOffline(false);
    intentionallyOffline = false;
    const originalTab = page.getByRole('tab', { selected: true });
    const originalTabName = (await originalTab.textContent())!.trim();
    await page.locator('.workspace-tab-new').click();
    await expect(page.getByRole('tab', { selected: true })).not.toHaveText(originalTabName);
    expect((await page.request.post(`${fixture}/__release`)).ok()).toBe(true);
    await page.getByRole('tab').filter({ hasText: originalTabName }).click();
    await expect(page.getByText('OpenAI background started and completed')).toBeVisible({ timeout: 30_000 });
    // The new chat is named by the OpenAI fast model.
    await expect(page.getByText('Fixture title').first()).toBeVisible({ timeout: 30_000 });
    const title = (await captured()).find(request => request.path === '/v1/chat/completions' && request.includeUsage === undefined);
    expect(title).toMatchObject({ credential: 'personal-openai', model: 'gpt-5.4-mini' });
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
    const routerReply = page.locator('.chat-message-container').filter({ hasText: 'OpenRouter fixture reply' });
    await routerReply.hover();
    await routerReply.getByRole('button', { name: 'Create document' }).click();
    await expect(page.getByRole('textbox', { name: 'Document body' })).toContainText('OpenRouter fixture reply', { timeout: 30_000 });
    await page.reload();
    await expect(page.getByRole('textbox', { name: 'Document body' })).toContainText('OpenRouter fixture reply', { timeout: 30_000 });

    // Without a personal or instance OpenAI key, the server refuses OpenAI models.
    await openAiSettings(page, 'openai');
    await page.getByRole('button', { name: 'Remove key' }).click();
    await expect(page.getByText('No OpenAI key saved.')).toBeVisible();
    const refused = await page.request.post('/api/openrouter/stream', { headers: { origin, 'x-or3-cloud-intent': 'mutation' },
        data: { model: '@openai/gpt-5.4-mini', messages: [{ role: 'user', content: 'no key' }], stream: true } });
    expect(refused.status()).toBe(400);
    const refusal = (await refused.json() as { error?: { code?: string } }).error;
    expect(refusal?.code).toBe('ERR_AUTH');
    const models = await page.request.post('/api/openai/models', { headers: { origin, 'x-or3-cloud-intent': 'mutation' }, data: {} });
    expect(await models.json()).toEqual([]);

    const receipt = { openAi, title, memoryKind: (await classified.json() as { kind?: string }).kind, openRouter, refusedStatus: refused.status(), refusalCode: refusal?.code, browserProblems, intentionalOfflineProblems, jobStreams,
        upstreamRequests: (await captured()).length };
    await writeFile(resolve(process.env.OR3_OPENAI_E2E_OUTPUT!, 'receipt.json'), JSON.stringify(receipt, null, 2));
    await info.attach('openai-adapter-receipt', { contentType: 'application/json', body: JSON.stringify(receipt) });
    expect(browserProblems).toEqual([]);
});

test('administrators can bound chat limits for the instance and workspace', async ({ page, browser }, info) => {
    test.setTimeout(180_000);
    const origin = new URL(info.project.use.baseURL!).origin;
    const mutation = { origin, 'x-or3-admin-intent': 'admin' };
    expect((await page.request.post('/api/basic-auth/sign-in', { headers: { origin }, data: {
        email: process.env.OR3_OPENAI_E2E_EMAIL, password: process.env.OR3_OPENAI_E2E_PASSWORD,
    } })).ok()).toBe(true);
    expect((await page.request.post('/api/admin/auth/login', { headers: mutation, data: {
        username: 'openai-adapter-admin', password: process.env.OR3_OPENAI_E2E_ADMIN_PASSWORD,
    } })).ok()).toBe(true);
    await page.goto('/admin/workspace');
    const workspaceId = await page.evaluate(async () => (await (await fetch('/api/auth/session')).json()).session.workspace.id as string);
    await expect(page.getByRole('heading', { name: 'Chat limits' })).toBeVisible();
    await expect(page.getByLabel('Instance tool iterations')).toHaveValue('10');
    await expect(page.getByLabel('Instance generated images')).toHaveValue('6');
    await page.getByLabel('Instance tool iterations').fill('4');
    await page.getByLabel('Instance generated images').fill('3');
    await page.getByRole('button', { name: 'Save instance chat limits' }).click();
    await expect(page.getByText('Instance chat limits saved.')).toBeVisible();
    await page.getByLabel('Workspace tool iterations').fill('2');
    await page.getByLabel('Workspace generated images').fill('1');
    await page.getByRole('button', { name: 'Save workspace chat limits' }).click();
    await expect(page.getByText('Workspace chat limits saved.')).toBeVisible();
    await page.reload();
    await expect(page.getByLabel('Instance tool iterations')).toHaveValue('4');
    await expect(page.getByLabel('Workspace tool iterations')).toHaveValue('2');
    const settings = await page.request.get(`/api/admin/chat-limits?workspaceId=${encodeURIComponent(workspaceId)}`);
    expect(await settings.json()).toMatchObject({ instance: { toolIterations: 4, generatedImages: 3 },
        workspace: { toolIterations: 2, generatedImages: 1 }, effective: { toolIterations: 2, generatedImages: 1 } });
    const aboveMaximum = await page.request.post('/api/admin/chat-limits', { headers: mutation, data: {
        scope: 'workspace', workspaceId, limits: { toolIterations: 5, generatedImages: 1 },
    } });
    expect(aboveMaximum.status()).toBe(400);
    const invalid = await page.request.post('/api/admin/chat-limits', { headers: mutation, data: {
        scope: 'workspace', workspaceId, limits: { toolIterations: 0, generatedImages: -1 },
    } });
    expect(invalid.status()).toBe(400);
    expect((await page.request.get('/api/chat/limits?workspaceId=another-workspace')).status()).toBe(403);
    const anonymous = await browser.newContext({ baseURL: origin });
    expect((await anonymous.request.get(`/api/admin/chat-limits?workspaceId=${encodeURIComponent(workspaceId)}`)).status()).toBeGreaterThanOrEqual(400);
    expect((await anonymous.request.post('/api/admin/chat-limits', { headers: mutation, data: {
        scope: 'workspace', workspaceId, limits: { toolIterations: 1, generatedImages: 0 },
    } })).status()).toBeGreaterThanOrEqual(400);
    await anonymous.close();
    await page.screenshot({ path: resolve(process.env.OR3_OPENAI_E2E_OUTPUT!, 'chat-limits.png') });

    // Exercise the effective limit in the actual background tool loop.
    const fixture = process.env.OR3_OPENAI_E2E_FIXTURE_URL!;
    const key = `sk-e2e-${crypto.randomUUID().replaceAll('-', '')}`;
    expect((await page.request.post(`${fixture}/__key`, { data: key })).ok()).toBe(true);
    await openAiSettings(page, 'openai');
    await page.getByLabel('OpenAI API key').fill(key);
    await page.getByRole('button', { name: 'Save key' }).click();
    await expect(page.getByText('Your OpenAI key is saved.')).toBeVisible();
    await page.locator('#dashboard-back-button').click();
    const toolsSwitch = page.getByRole('switch', { name: 'Enable all tools by default' });
    if (await toolsSwitch.getAttribute('aria-checked') !== 'true') await toolsSwitch.click();
    await page.goto('/chat');
    await chooseModel(page, 'gpt-5.4-mini (OpenAI key)');
    const captured = async () => ((await (await page.request.get(`${fixture}/__capture`)).json()).requests as Captured[]);
    const beforeLoop = (await captured()).length;
    await send(page, 'openai:limit-loop');
    await expect(page.getByRole('alert', { name: 'Response failed' })).toBeVisible({ timeout: 45_000 });
    const loopCalls = (await captured()).slice(beforeLoop).filter(request => request.path === '/v1/responses' && request.stream === true);
    expect(loopCalls).toHaveLength(2);

    // Image output is foreground-only; four provider images must save only one.
    await chooseModel(page, 'Fixture Images');
    await send(page, 'generate fixture images');
    await expect(page.getByText('Images ready')).toBeVisible({ timeout: 45_000 });
    const savedImageCount = () => page.evaluate(async () => {
        for (const { name } of await indexedDB.databases()) {
            if (!name?.startsWith('or3-db')) continue;
            const db = await new Promise<IDBDatabase>((resolve, reject) => {
                const request = indexedDB.open(name); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
            });
            const rows = await new Promise<Array<{ role?: string; file_hashes?: string; data?: { content?: string } }>>((resolve, reject) => {
                const request = db.transaction('messages').objectStore('messages').getAll(); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
            });
            db.close();
            const message = rows.find(row => row.role === 'assistant' && row.data?.content?.includes('Images ready'));
            if (message?.file_hashes) return (JSON.parse(message.file_hashes) as string[]).length;
        }
        return 0;
    });
    await expect.poll(savedImageCount, { timeout: 30_000 }).toBe(1);
    const imageCount = await savedImageCount();
    // Lowering an instance cap clamps existing overrides; resetting inherits it.
    const originalSettings = await settings.json() as { revision: string };
    const lowered = await page.request.post('/api/admin/chat-limits', { headers: mutation, data: {
        scope: 'instance', revision: originalSettings.revision, limits: { toolIterations: 1, generatedImages: 0 },
    } });
    expect(lowered.ok()).toBe(true);
    const stale = await page.request.post('/api/admin/chat-limits', { headers: mutation, data: {
        scope: 'instance', revision: originalSettings.revision, limits: { toolIterations: 4, generatedImages: 3 },
    } });
    expect(stale.status()).toBe(409);
    expect(await (await page.request.get(`/api/chat/limits?workspaceId=${encodeURIComponent(workspaceId)}`)).json())
        .toEqual({ toolIterations: 1, generatedImages: 0 });
    await page.goto('/admin/workspace');
    await page.getByRole('button', { name: 'Use instance limits' }).click();
    await expect(page.getByText('Workspace chat limits saved.')).toBeVisible();
    expect(await (await page.request.get(`/api/admin/chat-limits?workspaceId=${encodeURIComponent(workspaceId)}`)).json())
        .toMatchObject({ workspace: null, effective: { toolIterations: 1, generatedImages: 0 } });
    await writeFile(resolve(process.env.OR3_OPENAI_E2E_OUTPUT!, 'chat-limits-receipt.json'), JSON.stringify({ workspaceId, settings: originalSettings, aboveMaximum: aboveMaximum.status(), invalid: invalid.status(), staleRevision: stale.status(), toolRequests: loopCalls.length, imageCount }, null, 2));
});

test('SQLite admin grants apply and revoke to cached workspace sessions', async ({ page, browser }, info) => {
    test.setTimeout(120_000);
    const origin = new URL(info.project.use.baseURL!).origin;
    const adminHeaders = { origin, 'x-or3-admin-intent': 'admin' };
    const cloudHeaders = { origin, 'x-or3-cloud-intent': 'mutation' };
    const credentials = { email: process.env.OR3_OPENAI_E2E_EMAIL, password: process.env.OR3_OPENAI_E2E_PASSWORD };
    expect((await page.request.post('/api/basic-auth/sign-in', { headers: cloudHeaders, data: credentials })).ok()).toBe(true);
    expect((await page.request.post('/api/admin/auth/login', { headers: adminHeaders, data: {
        username: 'openai-adapter-admin', password: process.env.OR3_OPENAI_E2E_ADMIN_PASSWORD,
    } })).ok()).toBe(true);
    const account = (await (await page.request.get('/api/auth/session')).json()).session as { user: { id: string }; providerUserId: string; workspace: { id: string } };
    const workspaceId = account.workspace.id;
    const instanceSettings = await page.request.get(`/api/admin/chat-limits?workspaceId=${encodeURIComponent(workspaceId)}`);
    const revision = (await instanceSettings.json()).revision as string;
    expect((await page.request.post('/api/admin/chat-limits', { headers: adminHeaders, data: {
        scope: 'instance', revision, limits: { toolIterations: 4, generatedImages: 3 },
    } })).ok()).toBe(true);
    expect(await (await page.request.get('/api/admin/admin-users')).json()).toMatchObject({ grantsEnforced: true });
    const member = await browser.newContext({ baseURL: origin });
    try {
        expect((await member.request.post('/api/basic-auth/sign-in', { headers: cloudHeaders, data: credentials })).ok()).toBe(true);
        expect((await member.request.get('/api/admin/auth/session')).status()).toBe(401);
        expect((await member.request.post('/api/admin/workspace/models', { headers: adminHeaders, data: { workspaceId, policy: { hidden: [], pinned: [], defaultModel: null } } })).status()).toBe(401);
        expect((await page.request.post('/api/admin/admin-users/grant', { headers: adminHeaders, data: { userId: account.user.id } })).ok()).toBe(true);
        const adminSession = await member.request.get('/api/admin/auth/session');
        expect(await adminSession.json()).toMatchObject({ authenticated: true, kind: 'workspace_admin', workspace: { id: workspaceId } });
        const settingsPage = await member.newPage();
        settingsPage.setDefaultTimeout(10_000);
        await settingsPage.goto('/admin/workspace');
        await expect(settingsPage.getByRole('heading', { name: 'Chat limits' })).toBeVisible();
        await expect(settingsPage.getByLabel('Instance tool iterations')).toHaveCount(0);
        await settingsPage.getByLabel('Workspace tool iterations').fill('3');
        await settingsPage.getByLabel('Workspace generated images').fill('2');
        await settingsPage.getByRole('button', { name: 'Save workspace chat limits' }).click();
        await expect(settingsPage.getByText('Workspace chat limits saved.')).toBeVisible();
        await settingsPage.reload();
        await expect(settingsPage.getByLabel('Workspace tool iterations')).toHaveValue('3');
        // Model curation uses the same workspace authority as chat limits.
        const policy = { hidden: ['fixture/image'], pinned: ['fixture/router'], defaultModel: 'fixture/router' };
        expect((await member.request.post('/api/admin/workspace/models', { headers: adminHeaders, data: { workspaceId, policy } })).ok()).toBe(true);
        expect(await (await member.request.get('/api/workspaces/models')).json()).toEqual(policy);
        expect((await member.request.post('/api/admin/workspace/models', { headers: adminHeaders, data: { workspaceId: 'other-workspace', policy } })).status()).toBe(403);
        expect((await member.request.get('/api/admin/workspace/model-catalog?workspaceId=other-workspace')).status()).toBe(403);
        const availableModels = await member.request.get(`/api/admin/workspace/model-catalog?workspaceId=${encodeURIComponent(workspaceId)}`);
        expect(availableModels.ok()).toBe(true);
        expect((await availableModels.json()).data).toContainEqual(expect.objectContaining({ id: 'fixture/router' }));
        expect((await member.request.post('/api/admin/workspace/models', { headers: { origin }, data: { workspaceId, policy } })).status()).toBe(403);
        expect((await member.request.post('/api/admin/workspace/models', { headers: adminHeaders, data: { workspaceId, policy: { ...policy, defaultModel: policy.hidden[0] } } })).status()).toBe(400);
        expect((await member.request.post('/api/openrouter/stream', { headers: cloudHeaders, data: { model: 'fixture/image', messages: [{ role: 'user', content: 'blocked' }] } })).status()).toBe(403);
        await settingsPage.goto('/chat');
        await settingsPage.getByRole('button', { name: 'Settings', exact: true }).last().click();
        await expect(settingsPage.getByRole('button', { name: 'Current model', exact: true })).toContainText('Fixture Router');
        await settingsPage.getByRole('button', { name: /^Model catalog/ }).click();
        const workspaceCatalog = settingsPage.getByRole('dialog', { name: 'Model catalog', exact: true });
        await expect(workspaceCatalog.locator('[data-model-id="fixture/image"]')).toHaveCount(0);
        await workspaceCatalog.getByRole('button', { name: /^Workspace picks/ }).click();
        await expect(workspaceCatalog.getByRole('listitem')).toHaveCount(1);
        await expect(workspaceCatalog.getByRole('listitem')).toContainText('Fixture Router');
        await settingsPage.screenshot({ path: resolve(process.env.OR3_OPENAI_E2E_OUTPUT!, 'workspace-model-picks.png') });
        await settingsPage.goto('/admin/workspace');
        await expect(settingsPage.getByRole('heading', { name: 'Workspace models' })).toBeVisible();
        const saveModels = settingsPage.getByRole('button', { name: 'Save workspace models', exact: true });
        await expect(saveModels).toBeVisible();
        await settingsPage.getByLabel('Workspace default model', { exact: true }).click();
        await settingsPage.getByRole('option', { name: 'Use personal preference', exact: true }).click();
        await saveModels.click();
        await expect(settingsPage.getByText('Workspace models saved.', { exact: true })).toBeVisible();
        expect(await (await member.request.get('/api/workspaces/models')).json()).toEqual({ ...policy, defaultModel: null });
        await settingsPage.getByLabel('Workspace default model', { exact: true }).click();
        await settingsPage.getByRole('option', { name: 'Fixture Router · OpenRouter', exact: true }).click();
        await saveModels.click();
        await expect.poll(async () => (await member.request.get('/api/workspaces/models')).json()).toEqual(policy);
        await settingsPage.screenshot({ path: resolve(process.env.OR3_OPENAI_E2E_OUTPUT!, 'workspace-models.png') });
        expect((await member.request.post('/api/admin/workspace/models', { headers: adminHeaders, data: { workspaceId, policy: { hidden: [], pinned: [], defaultModel: null } } })).ok()).toBe(true);
        const endpoint = '/api/admin/chat-limits';
        expect((await member.request.post(endpoint, { headers: adminHeaders, data: { scope: 'instance', revision: 'x', limits: { toolIterations: 1, generatedImages: 0 } } })).status()).toBe(403);
        expect((await member.request.get('/api/admin/admin-users')).status()).toBe(403);
        expect((await member.request.post('/api/admin/admin-users/grant', { headers: adminHeaders, data: { userId: account.user.id } })).status()).toBe(403);
        expect((await member.request.get(`${endpoint}?workspaceId=other-workspace`)).status()).toBe(403);
        expect((await member.request.post(endpoint, { headers: adminHeaders, data: { scope: 'workspace', workspaceId: 'other-workspace', limits: { toolIterations: 1, generatedImages: 0 } } })).status()).toBe(403);
        expect((await member.request.post(endpoint, { headers: { origin }, data: { scope: 'workspace', workspaceId, limits: { toolIterations: 1, generatedImages: 0 } } })).status()).toBe(403);
        await settingsPage.screenshot({ path: resolve(process.env.OR3_OPENAI_E2E_OUTPUT!, 'sqlite-workspace-admin.png') });
        // A different server process can change the same SQLite store without
        // notifying this process's session cache.
        const db = new Database(process.env.OR3_SQLITE_DB_PATH!);
        try {
            db.exec('ALTER TABLE admin_users RENAME TO admin_users_unavailable');
            try {
                expect((await member.request.get('/api/admin/auth/session')).status()).toBeGreaterThanOrEqual(500);
            } finally { db.exec('ALTER TABLE admin_users_unavailable RENAME TO admin_users'); }
            expect((await member.request.get('/api/admin/auth/session')).status()).toBe(200);
            db.prepare('DELETE FROM admin_users WHERE user_id = ?').run(account.user.id);
            expect((await member.request.get('/api/admin/auth/session')).status()).toBe(401);
            db.prepare('INSERT INTO admin_users (user_id, created_at) VALUES (?, ?)').run(account.user.id, Math.floor(Date.now() / 1000));
            expect((await member.request.get('/api/admin/auth/session')).status()).toBe(200);
        } finally { db.close(); }
        // A deployment grant alone must not let a viewer manage a different workspace.
        const other = await browser.newContext({ baseURL: origin });
        try {
            const password = 'DisposableViewer!123';
            const email = `admin-viewer-${crypto.randomUUID()}@example.test`;
            const invitation = await page.request.post('/api/admin/signup-invites/create', { headers: adminHeaders, data: { email } });
            expect(invitation.ok(), await invitation.text()).toBe(true);
            const inviteToken = (await invitation.json()).invite.token as string;
            const registered = await other.request.post('/api/basic-auth/register', { headers: cloudHeaders, data: {
                email, password, confirmPassword: password, inviteToken,
            } });
            expect(registered.ok(), await registered.text()).toBe(true);
            const otherSession = (await (await other.request.get('/api/auth/session')).json()).session as { workspace: { id: string } };
            expect((await other.request.get('/api/admin/auth/session')).status()).toBe(401);
            const otherWorkspace = otherSession.workspace.id;
            expect(otherWorkspace).not.toBe(workspaceId);
            const added = await page.request.post('/api/admin/workspace/members/upsert', { headers: adminHeaders, data: {
                workspaceId: otherWorkspace, provider: 'basic-auth', emailOrProviderId: account.providerUserId, role: 'viewer',
            } });
            expect(added.ok(), await added.text()).toBe(true);
            expect((await member.request.post('/api/workspaces/active', { headers: cloudHeaders, data: { id: otherWorkspace } })).ok()).toBe(true);
            expect((await member.request.get('/api/admin/auth/session')).status()).toBe(403);
            expect((await member.request.get('/api/admin/workspace/model-catalog')).status()).toBe(403);
            expect((await member.request.post(endpoint, { headers: adminHeaders, data: { scope: 'workspace', workspaceId: otherWorkspace, limits: { toolIterations: 1, generatedImages: 0 } } })).status()).toBe(403);
            expect((await page.request.post('/api/admin/workspace/members/set-role', { headers: adminHeaders, data: {
                workspaceId: otherWorkspace, userId: account.user.id, role: 'editor',
            } })).ok()).toBe(true);
            expect((await member.request.get('/api/admin/auth/session')).status()).toBe(403);
            expect((await member.request.get(`${endpoint}?workspaceId=${encodeURIComponent(otherWorkspace)}`)).status()).toBe(403);
            expect((await member.request.post('/api/workspaces/active', { headers: cloudHeaders, data: { id: workspaceId } })).ok()).toBe(true);
            expect((await member.request.get('/api/admin/auth/session')).status()).toBe(200);
        } finally { await other.close(); }
        expect((await page.request.post('/api/admin/admin-users/revoke', { headers: adminHeaders, data: { userId: account.user.id } })).ok()).toBe(true);
        expect((await member.request.get('/api/admin/auth/session')).status()).toBe(401);
        expect((await member.request.get('/api/admin/workspace/model-catalog')).status()).toBe(401);
        expect((await member.request.post(endpoint, { headers: adminHeaders, data: { scope: 'workspace', workspaceId, limits: { toolIterations: 1, generatedImages: 0 } } })).status()).toBe(401);
        expect((await (await page.request.get(`${endpoint}?workspaceId=${encodeURIComponent(workspaceId)}`)).json()).workspace)
            .toEqual({ toolIterations: 3, generatedImages: 2 });
        await writeFile(resolve(process.env.OR3_OPENAI_E2E_OUTPUT!, 'sqlite-admin-grants-receipt.json'), JSON.stringify({ workspaceId, grant: 'allowed', unavailableStore: 'denied', crossProcessRevocation: 'denied', crossProcessGrant: 'allowed', crossWorkspace: 'denied', viewer: 'denied', editor: 'denied', ungranted: 'denied', instance: 'denied', csrf: 'denied', revoke: 'denied' }, null, 2));
    } finally { await member.close(); }
});

test('an admin-only browser can curate models and recover catalog failures', async ({ page, browser }, info) => {
    test.setTimeout(120_000);
    page.setDefaultTimeout(15_000);
    const origin = new URL(info.project.use.baseURL!).origin;
    const headers = { origin, 'x-or3-admin-intent': 'admin' };
    // Obtain a fixture workspace in a separate account session; the admin browser stays signed out of chat.
    const account = await browser.newContext({ baseURL: origin });
    try {
        expect((await account.request.post('/api/basic-auth/sign-in', { headers: { origin, 'x-or3-cloud-intent': 'mutation' }, data: {
            email: process.env.OR3_OPENAI_E2E_EMAIL, password: process.env.OR3_OPENAI_E2E_PASSWORD,
        } })).ok()).toBe(true);
        const workspaceId = (await (await account.request.get('/api/auth/session')).json()).session.workspace.id as string;
        const endpoint = `/api/admin/workspace/model-catalog?workspaceId=${encodeURIComponent(workspaceId)}`;
        const anonymousStatus = (await page.request.get(endpoint)).status();
        expect((await page.request.post('/api/admin/auth/login', { headers, data: {
            username: 'openai-adapter-admin', password: process.env.OR3_OPENAI_E2E_ADMIN_PASSWORD,
        } })).ok()).toBe(true);
        expect((await page.request.post('/api/openrouter/models', { headers: { origin, 'x-or3-cloud-intent': 'mutation' }, data: {} })).status()).toBe(401);
        await page.goto(`/admin/workspaces/${encodeURIComponent(workspaceId)}`);
        await page.getByLabel('Workspace default model', { exact: true }).click();
        await page.getByRole('option', { name: 'Fixture Router · OpenRouter', exact: true }).click();
        expect(anonymousStatus).toBe(401);
        expect((await account.request.get(endpoint)).status()).toBe(401);
        await page.getByRole('button', { name: 'Save workspace models', exact: true }).click();
        await expect(page.getByText('Workspace models saved.', { exact: true })).toBeVisible();
        expect((await (await page.request.get(`/api/admin/workspace/models?workspaceId=${encodeURIComponent(workspaceId)}`)).json()).policy.defaultModel).toBe('fixture/router');
        await page.route('**/api/admin/workspace/model-catalog?*', route => route.fulfill({ status: 503, json: {} }));
        await page.reload();
        await expect(page.getByRole('alert').filter({ hasText: 'Could not load available models.' })).toBeVisible();
        await page.unroute('**/api/admin/workspace/model-catalog?*');
        await page.getByRole('button', { name: 'Retry loading models', exact: true }).click();
        await page.getByLabel('Hidden models', { exact: true }).click();
        await expect(page.getByRole('option', { name: 'Fixture Images · OpenRouter', exact: true })).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(page.getByRole('option', { name: 'Fixture Images · OpenRouter', exact: true })).toHaveCount(0);
        await page.getByRole('region', { name: 'Workspace models', exact: true }).screenshot({ path: resolve(process.env.OR3_OPENAI_E2E_OUTPUT!, 'admin-only-workspace-models.png') });
        expect((await page.request.post('/api/admin/workspace/models', { headers, data: {
            workspaceId, policy: { hidden: [], pinned: [], defaultModel: null },
        } })).ok()).toBe(true);
    } finally { await account.close(); }
});

test('reloading after a user turn is saved leaves a recoverable response', async ({ page }, info) => {
    test.setTimeout(120_000);
    const origin = new URL(info.project.use.baseURL!).origin;
    const fixture = process.env.OR3_OPENAI_E2E_FIXTURE_URL!;
    expect((await page.request.post('/api/basic-auth/sign-in', { headers: { origin }, data: {
        email: process.env.OR3_OPENAI_E2E_EMAIL, password: process.env.OR3_OPENAI_E2E_PASSWORD,
    } })).ok()).toBe(true);
    await page.goto('/chat');
    await chooseModel(page, 'Fixture Router');
    await send(page, 'establish chat');
    await expect(page.getByText('OpenRouter fixture reply')).toBeVisible({ timeout: 45_000 });
    // Pause a real post-commit hook before the send can create a response or
    // reach the provider. Reloading drops this hook along with the old page.
    await page.evaluate(async () => {
        const importModule = new Function('path', 'return import(path)') as (path: string) => Promise<{ useHooks: () => { addAction: (name: string, handler: (row: { role?: string; data?: { content?: string } }) => Promise<void>) => void } }>;
        const url = performance.getEntriesByType('resource').map(entry => entry.name).find(name => name.includes('/core/hooks/useHooks.ts'));
        if (!url) throw new Error('Hook module was not loaded by the application.');
        const { useHooks } = await importModule(url);
        useHooks().addAction('db.messages.append:action:after', async row => {
            if (row.role !== 'user' || row.data?.content !== 'reload-before-admission') return;
            sessionStorage.setItem('reload-before-admission-committed', 'yes');
            await new Promise<void>(() => {});
        });
    });
    const before = (await (await page.request.get(`${fixture}/__capture`)).json()).requests.length;
    await send(page, 'reload-before-admission');
    await expect.poll(() => page.evaluate(() => sessionStorage.getItem('reload-before-admission-committed'))).toBe('yes');
    await expect(page.getByRole('textbox', { name: 'Message input' })).toBeEmpty();
    await page.reload();
    await expect(page.getByRole('textbox', { name: 'Message input' })).toBeEmpty({ timeout: 30_000 });
    await expect(page.locator('.cm-user').filter({ hasText: 'reload-before-admission' })).toBeVisible({ timeout: 30_000 });
    // Once the old lease expires the interrupted response is actionable, so
    // the user is not left with a silently unanswered turn.
    await expect(page.locator('.cm-assistant')).toHaveCount(2, { timeout: 45_000 });
    const assistant = page.locator('.cm-assistant').last();
    await expect(assistant).toBeVisible({ timeout: 45_000 });
    await assistant.hover();
    await assistant.getByRole('button', { name: 'Retry message' }).click();
    await expect.poll(async () => ((await (await page.request.get(`${fixture}/__capture`)).json()).requests as Captured[])
        .slice(before).filter(request => request.path === '/api/v1/chat/completions' && request.stream === true).length, { timeout: 45_000 }).toBe(1);
    await expect(page.getByText('OpenRouter fixture reply')).toHaveCount(2, { timeout: 45_000 });
    const requests = (await (await page.request.get(`${fixture}/__capture`)).json()).requests;
    const calls = requests.slice(before).filter((request: Captured) => request.path === '/api/v1/chat/completions' && request.stream === true);
    expect(calls).toHaveLength(1);
    await page.screenshot({ path: resolve(process.env.OR3_OPENAI_E2E_OUTPUT!, 'early-reload-recovered.png') });
    await writeFile(resolve(process.env.OR3_OPENAI_E2E_OUTPUT!, 'early-reload-receipt.json'), JSON.stringify({ modelRequests: calls.length }, null, 2));
});

test('switching tabs while a saved turn is preparing does not lose its reply', async ({ page }, info) => {
    test.setTimeout(120_000);
    const origin = new URL(info.project.use.baseURL!).origin;
    expect((await page.request.post('/api/basic-auth/sign-in', { headers: { origin }, data: {
        email: process.env.OR3_OPENAI_E2E_EMAIL, password: process.env.OR3_OPENAI_E2E_PASSWORD,
    } })).ok()).toBe(true);
    await page.goto('/chat');
    await chooseModel(page, 'Fixture Router');
    await send(page, 'establish chat');
    await expect(page.getByText('OpenRouter fixture reply')).toBeVisible({ timeout: 45_000 });
    const originalTabId = await page.getByRole('tab', { selected: true }).getAttribute('id');
    expect(originalTabId).toBeTruthy();
    await page.evaluate(async () => {
        const importModule = new Function('path', 'return import(path)') as (path: string) => Promise<{ useHooks: () => { addAction: (name: string, handler: (row: { role?: string; data?: { content?: string } }) => Promise<void>) => void } }>;
        const url = performance.getEntriesByType('resource').map(entry => entry.name).find(name => name.includes('/core/hooks/useHooks.ts'));
        if (!url) throw new Error('Hook module was not loaded by the application.');
        const { useHooks } = await importModule(url);
        useHooks().addAction('db.messages.append:action:after', async row => {
            if (row.role !== 'user' || row.data?.content !== 'switch-before-admission') return;
            sessionStorage.setItem('switch-before-admission-committed', 'yes');
            await new Promise<void>(resolve => { (window as any).releaseSwitchPreparation = resolve; });
        });
    });
    await send(page, 'switch-before-admission');
    await expect.poll(() => page.evaluate(() => sessionStorage.getItem('switch-before-admission-committed'))).toBe('yes');
    await page.locator('.workspace-tab-new').click();
    await send(page, 'separate conversation');
    await expect(page.getByText('OpenRouter fixture reply')).toHaveCount(1, { timeout: 30_000 });
    await page.evaluate(() => (window as any).releaseSwitchPreparation());
    await page.locator(`[id="${originalTabId}"]`).click();
    await expect(page.getByText('separate conversation', { exact: true })).toHaveCount(0);
    await expect(page.getByText('OpenRouter fixture reply')).toHaveCount(2, { timeout: 30_000 });
    await page.reload();
    await expect(page.getByText('OpenRouter fixture reply')).toHaveCount(2, { timeout: 30_000 });
    await page.screenshot({ path: resolve(process.env.OR3_OPENAI_E2E_OUTPUT!, 'early-switch-recovered.png') });
});

test('switching tabs before a send is saved still sends the original message', async ({ page }, info) => {
    test.setTimeout(120_000);
    const origin = new URL(info.project.use.baseURL!).origin;
    expect((await page.request.post('/api/basic-auth/sign-in', { headers: { origin }, data: {
        email: process.env.OR3_OPENAI_E2E_EMAIL, password: process.env.OR3_OPENAI_E2E_PASSWORD,
    } })).ok()).toBe(true);
    await page.goto('/chat');
    await chooseModel(page, 'Fixture Router');
    await send(page, 'establish chat');
    await expect(page.getByText('OpenRouter fixture reply')).toBeVisible({ timeout: 45_000 });
    const originalTabId = await page.getByRole('tab', { selected: true }).getAttribute('id');
    expect(originalTabId).toBeTruthy();
    await page.evaluate(async () => {
        const importModule = new Function('path', 'return import(path)') as (path: string) => Promise<{ useHooks: () => { addFilter: (name: string, handler: (text: string) => Promise<string>) => void } }>;
        const url = performance.getEntriesByType('resource').map(entry => entry.name).find(name => name.includes('/core/hooks/useHooks.ts'));
        if (!url) throw new Error('Hook module was not loaded by the application.');
        const { useHooks } = await importModule(url);
        useHooks().addFilter('ui.chat.message:filter:outgoing', async text => {
            if (text !== 'switch-before-save') return text;
            sessionStorage.setItem('switch-before-save-started', 'yes');
            await new Promise<void>(resolve => { (window as any).releaseUnpersistedSend = resolve; });
            return text;
        });
    });
    const input = page.getByRole('textbox', { name: 'Message input' });
    await input.fill('switch-before-save');
    await input.press('Enter');
    await expect.poll(() => page.evaluate(() => sessionStorage.getItem('switch-before-save-started'))).toBe('yes');
    await page.locator('.workspace-tab-new').click();
    const otherTabId = await page.getByRole('tab', { selected: true }).getAttribute('id');
    await page.evaluate(() => (window as any).releaseUnpersistedSend());
    await expect(page.getByRole('region', { name: 'New chat' })).toBeVisible({ timeout: 30_000 });
    await page.getByRole('textbox', { name: 'Message input' }).fill('other tab draft');
    await page.locator(`[id="${originalTabId}"]`).click();
    await expect(page.getByText('switch-before-save', { exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('OpenRouter fixture reply')).toHaveCount(2, { timeout: 30_000 });
    await expect(page.getByRole('textbox', { name: 'Message input' })).not.toContainText('switch-before-save');
    await page.locator(`[id="${otherTabId}"]`).click();
    await expect(page.getByRole('textbox', { name: 'Message input' })).toContainText('other tab draft');
    await page.locator(`[id="${originalTabId}"]`).click();
    await page.reload();
    await expect(page.getByText('OpenRouter fixture reply')).toHaveCount(2, { timeout: 30_000 });
    await page.screenshot({ path: resolve(process.env.OR3_OPENAI_E2E_OUTPUT!, 'switch-before-save-recovered.png') });
});

test('switching away during the first send keeps the new conversation', async ({ page }, info) => {
    test.setTimeout(120_000);
    const origin = new URL(info.project.use.baseURL!).origin;
    const fixture = process.env.OR3_OPENAI_E2E_FIXTURE_URL!;
    expect((await page.request.post('/api/basic-auth/sign-in', { headers: { origin }, data: {
        email: process.env.OR3_OPENAI_E2E_EMAIL, password: process.env.OR3_OPENAI_E2E_PASSWORD,
    } })).ok()).toBe(true);
    await page.goto('/chat');
    await chooseModel(page, 'Fixture Router');
    const before = ((await (await page.request.get(`${fixture}/__capture`)).json()).requests as Captured[])
        .filter(request => request.path === '/api/v1/chat/completions' && request.stream === true).length;
    const originalTabId = await page.getByRole('tab', { selected: true }).getAttribute('id');
    expect(originalTabId).toBeTruthy();
    await page.evaluate(async () => {
        const importModule = new Function('path', 'return import(path)') as (path: string) => Promise<{ useHooks: () => { addFilter: (name: string, handler: (text: string) => Promise<string>) => void } }>;
        const url = performance.getEntriesByType('resource').map(entry => entry.name).find(name => name.includes('/core/hooks/useHooks.ts'));
        if (!url) throw new Error('Hook module was not loaded by the application.');
        const { useHooks } = await importModule(url);
        useHooks().addFilter('ui.chat.message:filter:outgoing', async text => {
            if (text !== 'first-send-before-switch') return text;
            sessionStorage.setItem('first-send-started', 'yes');
            await new Promise<void>(resolve => { (window as any).releaseFirstSend = resolve; });
            return text;
        });
    });
    const input = page.getByRole('textbox', { name: 'Message input' });
    await input.fill('first-send-before-switch');
    await input.press('Enter');
    await expect.poll(() => page.evaluate(() => sessionStorage.getItem('first-send-started'))).toBe('yes');
    await page.locator('.workspace-tab-new').click();
    await page.evaluate(() => (window as any).releaseFirstSend());
    await expect.poll(async () => ((await (await page.request.get(`${fixture}/__capture`)).json()).requests as Captured[])
        .filter(request => request.path === '/api/v1/chat/completions' && request.stream === true).length,
        { timeout: 30_000 }).toBe(before + 1);
    await expect(page.getByRole('region', { name: 'New chat' })).toBeVisible();
    await expect(page.getByRole('tab', { selected: true }).locator('.workspace-tab-status.is-streaming')).toHaveCount(0);
    await expect(page.locator(`[id="${originalTabId}"] .workspace-tab-status.is-streaming`)).toHaveCount(0, { timeout: 30_000 });
    await page.locator(`[id="${originalTabId}"]`).click();
    await expect(page.getByText('OpenRouter fixture reply')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('textbox', { name: 'Message input' })).not.toContainText('first-send-before-switch');
    await page.reload();
    await expect(page.getByText('OpenRouter fixture reply')).toBeVisible({ timeout: 30_000 });
    await page.screenshot({ path: resolve(process.env.OR3_OPENAI_E2E_OUTPUT!, 'first-send-switch-recovered.png') });
});


test('catalog publishes platforms independently and keeps saved models during an outage', async ({ page }, info) => {
    test.setTimeout(90_000);
    const origin = new URL(info.project.use.baseURL!).origin;
    expect((await page.request.post('/api/basic-auth/sign-in', { headers: { origin }, data: {
        email: process.env.OR3_OPENAI_E2E_EMAIL, password: process.env.OR3_OPENAI_E2E_PASSWORD,
    } })).ok()).toBe(true);
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    let stage = 1;
    const direct = { id: '@openai/gpt-6-luna', name: 'Same model', context_length: 32000, created: 2 };
    const routed = { id: 'openai/gpt-6-luna', name: 'Same model', context_length: 32000, created: 2, pricing: { prompt: '0.000000004', completion: '0.000001' } };
    await page.route('**/api/openai/models', route => stage === 1 ? route.fulfill({ json: [direct] }) : route.fulfill({ status: 503, json: {} }));
    await page.route('**/api/openrouter/models', async route => {
        if (stage === 1) await held;
        await route.fulfill(stage === 2 ? { json: [routed] } : { status: 503, json: {} });
    });
    await page.goto('/chat');
    await expect(page.getByRole('textbox', { name: 'Message input' })).toBeVisible({ timeout: 45_000 });
    await page.getByRole('button', { name: 'Settings', exact: true }).last().click();
    await page.getByRole('button', { name: /^Model catalog/ }).click();
    const catalog = page.getByRole('dialog', { name: 'Model catalog', exact: true });
    await expect(catalog.locator('[data-model-id="@openai/gpt-6-luna"]')).toBeVisible();
    await expect(catalog.getByText('OpenRouter: Loading models…')).toBeVisible();
    release();
    await expect(catalog.getByText('OpenRouter: Models unavailable. Refresh to try again.')).toBeVisible();
    await expect(catalog.locator('[data-model-id="@openai/gpt-6-luna"]')).toBeVisible();
    stage = 2;
    await catalog.getByRole('button', { name: 'Refresh model catalog' }).click();
    await expect(catalog.locator('[data-model-id="openai/gpt-6-luna"]')).toBeVisible();
    await expect(catalog.getByText('OpenAI: Models unavailable. Refresh to try again.')).toBeVisible();
    stage = 3;
    await catalog.getByRole('button', { name: 'Refresh model catalog' }).click();
    await expect(catalog.getByText('OpenRouter: Showing saved models. Refresh to try again.')).toBeVisible();
    await expect(catalog.locator('[data-model-id="openai/gpt-6-luna"]')).toBeVisible();
    await page.screenshot({ path: resolve(process.env.OR3_OPENAI_E2E_OUTPUT!, 'catalog-platform-recovery.png') });
    await info.attach('catalog-platform-recovery', { contentType: 'application/json', body: JSON.stringify({ fastPlatformVisibleWhileOtherHeld: true, failuresIsolatedBothWays: true, staleCatalogPreserved: true }) });
});
