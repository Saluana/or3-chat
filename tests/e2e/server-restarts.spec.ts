import { test, expect } from '@playwright/test';
import { writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';

if (process.env.OR3_RESTART_E2E_MODEL) test('restart waits for real background execution, cancels safely, and persists one tool receipt', async ({ page, context }, info) => {
    test.setTimeout(180_000);
    const origin = String(info.project.use.baseURL), model = process.env.OR3_RESTART_E2E_MODEL!;
    const headers = { origin, 'x-or3-cloud-intent': 'mutation' }, admin = { origin, 'x-or3-admin-intent': 'admin' };
    expect((await context.request.post('/api/basic-auth/sign-in', { headers, data: { email: 'restart@example.test', password: 'DisposableRestart!123' } })).ok()).toBe(true);
    expect((await context.request.post('/api/admin/auth/login', { headers: admin, data: { username: 'restart-admin', password: 'DisposableRestartAdmin!123' } })).ok()).toBe(true);
    const session = await (await context.request.get('/api/auth/session')).json();
    const workspaceId = session.session.workspace.id;
    const id = crypto.randomUUID(), threadId = `thread-${id}`, messageId = `assistant-${id}`;
    const row = { clock: 1, created_at: Math.floor(Date.now() / 1000), updated_at: Math.floor(Date.now() / 1000), deleted: false };
    const started = await context.request.post('/api/openrouter/stream', { headers, data: {
        model: 'fixture/model', messages: [{ role: 'user', content: `cloud:normal:${id}` }],
        tools: [{ type: 'function', function: { name: 'test_write_once', description: 'Cloud reliability fixture', parameters: {
            type: 'object', properties: { value: { type: 'string' } }, required: ['value'], additionalProperties: false,
        } } }], _background: true, _threadId: threadId, _messageId: messageId, _clientDeviceId: 'fixture-device',
        _toolRuntime: { test_write_once: 'server' }, _backgroundAdmissionId: id,
        _history: { version: 1, kind: 'new-turn', admissionId: id, generationId: id, workspaceId, threadId, messageId,
            thread: { ...row, id: threadId, title: 'Restart continuity' },
            userMessage: { ...row, id: `user-${id}`, thread_id: threadId, role: 'user', index: 0, data: { content: 'Run once' } },
            assistantMessage: { ...row, id: messageId, thread_id: threadId, role: 'assistant', index: 1, pending: true,
                data: { content: '', generation_id: id, generation_state: 'streaming' } },
        },
    } });
    expect(started.ok(), await started.text()).toBe(true);
    const jobId = (await started.json()).jobId;
    await expect.poll(async () => (await (await context.request.get(`${model}/state`)).json()).requests.length).toBe(2);
    const read = async () => (await context.request.get('/api/admin/system/restart-status')).json();
    const original = await read();
    const submit = (requestId: string) => context.request.post('/api/admin/system/restart', { headers: admin,
        data: { requestId, policy: 'wait', target: { kind: 'current', activeRevision: original.activeRevision } } });
    const cancelledId = crypto.randomUUID(); expect((await submit(cancelledId)).status()).toBe(202);
    await expect.poll(async () => (await context.request.get('/api/ready')).status()).toBe(503);
    expect((await read()).bootId).toBe(original.bootId);
    expect((await context.request.post('/api/openrouter/stream', { headers, data: { model: 'fixture/model', messages: [] } })).status()).toBe(503);
    expect((await context.request.post('/api/admin/system/restart-cancel', { headers: admin, data: { requestId: cancelledId } })).ok()).toBe(true);
    await expect.poll(async () => (await context.request.get('/api/ready')).status()).toBe(200);
    await page.goto('/admin/system');
    let requestId = '';
    let restartSubmissions = 0;
    page.on('request', request => {
        if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/admin/system/restart') {
            restartSubmissions++; requestId = request.postDataJSON().requestId;
        }
    });
    await page.getByRole('button', { name: 'Restart Server', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Restart', exact: true }).click();
    await expect.poll(() => requestId).not.toBe('');
    await expect.poll(async () => (await read()).operation.requestId).toBe(requestId);
    await expect.poll(async () => (await context.request.get('/api/ready')).status()).toBe(503);
    expect((await read()).bootId).toBe(original.bootId);
    expect((await submit(crypto.randomUUID())).status()).toBe(409);
    expect((await context.request.post('/api/admin/auth/logout', { headers: admin })).ok()).toBe(true);
    expect([401, 403]).toContain((await context.request.get('/api/admin/system/restart-status')).status());
    await page.reload({ waitUntil: 'domcontentloaded' });
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('or3:admin:restart-observation') ?? 'null')?.requestId)).toBe(requestId);
    expect((await context.request.post('/api/admin/auth/login', { headers: admin, data: { username: 'restart-admin', password: 'DisposableRestartAdmin!123' } })).ok()).toBe(true);
    await page.goto('/admin/system');
    await expect.poll(async () => page.evaluate(() => JSON.parse(localStorage.getItem('or3:admin:restart-observation') ?? 'null')?.requestId)).toBe(requestId);
    const active = await (await context.request.get(`/api/jobs/${jobId}/status`)).json();
    expect(active.status).toBe('streaming');
    expect(JSON.parse(active.tool_calls.find((call: { id: string }) => call.id === id).result).count).toBe(1);
    await context.request.post(`${model}/release`);
    await expect.poll(async () => {
        const lines = await readFile(join(process.env.OR3_RESTART_E2E_OUTPUT!, 'history-recovery.jsonl'), 'utf8').catch(() => '');
        return lines.trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
    }, { timeout: 20_000 }).toEqual([
        { event: 'delivery_failed', bootId: original.bootId, phase: 'preparing' },
        { event: 'delivery_recovered', bootId: original.bootId, phase: 'preparing', status: 'committed' },
    ]);
    await expect.poll(async () => { try { return (await read()).operation.phase; } catch { return 'unreachable'; } }, { timeout: 120_000 }).toBe('succeeded');
    const pull = await context.request.post('/api/sync/pull', { headers, data: { scope: { workspaceId }, cursor: 0, limit: 1000, fileKindCapability: 'v1' } });
    expect(pull.ok(), await pull.text()).toBe(true);
    const history = await pull.text(); expect(history).toContain(messageId); expect(history).toContain(id); expect(history).toContain('Restart fixture completed.');
    expect((await (await context.request.get(`${model}/state`)).json()).requests).toEqual([{ toolResults: 0 }, { toolResults: 1 }]);
    expect(restartSubmissions).toBe(1);
    await writeFile(join(process.env.OR3_RESTART_E2E_OUTPUT!, 'active-job.json'), JSON.stringify({ jobId, requestId, cancelledId, originalBootId: original.bootId,
        newBootId: (await read()).bootId, toolExecutions: 1, modelRequests: 2, historyPreserved: true, reauthenticated: true, restartSubmissions }, null, 2));
});

if (process.env.OR3_RESTART_E2E_MODEL) test('browser queues retain identity and bytes through maintenance, restart and workspace switching', async ({ page, context }, info) => {
    test.setTimeout(180_000);
    const origin = String(info.project.use.baseURL), headers = { origin, 'x-or3-cloud-intent': 'mutation' }, admin = { origin, 'x-or3-admin-intent': 'admin' };
    expect((await context.request.post('/api/basic-auth/sign-in', { headers, data: { email: 'restart@example.test', password: 'DisposableRestart!123' } })).ok()).toBe(true);
    expect((await context.request.post('/api/admin/auth/login', { headers: admin, data: { username: 'restart-admin', password: 'DisposableRestartAdmin!123' } })).ok()).toBe(true);
    const workspace = (await (await context.request.get('/api/auth/session')).json()).session.workspace.id;
    const created = await context.request.post('/api/workspaces', { headers, data: { name: 'Restart other workspace' } });
    expect(created.ok(), await created.text()).toBe(true); const other = (await created.json()).id;
    const proof = `restart-bytes-${crypto.randomUUID()}`;
    let maintenance = true, lostCommit = false, presigns = 0, commits = 0, pushes = 0;
    await page.route('**/api/storage/presign-upload', async route => { presigns++; await route.continue(); });
    await page.route('**/api/sync/push', async route => { pushes++;
        if (maintenance) await route.fulfill({ status: 503, headers: { 'retry-after': '1' }, json: { code: 'server_maintenance' } }); else await route.continue(); });
    await page.route('**/api/storage/commit', async route => { commits++;
        if (maintenance) await route.fulfill({ status: 503, headers: { 'retry-after': '1' }, json: { code: 'server_maintenance' } });
        else if (!lostCommit) { expect((await route.fetch()).ok()).toBe(true); lostCommit = true; await route.abort(); }
        else await route.continue();
    });
    const url = `/__or3-restart-continuity?${new URLSearchParams({ workspace, other, proof })}`;
    await page.goto(url);
    // The first visit compiles this fixture's real queue dependencies in Vite.
    // Keep the same bounded mount budget used after replacement.
    await expect(page.getByTestId('continuity-ready')).toHaveText('true', { timeout: 30_000 });
    const snapshot = async () => JSON.parse(await page.getByTestId('continuity-state').innerText());
    await page.getByRole('button', { name: 'Queue local work', exact: true }).click();
    await expect.poll(() => commits).toBeGreaterThan(0); await expect.poll(() => pushes).toBeGreaterThan(0);
    await expect.poll(async () => (await snapshot()).transfers[0]?.state).toBe('queued');
    const before = await snapshot();
    expect(before.transfers[0].attempts).toBe(0); expect(before.ops[0].attempts).toBe(0);
    await page.getByRole('button', { name: 'Switch away', exact: true }).click();
    expect((await context.request.post('/api/workspaces/active', { headers, data: { id: other } })).ok()).toBe(true);
    const initial = await (await context.request.get('/api/admin/system/restart-status')).json();
    const requestId = crypto.randomUUID();
    expect((await context.request.post('/api/admin/system/restart', { headers: admin, data: {
        requestId, policy: 'wait', target: { kind: 'current', activeRevision: initial.activeRevision },
    } })).status()).toBe(202);
    await expect.poll(async () => { try { return (await (await context.request.get('/api/admin/system/restart-status')).json()).operation.phase; } catch { return 'unreachable'; } }, { timeout: 120_000 }).toBe('succeeded');
    // Reopen the real queues on the verified boot. Automatic Vite reload can
    // race client-only startup; the dashboard journey owns HMR recovery checks.
    await page.goto(url);
    await expect(page.getByTestId('continuity-ready')).toHaveText('true', { timeout: 30_000 });
    const parked = await snapshot();
    expect(parked.transfers[0].id).toBe(before.transfers[0].id); expect(parked.ops[0].stamp.opId).toBe(before.ops[0].stamp.opId);
    expect(parked.otherTransfers).toBe(0); expect(parked.otherOps).toBe(0);
    expect((await (await context.request.get('/api/auth/session')).json()).session.workspace.id).toBe(other);
    expect((await context.request.post('/api/workspaces/active', { headers, data: { id: workspace } })).ok()).toBe(true);
    maintenance = false;
    await page.getByRole('button', { name: 'Resume original workspace', exact: true }).click();
    await expect.poll(async () => (await snapshot()).transfers[0]?.state, { timeout: 30_000 }).toBe('done');
    await expect.poll(async () => (await snapshot()).ops.length).toBe(0);
    expect(lostCommit).toBe(true); expect(presigns).toBeGreaterThanOrEqual(3);
    await page.getByRole('button', { name: 'Publish file metadata', exact: true }).click();
    await expect.poll(async () => (await snapshot()).ops.length).toBe(0);
    const after = await snapshot(); expect(after.files).toHaveLength(1); expect(after.files[0].ref_count).toBe(1);
    const pull = await context.request.post('/api/sync/pull', { headers, data: { scope: { workspaceId: workspace }, cursor: 0, limit: 1000, fileKindCapability: 'v1' } });
    expect(pull.ok(), await pull.text()).toBe(true);
    const changes = (await pull.json()).changes;
    expect(changes.filter((change: { tableName: string; pk: string }) => change.tableName === 'projects' && change.pk === before.ops[0].pk)).toHaveLength(1);
    await expect.poll(async () => {
        const response = await context.request.post('/api/sync/pull', { headers, data: { scope: { workspaceId: workspace }, cursor: 0, limit: 1000, fileKindCapability: 'v1' } });
        return (await response.json()).changes.some((change: { tableName: string; pk: string }) => change.tableName === 'file_meta' && change.pk === after.files[0].hash);
    }).toBe(true);
    const download = await context.request.post('/api/storage/presign-download', { headers, data: { workspace_id: workspace, hash: after.files[0].hash, file_kind_capability: 'v1' } });
    expect(download.ok(), await download.text()).toBe(true);
    expect(await (await context.request.get((await download.json()).url)).text()).toBe(proof);
    expect(await page.getByTestId('continuity-error').innerText()).toBe('');
    await writeFile(join(process.env.OR3_RESTART_E2E_OUTPUT!, 'queue-continuity.json'), JSON.stringify({ requestId, workspace, other,
        transferId: before.transfers[0].id, opId: before.ops[0].stamp.opId, checksum: after.files[0].hash,
        maintenanceAttempts: { transfer: before.transfers[0].attempts, sync: before.ops[0].attempts }, presigns, commits, lostCommit,
        oneMetadataReference: true, originalBytesVerified: true, otherWorkspaceUnchanged: true }, null, 2));
});

test('dashboard restart replaces boots and activates saved registration', async ({ page, context }, info) => {
    if (process.env.OR3_RESTART_E2E !== 'true') throw new Error('Run the named test:e2e:server-restarts harness');
    test.setTimeout(process.env.OR3_RESTART_E2E_MODE === '--performance' ? 900_000 : 300_000);
    context.setDefaultTimeout(15000);
    const origin = String(info.project.use.baseURL);
    const login = await context.request.post('/api/admin/auth/login', {
        headers: { origin, 'x-or3-admin-intent': 'admin' },
        data: { username: 'restart-admin', password: 'DisposableRestartAdmin!123' },
    });
    expect(login.ok(), await login.text()).toBe(true);
    const status = async () => {
        // A replacement boot can reset a connection pooled from the previous boot.
        const response = await context.request.get('/api/admin/system/restart-status', { maxRetries: 1 });
        expect(response.ok(), await response.text()).toBe(true);
        return await response.json();
    };
    const initial = await status();
    let hmrConnections = 0;
    const hmrEvents: Array<{ event: string; url?: string; message?: string }> = [];
    page.on('pageerror', error => { hmrEvents.push({ event: 'pageerror', message: error.message.replace(/token=[^\s&"')]+/g, 'token=[redacted]').slice(0, 1024) }); });
    page.on('console', message => {
        if (/\[vite\]|WebSocket/.test(message.text())) hmrEvents.push({ event: 'console', message: message.text().replace(/token=[^\s&"')]+/g, 'token=[redacted]').slice(0, 1024) });
    });
    page.on('websocket', socket => {
        const url = new URL(socket.url()); url.search = '';
        hmrEvents.push({ event: 'open', url: url.href });
        socket.on('close', () => { hmrEvents.push({ event: 'close', url: url.href }); });
        socket.on('socketerror', error => { hmrEvents.push({ event: 'error', url: url.href, message: error.replace(/token=[^\s&"')]+/g, 'token=[redacted]') }); });
        socket.on('framereceived', frame => {
        try { const value: unknown = JSON.parse(String(frame.payload));
            if (value && typeof value === 'object' && 'type' in value && value.type === 'connected') { hmrConnections++; hmrEvents.push({ event: 'connected', url: url.href }); }
        } catch { /* Non-Vite sockets can carry non-JSON frames. */ }
    }); });
    await page.goto('/admin/system');
    if (process.env.OR3_RESTART_E2E_TARGET === 'dev') await expect.poll(() => hmrConnections).toBeGreaterThan(0);
    const secondTab = await context.newPage();
    await secondTab.goto('/admin/registration');
    await secondTab.getByRole('radio', { name: 'Registration closed', exact: true }).click();
    const advancedTab = await context.newPage();
    await advancedTab.goto('/admin/advanced');
    await advancedTab.getByRole('textbox', { name: 'Find a setting' }).fill('OR3_ADMIN_ALLOW_RESTART');
    const restartSetting = advancedTab.getByLabel('Allow Server Restart', { exact: true });
    await restartSetting.click();
    await advancedTab.getByRole('option', { name: 'Disabled', exact: true }).click();
    const boots = [initial.bootId];
    const performanceMode = process.env.OR3_RESTART_E2E_MODE === '--performance';
    if (performanceMode) {
        // Warm idle server timing excludes late Vite reloads from the separate
        // multi-tab UI journey. Keep the real authenticated API context.
        await secondTab.close(); await advancedTab.close(); await page.goto('about:blank');
    }
    const count = performanceMode ? (process.env.OR3_RESTART_E2E_TARGET === 'managed' ? 20 : 10) : 2;
    const timings: Array<{ totalMs: number; outageMs: number; preparationMs: number; acceptanceMs: number }> = [];
    let lastStart = 0;
    for (let iteration = 0; iteration < count; iteration++) {
        if (!performanceMode && process.env.OR3_RESTART_E2E_TARGET === 'dev') await page.bringToFront();
        const previousHmr = hmrConnections;
        // Respect the production six-starts/minute guard without changing its limits.
        if (lastStart && performanceMode) await new Promise(resolve => setTimeout(resolve, Math.max(0, 10_200 - (Date.now() - lastStart))));
        lastStart = Date.now();
        let outageStart: number | undefined; let outageEnd: number | undefined;
        let probing = true;
        const probe = (async () => {
            while (probing) {
                let ready = false;
                try { ready = (await context.request.get('/api/ready', { timeout: 750 })).ok(); } catch {}
                if (!ready) outageStart ??= Date.now();
                else if (outageStart) outageEnd ??= Date.now();
                await new Promise(resolve => setTimeout(resolve, 100));
            }
        })();
        let recovered: Awaited<ReturnType<typeof status>>;
        let acceptanceMs = 0;
        try {
        let requestId = crypto.randomUUID();
        if (!performanceMode && iteration === 0) {
            let acknowledged!: () => void;
            const lostAcknowledgement = new Promise<void>(resolve => { acknowledged = resolve; });
            // The mutation reaches the real server; only its acknowledgement is lost.
            await page.route('**/api/admin/system/restart', async route => {
                requestId = route.request().postDataJSON().requestId;
                const acceptedAt = Date.now();
                expect((await route.fetch({ timeout: 35000 })).status()).toBe(202);
                acceptanceMs = Date.now() - acceptedAt;
                await route.abort();
                acknowledged();
            });
            await page.getByRole('button', { name: 'Restart Server', exact: true }).click();
            await page.getByRole('dialog').getByRole('button', { name: 'Restart', exact: true }).click();
            await lostAcknowledgement;
            await expect.poll(async () => (await status()).operation?.requestId).toBe(requestId);
            await page.unroute('**/api/admin/system/restart');
        } else {
            const activeRevision = (await status()).activeRevision;
            const acceptedAt = Date.now();
            const accepted = await context.request.post('/api/admin/system/restart', {
            headers: { origin, 'x-or3-admin-intent': 'admin' },
            data: { requestId, target: { kind: 'current', activeRevision }, policy: 'wait' },
        });
            expect(accepted.status(), await accepted.text()).toBe(202);
            acceptanceMs = Date.now() - acceptedAt;
        }
        expect(acceptanceMs).toBeLessThanOrEqual(2000);
        await expect.poll(async () => {
            let phase: string | undefined;
            try { phase = (await status()).operation?.phase; } catch { return 'unreachable'; }
            expect(['cancelled', 'failed', 'needs_attention']).not.toContain(phase);
            return phase;
        }, { timeout: 150_000, intervals: [500, 1000, 1500] }).toBe('succeeded');
        recovered = await status();
        expect(recovered.bootId).not.toBe(boots.at(-1));
        boots.push(recovered.bootId);
        if (!performanceMode && process.env.OR3_RESTART_E2E_TARGET === 'dev') {
            // Vite intentionally suspends reconnect polling in hidden tabs.
            await page.bringToFront();
            try { await expect.poll(() => hmrConnections, { timeout: 30000 }).toBeGreaterThan(previousHmr); }
            catch (error) {
                const url = hmrEvents.find(event => event.event === 'connected')!.url!;
                const probes = await page.evaluate(async url => {
                    const page = await new Promise<string>(resolve => {
                        const socket = new WebSocket(url, 'vite-ping');
                        const timer = setTimeout(() => { socket.close(); resolve('timeout'); }, 3000);
                        socket.onopen = () => { clearTimeout(timer); socket.close(); resolve('open'); };
                        socket.onerror = () => { clearTimeout(timer); resolve('error'); };
                    });
                    const shared = await new Promise<string>(resolve => {
                        const blob = URL.createObjectURL(new Blob([`onconnect = event => { const port = event.ports[0]; const socket = new WebSocket(${JSON.stringify(url)}, 'vite-ping'); socket.onopen = () => { port.postMessage('open'); socket.close(); close(); }; socket.onerror = () => { port.postMessage('socket-error'); close(); }; };`], { type: 'application/javascript' }));
                        const worker = new SharedWorker(blob);
                        const finish = (value: string) => { clearTimeout(timer); worker.port.close(); URL.revokeObjectURL(blob); resolve(value); };
                        const timer = setTimeout(() => finish('timeout'), 3000);
                        worker.onerror = event => { finish(`worker-error:${event.message}`); };
                        worker.port.onmessage = event => { finish(String(event.data)); };
                        worker.port.start();
                    });
                    return { page, shared };
                }, url);
                await writeFile(join(process.env.OR3_RESTART_E2E_OUTPUT!, 'hmr-probes.json'), JSON.stringify(probes));
                throw error;
            }
            finally { await writeFile(join(process.env.OR3_RESTART_E2E_OUTPUT!, 'hmr.json'), JSON.stringify({ hmrEvents, visibility: await page.evaluate(() => document.visibilityState) }, null, 2)); }
        }
        timings.push({ totalMs: Date.now() - lastStart, acceptanceMs, outageMs: outageStart ? (outageEnd ?? Date.now()) - outageStart : 0,
            preparationMs: Date.parse(recovered.operation.preparedAt) - Date.parse(recovered.operation.createdAt) });
        const replay = await context.request.post('/api/admin/system/restart', {
            // Replacement may reset a pooled socket from the old boot. Retry
            // only that transport failure, with the already committed identity.
            maxRetries: 1,
            headers: { origin, 'x-or3-admin-intent': 'admin' },
            data: { requestId, target: { kind: 'current', activeRevision: initial.activeRevision }, policy: 'wait' },
        });
        expect(replay.status()).toBe(202);
        expect((await replay.json()).operation.requestId).toBe(requestId);
        } finally { probing = false; await probe; }
    }
    if (!performanceMode) {
        await secondTab.reload({ waitUntil: 'domcontentloaded' });
        await expect(secondTab.getByRole('radio', { name: 'Registration closed', exact: true })).toBeChecked({ timeout: 30000 });
        await advancedTab.reload({ waitUntil: 'domcontentloaded' });
        await advancedTab.getByRole('textbox', { name: 'Find a setting' }).fill('OR3_ADMIN_ALLOW_RESTART');
        await expect(restartSetting).toContainText('Disabled');
    }
    if (performanceMode) {
        await writeFile(join(process.env.OR3_RESTART_E2E_OUTPUT!, 'runtime-boots.json'), JSON.stringify({ boots }));
        const samples = timings.map(t => t.outageMs).sort((a, b) => a - b);
        const result = { count, workload: 'warm-idle-authenticated-api', probeResolutionMs: 100, timings, p50: samples[Math.ceil(count * .5) - 1], p95: samples[Math.ceil(count * .95) - 1], max: samples.at(-1) };
        await writeFile(join(process.env.OR3_RESTART_E2E_OUTPUT!, 'performance.json'), JSON.stringify(result, null, 2));
        expect(result.p95).toBeLessThanOrEqual(process.env.OR3_RESTART_E2E_TARGET === 'managed' ? 10_000 : 60_000);
        return;
    }
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Operations', exact: true }).first()).toBeVisible();
    const registration = await context.request.get('/api/admin/registration');
    const saved = await context.request.post('/api/admin/registration', {
        headers: { origin, 'x-or3-admin-intent': 'admin' },
        data: { mode: 'disabled', expectedRevision: (await registration.json()).savedRevision },
    });
    expect(saved.ok(), await saved.text()).toBe(true);
    expect(await saved.json()).toMatchObject({ currentMode: 'open', savedMode: 'disabled', restartRequired: true });
    await page.goto('/admin/registration', { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Restart now', exact: true }).click();
    await page.getByRole('button', { name: 'Apply and restart', exact: true }).click();
    await expect.poll(async () => {
        try { return await (await context.request.get('/api/admin/registration', { timeout: 4000 })).json(); } catch { return null; }
    }, { timeout: 150000, intervals: [1000, 1500] }).toMatchObject({ currentMode: 'disabled', savedMode: 'disabled', restartRequired: false });
    boots.push((await status()).bootId);
    await writeFile(join(process.env.OR3_RESTART_E2E_OUTPUT!, 'boots.json'), JSON.stringify({ boots, origin, hmrConnections, verified: true }, null, 2));
    await page.screenshot({ path: join(process.env.OR3_RESTART_E2E_OUTPUT!, 'recovered.png') });
    if (process.env.OR3_RESTART_E2E_MODE === '--failure') {
        await secondTab.close(); await advancedTab.close();
        // The registration page may still be completing its post-restart reload.
        // Use a fresh observer so that reload cannot abort presentation navigation.
        const page = await context.newPage();
        const healthy = await status();
        let posts = 0;
        page.on('request', request => { if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/admin/system/restart') posts++; });
        // Presentation qualification uses actual fault receipts from the process
        // lane. It never intercepts a mutation or fabricates restart success.
        for (const fault of ['failed-startup', 'wrong-settings']) {
            const { operation } = JSON.parse(await readFile(join(process.env.OR3_RESTART_E2E_OUTPUT!, `${fault}.json`), 'utf8'));
            await page.route('**/api/admin/system/restart-status*', route => route.fulfill({ json: { ...healthy, operation } }));
            await page.goto('/admin/system', { waitUntil: 'domcontentloaded' });
            // The heading is server-rendered; the operation card waits for client
            // hydration and status. Allow the same post-replacement mount budget
            // as the queue journey, without aborting bootstrap with another reload.
            await expect(page.getByRole('button', { name: 'Restart Server', exact: true })).toBeVisible({ timeout: 30_000 });
            await expect(page.getByText('Restart needs attention.', { exact: false })).toBeVisible();
            await expect(page.getByRole('button', { name: 'Restart Server', exact: true })).toBeDisabled();
            await expect(page.getByRole('button', { name: 'Recheck existing restart', exact: true })).toBeEnabled();
            await page.screenshot({ path: join(process.env.OR3_RESTART_E2E_OUTPUT!, `${fault}-presentation.png`) });
            await page.unroute('**/api/admin/system/restart-status*');
        }
        const expired = { ...healthy.operation, phase: 'verifying', createdAt: new Date(Date.now() - 10 * 60_000).toISOString() };
        await page.evaluate(operation => localStorage.setItem('or3:admin:restart-observation', JSON.stringify({ requestId: operation.requestId, startedAt: Date.parse(operation.createdAt) })), expired);
        await page.route('**/api/admin/system/restart-status*', route => route.fulfill({ json: { ...healthy, operation: expired } }));
        await page.reload({ waitUntil: 'domcontentloaded' });
        await expect(page.getByRole('button', { name: 'Restart Server', exact: true })).toBeVisible({ timeout: 30_000 });
        await expect(page.getByText('Observation timed out.', { exact: false })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Restart Server', exact: true })).toBeDisabled();
        expect(await page.evaluate(() => JSON.parse(localStorage.getItem('or3:admin:restart-observation')!).requestId)).toBe(expired.requestId);
        expect(posts).toBe(0);
        await page.screenshot({ path: join(process.env.OR3_RESTART_E2E_OUTPUT!, 'observation-expired-presentation.png') });
        await writeFile(join(process.env.OR3_RESTART_E2E_OUTPUT!, 'failure-presentation.json'), JSON.stringify({ presentationOnly: true, realFaultReceipts: ['failed-startup', 'wrong-settings'], observationExpired: true, restartSubmissions: posts }));
        await page.unroute('**/api/admin/system/restart-status*');
    }
});
