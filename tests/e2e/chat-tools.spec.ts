import { expect, test, type Page } from '@playwright/test';
import { fixtureCall, priorityCases, sseFrame, toolHistoryError, toolResponse, type FixtureCall } from './fixtures/chat-tool-script';

test.setTimeout(90000);
const evidence = 'test-results/chat-tools';
const requests = new WeakMap<Page, Record<string, unknown>[]>();
const exceptions = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page }) => {
    exceptions.set(page, []);
    page.on('pageerror', error => exceptions.get(page)!.push(error.message));
    await page.route(/https?:\/\/(?!127\.0\.0\.1|localhost)/, route => route.fulfill({ json: { data: [], links: { next: null }, total_count: 0 } }));
});

async function open(page: Page, rounds: FixtureCall[][], scenario = 'normal', firstResponse?: string) {
    const captured: Record<string, unknown>[] = [];
    requests.set(page, captured);
    let round = 0;
    await page.route('**openrouter.ai/**', async route => {
        if (!route.request().url().includes('/chat/completions')) {
            await route.fulfill({ json: { data: [], links: { next: null }, total_count: 0 } }); return;
        }
        const body = route.request().postDataJSON();
        captured.push(body);
        const protocolError = toolHistoryError(body.messages);
        if (protocolError) { await route.fulfill({ status: 400, json: { error: { message: protocolError } } }); return; }
        const messages = body.messages as { role: string; content: unknown }[];
        const recovery = JSON.stringify(messages.at(-1)?.content).includes('Recovery message');
        const calls = recovery ? undefined : rounds[round++];
        await route.fulfill({ contentType: 'text/event-stream', body: firstResponse && captured.length === 1 ? firstResponse : calls
            ? toolResponse(calls)
            : sseFrame({ content: recovery ? 'Recovery completed.' : 'Fixture completed.' }, 'stop') + 'data: [DONE]\n\n' });
    });
    await page.goto('/__or3-chat-tools-test?scenario=' + scenario);
    await expect(page.getByRole('textbox', { name: 'Message input' })).toBeVisible({ timeout: 60000 });
}

async function send(page: Page, text = 'Run fixture') {
    await page.getByRole('textbox', { name: 'Message input' }).fill(text);
    await page.getByRole('button', { name: 'Send message', exact: true }).click();
}
async function recovered(page: Page) {
    await expect(page.getByRole('button', { name: 'Stop generation', exact: true })).toHaveCount(0);
    await expect(page.locator('.tool-call-indicator .animate-spin')).toHaveCount(0);
    await expect(page.getByRole('textbox', { name: 'Message input' })).toBeEditable();
    await send(page, 'Recovery message');
    await expect(page.locator('[data-msg-id]').filter({ hasText: 'Recovery completed.' })).toBeVisible();
    expect(exceptions.get(page)).toEqual([]);
}
async function snapshot(page: Page) {
    return JSON.parse(await page.locator('[data-fixture-snapshot]').textContent() ?? '{}') as {
        threadId: string;
        executions: { callId: string; tool: string }[];
        results: { callId: string; status: string; content: string; resolvedLength?: number; threadId: string; generationId: string }[];
        calls: { id: string; status: string; outcome?: string; error?: string; executionReceipt?: { state: string } }[];
        foreignResults: number;
    };
}
test.afterEach(async ({ page }, info) => {
    await info.attach('chat-tools-evidence', { contentType: 'application/json', body: JSON.stringify({
        browser: page.context().browser()?.version(), exceptions: exceptions.get(page),
        requests: requests.get(page)?.length, snapshot: await page.locator('[data-fixture-snapshot]').count()
            ? await snapshot(page).catch(() => null) : null }) });
    await page.screenshot({ path: `${evidence}/${info.title.replace(/[^a-z0-9]+/gi, '-')}-retry-${info.retry}-worker-${info.workerIndex}.png`, animations: 'disabled' });
});

for (const fixture of priorityCases) test(fixture.name, async ({ page }) => {
    await open(page, fixture.rounds, fixture.name.startsWith('7 ') ? 'disabled' : 'normal');
    await send(page);
    await expect(page.locator('[data-msg-id]').filter({ hasText: 'Fixture completed.' })).toBeVisible({ timeout: 20000 });
    await expect.poll(async () => (await snapshot(page)).executions.length).toBe(fixture.executions);
    const stored = await snapshot(page);
    expect(stored.results.filter(result => result.status === 'error')).toHaveLength(fixture.errors);
    expect(stored.calls.some(call => call.status === 'loading')).toBe(false);
    if (fixture.name === 'handler throws an oversized error') {
        expect(stored.results[0]!.content.length).toBeLessThan(1024);
        expect(JSON.stringify(stored)).not.toContain('private-fixture-secret');
    }
    for (const call of fixture.rounds.flat()) expect(stored.results.some(result => result.callId === call.id)).toBe(true);
    for (const result of stored.results) {
        expect(result.threadId).toBe(stored.threadId);
        expect(result.generationId).toEqual(expect.any(String));
    }
    if (fixture.pattern) {
        await page.locator('.tool-call-indicator summary').click();
        await expect(page.locator('.tool-call-indicator')).toContainText(fixture.pattern);
    }
    if (fixture.name.startsWith('3 ')) expect(stored.calls[0]?.outcome).toBe('timed_out');
    if (fixture.name.startsWith('8 ') || fixture.name.startsWith('9 ')) {
        expect(stored.results.find(result => result.callId === 'first')).toMatchObject({ status: 'complete', content: '{"value":"echo"}' });
    }
    if (fixture.name.startsWith('10 ') || fixture.name.startsWith('11 '))
        expect(stored.executions.filter(call => call.tool === 'test_write_once')).toHaveLength(1);
    await recovered(page);
});

test('a nonshipping router reaches the shared text and tool consumer with opaque identities', async ({ page }, info) => {
    await open(page, [], 'adapter-conformance');
    const result = JSON.parse(await page.locator('[data-adapter-conformance]').textContent() ?? '{}');
    expect(result.bodies).toEqual([{ id: 'vendor/model:online:free' },
        { id: 'vendor/model:online', input: [{ role: 'user', content: 'Fixture completion' }], limit: 12 }]);
    expect(result.events).toEqual(['text', 'tool_call', 'done']);
    expect(result.text).toBe('Fixture response');
    expect(result.tool).toMatchObject({ id: 'call-1', name: 'fixture_tool', arguments: '{"value":1}', status: 'pending' });
    expect(result.unsupported).toBe('Unsupported router option');
    expect(result.options).toEqual([]);
    expect(result.unsupportedSearch).toBe('Unsupported router option');
    expect(result.fixtureCompletion).toMatchObject({ content: 'Fixture response' });
    expect(result.completionBodies).toEqual([{ model: 'vendor/model:free',
        messages: [{ role: 'user', content: 'Title this' }], max_tokens: 48, stream: false,
        reasoning: { effort: 'none' } }]);
    expect(result.completion).toMatchObject({ content: 'Fixture title', finishReason: 'stop' });
    expect(result.wrongRouter).toBe('Model belongs to a different router');
    expect(await page.locator('[data-empty-router-selector] button').count()).toBe(0);
    expect(await page.locator('[data-empty-router-settings] [aria-label="Model variant"]').count()).toBe(0);
    await info.attach('adapter-conformance', { contentType: 'application/json', body: JSON.stringify(result) });
    expect(result.loopError).toBeUndefined();
    expect(result.loop.models).toEqual(['vendor/model:online:free', 'vendor/model:online:free']);
    expect(result.loop.toolExecutions).toBe(1);
    expect(result.loop.receiptBeforeExecution).toBe('running');
    expect(result.loop.assistantText).toBe('Fixture final answer');
    expect(result.loop.toolResult).toContain('fixture result');
    expect(result.loop.followup).toContain('fixture result');
    expect(result.loop.savedToolState).toBe('settled');
    await info.attach('adapter-foreground-loop', { contentType: 'application/json', body: JSON.stringify(result.loop) });
});

test('nonshipping router options retain opaque values in both presenters', async ({ page }, info) => {
    await open(page, [], 'custom-router-options');
    const selection = page.locator('[data-custom-router-selection]');
    await expect(selection).toHaveText('fixture:standard');
    await page.getByRole('button', { name: 'Fixture router options', exact: true }).click();
    await page.getByRole('listbox', { name: 'Fixture router options' }).getByRole('option', { name: /^Fixture fast/ }).click();
    await expect(selection).toHaveText('fixture:fast');
    await page.locator('[data-custom-router-settings]').getByRole('button', { name: 'Model variant', exact: true }).click();
    await page.getByRole('listbox', { name: 'Model variant' }).getByRole('option', { name: /^Fixture standard/ }).click();
    await expect(selection).toHaveText('fixture:standard');
    expect(exceptions.get(page)).toEqual([]);
    await info.attach('router-option-selection', { contentType: 'application/json', body: JSON.stringify({ selection: await selection.textContent() }) });
});

test('Web search remains a provider tool through a local tool round', async ({ page }, info) => {
    await open(page, [[fixtureCall('search-round', 'test_write_once')]]);
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('button', { name: 'Model variant', exact: true }).click();
    await page.getByRole('option', { name: /^Web search/ }).click();
    await page.getByRole('button', { name: 'Close chat settings', exact: true }).click();
    await send(page, 'Find evidence and run the local tool');
    await expect(page.locator('[data-msg-id]').filter({ hasText: 'Fixture completed.' })).toBeVisible({ timeout: 20000 });
    const sent = requests.get(page)!;
    expect(sent).toHaveLength(2);
    for (const body of sent) {
        expect(body.model).toBe('~openai/gpt-luna-latest');
        const tools = body.tools as { type: string; function?: { name: string } }[];
        expect(tools.filter(tool => tool.type === 'openrouter:web_search')).toHaveLength(1);
        expect(tools.some(tool => tool.function?.name === 'test_write_once')).toBe(true);
    }
    expect((sent[1]!.messages as { role: string; tool_call_id?: string }[])
        .some(message => message.role === 'tool' && message.tool_call_id === 'search-round')).toBe(true);
    expect((await snapshot(page)).executions.filter(call => call.tool === 'test_write_once')).toHaveLength(1);
    expect(exceptions.get(page)).toEqual([]);
    await info.attach('online-tool-round-requests', { contentType: 'application/json', body: JSON.stringify(sent) });
});

test('documentation help preserves its fixed model and documentation tool request', async ({ page }, info) => {
    await open(page, []);
    await page.goto('/documentation');
    await expect(async () => {
        const launcher = page.getByRole('button', { name: 'Open help chat', exact: true });
        if (await launcher.isVisible()) await launcher.click();
        await expect(page.getByPlaceholder('Ask about Or3 Chat…')).toBeVisible({ timeout: 1000 });
    }).toPass({ timeout: 15000 });
    await page.getByPlaceholder('Ask about Or3 Chat…').fill('How do workspaces work?');
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(page.getByText('Fixture completed.', { exact: true })).toBeVisible({ timeout: 20000 });
    const sent = requests.get(page)!;
    expect(sent).toHaveLength(1);
    expect(sent[0]!.model).toBe('google/gemini-3-flash-preview');
    expect(JSON.stringify(sent[0]!.messages)).toContain('You are the AI assistant for the Or3 Chat developer documentation.');
    expect((sent[0]!.tools as { function?: { name: string } }[]).some(tool => tool.function?.name === 'search_docs')).toBe(true);
    expect(exceptions.get(page)).toEqual([]);
    await info.attach('help-request', { contentType: 'application/json', body: JSON.stringify(sent[0]) });
});

test('legacy thinking suffix keeps its current interpretation when a catalog ID collides', async ({ page }, info) => {
    await open(page, [], 'thinking-collision');
    await send(page, 'Legacy thinking selection');
    await expect(page.locator('[data-msg-id]').filter({ hasText: 'Fixture completed.' })).toBeVisible({ timeout: 20000 });
    const sent = requests.get(page)!;
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ model: 'fixture/collision', reasoning: { effort: 'high' } });
    expect(exceptions.get(page)).toEqual([]);
    await info.attach('thinking-collision-request', { contentType: 'application/json', body: JSON.stringify(sent[0]) });
});

test('free catalog identity survives Off and Nitro provider requests', async ({ page }, info) => {
    await open(page, [], 'free-identity');
    await send(page, 'First free request');
    await expect(page.locator('[data-msg-id]').filter({ hasText: 'Fixture completed.' })).toHaveCount(1);
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('button', { name: 'Model variant', exact: true }).click();
    await page.getByRole('option', { name: /^Nitro/ }).click();
    await page.getByRole('button', { name: 'Close chat settings', exact: true }).click();
    await send(page, 'Second free request');
    await expect(page.locator('[data-msg-id]').filter({ hasText: 'Fixture completed.' })).toHaveCount(2);
    const sent = requests.get(page)!;
    expect(sent.map(body => body.model)).toEqual(['fixture/identity:free', 'fixture/identity:free:nitro']);
    expect(exceptions.get(page)).toEqual([]);
    await info.attach('free-identity-requests', { contentType: 'application/json', body: JSON.stringify(sent) });
});

test('native hook sequence surrounds durable acceptance and finalization', async ({ page }, info) => {
    await open(page, [], 'hook-order');
    await send(page, 'Record hook ordering');
    await expect(page.locator('[data-msg-id]').filter({ hasText: 'Fixture completed.' })).toBeVisible();
    const readTrace = async () => JSON.parse(await page.locator('[data-hook-trace]').textContent() || '[]') as string[];
    await expect.poll(async () => (await readTrace()).at(-1)).toBe('after');
    const trace = await readTrace();
    expect(trace).toEqual(['ui.chat.message:filter:outgoing', 'ai.chat.model:filter:select',
        'ai.chat.messages:filter:input', 'ai.chat.send:filter:prepare', 'before:2',
        'ai.chat.messages:filter:before_send', 'complete', 'after']);
    expect(exceptions.get(page)).toEqual([]);
    await info.attach('hook-order', { contentType: 'application/json', body: JSON.stringify({ trace, requests: requests.get(page) }) });
});

test('12 Stop during tool execution clears loading and permits another message', async ({ page }) => {
    await open(page, [[fixtureCall('cancel', 'test_slow')]]);
    await send(page);
    await expect.poll(async () => (await snapshot(page)).executions.length).toBe(1);
    await page.getByRole('button', { name: 'Stop generation', exact: true }).click();
    await page.getByRole('button', { name: 'Release slow tool' }).click();
    await recovered(page);
    expect((await snapshot(page)).calls.find(call => call.id === 'cancel')?.outcome).toBe('canceled');
    await page.reload();
    await expect(page.getByRole('textbox', { name: 'Message input' })).toBeVisible();
    expect((await snapshot(page)).executions).toHaveLength(1);
    await expect(page.locator('.tool-call-indicator .animate-spin')).toHaveCount(0);
});

for (const navigation of ['pane', 'workspace']) test(`13 switching ${navigation} preserves origin`, async ({ page }) => {
    await open(page, [[fixtureCall('origin', 'test_slow')]]);
    await send(page);
    await expect.poll(async () => (await snapshot(page)).executions.length).toBe(1);
    await page.getByRole('button', { name: navigation === 'pane' ? 'Switch conversation' : 'Switch workspace' }).click();
    const controls = page.locator('[data-navigation-state]');
    await expect(controls).toHaveAttribute('data-navigation-state', 'ready');
    await expect(controls).not.toHaveAttribute('data-active-thread', (await snapshot(page)).threadId);
    await page.getByRole('button', { name: 'Release slow tool' }).click();
    await page.getByRole('button', { name: 'Return to origin' }).click();
    await expect(controls).toHaveAttribute('data-navigation-state', 'ready');
    await expect(controls).toHaveAttribute('data-active-thread', (await snapshot(page)).threadId);
    await expect(page.locator('[data-msg-id]').filter({ hasText: 'Run fixture' })).toBeVisible();
    await expect.poll(async () => (await snapshot(page)).calls.find(call => call.id === 'origin')?.status).toBe('error');
    const origin = await snapshot(page);
    expect(origin.foreignResults).toBe(0);
    expect(origin.executions).toHaveLength(1);
    expect(origin.results.find(result => result.callId === 'origin')).toMatchObject({ status: 'error', threadId: origin.threadId });
    await recovered(page);
});

test('14 result database failure prevents continuation and recovers composer', async ({ page }) => {
    await open(page, [[fixtureCall('unsaved', 'test_write_once')]], 'persistence-failure');
    await send(page);
    await expect.poll(async () => (await snapshot(page)).executions.length).toBe(1);
    await expect(page.getByRole('button', { name: 'Stop generation', exact: true })).toHaveCount(0);
    expect(requests.get(page)).toHaveLength(1);
    expect((await snapshot(page)).results).toHaveLength(0);
    await page.locator('.tool-call-indicator summary').click();
    await expect(page.locator('.tool-call-indicator')).toContainText(/result could not be saved/);
    expect((await snapshot(page)).calls[0]?.outcome).toBe('unresolved');
    expect((await snapshot(page)).calls[0]?.executionReceipt?.state).toBe('unresolved');
    await expect(page.locator('[data-msg-id]').filter({ hasText: 'Run fixture' })).toBeVisible();
    await recovered(page);
    expect((await snapshot(page)).executions).toHaveLength(1);
    await page.reload();
    await expect(page.getByRole('textbox', { name: 'Message input' })).toBeVisible();
    await expect.poll(async () => (await snapshot(page)).calls.find(call => call.id === 'unsaved')?.outcome).toBe('unresolved');
    expect((await snapshot(page)).executions).toHaveLength(1);
    expect((await snapshot(page)).results).toHaveLength(0);
    await recovered(page);
});

for (const reload of [false, true]) test(`uncertain write refuses native Retry${reload ? ' after reload' : ''}`, async ({ page }) => {
    await open(page, [[fixtureCall('unsaved-retry', 'test_write_once')]], 'persistence-failure');
    await send(page);
    await expect.poll(async () => (await snapshot(page)).calls[0]?.outcome).toBe('unresolved');
    await expect(page.getByRole('button', { name: 'Stop generation', exact: true })).toHaveCount(0);
    if (reload) {
        await page.reload();
        await expect(page.getByRole('textbox', { name: 'Message input' })).toBeVisible();
        await expect.poll(async () => (await snapshot(page)).calls[0]?.outcome).toBe('unresolved');
        await expect(page.getByRole('button', { name: 'Retry message', exact: true })).toHaveCount(2);
    }
    await page.getByRole('button', { name: 'Retry message', exact: true }).last().click({ force: true });
    await expect(page.getByText('Retry did not start', { exact: true })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Notifications (F8)' })
        .getByText(/Retry is blocked to avoid repeating an operation/)).toBeVisible();
    expect((await snapshot(page)).executions).toHaveLength(1);
    expect(requests.get(page)).toHaveLength(1);
    await expect(page.locator('[data-msg-id]').filter({ hasText: 'Run fixture' })).toBeVisible();
    await recovered(page);
});

test('15 reload restores success and failure without executing again', async ({ page }) => {
    await open(page, [[fixtureCall('saved', 'test_write_once'), fixtureCall('failed', 'test_fail')]]);
    await send(page);
    await expect(page.locator('[data-msg-id]').filter({ hasText: 'Fixture completed.' })).toBeVisible();
    const before = await snapshot(page);
    await page.reload();
    await expect(page.getByRole('textbox', { name: 'Message input' })).toBeVisible();
    await expect.poll(async () => (await snapshot(page)).results.length).toBe(2);
    const after = await snapshot(page);
    expect(after.executions).toEqual(before.executions);
    expect(after.results).toEqual(before.results);
    await page.locator('.tool-call-indicator summary').click();
    await expect(page.locator('.tool-call-indicator')).toContainText('deliberate fixture failure');
    await recovered(page);
});

test('large results respect durable model and rendering limits', async ({ page }) => {
    await open(page, [[fixtureCall('large', 'test_large_result')]]);
    await send(page);
    await expect(page.locator('[data-msg-id]').filter({ hasText: 'Fixture completed.' })).toBeVisible();
    // The row holds a bounded artifact reference; the stored artifact keeps the full result.
    const [result] = (await snapshot(page)).results;
    expect(result!.content).toMatch(/^or3-tool-result:v1\//);
    expect(result!.resolvedLength).toBe(160 * 1024);
    const continuation = JSON.stringify(requests.get(page)!.at(-1));
    expect(continuation).toContain('omitted');
    expect(continuation.length).toBeLessThan(128 * 1024);
    await recovered(page);
});

test('development inspector redacts arguments and results', async ({ page }) => {
    await open(page, [[fixtureCall('inspect', 'test_echo', 'secret-fixture-value')]]);
    await send(page);
    await expect(page.locator('[data-msg-id]').filter({ hasText: 'Fixture completed.' })).toBeVisible();
    await page.getByText('Tool Call Inspector', { exact: true }).click();
    await page.getByLabel('Inspect tool call').selectOption('inspect');
    const metadata = JSON.parse(await page.locator('[data-tool-inspector]').textContent() ?? '{}');
    expect(metadata).toMatchObject({ callId: 'inspect', runtime: 'client', validation: 'accepted',
        persistence: 'saved', arguments: '[redacted]', result: '[redacted]' });
    expect(metadata.endedAt).toBeGreaterThanOrEqual(metadata.startedAt);
    expect(JSON.stringify(metadata)).not.toContain('secret-fixture-value');
    await page.reload();
    await expect(page.getByRole('textbox', { name: 'Message input' })).toBeVisible();
    await page.getByText('Tool Call Inspector', { exact: true }).click();
    await page.getByLabel('Inspect tool call').selectOption('inspect');
    const restored = JSON.parse(await page.locator('[data-tool-inspector]').textContent() ?? '{}');
    expect(restored.startedAt).toBe(metadata.startedAt);
    expect(restored.endedAt).toBe(metadata.endedAt);
    await recovered(page);
});

for (const [name, brokenStream] of [
    ['malformed JSON', 'data: {broken}\n\n'],
    ['missing call identity', sseFrame({ tool_calls: [{ index: 0, function: { name: 'test_write_once', arguments: '{"value":"write"}' } }] }, 'tool_calls')],
    ['unfinished tool arguments', sseFrame({ tool_calls: [{ index: 0, id: 'partial', function: { name: 'test_write_once', arguments: '{"value":' } }] }) + 'data: [DONE]\n\n'],
    ['provider error after tool starts', sseFrame({ tool_calls: [{ index: 0, id: 'provider-error', function: { name: 'test_write_once', arguments: '{"value":' } }] }) + 'data: {"error":{"message":"fixture provider failed","status":503}}\n\n'],
] as const) test(`protocol failure recovers chat: ${name}`, async ({ page }) => {
    await open(page, [], 'normal', sseFrame({ content: 'Preserved partial text.' }) + brokenStream);
    await send(page);
    await expect(page.locator('[data-msg-id]').filter({ hasText: 'Preserved partial text.' })).toBeVisible();
    await recovered(page);
    expect((await snapshot(page)).executions).toHaveLength(0);
    expect((await snapshot(page)).results).toHaveLength(0);
});
