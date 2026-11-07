import { expect, test, type APIRequestContext } from '@playwright/test';
import Database from 'better-sqlite3';
import { execFileSync } from 'node:child_process';
import { basename, dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

// Keep the fixture writer open while this file's dev-server scenarios share its WAL.
let inspectorBilling: Database.Database | undefined;
test.afterAll(() => inspectorBilling?.close());

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
    await page.getByLabel('Reason for storage allowance change').fill('Disposable allowance qualification');
    await page.getByRole('button', { name: 'Preview impact', exact: true }).click();
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
    } finally { inspectorBilling = db; } // Keep the shared WAL open until afterAll, even on failure.
    expect(billingHydrationWarnings).toEqual([]);
});

/*
 * Stage A customer inspector (tasks 1.2 / 4.4). Failure inventory:
 * - an ordinary member or unauthenticated caller must get no customer metadata;
 * - list/detail/billing reads must not create billing rows, trial decisions, users, workspaces or memberships;
 * - an absent billing row must read as "Cloud not started", never as expired or a trial;
 * - a denied trial must stay denied and paid dates unchanged after admin reads and decisions;
 * - a legacy review hold must be shown with an unknown reason and resolvable only with a reason;
 * - filters must apply server-side to the matching population, beyond the first page.
 */
test('admin customer inspector explains accounts without provisioning them', async ({ page, browser, baseURL }, info) => {
    const root = process.env.OR3_WORKSPACE_CLOUD_E2E_DIR;
    if (!root || dirname(resolve(root)) !== resolve(tmpdir()) || process.env.OR3_BILLING_SQLITE_PATH !== join(root, 'billing.sqlite')) {
        throw new Error('Use bun run test:e2e:hosted-billing with its disposable databases.');
    }
    test.setTimeout(180_000);
    page.setDefaultTimeout(15_000);
    const headers = { origin: baseURL!, 'x-or3-cloud-intent': 'mutation' };
    const adminHeaders = { origin: baseURL!, 'x-or3-admin-intent': 'admin' };
    const users: Record<string, { id: string; email: string }> = {};
    for (const name of ['paid', 'review', 'expired', 'denied', 'never', 'member']) {
        const context = await browser.newContext({ baseURL });
        try {
            const email = `inspector-${name}-${Date.now()}@example.test`;
            const registered = await context.request.post('/api/basic-auth/register', { headers, data: { email, password: 'DisposableInspector!123', confirmPassword: 'DisposableInspector!123' } });
            expect(registered.ok(), await registered.text()).toBe(true);
            const session = await (await context.request.get('/api/auth/session')).json();
            users[name] = { id: session.session.user.id, email };
            if (['paid', 'review', 'expired', 'denied'].includes(name)) {
                expect((await context.request.get('/api/billing/status')).ok()).toBe(true);
            }
            if (name === 'member') {
                // An ordinary signed-in member cannot reach cross-account support data.
                for (const path of ['/api/admin/customers', `/api/admin/customers/${users.paid!.id}`, `/api/admin/hosted-billing/accounts/${users.paid!.id}`]) {
                    const denied = await context.request.get(path);
                    expect([401, 403, 404]).toContain(denied.status());
                    expect(await denied.text()).not.toContain(users.paid!.email);
                }
                expect([401, 403, 404]).toContain((await context.request.post(`/api/admin/hosted-billing/accounts/${users.review!.id}/review`, { headers: adminHeaders, data: {} })).status());
            }
        } finally { await context.close(); }
    }
    const billing = inspectorBilling ??= new Database(process.env.OR3_BILLING_SQLITE_PATH);
    const canonical = new Database(process.env.OR3_SQLITE_DB_PATH, { readonly: true });
    try {
        const paidUntil = Date.now() + 200 * 86_400_000;
        billing.prepare("UPDATE billing_accounts SET subscription_status = 'active', subscription_id = 'sub_fixture', paid_until = ?, trial_ends_at = 0 WHERE user_id = ?").run(paidUntil, users.paid!.id);
        billing.prepare('UPDATE billing_accounts SET review_required = 1 WHERE user_id = ?').run(users.review!.id);
        billing.prepare('UPDATE billing_accounts SET trial_ends_at = ? WHERE user_id = ?').run(Date.now() - 86_400_000, users.expired!.id);
        billing.prepare('DELETE FROM billing_accounts WHERE user_id = ?').run(users.never!.id);
        billing.prepare('DELETE FROM billing_trial_decisions WHERE user_id = ?').run(users.never!.id);
        // The denied fixture represents a repeated identity regardless of test order.
        billing.prepare('INSERT OR REPLACE INTO billing_trial_decisions (user_id, granted) VALUES (?, 0)').run(users.denied!.id);
        expect(billing.prepare('SELECT COUNT(*) AS n FROM billing_accounts WHERE user_id = ?').get(users.denied!.id)).toEqual({ n: 1 });
        const snapshot = () => ({
            accounts: billing.prepare('SELECT user_id, trial_ends_at, paid_until, review_required FROM billing_accounts ORDER BY user_id').all(),
            decisions: billing.prepare('SELECT user_id, granted FROM billing_trial_decisions ORDER BY user_id').all(),
            users: canonical.prepare('SELECT COUNT(*) AS n FROM users').get(),
            workspaces: canonical.prepare('SELECT COUNT(*) AS n FROM workspaces').get(),
            members: canonical.prepare('SELECT COUNT(*) AS n FROM workspace_members').get(),
        });

        const login = await page.request.post('/api/admin/auth/login', { headers: adminHeaders, data: { username: 'workspace-e2e-admin', password: 'DisposableAdminE2e!123' } });
        expect(login.ok(), await login.text()).toBe(true);
        // The preview must include the current paid cohort while leaving account facts untouched.
        const impact = await page.request.get('/api/admin/hosted-billing/quota-impact', { params: { trialStorageGb: '2', paidStorageGb: '75' } });
        expect(impact.ok()).toBe(true);
        expect((await impact.json()).impact.paid.accounts).toBeGreaterThanOrEqual(1);
        const before = snapshot();
        const list = await page.request.get('/api/admin/customers', { params: { q: 'inspector-' } });
        expect(list.ok(), await list.text()).toBe(true);
        expect(list.headers()['cache-control']).toBe('no-store');
        const listed = await list.json();
        expect(listed.items.map((item: { userId: string }) => item.userId)).toEqual(expect.arrayContaining(Object.values(users).map(user => user.id)));
        expect((await page.request.get('/api/admin/customers', { params: { q: 'x'.repeat(201) } })).status()).toBe(400);
        const never = await (await page.request.get(`/api/admin/hosted-billing/accounts/${users.never!.id}`)).json();
        expect(never).toMatchObject({ account: null, access: { allowed: false, blockers: ['cloud_not_started'] } });
        const paidFilter = await (await page.request.get('/api/admin/hosted-billing/accounts', { params: { filter: 'paid' } })).json();
        expect(paidFilter.items.map((item: { userId: string }) => item.userId)).toContain(users.paid!.id);
        const attention = await (await page.request.get('/api/admin/hosted-billing/accounts', { params: { filter: 'attention' } })).json();
        expect(attention.items.map((item: { userId: string }) => item.userId)).toContain(users.review!.id);
        expect((await page.request.get('/api/admin/customers/not-a-real-user')).status()).toBe(404);
        expect(snapshot()).toEqual(before);

        await page.goto('/admin/customers');
        await expect(page.getByRole('heading', { name: 'Customers', level: 1 })).toBeVisible();
        await page.getByRole('searchbox', { name: 'Search customers' }).fill('inspector-');
        await expect(page.getByRole('link', { name: users.paid!.email })).toBeVisible();
        await page.getByRole('button', { name: 'Paid', exact: true }).click();
        await expect(page.getByRole('link', { name: users.paid!.email })).toBeVisible();
        await expect(page.getByRole('link', { name: users.expired!.email })).toHaveCount(0);
        for (const [width, height, scheme] of [[1440, 900, 'light'], [390, 844, 'light'], [1440, 900, 'dark'], [390, 844, 'dark']] as const) {
            await page.setViewportSize({ width, height });
            await page.emulateMedia({ colorScheme: scheme });
            expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
            await page.screenshot({ path: info.outputPath(`admin-customers-${width}-${scheme}.png`), fullPage: true });
        }
        await page.setViewportSize({ width: 1440, height: 900 });
        await page.emulateMedia({ colorScheme: 'light' });
        await page.getByRole('button', { name: 'All', exact: true }).click();

        await page.goto(`/admin/customers/${users.never!.id}`);
        await expect(page.getByText('Cloud not started').first()).toBeVisible();
        await page.goto(`/admin/customers/${users.denied!.id}`);
        await expect(page.getByText('Trial denied')).toBeVisible();
        await page.goto(`/admin/customers/${users.review!.id}`);
        await expect(page.getByText('Legacy review — reason unavailable').first()).toBeVisible();
        await expect(page.getByText(/Access: blocked/)).toBeVisible();
        await page.screenshot({ path: info.outputPath('admin-account-review.png'), fullPage: true });
        expect(snapshot()).toEqual(before);

        await page.getByRole('button', { name: 'Resolve review' }).click();
        const dialog = page.getByRole('dialog');
        await expect(dialog.getByRole('button', { name: 'Resolve review' })).toBeDisabled();
        await dialog.getByLabel('Reason').fill('Verified with the customer by email');
        await dialog.getByRole('button', { name: 'Resolve review' }).click();
        await expect(page.getByRole('status').filter({ hasText: 'Review resolved.' })).toHaveCount(1);
        await expect(page.getByText('Review resolved.').first()).toBeVisible();
        await expect(page.getByText(/Access: allowed|Access: blocked/)).toBeVisible();
        await expect(page.getByText('Verified with the customer by email')).toBeVisible();
        const after = billing.prepare('SELECT review_required, paid_until FROM billing_accounts WHERE user_id = ?').get(users.review!.id) as { review_required: number };
        expect(after.review_required).toBe(0);
        const paid = billing.prepare('SELECT paid_until FROM billing_accounts WHERE user_id = ?').get(users.paid!.id) as { paid_until: number };
        expect(paid.paid_until).toBe(paidUntil);
        expect((billing.prepare('SELECT granted FROM billing_trial_decisions WHERE user_id = ?').get(users.denied!.id) as { granted: number }).granted).toBe(0);

        for (const [width, height, scheme] of [[1440, 900, 'light'], [390, 844, 'light'], [1440, 900, 'dark'], [390, 844, 'dark']] as const) {
            await page.setViewportSize({ width, height });
            await page.emulateMedia({ colorScheme: scheme });
            await page.goto(`/admin/customers/${users.paid!.id}`);
            await expect(page.getByRole('heading', { name: users.paid!.email })).toBeVisible();
            expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
            await page.screenshot({ path: info.outputPath(`admin-account-${width}-${scheme}.png`), fullPage: true });
        }
    } finally {
        canonical.close();
    }
});

/*
 * Stage B operational pauses (task 7.1). Failure inventory:
 * - a deployment upload pause must refuse new presigns with retry guidance, but not downloads or sign-in;
 * - a registration pause must refuse new accounts while existing accounts still sign in;
 * - a purchase pause must refuse Checkout before any Stripe request, while billing status still reads;
 * - a background-job pause must refuse new background admissions only;
 * - an account upload pause must refuse that owner's uploads only, and resume must restore normal checks;
 * - a stale pause revision must be refused, and every change must reach the activity journal with its reason.
 */
test('operational pauses refuse only new work and are recorded', async ({ page, browser, baseURL }, info) => {
    const root = process.env.OR3_WORKSPACE_CLOUD_E2E_DIR;
    if (!root || dirname(resolve(root)) !== resolve(tmpdir()) || process.env.OR3_BILLING_SQLITE_PATH !== join(root, 'billing.sqlite')) {
        throw new Error('Use bun run test:e2e:hosted-billing with its disposable databases.');
    }
    test.setTimeout(180_000);
    const headers = { origin: baseURL!, 'x-or3-cloud-intent': 'mutation' };
    const adminHeaders = { origin: baseURL!, 'x-or3-admin-intent': 'admin' };
    const readSession = async (request: APIRequestContext) => {
        let response = await request.get('/api/auth/session');
        if (response.status() === 429) {
            // Earlier scenarios share this loopback IP and may fill its session window.
            const retryAfter = Number(response.headers()['retry-after']);
            expect(retryAfter).toBeGreaterThan(0);
            expect(retryAfter).toBeLessThanOrEqual(60);
            await new Promise(resolve => setTimeout(resolve, retryAfter * 1000 + 100));
            response = await request.get('/api/auth/session');
        }
        return response;
    };
    const user = await browser.newContext({ baseURL });
    const email = `pause-${Date.now()}@example.test`;
    expect((await user.request.post('/api/basic-auth/register', { headers, data: { email, password: 'DisposablePause!123', confirmPassword: 'DisposablePause!123' } })).ok()).toBe(true);
    const sessionResponse = await readSession(user.request);
    expect(sessionResponse.ok(), await sessionResponse.text()).toBe(true);
    const session = await sessionResponse.json();
    const userId = session.session.user.id as string;
    const workspaceId = session.session.workspace.id as string;
    try {
        expect((await page.request.post('/api/admin/auth/login', { headers: adminHeaders, data: { username: 'workspace-e2e-admin', password: 'DisposableAdminE2e!123' } })).ok()).toBe(true);
        const inspect = async () => (await (await page.request.get(`/api/admin/hosted-billing/accounts/${userId}`)).json()).revision as number;
        // Access comes from a support grant through the real command path, not a database edit.
        const granted = await page.request.post(`/api/admin/hosted-billing/accounts/${userId}/support`, { headers: adminHeaders, data: {
            operationId: `grant-${Date.now()}`, reason: 'Pause qualification', expectedRevision: await inspect(),
            command: { kind: 'grant', expiresAt: Date.now() + 86_400_000, storageBytes: 1_000_000_000 },
        } });
        expect(granted.ok(), await granted.text()).toBe(true);
        expect(await (await user.request.get('/api/billing/status')).json()).toMatchObject({ state: 'grant', allowed: true });
        const billingPage = await user.newPage();
        await billingPage.route('**/api/billing/status*', route => route.fulfill({ json: {
            userId, state: 'paused', source: 'paid', allowed: false, trialEndsAt: 0,
            paidUntil: Date.now() + 86_400_000, cancelAtPeriodEnd: false, hasCustomer: true,
            storageLimitBytes: 0, paidStorageLimitBytes: 50_000_000_000,
        } }));
        await billingPage.goto('/billing');
        await expect(billingPage.getByRole('button', { name: 'Manage subscription' })).toBeVisible();
        await expect(billingPage.getByRole('button', { name: 'Upgrade to Cloud' })).toHaveCount(0);
        await billingPage.close();
        const upload = () => user.request.post('/api/storage/presign-upload', { headers, data: { workspace_id: workspaceId, hash: `sha256:${'a'.repeat(64)}`, mime_type: 'image/png', size_bytes: 10 } });
        const admitted = await upload();
        expect(admitted.status(), await admitted.text()).toBe(200);
        const candidates = await page.request.get('/api/admin/storage/candidates', { params: { workspaceId } });
        expect(candidates.ok()).toBe(true);
        expect(await candidates.json()).toMatchObject({ available: true, page: { items: [], complete: true, scope: 'managed_generations_only', legacyIncluded: false } });


        const set = async (kind: string, active: boolean, operationId: string) => {
            const { revision } = await (await page.request.get('/api/admin/system/pauses')).json();
            return page.request.post('/api/admin/system/pauses', { headers: adminHeaders, data: { operationId, kind, active, expiresAt: null, reason: `E2E ${kind}`, expectedRevision: revision } });
        };
        for (const kind of ['uploads', 'registrations', 'purchases', 'jobs']) expect((await set(kind, true, `pause-${kind}-${Date.now()}`)).ok()).toBe(true);
        expect((await page.request.post('/api/admin/system/pauses', { headers: adminHeaders, data: { operationId: `stale-${Date.now()}`, kind: 'uploads', active: false, expiresAt: null, reason: 'stale', expectedRevision: 'none' } })).status()).toBe(409);

        const refused = await upload();
        expect(refused.status()).toBe(503);
        expect(refused.headers()['retry-after']).toBeTruthy();
        expect((await refused.json()).data).toMatchObject({ code: 'service_paused', pause: 'uploads' });
        expect((await user.request.post('/api/storage/presign-download', { headers, data: { workspace_id: workspaceId, hash: `sha256:${'b'.repeat(64)}` } })).status()).not.toBe(503);
        const newcomer = await browser.newContext({ baseURL });
        try {
            // Basic Auth may store a credential, but no canonical OR3 account is provisioned while paused.
            const canonical = new Database(process.env.OR3_SQLITE_DB_PATH, { readonly: true });
            try {
                const users = () => (canonical.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n;
                const before = users();
                const registered = await newcomer.request.post('/api/basic-auth/register', { headers, data: { email: `paused-${Date.now()}@example.test`, password: 'DisposablePause!123', confirmPassword: 'DisposablePause!123' } });
                const session = await readSession(newcomer.request);
                expect([registered.status(), session.status()]).toContain(503);
                expect(users()).toBe(before);
            } finally { canonical.close(); }
        } finally { await newcomer.close(); }
        expect((await user.request.post('/api/basic-auth/sign-in', { headers, data: { email, password: 'DisposablePause!123' } })).ok()).toBe(true);
        const checkout = await user.request.post('/api/billing/checkout', { headers, data: {} });
        expect(checkout.status()).toBe(503);
        expect((await checkout.json()).data).toMatchObject({ code: 'service_paused' });
        expect((await user.request.get('/api/billing/status')).ok()).toBe(true);
        const job = await user.request.post('/api/openrouter/stream', { headers, data: { _background: true, model: 'openai/gpt-4o-mini', messages: [] } });
        expect(job.status()).toBe(503);
        for (const kind of ['uploads', 'registrations', 'purchases', 'jobs']) expect((await set(kind, false, `resume-${kind}-${Date.now()}`)).ok()).toBe(true);
        expect((await upload()).status()).toBe(200);

        // Account-scoped upload pause applies to this owner only.
        const pauseUploads = await page.request.post(`/api/admin/hosted-billing/accounts/${userId}/support`, { headers: adminHeaders, data: {
            operationId: `acct-pause-${Date.now()}`, reason: 'Abusive upload pattern', expectedRevision: await inspect(), command: { kind: 'pause_uploads', expiresAt: null },
        } });
        expect(pauseUploads.ok(), await pauseUploads.text()).toBe(true);
        const accountRefusal = await upload();
        expect(accountRefusal.status()).toBe(503);
        expect((await accountRefusal.json()).data).toMatchObject({ code: 'account_uploads_paused' });
        const resume = await page.request.post(`/api/admin/hosted-billing/accounts/${userId}/support`, { headers: adminHeaders, data: {
            operationId: `acct-resume-${Date.now()}`, reason: 'Resolved', expectedRevision: await inspect(), command: { kind: 'resume_uploads' },
        } });
        expect(resume.ok()).toBe(true);
        expect((await upload()).status()).toBe(200);
        const activity = await (await page.request.get('/api/admin/activity', { params: { action: 'pause.uploads' } })).json();
        expect(activity.items.map((item: { reason: string }) => item.reason)).toContain('E2E uploads');

        // Support action through the account page dialog, read back after confirmation.
        await page.goto(`/admin/customers/${userId}`);
        await page.getByRole('button', { name: 'Additional storage' }).click();
        const dialog = page.getByRole('dialog');
        await dialog.getByLabel('Additional storage (GB, 0 removes it)').fill('3');
        await dialog.getByLabel('Reason').fill('Customer migration headroom');
        await dialog.getByRole('button', { name: 'Confirm' }).click();
        await expect(page.getByText('Additional storage: applied.').first()).toBeVisible();
        await expect(page.getByText(/Additional storage 3 GB/)).toBeVisible();
        await expect(page.getByText('Customer migration headroom')).toBeVisible();
        await page.screenshot({ path: info.outputPath('admin-account-support.png'), fullPage: true });
        for (const [path, heading, name] of [
            ['/admin/storage', 'Storage', 'admin-storage'], ['/admin/activity', 'Activity', 'admin-activity'],
            ['/admin', 'Overview', 'admin-overview'], ['/admin/extensions/hosted-billing', null, 'admin-billing-health'],
            ['/admin/advanced', 'Advanced Settings', 'admin-advanced'],
        ] as const) {
            await page.goto(path);
            if (heading) await expect(page.getByRole('heading', { name: heading }).first()).toBeVisible();
            if (name === 'admin-storage') await expect(page.getByText('Charged to allowances')).toBeVisible();
            if (name === 'admin-activity') await expect(page.getByRole('cell', { name: 'Customer migration headroom' })).toBeVisible();
            if (name === 'admin-overview') {
                await expect(page.getByRole('heading', { name: /Needs attention/ })).toBeVisible();
                await expect(page.getByText('Auth Provider', { exact: true })).toBeVisible();
                await expect(page.getByText(/Checked … from local records/)).toHaveCount(0);
            }
            if (name === 'admin-billing-health') await expect(page.getByText('Latest reconciliation')).toBeVisible();
            if (name === 'admin-advanced') {
                await expect(page.getByRole('heading', { name: 'Service pauses' })).toBeVisible();
                await expect(page.locator('#resource-policy').getByText('OR3_BACKGROUND_MAX_JOBS', { exact: true })).toBeVisible();
            }
            for (const [width, height, scheme] of [[1440, 900, 'light'], [390, 844, 'light'], [1440, 900, 'dark'], [390, 844, 'dark']] as const) {
                await page.setViewportSize({ width, height });
                await page.emulateMedia({ colorScheme: scheme });
                expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
                await page.screenshot({ path: info.outputPath(`${name}-${width}-${scheme}.png`), fullPage: true });
            }
            if (name === 'admin-advanced') {
                await page.setViewportSize({ width: 1440, height: 900 });
                await page.emulateMedia({ colorScheme: 'light' });
                await page.locator('#resource-policy').scrollIntoViewIfNeeded();
                await page.screenshot({ path: info.outputPath('admin-resource-policy.png'), fullPage: true });
                await page.getByRole('heading', { name: 'Service pauses' }).scrollIntoViewIfNeeded();
                await page.screenshot({ path: info.outputPath('admin-service-pauses.png'), fullPage: true });
            }
        }
        await page.goto('/admin/extensions/hosted-billing');
        const paidAllowance = page.getByLabel('Paid storage (GB)');
        await paidAllowance.fill(String(Number(await paidAllowance.inputValue()) + 1));
        await page.getByLabel('Reason for storage allowance change').fill('Confirm current cohort allowance policy');
        await page.getByRole('button', { name: 'Preview impact', exact: true }).click();
        const saveResponse = page.waitForResponse(response => response.url().endsWith('/api/admin/hosted-billing') && response.request().method() === 'POST');
        await page.getByRole('button', { name: 'Save storage limits' }).click();
        expect((await saveResponse).ok()).toBe(true);
        await expect(page.getByText('Storage limits saved.', { exact: true })).toBeVisible();
        // A separate process proves the audit reached the database independently of the HTTP store.
        const recorded = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', `
            import Database from 'better-sqlite3';
            const db = new Database(process.env.OR3_BILLING_SQLITE_PATH, { readonly: true });
            try { console.log(JSON.stringify(db.prepare('SELECT operation_id,kind,reason FROM billing_admin_actions ORDER BY created_at DESC LIMIT 10').all())); }
            finally { db.close(); }
        `], { encoding: 'utf8' }));
        const history = await (await page.request.get('/api/admin/hosted-billing/activity')).json();
        expect((await page.request.get('/api/admin/hosted-billing/activity', { params: { since: 'invalid' } })).status()).toBe(400);
        expect((await page.request.get('/api/admin/hosted-billing/activity', { params: { until: 'invalid' } })).status()).toBe(400);
        await info.attach('allowance-audit-receipt', { body: JSON.stringify({ recorded, history }), contentType: 'application/json' });
        expect(recorded).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'allowance_change', reason: 'Confirm current cohort allowance policy' })]));
        expect(history.items).toEqual(expect.arrayContaining([expect.objectContaining({ action: 'allowance_change', reason: 'Confirm current cohort allowance policy' })]));
        await page.goto('/admin/system');
        await expect(page.getByRole('heading', { name: 'Provider checks' })).toBeVisible();
        const refreshed = page.waitForResponse(response => response.url().endsWith('/api/admin/system/checks') && response.request().method() === 'POST');
        await page.getByRole('button', { name: 'Refresh checks', exact: true }).click();
        const checkResult = await refreshed;
        expect(checkResult.ok()).toBe(true);
        expect((await checkResult.json()).providers.sync.check).toMatchObject({ result: 'passed', kind: 'database_read', code: 'read_ok' });
        await expect(page.getByText('read_ok', { exact: true })).toBeVisible();
        await expect(page.getByRole('heading', { name: 'Backup & recovery evidence' })).toBeVisible();
        await expect(page.getByText('Loading recovery evidence…')).toHaveCount(0);
        await page.screenshot({ path: info.outputPath('admin-system-checks.png'), fullPage: true });
        await page.locator('section[aria-labelledby="recovery-heading"]').screenshot({ path: info.outputPath('admin-system-recovery.png') });

    } finally {
        await user.close();
    }
});

// Offer UI failure inventory: reads must not call Stripe or mutate offers;
// ordinary members cannot inspect prices; stale/invalid edits do not change
// accepted offers; retiring a historical offer keeps it recognized.
test('accepted offers are read-only on load and invalid changes preserve the offer', async ({ page, browser, baseURL }, info) => {
    const root = process.env.OR3_WORKSPACE_CLOUD_E2E_DIR;
    if (!root || dirname(resolve(root)) !== resolve(tmpdir()) || process.env.OR3_BILLING_SQLITE_PATH !== join(root, 'billing.sqlite')) throw new Error('Disposable billing runner required');
    const headers = { origin: baseURL!, 'x-or3-admin-intent': 'admin' };
    const db = new Database(process.env.OR3_BILLING_SQLITE_PATH, { readonly: true });
    try {
        expect((await page.request.post('/api/admin/auth/login', { headers, data: { username: 'workspace-e2e-admin', password: 'DisposableAdminE2e!123' } })).ok()).toBe(true);
        const before = db.prepare('SELECT * FROM billing_offers ORDER BY version').all();
        const anonymous = await browser.newContext({ baseURL });
        try { expect([401, 403]).toContain((await anonymous.request.get('/api/admin/hosted-billing/offers')).status()); }
        finally { await anonymous.close(); }
        const response = await page.request.get('/api/admin/hosted-billing/offers');
        expect(response.ok()).toBe(true);
        const state = await response.json();
        const invalid = await page.request.post('/api/admin/hosted-billing/offers', { headers, data: { operationId: 'invalid-offer', reason: 'Invalid input check', expectedRevision: state.revision,
            command: { kind: 'create_current', priceId: 'invalid', amountCents: 6000, paidStorageGb: 75, trialStorageGb: 2, trialDays: 14 } } });
        expect(invalid.status()).toBe(400);
        await page.goto('/admin/extensions/hosted-billing');
        await page.getByRole('tab', { name: 'Accepted offers' }).click();
        await expect(page.getByRole('heading', { name: 'Accepted annual offers' })).toBeVisible();
        await expect(page.getByText('current', { exact: true }).first()).toBeVisible();
        await expect(page.getByRole('button', { name: 'Confirm new offer' })).toBeDisabled();
        expect(db.prepare('SELECT * FROM billing_offers ORDER BY version').all()).toEqual(before);
        await page.screenshot({ path: info.outputPath('admin-accepted-offers.png'), fullPage: true });
        await info.attach('offer-read-receipt', { body: JSON.stringify({ revision: state.revision, unchanged: true, invalidWriteStatus: invalid.status(), offers: state.items.length }), contentType: 'application/json' });

        // Explicit --stripe-env uses a real test price and disposable application DB.
        // Refuse live keys; ordinary offline browser runs still verify local reads/input guards.
        const secret = process.env.OR3_BILLING_STRIPE_SECRET_KEY;
        if (secret && secret !== 'sk_test_disposable_no_network') {
            expect(secret).toMatch(/^(sk|rk)_test_/);
            test.setTimeout(120_000);
            const { default: Stripe } = await import('../../packages/hosted-billing/node_modules/stripe/esm/stripe.esm.node.js');
            const stripe = new Stripe(secret, { timeout: 15_000, maxNetworkRetries: 1 });
            const originalPrice = await stripe.prices.retrieve(process.env.OR3_BILLING_STRIPE_PRICE_ID!);
            expect(originalPrice.livemode).toBe(false);
            const fixture = await stripe.prices.create({ product: typeof originalPrice.product === 'string' ? originalPrice.product : originalPrice.product.id,
                currency: 'usd', unit_amount: 6000, recurring: { interval: 'year' }, metadata: { purpose: 'or3_disposable_offer_ui' } });
            const facts = () => db.prepare('SELECT user_id,trial_ends_at,paid_until,review_required FROM billing_accounts ORDER BY user_id').all();
            const beforeFacts = facts();
            try {
                expect(fixture.livemode).toBe(false);
                const editor = page.getByRole('tabpanel').locator('form');
                await editor.getByLabel('Stripe price ID', { exact: true }).fill(fixture.id);
                await editor.getByLabel('Annual amount (USD cents)', { exact: true }).fill('6001');
                await editor.getByLabel('Paid storage (GB)', { exact: true }).fill('75');
                await editor.getByLabel('Trial storage (GB)', { exact: true }).fill('2');
                await editor.getByLabel('Trial days', { exact: true }).fill('14');
                await editor.getByLabel('Reason', { exact: true }).fill('Disposable offer UI qualification');
                const offerPost = () => page.waitForResponse(response => new URL(response.url()).pathname.endsWith('/api/admin/hosted-billing/offers') && response.request().method() === 'POST');
                let response = offerPost();
                await editor.getByRole('button', { name: 'Validate and preview' }).click();
                expect((await response).status()).toBe(400);
                await expect(editor.getByRole('button', { name: 'Confirm new offer' })).toBeDisabled();
                expect(db.prepare('SELECT * FROM billing_offers ORDER BY version').all()).toEqual(before);
                await editor.getByLabel('Annual amount (USD cents)', { exact: true }).fill('6000');
                response = offerPost();
                await editor.getByRole('button', { name: 'Validate and preview' }).click();
                expect((await response).ok()).toBe(true);
                await expect(editor.getByText(/The previous current offer will become grandfathered/)).toBeVisible();
                response = offerPost();
                await editor.getByRole('button', { name: 'Confirm new offer' }).click();
                expect((await response).ok()).toBe(true);
                await expect(page.getByText('Offer history updated. Existing subscriptions and trial deadlines were preserved.')).toBeVisible();
                let after = await (await page.request.get('/api/admin/hosted-billing/offers')).json();
                expect(after.items).toEqual(expect.arrayContaining([expect.objectContaining({ priceId: fixture.id, status: 'current', amountCents: 6000 }), expect.objectContaining({ priceId: originalPrice.id, status: 'grandfathered' })]));
                const historical = after.items.find((offer: { priceId: string }) => offer.priceId === originalPrice.id);
                expect((await page.request.post('/api/admin/hosted-billing/offers', { headers, data: { operationId: 'stale-offer-ui', reason: 'Stale revision control', expectedRevision: state.revision, command: { kind: 'retire', offerId: historical.id } } })).status()).toBe(409);
                response = offerPost();
                await page.getByRole('button', { name: 'Retire from sale' }).click();
                expect((await response).ok()).toBe(true);
                after = await (await page.request.get('/api/admin/hosted-billing/offers')).json();
                expect(after.items).toEqual(expect.arrayContaining([expect.objectContaining({ priceId: originalPrice.id, status: 'retired' })]));
                expect(facts()).toEqual(beforeFacts);
                const activity = await (await page.request.get('/api/admin/hosted-billing/activity', { params: { action: 'offer_change' } })).json();
                expect(activity.items).toHaveLength(2);
                await info.attach('offer-ui-receipt', { body: JSON.stringify({ testMode: true, currentPriceId: fixture.id, historicalPriceId: originalPrice.id, originalFactsUnchanged: true, audit: activity.items }), contentType: 'application/json' });
                await page.screenshot({ path: info.outputPath('admin-qualified-offer-editor.png'), fullPage: true });
            } finally { await stripe.prices.update(fixture.id, { active: false }); }
        }
    } finally { db.close(); }
});
