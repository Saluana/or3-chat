import { expect, test } from '@playwright/test';
import Database from 'better-sqlite3';
import { basename, dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

test('trial, editable admin allowances, and expiry preserve billing and data access', async ({ page, baseURL }, info) => {
    const root = process.env.OR3_WORKSPACE_CLOUD_E2E_DIR;
    if (!root || dirname(resolve(root)) !== resolve(tmpdir()) ||
        !/^or3-workspace-cloud-e2e-[a-zA-Z0-9]+$/.test(basename(root)) ||
        process.env.OR3_BILLING_SQLITE_PATH !== join(root, 'billing.sqlite')) {
        throw new Error('Use bun run test:e2e:hosted-billing with its disposable databases.');
    }
    test.setTimeout(120_000);
    page.setDefaultTimeout(15_000);
    const moduleRequests: string[] = [];
    const billingHydrationWarnings: string[] = [];
    page.on('console', message => {
        const text = message.text();
        if (/hydration/i.test(text) && text.includes('BillingPanel')) billingHydrationWarnings.push(text);
    });
    page.on('request', request => moduleRequests.push(request.url()));
    const headers = { origin: baseURL!, 'x-or3-cloud-intent': 'mutation' };
    // Billing must not leak account state or create Stripe sessions before sign-in.
    expect([401, 403]).toContain((await page.request.get('/api/billing/status')).status());
    for (const route of ['checkout', 'portal', 'refresh']) {
        expect([401, 403]).toContain((await page.request.post(`/api/billing/${route}`, { headers, data: {} })).status());
    }
    const login = await page.request.post('/api/basic-auth/sign-in', { headers, data: { email: 'workspace-e2e@example.test', password: 'DisposableWorkspaceE2e!123' } });
    expect(login.ok(), await login.text()).toBe(true);
    const status = await page.request.get('/api/billing/status');
    expect(status.ok(), await status.text()).toBe(true);
    expect(status.headers()['cache-control']).toBe('no-store');
    const trial = await status.json();
    expect(trial).toMatchObject({ state: 'trial', allowed: true, storageLimitBytes: 1_000_000_000, paidStorageLimitBytes: 50_000_000_000 });
    expect((await page.request.get('/api/admin/hosted-billing')).status()).toBeGreaterThanOrEqual(400);
    // No outbound payment requests are needed for the no-card trial.
    await page.goto('/billing');
    await expect(page.getByRole('heading', { name: 'Keep your workspace in sync.' })).toBeVisible();
    await expect(page.getByText('50 GB of cloud storage')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/No card needed for your trial/)).toBeVisible();
    const bounds = await page.locator('main').boundingBox();
    expect(bounds!.x).toBeLessThan(1);
    expect(bounds!.width).toBeGreaterThanOrEqual(page.viewportSize()!.width - 1);
    await page.screenshot({ path: info.outputPath('billing-trial.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('button', { name: 'Upgrade to Cloud' }).scrollIntoViewIfNeeded();
    await expect(page.getByRole('button', { name: 'Upgrade to Cloud' })).toBeInViewport();
    expect(await page.locator('main').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath('billing-mobile.png'), fullPage: true });
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto('/chat');
    await expect(page.getByRole('complementary', { name: 'Subscription' })).toBeVisible();
    const shell = page.locator('#page-container');
    await expect.poll(async () => { const box = await shell.boundingBox(); return box ? box.y + box.height : Infinity; }).toBeLessThanOrEqual(721);
    await page.screenshot({ path: info.outputPath('billing-banner.png'), fullPage: true });
    await page.getByRole('button', { name: 'Dismiss welcome', exact: true }).click();
    await page.getByRole('button', { name: 'Dismiss plan notice' }).click();
    await expect(page.getByRole('complementary', { name: 'Subscription' })).toBeHidden();
    await page.reload();
    await expect(page.getByRole('button', { name: 'Dashboard', exact: true })).toBeVisible();
    await expect(page.getByRole('complementary', { name: 'Subscription' })).toBeHidden();
    await expect.poll(async () => (await shell.boundingBox())?.y).toBe(0);
    // Customers reach their plan inside the ordinary dashboard without an admin login.
    await page.getByRole('button', { name: 'Dashboard', exact: true }).click();
    await page.locator('#dashboard-sidebar').getByRole('button', { name: 'Billing', exact: true }).click();
    const dashboardBilling = page.getByRole('region', { name: 'Your subscription' });
    await expect(dashboardBilling.getByText('50 GB of cloud storage')).toBeVisible();
    await expect(dashboardBilling.getByRole('button', { name: 'Upgrade to Cloud' })).toBeVisible();
    await expect(page).toHaveURL(/\/chat$/);
    await page.screenshot({ path: info.outputPath('billing-dashboard.png'), fullPage: true });
    await page.getByRole('button', { name: 'Close dashboard' }).click();
    // Browser writes retain the host's same-origin and intent requirement.
    for (const route of ['checkout', 'portal', 'refresh']) {
        for (const unsafeHeaders of [{}, { ...headers, origin: 'https://attacker.example' }, { origin: baseURL! }]) {
            expect((await page.request.post(`/api/billing/${route}`, { headers: unsafeHeaders, data: { userId: 'someone-else', customer: 'cus_someone_else' } })).status()).toBe(403);
        }
    }
    expect((await page.request.post('/api/billing/webhook', { headers: { 'stripe-signature': 'invalid' }, data: {} })).status()).toBe(400);

    const adminHeaders = { origin: baseURL!, 'x-or3-admin-intent': 'admin' };
    const admin = await page.request.post('/api/admin/auth/login', { headers: adminHeaders, data: { username: 'workspace-e2e-admin', password: 'DisposableAdminE2e!123' } });
    expect(admin.ok(), await admin.text()).toBe(true);
    await page.goto('/admin/extensions/hosted-billing');
    await expect(page.getByLabel('Paid storage (GB)')).toHaveValue('50');
    await page.getByLabel('Paid storage (GB)').fill('75');
    await page.getByRole('button', { name: 'Save storage limits' }).click();
    await expect(page.getByText('Storage limits saved.')).toBeVisible();
    await page.reload();
    await expect(page.getByLabel('Paid storage (GB)')).toHaveValue('75');
    await page.screenshot({ path: info.outputPath('billing-admin.png'), fullPage: true });
    expect((await (await page.request.get('/api/billing/status')).json()).paidStorageLimitBytes).toBe(75_000_000_000);

    // Keep one fixture connection for both transitions and release it after verification.
    const db = new Database(process.env.OR3_BILLING_SQLITE_PATH);
    try {
        db.prepare('UPDATE billing_accounts SET trial_ends_at = ? WHERE user_id = ?').run(Date.now() + 8_000, trial.userId);
        await page.goto('/chat');
        const notice = page.getByRole('complementary', { name: 'Subscription' });
        await expect(notice).toContainText('left in your Cloud trial');
        await page.getByRole('button', { name: 'Dismiss plan notice' }).click();
        await expect(notice).toBeHidden();
        // Deadline changes the notice without a reload or waiting for the 60-second poll.
        await expect(notice).toContainText('Free Local', { timeout: 12_000 });
        await page.screenshot({ path: info.outputPath('billing-deadline-notice.png'), fullPage: true });
        expect((await page.request.post('/api/openrouter/stream', { headers, data: {} })).status()).not.toBe(402);
        for (const path of ['/api/sync/pull', '/api/sync/push', '/api/sync/snapshot']) expect((await page.request.post(path, { headers, data: {} })).status()).toBe(402);
        expect((await page.request.get('/api/sync/events?workspaceId=fixture')).status()).toBe(402);
        expect((await page.request.post('/api/storage/presign-upload', { headers, data: {} })).status()).toBe(402);
        expect((await page.request.post('/api/workspaces', { headers, data: { name: 'Expired' } })).status()).toBe(402);
        expect((await page.request.get('/api/workspaces')).ok()).toBe(true);
        expect((await page.request.get('/api/billing/status')).ok()).toBe(true);
        await page.goto('/billing');
        await expect(page.getByText(/Your current plan/)).toBeVisible();
        await page.screenshot({ path: info.outputPath('billing-expired.png'), fullPage: true });
        const requests: string[] = [];
        page.on('request', request => { if (/\/api\/(sync\/|storage\/presign-upload)/.test(request.url())) requests.push(request.url()); });
        await page.goto('/chat');
        await expect.poll(() => moduleRequests.find(url => /\/db\/client\.ts(?:\?|$)/.test(url))).toBeTruthy();
        const clientUrl = moduleRequests.find(url => /\/db\/client\.ts(?:\?|$)/.test(url))!;
        const session = await (await page.request.get('/api/auth/session')).json();
        expect(session.cloudAccess.enabled).toBe(false);
        await expect.poll(() => page.evaluate(async url => (await import(url)).getActiveWorkspaceId(), clientUrl)).toBe(session.session.workspace.id);
        const local = await page.evaluate(async url => {
            const posts = await import(new URL('./posts.ts', url).href);
            const files = await import(new URL('./files.ts', url).href);
            const post = await posts.createPost({ title: 'Free Local keeps my work', content: 'before upgrade', postType: 'markdown', meta: null });
            await posts.upsertPost({ ...post, content: 'latest local edit', clock: post.clock + 1 });
            const file = await files.createOrRefFile(new File(['free local original'], 'local-note.txt', { type: 'text/plain' }), 'local-note.txt');
            return { id: post.id, hash: file.hash };
        }, clientUrl);
        await page.reload();
        await expect.poll(() => page.evaluate(async ({ url, id }) => (await (await import(url)).getDb().posts.get(id))?.content, { url: clientUrl, id: local.id })).toBe('latest local edit');
        expect(await page.evaluate(async ({ url, hash }) => (await (await import(url)).getDb().file_blobs.get(hash))?.blob.text(), { url: clientUrl, hash: local.hash })).toBe('free local original');
        expect(requests).toEqual([]);
        // Export must include unsynced browser work without starting Cloud transport.
        await page.evaluate(() => {
            const chunks: Uint8Array[] = [];
            Object.assign(window, { __localBackup: '', showSaveFilePicker: async () => ({ createWritable: async () => ({
                write: async (chunk: Uint8Array) => { chunks.push(chunk); },
                close: async () => { (window as any).__localBackup = await new Blob(chunks).text(); },
                abort: async () => {},
            }) }) });
        });
        await page.getByRole('button', { name: 'Dashboard', exact: true }).click();
        await page.locator('#dashboard-sidebar').getByRole('button', { name: 'Workspaces', exact: true }).click();
        await page.getByRole('button', { name: /^Backup & Restore/ }).click();
        await page.getByRole('button', { name: 'Export', exact: true }).click();
        await expect.poll(() => page.evaluate(() => (window as any).__localBackup), { timeout: 10_000 }).toContain('latest local edit');
        const backup = await page.evaluate(() => (window as any).__localBackup as string);
        expect(backup).toContain(local.hash);
        expect(backup).toContain(Buffer.from('free local original').toString('base64'));
        expect(requests).toEqual([]);
        await page.getByRole('button', { name: 'Close dashboard' }).click();
        // Only the disposable ledger is advanced. Payment verification has its own SDK suite.
        const paidUntil = Date.now() + 86_400_000;
        expect(db.prepare("UPDATE billing_accounts SET subscription_status = 'active', paid_until = ? WHERE user_id = ?").run(paidUntil, trial.userId).changes).toBe(1);
        const upgraded = await (await page.request.get('/api/billing/status')).json();
        expect(upgraded).toMatchObject({ state: 'active', allowed: true });
        await page.goto('/billing');
        await expect(page.getByRole('heading', { name: 'Your Cloud plan' })).toBeVisible();
        await expect(page.getByText('75 GB of cloud storage')).toBeVisible();
        await page.screenshot({ path: info.outputPath('billing-paid.png'), fullPage: true });
        const canonical = new Database(process.env.OR3_SQLITE_DB_PATH, { readonly: true });
        try {
            await expect.poll(() => {
                const row = canonical.prepare('SELECT data_json FROM s_posts WHERE id = ?').get(local.id) as { data_json: string } | undefined;
                return row && JSON.parse(row.data_json).content;
            }, { timeout: 30_000 }).toBe('latest local edit');
            await expect.poll(() => {
                const row = canonical.prepare('SELECT data_json FROM s_file_meta WHERE id = ?').get(local.hash) as { data_json: string } | undefined;
                return row && JSON.parse(row.data_json).storage_id;
            }, { timeout: 30_000 }).toBeTruthy();
        } finally { canonical.close(); }
        expect(requests.some(url => url.includes('/api/sync/'))).toBe(true);
        expect(requests.some(url => url.includes('/api/storage/presign-upload'))).toBe(true);
        db.prepare("UPDATE billing_accounts SET review_required = 1, customer_id = 'cus_disposable' WHERE user_id = ?").run(trial.userId);
        await page.goto('/billing');
        await expect(page.getByText('Contact support about your subscription')).toBeVisible();
        await expect(page.getByRole('button', { name: 'Manage subscription', exact: true })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Upgrade to Cloud', exact: true })).toHaveCount(0);
        expect((await (await page.request.get('/api/auth/session')).json()).cloudAccess.enabled).toBe(false);
        await page.screenshot({ path: info.outputPath('billing-review.png'), fullPage: true });
    } finally { db.close(); }
    expect(billingHydrationWarnings).toEqual([]);
});
