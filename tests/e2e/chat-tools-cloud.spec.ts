import { expect, test, type APIRequestContext } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { modelSearchDefinition } from '../../shared/openrouter/delegation-model-catalog';
import { normalizeError } from '../../shared/errors';

test.setTimeout(90000);
test.beforeAll(() => {
    expect(process.env.OR3_CHAT_TOOLS_CLOUD_TEST_HARNESS).toBe('true');
    expect(process.env.OR3_BASIC_AUTH_DB_PATH).toMatch(/^\/tmp\/or3-chat-tools-cloud-/);
    expect(['memory', 'sqlite']).toContain(process.env.OR3_BACKGROUND_STREAMING_PROVIDER);
    expect(process.env.OR3_SQLITE_DB_PATH).toMatch(/^\/tmp\/or3-chat-tools-cloud-/);
});
const definition = (name: string) => ({ type: 'function', function: { name, description: 'Cloud reliability fixture',
    parameters: { type: 'object', properties: { value: { type: 'string' } }, required: ['value'], additionalProperties: false } } });

async function start(request: APIRequestContext, origin: string, name: string, runtime = 'server', mode = 'normal') {
    const headers = { origin, 'x-or3-cloud-intent': 'mutation' };
    const login = await request.post('/api/basic-auth/sign-in', { headers, data: {
        email: 'chat-tools@example.test', password: 'DisposableToolSuite!123',
    } });
    expect(login.ok(), await login.text()).toBe(true);
    const session = await (await request.get('/api/auth/session')).json();
    const workspaceId = session.session.workspace.id as string;
    const id = randomUUID(), threadId = 'thread-' + id, messageId = 'assistant-' + id;
    const timestamp = Math.floor(Date.now() / 1000);
    const row = { clock: 1, created_at: timestamp, updated_at: timestamp, deleted: false };
    const response = await request.post('/api/openrouter/stream', { headers, data: {
        model: 'fixture/model', messages: [{ role: 'user', content: `cloud:${mode}:${id}` }], tools: [definition(name)],
        _background: true, _threadId: threadId, _messageId: messageId, _clientDeviceId: 'fixture-device',
        _toolRuntime: { [name]: runtime }, _backgroundAdmissionId: id,
        _history: { version: 1, kind: 'new-turn', admissionId: id, generationId: id, workspaceId, threadId, messageId,
            thread: { ...row, id: threadId, title: 'Cloud tool fixture' },
            userMessage: { ...row, id: 'user-' + id, thread_id: threadId, role: 'user', index: 0, data: { content: 'Run tool fixture' } },
            assistantMessage: { ...row, id: messageId, thread_id: threadId, role: 'assistant', index: 1,
                pending: true, data: { content: '', generation_id: id, generation_state: 'streaming' } },
        },
    } });
    expect(response.ok(), await response.text()).toBe(true);
    return { jobId: (await response.json()).jobId as string, workspaceId, threadId, messageId, callId: id };
}
async function status(request: APIRequestContext, jobId: string) {
    const response = await request.get(`/api/jobs/${jobId}/status`);
    expect(response.ok(), await response.text()).toBe(true);
    return response.json();
}

async function startDurableDraft(request: APIRequestContext, origin: string, prompt = 'durable-parent') {
    const headers = { origin, 'x-or3-cloud-intent': 'mutation' };
    const login = await request.post('/api/basic-auth/sign-in', { headers, data: {
        email: 'chat-tools@example.test', password: 'DisposableToolSuite!123',
    } });
    expect(login.ok(), await login.text()).toBe(true);
    const session = await (await request.get('/api/auth/session')).json();
    const workspaceId = session.session.workspace.id as string;
    const id = randomUUID(), threadId = `thread-${id}`, messageId = `assistant-${id}`;
    const timestamp = Math.floor(Date.now() / 1000);
    const row = { clock: 1, created_at: timestamp, updated_at: timestamp, deleted: false };
    const admitted = await request.post('/api/openrouter/stream', { headers, data: {
        model: 'fixture/model', messages: [{ role: 'user', content: prompt }],
        tools: [{ type: 'function', function: { name: 'delegate_chat', description: 'Delegate',
            parameters: { type: 'object', properties: {} } } }, ...(prompt === 'durable-search' ? [modelSearchDefinition] : [])], modalities: ['text'],
        _toolRuntime: { delegate_chat: 'client', ...(prompt === 'durable-search' ? { search_models: 'hybrid' } : {}) },
        _context: { version: 1, user_max_context_tokens: null, requested_completion_tokens: null },
        _durableDelegation: 1, _delegationDefaults: { version: 1, instructions: [] },
        _background: true, _threadId: threadId, _messageId: messageId, _clientDeviceId: 'fixture-device', _backgroundAdmissionId: id,
        _history: { version: 1, kind: 'new-turn', admissionId: id, generationId: id, workspaceId, threadId, messageId,
            thread: { ...row, id: threadId, title: 'Durable research' },
            userMessage: { ...row, id: `user-${id}`, thread_id: threadId, role: 'user', index: 0, data: { content: prompt } },
            assistantMessage: { ...row, id: messageId, thread_id: threadId, role: 'assistant', index: 1,
                pending: true, data: { content: '', generation_id: id, generation_state: 'streaming' } },
        },
    } });
    expect(admitted.ok(), await admitted.text()).toBe(true);
    return { jobId: (await admitted.json()).jobId as string, threadId, messageId, workspaceId };
}

test('durable delegation browser closure preserves concurrent child results', async ({ browser, playwright }, info) => {
    test.skip(process.env.OR3_DELEGATION_DRAFT_E2E !== 'true', 'Requires the isolated draft provider profile.');
    const origin = String(info.project.use.baseURL);
    const fixtureUrl = process.env.OR3_DELEGATION_FIXTURE_URL!;
    const fixtureHeaders = { 'x-fixture-token': process.env.OR3_DELEGATION_FIXTURE_TOKEN! };
    const fixture = async () => (await fetch(fixtureUrl, { headers: fixtureHeaders })).json() as Promise<{ requests: string[] }>;
    const headers = { origin, 'x-or3-cloud-intent': 'mutation' };
    const context = await browser.newContext();
    const page = await context.newPage();
    const { jobId, threadId, messageId, workspaceId } = await startDurableDraft(page.request, origin);
    await expect.poll(async () => (await fixture()).requests.filter(value => value.startsWith('durable-child-')).length,
        { timeout: 45000 }).toBe(2);
    const storageState = await context.storageState();
    await context.close();
    await fetch(fixtureUrl, { method: 'POST', headers: fixtureHeaders });
    const observer = await playwright.request.newContext({ baseURL: origin, storageState });
    try {
        await expect.poll(async () => (await status(observer, jobId)).status, { timeout: 60000 }).toBe('complete');
        const saved = await status(observer, jobId);
        expect(saved.content).toContain('Both research tasks finished.');
        const activity = saved.tool_calls.find((call: { id: string }) => call.id === 'durable-delegate');
        expect(activity.delegation.children.map((child: { outcome: string }) => child.outcome)).toEqual(['complete', 'complete']);
        expect(activity.delegation.children.every((child: { threadId?: string }) => child.threadId)).toBe(true);
        const calls = (await fixture()).requests;
        expect(calls[0]).toBe('parent-initial');
        expect(calls.at(-1)).toBe('parent-resume');
        expect(calls.slice(1, -1).sort()).toEqual(['durable-child-one', 'durable-child-two']);
        const pull = await observer.post('/api/sync/pull', { headers, data: {
            scope: { workspaceId }, cursor: 0, limit: 1000, fileKindCapability: 'v1',
        } });
        expect(pull.ok(), await pull.text()).toBe(true);
        const history = await pull.text();
        expect(history).toContain(messageId);
        for (const child of activity.delegation.children) expect(history).toContain(child.threadId);
        const returned = await browser.newContext({ storageState, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
        try {
            const returnedPage = await returned.newPage();
            await returnedPage.goto(`/chat/${threadId}`);
            await expect(returnedPage.getByText('Both research tasks finished.')).toBeVisible({ timeout: 45000 });
            const childLinks = returnedPage.getByRole('button', { name: 'Open fixture/model chat in a new tab' });
            await expect(childLinks).toHaveCount(2, { timeout: 45000 });
            await childLinks.first().tap();
            await expect(returnedPage.getByText('durable-child-one result')).toBeVisible({ timeout: 30000 });
            await returnedPage.goto(`/chat/${threadId}`);
            await expect(childLinks).toHaveCount(2, { timeout: 30000 });
            await childLinks.nth(1).focus();
            await returnedPage.keyboard.press('Enter');
            await expect(returnedPage.getByText('durable-child-two result')).toBeVisible({ timeout: 30000 });
        } finally { await returned.close(); }
        await info.attach('durable-closure-receipt', { contentType: 'application/json',
            body: JSON.stringify({ requests: (await fixture()).requests, jobId, threadId, childCount: activity.delegation.children.length }) });
    } finally { await observer.dispose(); }
});

test('durable delegation single mobile child opens after browser closure', async ({ browser, playwright }, info) => {
    test.skip(process.env.OR3_DELEGATION_DRAFT_E2E !== 'true', 'Requires the isolated draft provider profile.');
    const origin = String(info.project.use.baseURL);
    const fixtureUrl = process.env.OR3_DELEGATION_FIXTURE_URL!;
    const fixtureHeaders = { 'x-fixture-token': process.env.OR3_DELEGATION_FIXTURE_TOKEN! };
    const fixture = async () => (await fetch(fixtureUrl, { headers: fixtureHeaders })).json() as Promise<{ requests: string[]; childModel?: string }>;
    const context = await browser.newContext();
    try {
        const page = await context.newPage();
        const { jobId, threadId } = await startDurableDraft(page.request, origin, 'durable-single');
        await expect.poll(async () => (await fixture()).requests.filter(value => value === 'durable-child-one').length,
            { timeout: 45000 }).toBe(1);
        const storageState = await context.storageState();
        await context.close();
        await fetch(fixtureUrl, { method: 'POST', headers: fixtureHeaders });
        const observer = await playwright.request.newContext({ baseURL: origin, storageState });
        try {
            await expect.poll(async () => (await status(observer, jobId)).status, { timeout: 60000 }).toBe('complete');
            const returned = await browser.newContext({ storageState, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
            try {
                const returnedPage = await returned.newPage();
                await returnedPage.goto(`/chat/${threadId}`);
                const child = returnedPage.getByRole('button', { name: 'Open fixture/model:nitro chat in a new tab' });
                await expect(child).toBeVisible({ timeout: 45000 });
                await child.tap();
                await expect(returnedPage.getByText('durable-child-one result')).toBeVisible({ timeout: 30000 });
                await returnedPage.getByRole('button', { name: 'Settings', exact: true }).click();
                await expect(returnedPage.getByLabel('Current model')).toContainText('Fixture');
                await expect(returnedPage.getByLabel('Model variant')).toContainText('Nitro');
                expect((await fixture()).childModel).toBe('fixture/model:nitro');
            } finally { await returned.close(); }
        } finally { await observer.dispose(); }
    } finally {
        await fetch(fixtureUrl, { method: 'POST', headers: fixtureHeaders }).catch(() => {});
        await context.close().catch(() => {});
    }
});

test('durable delegation searches the catalog before choosing a child model', async ({ browser, playwright }, info) => {
    test.skip(process.env.OR3_DELEGATION_DRAFT_E2E !== 'true', 'Requires the isolated draft provider profile.');
    const origin = String(info.project.use.baseURL);
    const fixtureUrl = process.env.OR3_DELEGATION_FIXTURE_URL!;
    const fixtureHeaders = { 'x-fixture-token': process.env.OR3_DELEGATION_FIXTURE_TOKEN! };
    const fixture = async () => (await fetch(fixtureUrl, { headers: fixtureHeaders })).json() as Promise<{
        requests: string[]; searchedModelIds: string[]; childModel: string;
    }>;
    const context = await browser.newContext();
    try {
        const page = await context.newPage();
        const { jobId } = await startDurableDraft(page.request, origin, 'durable-search');
        await expect.poll(async () => (await fixture()).childModel, { timeout: 45000 }).toBe('openai/gpt-6.1-terra');
        const storageState = await context.storageState();
        await context.close();
        await fetch(fixtureUrl, { method: 'POST', headers: fixtureHeaders });
        const observer = await playwright.request.newContext({ baseURL: origin, storageState });
        try {
            await expect.poll(async () => (await status(observer, jobId)).status, { timeout: 60000 }).toBe('complete');
            const captured = await fixture();
            expect(captured.searchedModelIds).toEqual(['openai/gpt-6.1-terra']);
            expect(captured.requests).toEqual(['parent-search', 'parent-delegate', 'durable-child-one', 'parent-resume']);
        } finally { await observer.dispose(); }
    } finally {
        await fetch(fixtureUrl, { method: 'POST', headers: fixtureHeaders }).catch(() => {});
        await context.close().catch(() => {});
    }
});

test('durable delegation interrupted dispatch stays unknown without repeating requests', async ({ browser, playwright }, info) => {
    test.skip(process.env.OR3_DELEGATION_MANAGED_SERVER !== 'true', 'Requires the disposable managed restart profile.');
    test.setTimeout(210_000);
    const origin = String(info.project.use.baseURL);
    const fixtureUrl = process.env.OR3_DELEGATION_FIXTURE_URL!;
    const fixtureHeaders = { 'x-fixture-token': process.env.OR3_DELEGATION_FIXTURE_TOKEN! };
    const fixture = async () => (await fetch(fixtureUrl, { headers: fixtureHeaders })).json() as Promise<{ requests: string[]; restartCount: number; modelOutcomes: string[] }>;
    const context = await browser.newContext();
    const page = await context.newPage();
    const { jobId, threadId } = await startDurableDraft(page.request, origin);
    await expect.poll(async () => (await fixture()).requests.filter(value => value.startsWith('durable-child-')).length,
        { timeout: 45000 }).toBe(2);
    const storageState = await context.storageState();
    await context.close();
    const restarted = await fetch(`${fixtureUrl}?action=crash`, { method: 'POST', headers: fixtureHeaders });
    expect(restarted.ok, await restarted.text()).toBe(true);
    expect((await fixture()).restartCount).toBe(1);
    await fetch(fixtureUrl, { method: 'POST', headers: fixtureHeaders });
    const observer = await playwright.request.newContext({ baseURL: origin, storageState });
    try {
        await expect.poll(async () => (await status(observer, jobId)).status, { timeout: 120000 }).toBe('complete');
        const saved = await status(observer, jobId);
        const activity = saved.tool_calls.find((call: { id: string }) => call.id === 'durable-delegate');
        expect(activity.delegation.children.map((child: { outcome: string }) => child.outcome)).toEqual(['unknown', 'unknown']);
        expect(saved.content).toContain('Some results are unknown.');
        expect((await fixture()).modelOutcomes).toEqual(['unknown', 'unknown']);
        const calls = (await fixture()).requests;
        expect(calls[0]).toBe('parent-initial');
        expect(calls.at(-1)).toBe('parent-resume');
        expect(calls.slice(1, -1).sort()).toEqual(['durable-child-one', 'durable-child-two']);
        const returned = await browser.newContext({ storageState, viewport: { width: 390, height: 844 } });
        try {
            const returnedPage = await returned.newPage();
            await returnedPage.goto(`/chat/${threadId}`);
            await expect(returnedPage.getByText('Some results are unknown.')).toBeVisible({ timeout: 45000 });
            await expect(returnedPage.getByText('fixture/model outcome unknown')).toHaveCount(2);
        } finally { await returned.close(); }
        await info.attach('durable-crash-receipt', { contentType: 'application/json', body: JSON.stringify({
            requests: calls, restartCount: 1, outcomes: ['unknown', 'unknown'], jobId,
        }) });
    } finally { await observer.dispose(); }
});

test('durable delegation interrupted parent dispatch remains unknown without repeating the request', async ({ browser, playwright }, info) => {
    test.skip(process.env.OR3_DELEGATION_HOLD_PARENT !== 'true', 'Requires the disposable held-parent restart profile.');
    test.setTimeout(210_000);
    const origin = String(info.project.use.baseURL);
    const fixtureUrl = process.env.OR3_DELEGATION_FIXTURE_URL!;
    const fixtureHeaders = { 'x-fixture-token': process.env.OR3_DELEGATION_FIXTURE_TOKEN! };
    const fixture = async () => (await fetch(fixtureUrl, { headers: fixtureHeaders })).json() as Promise<{ requests: string[]; restartCount: number }>;
    const context = await browser.newContext();
    const page = await context.newPage();
    const { jobId, threadId, messageId, workspaceId } = await startDurableDraft(page.request, origin);
    await expect.poll(async () => (await fixture()).requests, { timeout: 45000 }).toEqual(['parent-initial']);
    const storageState = await context.storageState();
    await context.close();
    const restarted = await fetch(`${fixtureUrl}?action=crash`, { method: 'POST', headers: fixtureHeaders });
    expect(restarted.ok, await restarted.text()).toBe(true);
    expect((await fixture()).restartCount).toBe(1);
    await fetch(fixtureUrl, { method: 'POST', headers: fixtureHeaders });
    const observer = await playwright.request.newContext({ baseURL: origin, storageState });
    try {
        await expect.poll(async () => (await status(observer, jobId)).status, { timeout: 120000 }).toBe('error');
        const saved = await status(observer, jobId);
        expect(normalizeError(saved.error)).toMatchObject({ code: 'ERR_MODEL_OUTCOME_UNKNOWN' });
        expect(saved.tool_calls ?? []).toEqual([]);
        expect((await fixture()).requests).toEqual(['parent-initial']);
        const pull = await observer.post('/api/sync/pull', { headers: { origin, 'x-or3-cloud-intent': 'mutation' }, data: {
            scope: { workspaceId }, cursor: 0, limit: 1000, fileKindCapability: 'v1',
        } });
        expect(pull.ok(), await pull.text()).toBe(true);
        const history = await pull.text();
        expect(history).toContain(messageId);
        expect(history).not.toContain('durable-delegate');
        const returned = await browser.newContext({ storageState, viewport: { width: 390, height: 844 } });
        try {
            const returnedPage = await returned.newPage();
            await returnedPage.goto(`/chat/${threadId}`);
            await expect(returnedPage.getByText('The model may have received this request. Check the chat before starting it again.'))
                .toBeVisible({ timeout: 45000 });
        } finally { await returned.close(); }
        await info.attach('durable-parent-crash-receipt', { contentType: 'application/json', body: JSON.stringify({
            requests: (await fixture()).requests, restartCount: 1, outcome: 'unknown', jobId,
        }) });
    } finally { await observer.dispose(); }
});

test('durable delegation completed children restart before parent settlement', async ({ browser, playwright }, info) => {
    test.skip(process.env.OR3_DELEGATION_SETTLED_RESTART !== 'true', 'Requires the disposable settled-child restart profile.');
    test.setTimeout(210_000);
    const origin = String(info.project.use.baseURL);
    const fixtureUrl = process.env.OR3_DELEGATION_FIXTURE_URL!;
    const headers = { 'x-fixture-token': process.env.OR3_DELEGATION_FIXTURE_TOKEN! };
    const fixture = async () => (await fetch(fixtureUrl, { headers })).json() as Promise<{
        requests: string[]; restartCount: number; modelOutcomes: string[]; parentToolResults: number;
        checkpoint: { idleParents: number; completedChildren: number; settlements: number };
    }>;
    const context = await browser.newContext();
    const page = await context.newPage();
    const { jobId, threadId } = await startDurableDraft(page.request, origin);
    try {
        await expect.poll(async () => (await fixture()).requests.filter(value => value.startsWith('durable-child-')).length,
            { timeout: 45000 }).toBe(2);
        expect((await fetch(`${fixtureUrl}?action=pause`, { method: 'POST', headers })).ok).toBe(true);
        await expect.poll(async () => (await fixture()).checkpoint.idleParents, { timeout: 30000 }).toBe(1);
        const storageState = await context.storageState();
        await context.close();
        await fetch(fixtureUrl, { method: 'POST', headers });
        await expect.poll(async () => (await fixture()).checkpoint.completedChildren, { timeout: 60000 }).toBe(2);
        expect((await fixture()).checkpoint).toEqual({ idleParents: 1, completedChildren: 2, settlements: 0 });
        const restarted = await fetch(`${fixtureUrl}?action=crash`, { method: 'POST', headers });
        expect(restarted.ok, await restarted.text()).toBe(true);
        expect((await fixture()).restartCount).toBe(1);
        expect((await fixture()).checkpoint).toEqual({ idleParents: 1, completedChildren: 2, settlements: 0 });
        expect((await fetch(`${fixtureUrl}?action=resume`, { method: 'POST', headers })).ok).toBe(true);
        const observer = await playwright.request.newContext({ baseURL: origin, storageState });
        try {
            await expect.poll(async () => (await status(observer, jobId)).status, { timeout: 90000 }).toBe('complete');
            const saved = await status(observer, jobId);
            const calls = saved.tool_calls.filter((call: { id: string }) => call.id === 'durable-delegate');
            expect(calls).toHaveLength(1);
            const activity = calls[0];
            expect(activity.delegation.children.map((child: { outcome: string }) => child.outcome)).toEqual(['complete', 'complete']);
            const captured = await fixture();
            expect(captured.modelOutcomes).toEqual(['complete', 'complete']);
            expect(captured.parentToolResults).toBe(1);
            expect(captured.requests[0]).toBe('parent-initial');
            expect(captured.requests.at(-1)).toBe('parent-resume');
            expect(captured.requests.slice(1, -1).sort()).toEqual(['durable-child-one', 'durable-child-two']);
            const returned = await browser.newContext({ storageState, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
            try {
                const returnedPage = await returned.newPage();
                await returnedPage.goto(`/chat/${threadId}`);
                await expect(returnedPage.getByText('Both research tasks finished.')).toBeVisible({ timeout: 45000 });
                await expect(returnedPage.getByRole('button', { name: 'Open fixture/model chat in a new tab' })).toHaveCount(2);
            } finally { await returned.close(); }
            await info.attach('durable-settled-restart-receipt', { contentType: 'application/json', body: JSON.stringify({
                requests: captured.requests, restartCount: captured.restartCount, outcomes: captured.modelOutcomes, jobId,
            }) });
        } finally { await observer.dispose(); }
    } finally {
        await fetch(`${fixtureUrl}?action=resume`, { method: 'POST', headers }).catch(() => {});
        await fetch(fixtureUrl, { method: 'POST', headers }).catch(() => {});
        await context.close().catch(() => {});
    }
});

test('durable delegation safe checkpoint restarts before admitting children', async ({ browser, playwright }, info) => {
    test.skip(process.env.OR3_DELEGATION_SAFE_GATE !== 'true', 'Requires the disposable coordinator gate profile.');
    test.setTimeout(210_000);
    const origin = String(info.project.use.baseURL);
    const fixtureUrl = process.env.OR3_DELEGATION_FIXTURE_URL!;
    const fixtureHeaders = { 'x-fixture-token': process.env.OR3_DELEGATION_FIXTURE_TOKEN! };
    const fixture = async () => (await fetch(fixtureUrl, { headers: fixtureHeaders })).json() as Promise<{ requests: string[]; restartCount: number; modelOutcomes: string[] }>;
    const context = await browser.newContext();
    const page = await context.newPage();
    const { jobId } = await startDurableDraft(page.request, origin);
    await expect.poll(async () => {
        const saved = await status(page.request, jobId);
        return saved.tool_calls?.find((call: { id: string }) => call.id === 'durable-delegate')?.delegation?.children
            ?.map((child: { outcome: string }) => child.outcome);
    }, { timeout: 45000 }).toEqual(['waiting', 'waiting']);
    expect((await fixture()).requests).toEqual(['parent-initial']);
    const storageState = await context.storageState();
    await context.close();
    const restarted = await fetch(`${fixtureUrl}?action=crash`, { method: 'POST', headers: fixtureHeaders });
    expect(restarted.ok, await restarted.text()).toBe(true);
    expect((await fixture()).restartCount).toBe(1);
    expect((await fixture()).requests).toEqual(['parent-initial']);
    const resumed = await fetch(`${fixtureUrl}?action=resume`, { method: 'POST', headers: fixtureHeaders });
    expect(resumed.ok).toBe(true);
    await expect.poll(async () => (await fixture()).requests.filter(value => value.startsWith('durable-child-')).length,
        { timeout: 60000 }).toBe(2);
    await fetch(fixtureUrl, { method: 'POST', headers: fixtureHeaders });
    const observer = await playwright.request.newContext({ baseURL: origin, storageState });
    try {
        await expect.poll(async () => (await status(observer, jobId)).status, { timeout: 90000 }).toBe('complete');
        const saved = await status(observer, jobId);
        const activity = saved.tool_calls.find((call: { id: string }) => call.id === 'durable-delegate');
        expect(activity.delegation.children.map((child: { outcome: string }) => child.outcome)).toEqual(['complete', 'complete']);
        const captured = await fixture();
        expect(captured.modelOutcomes).toEqual(['complete', 'complete']);
        expect(captured.requests[0]).toBe('parent-initial');
        expect(captured.requests.at(-1)).toBe('parent-resume');
        expect(captured.requests.slice(1, -1).sort()).toEqual(['durable-child-one', 'durable-child-two']);
        await info.attach('durable-safe-restart-receipt', { contentType: 'application/json', body: JSON.stringify({
            requests: captured.requests, restartCount: 1, outcomes: captured.modelOutcomes, jobId,
        }) });
    } finally { await observer.dispose(); }
});

for (const interruption of ['browser closure', 'offline reconnect'] as const) test(`durable delegation composer ${interruption} preserves results`, async ({ browser, playwright }, info) => {
    test.skip(process.env.OR3_DELEGATION_DRAFT_E2E !== 'true', 'Requires the isolated draft provider profile.');
    test.setTimeout(150_000);
    const origin = String(info.project.use.baseURL);
    const fixtureUrl = process.env.OR3_DELEGATION_FIXTURE_URL!;
    const fixtureHeaders = { 'x-fixture-token': process.env.OR3_DELEGATION_FIXTURE_TOKEN! };
    const fixture = async () => (await fetch(fixtureUrl, { headers: fixtureHeaders })).json() as Promise<{ requests: string[] }>;
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await context.addInitScript(() => {
        localStorage.setItem('last_selected_model', 'fixture/model');
        localStorage.setItem('or3.tools.enabled', JSON.stringify({ search_threads: false, read_thread: false,
            send_message_to_thread: false, workspace_search: false, workspace_read: false, workspace_create_document: false,
            workspace_update_project: false, workspace_propose_document_edit: false, duplicate_document: false, search_documents: false,
            get_open_pane_context: false, get_document_outline: false, list_document_chunks: false, read_blocks: false,
            search_document: false, propose_edits: false, get_proposal_status: false, delegate_chat: true, search_models: true }));
    });
    const page = await context.newPage();
    try {
        const login = await page.request.post('/api/basic-auth/sign-in', { headers: { origin, 'x-or3-cloud-intent': 'mutation' }, data: {
            email: 'chat-tools@example.test', password: 'DisposableToolSuite!123',
        } });
        expect(login.ok(), await login.text()).toBe(true);
        await page.goto('/');
        const input = page.getByRole('textbox', { name: 'Message input' });
        await expect(input).toBeVisible({ timeout: 45000 });
        await input.fill('durable-parent');
        const admitted = page.waitForResponse(response => response.url().endsWith('/api/openrouter/stream') && response.request().method() === 'POST', { timeout: 45000 });
        await page.getByRole('button', { name: 'Send message', exact: true }).click();
        const response = await admitted;
        expect(response.ok(), await response.text()).toBe(true);
        const body = response.request().postDataJSON() as { _durableDelegation?: number; _threadId: string; _toolRuntime?: Record<string, string>; _background?: boolean; _delegationDefaults?: unknown };
        const capability = await (await page.request.get('/api/jobs/client-tool/capability')).json();
        expect(body._durableDelegation, JSON.stringify({ runtime: body._toolRuntime, background: body._background,
            defaultsCaptured: !!body._delegationDefaults, capability })).toBe(1);
        expect(body._toolRuntime).toMatchObject({ delegate_chat: 'client', search_models: 'hybrid' });
        const jobId = (await response.json()).jobId as string;
        await expect.poll(async () => (await fixture()).requests.filter(value => value.startsWith('durable-child-')).length,
            { timeout: 45000 }).toBe(2);
        const storageState = await context.storageState();
        if (interruption === 'browser closure') await context.close();
        else {
            await expect(page.getByText('fixture/model working')).toHaveCount(2, { timeout: 30000 });
            await context.setOffline(true);
            await expect(page.getByRole('status').filter({ hasText: 'Reconnecting' })).toBeVisible({ timeout: 15000 });
            await expect(page.getByText(/Chat could not finish/i)).toHaveCount(0);
        }
        await fetch(fixtureUrl, { method: 'POST', headers: fixtureHeaders });
        const observer = await playwright.request.newContext({ baseURL: origin, storageState });
        try {
            await expect.poll(async () => (await status(observer, jobId)).status, { timeout: 60000 }).toBe('complete');
            if (interruption === 'offline reconnect') {
                await context.setOffline(false);
                await expect(page.getByText('Both research tasks finished.')).toBeVisible({ timeout: 45000 });
                await expect(page.getByRole('button', { name: 'Open fixture/model chat in a new tab' })).toHaveCount(2);
                await expect(page.getByRole('status').filter({ hasText: 'Reconnecting' })).toHaveCount(0);
                await expect(page.getByText(/Chat could not finish|connection problem/i)).toHaveCount(0);
            } else {
                const returned = await browser.newContext({ storageState, viewport: { width: 390, height: 844 } });
                try {
                    const returnedPage = await returned.newPage();
                    await returnedPage.goto(`/chat/${body._threadId}`);
                    await expect(returnedPage.getByText('Both research tasks finished.')).toBeVisible({ timeout: 45000 });
                    await expect(returnedPage.getByRole('button', { name: 'Open fixture/model chat in a new tab' })).toHaveCount(2);
                } finally { await returned.close(); }
            }
            expect((await fixture()).requests.filter(value => value.startsWith('durable-child-')).sort())
                .toEqual(['durable-child-one', 'durable-child-two']);
            await info.attach('durable-composer-receipt', { contentType: 'application/json', body: JSON.stringify({
                jobId, threadId: body._threadId, requests: (await fixture()).requests, serverModelSearch: true, interruption,
            }) });
        } finally { await observer.dispose(); }
    } finally {
        await fetch(fixtureUrl, { method: 'POST', headers: fixtureHeaders }).catch(() => {});
        await context.close().catch(() => {});
    }
});
for (const mode of ['normal', 'duplicate', 'conflict', 'failure']) test(`authenticated server tool ${mode}`, async ({ request }, info) => {
    const origin = String(info.project.use.baseURL);
    const job = await start(request, origin, mode === 'failure' ? 'test_fail' : 'test_write_once', 'server', mode);
    await expect.poll(async () => (await status(request, job.jobId)).status, { timeout: 30000 }).toBe('complete');
    const saved = await status(request, job.jobId);
    expect(saved.content).toContain('Cloud fixture completed.');
    const call = saved.tool_calls.find((call: { id: string }) => call.id === job.callId);
    expect(call.status).toBe(mode === 'failure' || mode === 'conflict' ? 'error' : 'complete');
    if (mode !== 'failure' && mode !== 'conflict') expect(JSON.parse(call.result).count).toBe(1);
    const pull = await request.post('/api/sync/pull', { headers: { origin, 'x-or3-cloud-intent': 'mutation' },
        data: { scope: { workspaceId: job.workspaceId }, cursor: 0, limit: 1000, fileKindCapability: 'v1' } });
    expect(pull.ok(), await pull.text()).toBe(true);
    const history = await pull.text();
    expect(history).toContain(job.messageId);
    expect(history).toContain(job.callId);
    await info.attach('cloud-terminal-receipt', { contentType: 'application/json', body: JSON.stringify({ job, saved }) });
});

test('authenticated client handoff claims once and preserves delivered result', async ({ request, playwright }, info) => {
    const origin = String(info.project.use.baseURL);
    const job = await start(request, origin, 'test_echo', 'client');
    await expect.poll(async () => (await status(request, job.jobId)).tool_calls?.[0]?.status).toBe('pending');
    const headers = { origin, 'x-or3-tool-intent': 'claim' };
    const endpoint = `/api/jobs/${job.jobId}/client-tool/claim`;
    const anonymous = await playwright.request.newContext({ baseURL: origin });
    try {
        expect((await anonymous.post(endpoint, { headers, data: { callId: job.callId, deviceId: 'fixture-device' } })).status()).toBe(401);
    } finally { await anonymous.dispose(); }
    expect((await request.post(endpoint, { headers, data: { callId: job.callId, deviceId: 'wrong-device' } })).status()).toBe(409);
    const claim = await request.post(endpoint, { headers, data: { callId: job.callId, deviceId: 'fixture-device' } });
    expect(claim.ok(), await claim.text()).toBe(true);
    const claimed = await claim.json();
    expect(claimed.context).toMatchObject({ workspaceId: job.workspaceId, threadId: job.threadId, messageId: job.messageId });
    expect((await request.post(endpoint, { headers, data: { callId: job.callId, deviceId: 'fixture-device' } })).status()).toBe(409);
    const resultHeaders = { origin, 'x-or3-tool-intent': 'result' };
    const resultUrl = `/api/jobs/${job.jobId}/client-tool/result`;
    expect((await request.post(resultUrl, { headers: resultHeaders, data: { callId: job.callId, claimToken: 'wrong', result: 'unsaved' } })).status()).toBe(409);
    const result = await request.post(resultUrl, { headers: resultHeaders,
        data: { callId: job.callId, claimToken: claimed.claimToken, result: 'durable client result' } });
    expect(result.ok(), await result.text()).toBe(true);
    await expect.poll(async () => (await status(request, job.jobId)).status).toBe('complete');
    const saved = await status(request, job.jobId);
    expect(saved.tool_calls[0]).toMatchObject({ id: job.callId, status: 'complete', result: 'durable client result' });
    expect((await request.post(resultUrl, { headers: resultHeaders,
        data: { callId: job.callId, claimToken: claimed.claimToken, result: 'duplicate' } })).status()).toBe(409);
    expect((await status(request, job.jobId)).tool_calls).toEqual(saved.tool_calls);
    await info.attach('authenticated-handoff-receipt', { contentType: 'application/json', body: JSON.stringify({ job, saved }) });
});

for (const interruption of ['running', 'settled'] as const)
test(`browser reconnect reconciles ${interruption} client journal without repeating its write`, async ({ page }, info) => {
    const context = page.context();
    await context.addInitScript(() => localStorage.setItem('or3-device-id', 'fixture-device'));
    const job = await start(page.request, String(info.project.use.baseURL), 'test_echo', 'client');
    const url = `/__or3-cloud-tools-test?jobId=${job.jobId}&threadId=${job.threadId}&messageId=${job.messageId}&callId=${job.callId}&workspaceId=${job.workspaceId}`;
    if (interruption === 'settled') await page.route('**/client-tool/result', route => route.abort());
    await page.goto(url + '&mode=' + interruption);
    await expect(page.locator('[data-cloud-counter]')).toHaveText('1', { timeout: 30000 });
    await expect.poll(() => page.evaluate(({ jobId, callId }) => {
        const saved = localStorage.getItem(`or3:bg-client-tool:${jobId}:${callId}`);
        return saved ? JSON.parse(saved).state : null;
    }, job)).toBe(interruption);
    await page.close();
    const reconnected = await context.newPage();
    const exceptions: string[] = [];
    let claimRequests = 0;
    reconnected.on('request', request => {
        if (request.url().endsWith('/client-tool/claim')) claimRequests++;
    });
    reconnected.on('pageerror', error => exceptions.push(error.message));
    await reconnected.goto(url + '&mode=recovered');
    // The production server's 30s claim lease must expire before a new claim.
    await expect.poll(async () => (await status(reconnected.request, job.jobId)).status,
        { timeout: 45000, intervals: [250, 500, 1000] }).toBe('complete');
    await expect(reconnected.locator('[data-cloud-counter]')).toHaveText('1');
    const saved = await status(reconnected.request, job.jobId);
    expect(saved.tool_calls[0]).toMatchObject({ id: job.callId, status: interruption === 'running' ? 'error' : 'complete' });
    expect(claimRequests, 'claim retries should stay bounded while the previous lease expires').toBeLessThanOrEqual(15);
    if (interruption === 'running') expect(saved.tool_calls[0].error).toContain('outcome is unknown');
    else expect(saved.tool_calls[0].result).toBe('one durable browser write');
    expect(exceptions).toEqual([]);
    await info.attach('browser-journal-receipt', { contentType: 'application/json', body: JSON.stringify({ job, saved, executions: 1, interruption }) });
    await reconnected.close();
});

test('delayed client registration leaves the Cloud call unclaimed until activation', async ({ page }, info) => {
    await page.context().addInitScript(() => localStorage.setItem('or3-device-id', 'fixture-device'));
    const job = await start(page.request, String(info.project.use.baseURL), 'test_echo', 'client');
    let claims = 0;
    page.on('request', request => { if (request.url().endsWith('/client-tool/claim')) claims++; });
    await page.goto(`/__or3-cloud-tools-test?jobId=${job.jobId}&threadId=${job.threadId}&messageId=${job.messageId}&callId=${job.callId}&workspaceId=${job.workspaceId}&mode=delayed`);
    await expect(page.locator('[data-cloud-pending]')).toHaveText('pending', { timeout: 30000 });
    expect(claims).toBe(0);
    await expect(page.locator('[data-cloud-counter]')).toHaveText('0');
    await page.getByRole('button', { name: 'Activate client tool' }).click();
    await expect.poll(async () => (await status(page.request, job.jobId)).status, { timeout: 15000 }).toBe('complete');
    await expect(page.locator('[data-cloud-counter]')).toHaveText('1');
    expect(claims).toBe(1);
});

test('fresh origin authorization fences claims and consequential result writes', async ({ request }, info) => {
    const origin = String(info.project.use.baseURL);
    // Establish the owner, then move this job to a disposable second workspace.
    const first = await start(request, origin, 'test_write_once');
    await expect.poll(async () => (await status(request, first.jobId)).status).toBe('complete');
    const headers = { origin, 'x-or3-cloud-intent': 'mutation' };
    const created = await request.post('/api/workspaces', { headers, data: { name: 'Revocation fixture' } });
    expect(created.ok(), await created.text()).toBe(true);
    const workspaceId = (await created.json()).id;
    const switched = await request.post('/api/workspaces/active', { headers, data: { id: workspaceId } });
    expect(switched.ok(), await switched.text()).toBe(true);
    const job = await start(request, origin, 'test_echo', 'client');
    expect(job.workspaceId).toBe(workspaceId);
    await expect.poll(async () => (await status(request, job.jobId)).tool_calls?.[0]?.status).toBe('pending');
    const claimHeaders = { origin, 'x-or3-tool-intent': 'claim' };
    const claimUrl = `/api/jobs/${job.jobId}/client-tool/claim`;
    const claim = await request.post(claimUrl, { headers: claimHeaders, data: { callId: job.callId, deviceId: 'fixture-device' } });
    expect(claim.ok(), await claim.text()).toBe(true);
    const claimToken = (await claim.json()).claimToken;
    const removed = await request.delete(`/api/workspaces/${workspaceId}`, { headers, data: {} });
    expect(removed.ok(), await removed.text()).toBe(true);
    const forbiddenClaim = await request.post(claimUrl, { headers: claimHeaders, data: { callId: job.callId, deviceId: 'fixture-device' } });
    expect(forbiddenClaim.status()).toBe(403);
    const forbiddenWrite = await request.post(`/api/jobs/${job.jobId}/client-tool/result`, {
        headers: { origin, 'x-or3-tool-intent': 'result' }, data: { callId: job.callId, claimToken, result: 'must not be committed' },
    });
    expect(forbiddenWrite.status()).toBe(403);
    await info.attach('revoked-origin-receipt', { contentType: 'application/json', body: JSON.stringify({
        job, workspaceRemoved: true, claimStatus: forbiddenClaim.status(), resultWriteStatus: forbiddenWrite.status(),
    }) });
});
