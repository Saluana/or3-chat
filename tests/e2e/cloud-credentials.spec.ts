import { test, expect, type BrowserContext, type Page } from '@playwright/test';

// Failure inventory: account mismatch imports a key; failed import deletes the
// source; hydration restores it; a second device reconnects unnecessarily;
// disconnect permits stale re-import; credentials leak in status/session state.
// Startup failures must not create pre-hydration toasts or cover the connection
// dialog; explicit connect/migration failures must still explain the failure.
test.setTimeout(120_000);
const canary = 'sk-or-synthetic-cloud-migration-fixture';
async function signIn(context: BrowserContext, origin: string) {
    const response = await context.request.post('/api/basic-auth/sign-in', { headers: { origin, 'x-or3-cloud-intent': 'mutation' },
        data: { email: 'credential-audit@example.test', password: 'DisposableCredentialSuite!123' } });
    expect(response.ok(), await response.text()).toBe(true);
}
async function metadata(page: Page, origin: string, operation = 'status') {
    const session = await (await page.request.get('/api/auth/session')).json();
    const account = JSON.stringify([session.session.provider, session.session.user.id]);
    const response = await page.request.post('/api/openrouter/credentials', { headers: { origin, 'x-or3-cloud-intent': 'mutation', 'x-or3-account': account }, data: { operation } });
    expect(response.ok(), await response.text()).toBe(true);
    const text = await response.text(); expect(text).not.toContain(canary);
    return JSON.parse(text);
}
test('refresh stays quiet during a credential outage while explicit connection failures remain visible', async ({ page, context, baseURL }, info) => {
    expect(process.env.OR3_CREDENTIAL_E2E).toBe('true');
    await signIn(context, baseURL!);
    const hydration: string[] = [];
    const startupToasts: string[] = [];
    let checks = 0;
    page.on('console', message => {
        if (/hydration.*mismatch/i.test(message.text())) hydration.push(message.text());
    });
    await page.addInitScript(() => {
        // Record short-lived notifications too, rather than passing once a toast expires.
        (window as any).__startupToastSeen = false;
        new MutationObserver(() => {
            if (document.body?.textContent?.includes('OpenRouter connection unavailable')) {
                (window as any).__startupToastSeen = true;
            }
        }).observe(document, { childList: true, subtree: true });
    });
    await page.route('**/api/openrouter/credentials', async route => {
        checks++;
        await route.fulfill({ status: 503, json: { message: 'Synthetic credential outage' } });
    });
    await page.route('**/api/openrouter/oauth', route => route.fulfill({ status: 503, json: { message: 'Synthetic connection outage' } }));
    for (let refresh = 0; refresh < 2; refresh++) {
        if (refresh === 0) await page.goto('/chat?welcome=1');
        else await page.reload();
        await expect.poll(() => checks, { timeout: 30_000 }).toBeGreaterThan(refresh);
        await expect(page.getByRole('button', { name: 'Connect with OpenRouter', exact: true })).toBeVisible({ timeout: 30_000 });
        if (await page.evaluate(() => (window as any).__startupToastSeen)) startupToasts.push('OpenRouter connection unavailable');
        expect.soft(startupToasts, 'passive startup checks do not notify over the welcome dialog').toEqual([]);
        expect.soft(hydration, 'SSR refresh hydrates without mismatches').toEqual([]);
    }
    await page.screenshot({ path: info.outputPath('quiet-refresh.png') });
    await info.attach('refresh-receipt', { contentType: 'application/json', body: JSON.stringify({ refreshes: 2, checks, startupToasts, hydration }) });
    await page.getByRole('button', { name: 'Connect with OpenRouter', exact: true }).click();
    await expect(page.getByText('OpenRouter connection unavailable', { exact: true })).toBeVisible();
    await expect(page.getByText('Refresh your session and try again, or contact the administrator.', { exact: true })).toBeVisible();
});

test('failed legacy migration retains the browser key and reports the requested save failure after hydration', async ({ page, context, baseURL }, info) => {
    expect(process.env.OR3_CREDENTIAL_E2E).toBe('true');
    await signIn(context, baseURL!);
    const session = await (await page.request.get('/api/auth/session')).json();
    const owner = JSON.stringify([session.session.provider, session.session.user.id]);
    await page.addInitScript(({ owner, canary }) => localStorage.setItem('openrouter_api_key', JSON.stringify({ owner, key: canary })), { owner, canary });
    const hydration: string[] = [];
    page.on('console', message => {
        if (/hydration.*mismatch/i.test(message.text())) hydration.push(message.text());
    });
    page.on('dialog', dialog => dialog.accept());
    await page.route('**/api/openrouter/credentials', route => route.request().postDataJSON().operation === 'status'
        ? route.fulfill({ json: { connected: false, persisted: false } })
        : route.fulfill({ status: 503, json: { message: 'Synthetic migration outage' } }));
    await page.goto('/chat?welcome=1');
    await expect(page.getByText('OpenRouter key migration failed', { exact: true })).toBeVisible({ timeout: 30_000 });
    expect(await page.evaluate(() => localStorage.getItem('openrouter_api_key'))).toBe(JSON.stringify({ owner, key: canary }));
    expect(hydration).toEqual([]);
    await info.attach('migration-failure-receipt', { contentType: 'application/json', body: JSON.stringify({ sourceRetained: true, hydration }) });
});

test('Cloud migration and cross-device deletion use only server connection metadata', async ({ page, context, browser, baseURL }, info) => {
    expect(process.env.OR3_CREDENTIAL_E2E).toBe('true');
    const origin = baseURL!;
    await signIn(context, origin);
    const session = await (await page.request.get('/api/auth/session')).json();
    expect(JSON.stringify(session)).not.toContain(canary);
    const owner = JSON.stringify([session.session.provider, session.session.user.id]);
    // A stale tab must not upload its key using a different account's cookie.
    for (const expectedAccount of [undefined, JSON.stringify([session.session.provider, 'different-account'])]) {
        const mismatch = await page.request.post('/api/openrouter/credentials', {
            headers: { origin, 'x-or3-cloud-intent': 'mutation', ...(expectedAccount ? { 'x-or3-account': expectedAccount } : {}) },
            data: { operation: 'migrate', key: canary },
        });
        expect(mismatch.status()).toBe(409);
    }
    expect(await metadata(page, origin)).toEqual({ connected: false, persisted: false });
    const modules: string[] = [];
    page.on('request', request => modules.push(request.url()));
    await page.goto('/');
    await expect.poll(() => modules.find(url => /\/core\/auth\/useUserApiKey\.ts(?:\?|$)/.test(url)), { timeout: 30_000 }).toBeTruthy();
    const keyModule = modules.find(url => /\/core\/auth\/useUserApiKey\.ts(?:\?|$)/.test(url))!;
    await page.evaluate(({ owner, canary }) => localStorage.setItem('openrouter_api_key', JSON.stringify({ owner, key: canary })), { owner, canary });
    page.on('dialog', dialog => dialog.accept());
    await page.reload();
    await expect(page.getByRole('button', { name: 'Disconnect from OpenRouter', exact: true })).toBeVisible({ timeout: 30_000 });
    expect(await page.evaluate(() => localStorage.getItem('openrouter_api_key'))).toBeNull();
    expect(await metadata(page, origin)).toEqual({ connected: true, persisted: true });
    expect(await page.evaluate(async url => (await import(url)).useUserApiKey().apiKey.value, keyModule)).toBeNull();
    await page.reload();
    await expect(page.getByRole('button', { name: 'Disconnect from OpenRouter', exact: true })).toBeVisible();
    await page.goto('/documentation');
    // This page has an SSR launcher before its click handler hydrates.
    await expect(async () => {
        const launcher = page.getByRole('button', { name: 'Open help chat', exact: true });
        if (await launcher.isVisible()) await launcher.click();
        await expect(page.getByPlaceholder('Ask about Or3 Chat…')).toBeVisible({ timeout: 1000 });
    }).toPass({ timeout: 15000 });
    await page.getByPlaceholder('Ask about Or3 Chat…').fill('How do workspaces work?');
    await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeEnabled();
    await page.goto('/');

    const second = await browser.newContext();
    try {
        await signIn(second, origin);
        const device = await second.newPage();
        await device.goto('/');
        await expect(device.getByRole('button', { name: 'Disconnect from OpenRouter', exact: true })).toBeVisible({ timeout: 30_000 });
        await device.evaluate(({ owner, canary }) => localStorage.setItem('openrouter_api_key', JSON.stringify({ owner, key: canary })), { owner, canary });
        expect(await metadata(page, origin, 'delete')).toEqual({ connected: false, persisted: true });
        await device.reload();
        await expect.poll(() => device.evaluate(() => localStorage.getItem('openrouter_api_key'))).toBeNull();
        expect(await metadata(device, origin)).toEqual({ connected: false, persisted: true });
        const rejected = await device.request.post('/api/openrouter/credentials', { headers: { origin, 'x-or3-cloud-intent': 'mutation', 'x-or3-account': owner }, data: { operation: 'migrate', key: canary } });
        expect(rejected.status()).toBe(409);
        // A forged browser key cannot bypass required BYOK or become a server key.
        const refused = await device.request.post('/api/openrouter/stream', { headers: { origin, 'x-or3-cloud-intent': 'mutation', 'x-or3-openrouter-key': canary }, data: { model: 'unused/synthetic', messages: [{ role: 'user', content: 'hello' }] } });
        expect(refused.ok()).toBe(false);
        expect(await refused.text()).not.toContain(canary);
    } finally { await second.close(); }
    await page.screenshot({ path: info.outputPath('connection.png') });
    await info.attach('security-receipt', { contentType: 'application/json', body: JSON.stringify({ migrated: true, browserKey: null, acrossDevices: true, tombstoneBlocksStaleImport: true }) });
});
