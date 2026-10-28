import { test, expect } from '@playwright/test';

test.skip(process.env.OR3_SIGN_IN_GATE_E2E_HARNESS !== 'true', 'Use test:e2e:waitlist with disposable credentials');

test('optional waitlist: admission, admin controls, sign-in and invite registration', async ({ page, browser }, info) => {
    test.setTimeout(120_000);
    const origin = new URL(info.project.use.baseURL!).origin;
    const adminHeaders = { origin, 'x-or3-admin-intent': 'admin' };
    const joinHeaders = { origin, 'x-or3-waitlist-intent': 'join' };

    if (process.env.OR3_CLOUD_WAITLIST_ENABLED !== 'true') {
        expect((await page.request.get('/api/cloud/waitlist')).status()).toBe(404);
        await page.goto('/welcome');
        // This is the profile's first hydrated page; allow the same cold-client
        // compilation budget as the existing sign-in gate browser journeys.
        await expect(page.getByRole('button', { name: 'Continue with email', exact: true })).toBeVisible({ timeout: 30_000 });
        await expect(page.getByRole('button', { name: 'Join the waitlist', exact: true })).toHaveCount(0);
        return;
    }

    const admin = await browser.newContext({ baseURL: origin });
    try {
        const login = await admin.request.post('/api/admin/auth/login', {
            headers: adminHeaders,
            data: { username: process.env.OR3_ADMIN_USERNAME, password: process.env.OR3_ADMIN_PASSWORD },
        });
        expect(login.ok(), await login.text()).toBe(true);
        // Installed is separate from enabled; installation alone changes no CTA.
        expect(await (await page.request.get('/api/cloud/waitlist')).json()).toEqual({ enabled: false });
        expect((await page.request.get('/api/admin/cloud-waitlist')).status()).toBe(401);
        expect((await admin.request.patch('/api/admin/cloud-waitlist', {
            headers: { origin: 'https://untrusted.example', 'x-or3-admin-intent': 'admin' }, data: { enabled: true },
        })).status()).toBe(403);
        expect((await page.request.post('/api/cloud/waitlist', { headers: joinHeaders, data: { email: 'closed@example.test' } })).status()).toBe(409);

        const adminPage = await admin.newPage();
        await adminPage.goto('/admin/extensions/cloud-waitlist');
        await expect(adminPage.getByRole('heading', { name: 'Cloud waitlist', exact: true })).toBeVisible();
        await adminPage.getByRole('switch', { name: 'Show waitlist on the welcome page' }).click();
        await expect.poll(async () => (await (await page.request.get('/api/cloud/waitlist')).json()).enabled).toBe(true);

        await page.setViewportSize({ width: 1440, height: 900 });
        await page.goto('/welcome');
        await expect(page.getByRole('button', { name: 'Join the waitlist', exact: true })).toBeVisible();
        await page.screenshot({ path: info.outputPath('waitlist-desktop.png'), fullPage: true });
        await info.attach('Waitlist on desktop (1440×900)', { path: info.outputPath('waitlist-desktop.png'), contentType: 'image/png' });
        await page.setViewportSize({ width: 390, height: 844 });
        await page.goto('/welcome?next=%2Fchat');
        const email = `waitlist-${crypto.randomUUID()}@example.test`;
        await page.getByRole('textbox', { name: 'Email address', exact: true }).fill(`  ${email.toUpperCase()}  `);
        await page.getByRole('button', { name: 'Join the waitlist', exact: true }).click();
        await expect(page.getByRole('status')).toContainText("You're on the list");
        await expect(page.getByRole('dialog')).toHaveCount(0);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await page.screenshot({ path: info.outputPath('waitlist-mobile.png'), fullPage: true });
        await info.attach('Waitlist on mobile (390×844)', { path: info.outputPath('waitlist-mobile.png'), contentType: 'image/png' });

        expect((await page.request.post('/api/cloud/waitlist', { headers: joinHeaders, data: { email } })).ok()).toBe(true);
        expect((await page.request.post('/api/cloud/waitlist', { headers: joinHeaders, data: { email: 'invalid' } })).status()).toBe(400);
        expect((await page.request.post('/api/cloud/waitlist', { headers: { ...joinHeaders, origin: 'https://untrusted.example' }, data: { email } })).status()).toBe(403);
        expect((await page.request.post('/api/cloud/waitlist', { headers: joinHeaders, data: { email, padding: 'x'.repeat(5000) } })).status()).toBe(413);
        await adminPage.reload();
        await expect(adminPage.getByRole('cell', { name: email, exact: true })).toBeVisible();
        const stored = await (await admin.request.get('/api/admin/cloud-waitlist')).json();
        expect(stored.total).toBe(1);
        expect(stored.entries[0].email).toBe(email);

        // A signed-in workspace owner still cannot read the deployment-wide email list.
        await page.getByRole('button', { name: 'Sign in', exact: true }).click();
        const signIn = page.getByRole('dialog', { name: 'Welcome back', exact: true });
        await expect(signIn).toBeVisible();
        await signIn.getByRole('textbox', { name: 'Email', exact: true }).fill(process.env.OR3_BASIC_AUTH_BOOTSTRAP_EMAIL!);
        await signIn.getByLabel('Password', { exact: true }).fill(process.env.OR3_BASIC_AUTH_BOOTSTRAP_PASSWORD!);
        await signIn.getByRole('button', { name: 'Sign in', exact: true }).click();
        await expect(page).not.toHaveURL(/\/welcome/);
        const chat = (await (await page.request.get('/api/auth/session')).json()).session;
        expect(chat.authenticated).toBe(true);
        expect((await page.request.get('/api/admin/cloud-waitlist')).status()).toBe(401);

        // Both a direct welcome invite and an invite carried in next use the provider's registration flow.
        for (const nested of [false, true]) {
            const invitee = `waitlist-invite-${crypto.randomUUID()}@example.test`;
            const created = await admin.request.post('/api/admin/signup-invites/create', { headers: adminHeaders, data: { email: invitee } });
            expect(created.ok(), await created.text()).toBe(true);
            const { invite } = await created.json();
            const token = new URL(invite.inviteUrl, origin).searchParams.get('invite')!;
            const visitor = await browser.newContext({ baseURL: origin });
            try {
                const tab = await visitor.newPage();
                await tab.goto(nested ? `/welcome?next=${encodeURIComponent(`/?invite=${token}`)}` : `/welcome?invite=${encodeURIComponent(token)}`);
                const register = tab.getByRole('dialog', { name: 'Create your account', exact: true });
                await expect(register).toBeVisible({ timeout: 30_000 });
                await register.getByRole('textbox', { name: 'Email', exact: true }).fill(invitee);
                await register.getByLabel('Password', { exact: true }).fill('DisposableWaitlistInvite!123');
                await register.getByLabel('Confirm password', { exact: true }).fill('DisposableWaitlistInvite!123');
                await register.getByRole('button', { name: 'Create account', exact: true }).click();
                await expect(tab).not.toHaveURL(/\/welcome/);
                expect((await (await visitor.request.get('/api/auth/session')).json()).session.authenticated).toBe(true);
            } finally { await visitor.close(); }
        }

        // A stale open page cannot submit once the admin switches back.
        expect((await admin.request.patch('/api/admin/cloud-waitlist', { headers: adminHeaders, data: { enabled: false } })).ok()).toBe(true);
        expect((await page.request.post('/api/cloud/waitlist', { headers: joinHeaders, data: { email } })).status()).toBe(409);
        const fresh = await browser.newContext({ baseURL: origin });
        try {
            const tab = await fresh.newPage();
            await tab.goto('/welcome');
            await expect(tab.getByRole('button', { name: 'Continue with email', exact: true })).toBeVisible();
            expect((await (await admin.request.get('/api/admin/cloud-waitlist')).json()).total).toBe(1);
        } finally { await fresh.close(); }
        // A closed list still rate-limits repeated public attempts.
        let limited = false;
        for (let attempt = 0; attempt < 10; attempt++) {
            const response = await page.request.post('/api/cloud/waitlist', { headers: joinHeaders, data: { email } });
            if (response.status() === 429) {
                expect(Number(response.headers()['retry-after'])).toBeGreaterThan(0);
                limited = true;
                break;
            }
            expect(response.status()).toBe(409);
        }
        expect(limited).toBe(true);
        expect((await admin.request.patch('/api/admin/cloud-waitlist', { headers: adminHeaders, data: { enabled: true } })).ok()).toBe(true);
        await info.attach('Waitlist receipt', { body: JSON.stringify(stored, null, 2), contentType: 'application/json' });
    } finally { await admin.close(); }
});

test('waitlist persistence after restart', async ({ request }, info) => {
    const origin = new URL(info.project.use.baseURL!).origin;
    expect((await request.post('/api/admin/auth/login', {
        headers: { origin, 'x-or3-admin-intent': 'admin' },
        data: { username: process.env.OR3_ADMIN_USERNAME, password: process.env.OR3_ADMIN_PASSWORD },
    })).ok()).toBe(true);
    const response = await request.get('/api/admin/cloud-waitlist');
    expect(response.ok()).toBe(true);
    const saved = await response.json();
    expect(saved.enabled).toBe(true);
    expect(saved.total).toBe(1);
    expect(saved.entries[0].email).toMatch(/^waitlist-.*@example.test$/);
    expect(await (await request.get('/api/cloud/waitlist')).json()).toEqual({ enabled: true });
    await info.attach('Persisted waitlist after process restart', { body: JSON.stringify(saved, null, 2), contentType: 'application/json' });
});
