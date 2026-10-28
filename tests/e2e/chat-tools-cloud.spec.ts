import { expect, test, type APIRequestContext } from '@playwright/test';
import { randomUUID } from 'node:crypto';

test.setTimeout(90000);
test.beforeAll(() => {
    expect(process.env.OR3_CHAT_TOOLS_CLOUD_TEST_HARNESS).toBe('true');
    expect(process.env.OR3_BASIC_AUTH_DB_PATH).toMatch(/^\/tmp\/or3-chat-tools-cloud-/);
    expect(process.env.OR3_BACKGROUND_STREAMING_PROVIDER).toBe('memory');
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
