import { expect, test } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

test.skip(process.env.OR3_AI_GOVERNANCE_HARNESS !== 'true', 'Run through the disposable AI governance harness.');

test('installed package completion is governed at the real HTTP boundary', async ({ page }, info) => {
    test.setTimeout(120_000);
    const origin = new URL(info.project.use.baseURL!).origin;
    const adminHeaders = { origin, 'x-or3-admin-intent': 'admin' };
    const mutationHeaders = { origin, 'x-or3-plugin-intent': 'plugin' };
    const api = page.request;
    const checked = async (response: Awaited<ReturnType<typeof api.post>>) => {
        const body = await response.text();
        expect(response.ok(), `${response.status()} ${body}`).toBe(true);
        return JSON.parse(body);
    };
    await checked(await api.post('/api/basic-auth/sign-in', { headers: { origin }, data: {
        email: 'ai-router@example.test', password: 'DisposableAiRouter!123',
    } }));
    await checked(await api.post('/api/admin/auth/login', { headers: adminHeaders, data: {
        username: 'ai-router-admin', password: 'DisposableAiRouterAdmin!123',
    } }));
    const session = await checked(await api.get('/api/auth/session'));
    const workspaceId = session.session.workspace.id as string;
    const pluginId = process.env.OR3_AI_TEST_PLUGIN_ID!;
    const archive = await readFile(process.env.OR3_AI_TEST_ARCHIVE!);
    const installed = await checked(await api.post('/api/admin/extensions/install', { headers: adminHeaders, multipart: {
        expectedKind: 'plugin', workspaceId, file: { name: 'or3-workflows.zip', mimeType: 'application/zip', buffer: archive },
    } }));
    expect(installed).toMatchObject({ kind: 'v2-candidate', status: 'candidate-stored' });
    const path = `/api/admin/plugins/packages/${pluginId}`;
    const review = await checked(await api.get(`${path}/review?workspaceId=${encodeURIComponent(workspaceId)}`));
    expect(review.requestedGrants).toContain('ai.provider');
    await checked(await api.post(`${path}/grants`, { headers: adminHeaders, data: {
        workspaceId, expectedPackageDigest: review.packageDigest, expectedAuthoritySha256: review.authoritySha256,
        approvedGrants: review.requestedGrants,
    } }));
    // Use the host's actual browser canary; do not fabricate a passing report.
    await page.goto('/chat');
    await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeEnabled({ timeout: 45_000 });
    const candidate = await checked(await api.post(`${path}/canary`, { headers: adminHeaders, data: { workspaceId } }));
    if (!candidate.ok) {
        expect(candidate.clientCanary?.status).toBe('awaiting-client');
        const outcome = await page.evaluate(async (ticket) => {
            const source = '/_nuxt/composables/plugins/portable-canary.ts';
            const canary = await import(/* @vite-ignore */ source);
            return canary.reportCandidateClientCanary(ticket);
        }, candidate.clientCanary.ticket);
        expect(outcome.status, JSON.stringify(outcome)).toBe('passed');
        const confirmed = await checked(await api.post(`${path}/canary`, { headers: adminHeaders, data: { workspaceId } }));
        expect(confirmed.ok, JSON.stringify(confirmed)).toBe(true);
    }
    await checked(await api.post(`${path}/promote`, { headers: adminHeaders, data: {
        workspaceId, candidateDigest: review.packageDigest,
    } }));
    if (process.env.OR3_AI_INSTALL_ONLY === 'true') {
        await info.attach('installed-package', { contentType: 'application/json', body: JSON.stringify({ pluginId, packageDigest: review.packageDigest }) });
        return;
    }
    const activation = await checked(await api.post('/api/plugins/isolation/activation', { headers: mutationHeaders,
        data: { pluginId } }));
    const activationId = activation.activation.activationId as string;
    const call = (method: string, params: Record<string, unknown>) => api.post('/api/plugins/isolation/capability', {
        headers: mutationHeaders, data: { activationId, method, params, requestId: crypto.randomUUID() },
    });
    const captures = async () => (await (await api.get(`${process.env.OR3_AI_FIXTURE_URL}/__capture`)).json()) as {
        requests: Array<{ path: string; authorized: boolean; body: { model: string; max_tokens: number } }>;
    };
    // Router configuration is host-owned. An attempted override must fail at
    // both public HTTP boundaries before any inference or spend reservation.
    const endpointOverride = await call('ai.complete', { model: 'fixture/model', prompt: 'override',
        endpoint: 'http://127.0.0.1:1/forbidden', apiKey: 'untrusted-plugin-key' });
    const routerOverride = await api.post('/api/openrouter/stream', { headers: { origin, 'x-or3-cloud-intent': 'mutation' },
        data: { model: 'fixture/model', messages: [{ role: 'user', content: 'router override' }], stream: true,
            routerId: 'unregistered-router', endpoint: 'http://127.0.0.1:1/forbidden' } });
    const attempted = await captures();
    expect.soft([400, 403]).toContain(endpointOverride.status());
    expect.soft([400, 403]).toContain(routerOverride.status());
    expect.soft(attempted.requests).toHaveLength(0);
    if (endpointOverride.ok() || routerOverride.ok() || attempted.requests.length) return;

    const success = await checked(await call('ai.complete', { model: 'fixture/model', prompt: 'normal', maxOutputTokens: 99999 }));
    expect(success.result).toMatchObject({ text: 'Governed fixture reply', model: 'fixture/model',
        usage: { promptTokens: 10, completionTokens: 3 } });
    expect(JSON.stringify(success)).not.toContain('disposable-governed-key');
    let captured = await captures();
    expect(captured.requests).toHaveLength(1);
    expect(captured.requests[0]).toMatchObject({ path: '/api/v1/chat/completions', authorized: true,
        body: { model: 'fixture/model', max_tokens: 4096 } });
    const unknownModel = await call('ai.complete', { model: 'unknown/model', prompt: 'not allowed' });
    expect(unknownModel.ok()).toBe(false);
    const expensive = await call('ai.complete', { model: 'fixture/expensive', prompt: 'spend limit', maxOutputTokens: 4096 });
    expect(expensive.ok()).toBe(false);
    const unknownMethod = await call('network.unknown_endpoint', { url: 'http://127.0.0.1:1/forbidden' });
    expect(unknownMethod.ok()).toBe(false);
    expect((await captures()).requests).toHaveLength(1);
    const missingUsage = await call('ai.complete', { model: 'fixture/model', prompt: 'missing usage', maxOutputTokens: 32 });
    expect(missingUsage.ok()).toBe(false);
    expect(await missingUsage.text()).toContain('usable token usage');
    captured = await captures();
    expect(captured.requests).toHaveLength(2);
    expect(captured.requests.every(request => request.authorized && request.path === '/api/v1/chat/completions')).toBe(true);
    await page.route('**openrouter.ai/**', route => route.abort());
    await page.goto('/chat');
    expect(await page.content()).not.toContain('disposable-governed-key');
    try {
        await checked(await api.post('/api/admin/plugins/workspace-enable', { headers: adminHeaders,
            data: { pluginId, workspaceId, enabled: false } }));
        const revoked = await call('ai.complete', { model: 'fixture/model', prompt: 'after revocation' });
        expect([403, 409]).toContain(revoked.status());
        expect((await captures()).requests).toHaveLength(2);
    } finally {
        await checked(await api.post('/api/admin/plugins/workspace-enable', { headers: adminHeaders,
            data: { pluginId, workspaceId, enabled: true } }));
    }
    const receipt = { pluginId, packageDigest: review.packageDigest,
        checks: ['real installation and grant review', 'host credential retained server-side', 'endpoint and router overrides refused',
            'output ceiling', 'model allowlist', 'spend ceiling', 'unknown method refused', 'missing usage refused', 'disabled activation refused'],
        providerRequests: captured.requests, unknownModelStatus: unknownModel.status(), expensiveStatus: expensive.status(),
        unknownMethodStatus: unknownMethod.status(), missingUsageStatus: missingUsage.status() };
    await writeFile(resolve(process.env.OR3_AI_GOVERNANCE_OUTPUT!, 'governance.json'), JSON.stringify(receipt, null, 2));
    await info.attach('governance-receipt', { contentType: 'application/json', body: JSON.stringify(receipt) });
});

test('Cloud stream selects personal credentials before the instance key without browser disclosure', async ({ page }, info) => {
    test.skip(process.env.OR3_AI_INSTALL_ONLY === 'true', 'The historical-host run only installs the archived package.');
    test.setTimeout(90_000);
    const origin = new URL(info.project.use.baseURL!).origin;
    const api = page.request;
    const signedIn = await api.post('/api/basic-auth/sign-in', { headers: { origin }, data: {
        email: 'ai-router@example.test', password: 'DisposableAiRouter!123',
    } });
    expect(signedIn.ok()).toBe(true);
    const session = await (await api.get('/api/auth/session')).json();
    const account = JSON.stringify([session.session.provider, session.session.user.id]);
    const personalKey = 'sk-or-personal-fixture-123456';
    const captured = async () => (await (await api.get(`${process.env.OR3_AI_FIXTURE_URL}/__capture`)).json()) as {
        requests: Array<{ credentialClass: string }>;
    };
    const prior = (await captured()).requests.length;
    const stream = async (expected: 'server' | 'personal') => {
        const response = await api.post('/api/openrouter/stream', {
            headers: { origin, 'x-or3-cloud-intent': 'mutation', 'x-or3-openrouter-key': 'sk-or-forged-fixture-123456' },
            data: { model: 'fixture/model', messages: [{ role: 'user', content: 'credential precedence' }], stream: true },
        });
        expect(response.status()).toBe(200);
        expect(response.headers()['x-or3-credential-source']).toBe(expected);
        const text = await response.text();
        expect(text).not.toContain(personalKey);
        expect(text).not.toContain('disposable-governed-key');
    };
    const credential = (operation: 'save' | 'delete', key?: string) => api.post('/api/openrouter/credentials', {
        headers: { origin, 'x-or3-cloud-intent': 'mutation', 'x-or3-account': account },
        data: { operation, ...(key ? { key } : {}) },
    });
    await stream('server');
    const saved = await credential('save', personalKey);
    expect(saved.ok()).toBe(true);
    expect(await saved.text()).not.toContain(personalKey);
    await stream('personal');
    expect((await credential('delete')).ok()).toBe(true);
    await stream('server');
    expect((await captured()).requests.slice(prior).map(request => request.credentialClass)).toEqual(['instance', 'personal', 'instance']);
    expect(JSON.stringify(await (await api.get('/api/auth/session')).json())).not.toContain(personalKey);
    await info.attach('credential-precedence', { contentType: 'application/json', body: JSON.stringify({
        credentialSources: ['server', 'personal', 'server'], browserKeyIgnored: true, credentialsDisclosed: false,
    }) });
});
