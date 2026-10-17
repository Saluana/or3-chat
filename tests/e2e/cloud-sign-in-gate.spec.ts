import { test, expect, type Page, type TestInfo } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createInviteToken } from '../../server/auth/invite-token';
import { strToU8, zipSync } from 'fflate';

// Needs the invite-only Basic Auth profile with a disposable bootstrap user:
// run it with `bun run test:e2e:sign-in-gate`.
const harnessReady = process.env.OR3_SIGN_IN_GATE_E2E_HARNESS === 'true';
const credentials = {
    email: process.env.OR3_BASIC_AUTH_BOOTSTRAP_EMAIL ?? '',
    password: process.env.OR3_BASIC_AUTH_BOOTSTRAP_PASSWORD ?? '',
};
const SIGN_IN_PROMPT = 'Sign in to start chatting';
// A send reaches the stream route or the provider; the startup model catalog
// GET (openrouter.ai/api/v1/models) is unrelated to sending.
const sendRequest = /\/api\/openrouter\/stream|\/chat\/completions/i;

test.skip(!harnessReady, 'Requires the sign-in gate E2E harness');

async function saveEvidence(info: TestInfo, name: string, artifact: { body: string | Buffer; contentType: string }) {
    const path = info.outputPath(`${name}.${artifact.contentType === 'image/png' ? 'png' : 'json'}`);
    await writeFile(path, artifact.body);
    await info.attach(name, { path, contentType: artifact.contentType });
}

async function openComposer(page: Page) {
    await page.goto('/');
    const composer = page.getByLabel('Message input', { exact: true });
    await expect(composer).toBeVisible({ timeout: 30_000 });
    // The keyless welcome dialog opens after the chat loads and covers the composer.
    await page.getByRole('button', { name: 'Dismiss welcome', exact: true }).click({ timeout: 5_000 }).catch(() => undefined);
    return composer;
}

async function typeAndSend(page: Page, composer: ReturnType<Page['getByLabel']>, text: string) {
    await composer.click();
    await page.keyboard.type(text);
    // Mobile never sends on Enter, so use the visible Send button on both.
    await page.getByRole('button', { name: 'Send message', exact: true }).click();
}

// Providers that sign people up in their own UI (Clerk) never see the token,
// and the session request after sign-up may come after a redirect or from
// another tab. The server keeps a valid invite in a cookie for that request.
test('an invite link keeps a valid token for a later sign-up, and ignores a forged one', async ({ page, context }) => {
    const secret = process.env.OR3_AUTH_INVITE_TOKEN_SECRET ?? '';
    expect(secret).not.toBe('');
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const payload = { workspaceId: 'e2e-workspace', email: 'e2e-invitee@example.test', exp };
    const stored = async () => (await context.cookies()).find((cookie) => cookie.name === 'or3_invite_token');

    await page.goto(`/?invite=${encodeURIComponent(createInviteToken(payload, 'not-the-instance-secret'))}`);
    expect(await stored()).toBeUndefined();

    const invite = createInviteToken(payload, secret);
    await page.goto(`/?invite=${encodeURIComponent(invite)}`);
    const cookie = await stored();
    expect(cookie).toMatchObject({ value: invite, httpOnly: true, sameSite: 'Lax', path: '/' });
    expect(Math.abs(cookie!.expires - exp)).toBeLessThan(5);

    // A page opened later without the query still sends it.
    const later = await context.newPage();
    const request = later.waitForRequest((sent) => new URL(sent.url()).pathname === '/chat');
    await later.goto('/chat');
    expect((await (await request).allHeaders()).cookie).toContain('or3_invite_token=');
});

for (const [label, viewport] of [
    ['desktop', { width: 1440, height: 900 }],
    ['mobile', { width: 390, height: 844 }],
] as const) {
    test.describe(label, () => {
        test.use({ viewport });

        test('signed-out send asks for sign-in, not an OpenRouter key, and sends nothing', async ({ page }, info) => {
            const sent: string[] = [];
            page.on('request', (request) => {
                if (sendRequest.test(request.url())) sent.push(request.url());
            });

            const composer = await openComposer(page);
            await expect(page.locator('.ProseMirror p.is-editor-empty')).toHaveAttribute('data-placeholder', SIGN_IN_PROMPT);

            const urlBeforeSend = page.url();
            await typeAndSend(page, composer, 'hello from a signed-out visitor');

            await expect(page.getByText(SIGN_IN_PROMPT, { exact: true }).last()).toBeVisible();
            await expect(page.getByText('Connect to OpenRouter')).toHaveCount(0);
            // Nothing was sent: the draft is still in the composer, no thread
            // was created, and no provider request left the page.
            await expect(composer).toContainText('hello from a signed-out visitor');
            expect(page.url()).toBe(urlBeforeSend);
            expect(sent).toEqual([]);
            await saveEvidence(info, `signed-out-${label}`, { body: await page.screenshot(), contentType: 'image/png' });
        });

        // Invite links open registration from the account control; on mobile
        // that control is inside More, so the visitor is told where it is.
        test('a signed-out visitor on an invite link is told where to create an account', async ({ page }, info) => {
            await page.goto('/?invite=e2e-invite-token');
            await page.getByRole('button', { name: 'Dismiss welcome', exact: true }).click({ timeout: 5_000 }).catch(() => undefined);
            await expect(page.locator('.ProseMirror p.is-editor-empty')).toHaveAttribute('data-placeholder', SIGN_IN_PROMPT, { timeout: 30_000 });
            const hint = page.getByText('Open the menu, tap More, then Login to create your account.', { exact: true });
            if (label === 'mobile') await expect(hint).toBeVisible();
            else await expect(hint).toHaveCount(0);
            // The token outlives the root → /chat rewrite: a provider that reads
            // invite links has opened registration, or it is still there to read.
            await expect.poll(async () => new URL(page.url()).searchParams.get('invite') === 'e2e-invite-token'
                || await page.getByRole('dialog', { name: 'Create your account' }).isVisible()).toBe(true);
            await saveEvidence(info, `invite-link-${label}`, { body: await page.screenshot(), contentType: 'image/png' });
        });

        // Complete the invite journey through the installed provider's UI,
        // registration endpoint and real SQLite membership provisioning.
        // A cookie or a mocked registration response alone cannot prove this.
        for (const kind of ['team', 'signup'] as const) test(`completes invite-only sign-up from a ${kind} invite link`, async ({ page, browser }, info) => {
            const origin = new URL(info.project.use.baseURL!).origin;
            const owner = await browser.newContext({ baseURL: origin });
            const email = `invite-${label}-${crypto.randomUUID()}@example.test`;
            let workspaceId: string;
            let inviteUrl: string;
            try {
                const signedIn = await owner.request.post('/api/basic-auth/sign-in', {
                    headers: { origin, 'x-or3-cloud-intent': 'mutation' },
                    data: credentials,
                });
                expect(signedIn.ok(), await signedIn.text()).toBe(true);
                const sessionResponse = await owner.request.get('/api/auth/session');
                expect(sessionResponse.ok()).toBe(true);
                workspaceId = (await sessionResponse.json()).session.workspace.id;
                const admin = await owner.request.post('/api/admin/auth/login', {
                    headers: { origin, 'x-or3-admin-intent': 'admin' },
                    data: { username: process.env.OR3_ADMIN_USERNAME, password: process.env.OR3_ADMIN_PASSWORD },
                });
                expect(admin.ok(), await admin.text()).toBe(true);
                const created = await owner.request.post(kind === 'signup' ? '/api/admin/signup-invites/create' : '/api/admin/workspace/invites/create', {
                    headers: { origin, 'x-or3-admin-intent': 'admin' },
                    data: kind === 'signup' ? { email } : { workspaceId, email, role: 'viewer' },
                });
                expect(created.ok(), await created.text()).toBe(true);
                const invitation = (await created.json()).invite;
                inviteUrl = invitation.inviteUrl;
                if (kind === 'signup') {
                    expect(invitation.token).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
                    expect(new URL(inviteUrl, origin).searchParams.get('invite')).toBe(invitation.token);
                }
            } finally {
                await owner.close();
            }

            await page.goto(inviteUrl);
            await page.getByRole('button', { name: 'Dismiss welcome', exact: true }).click({ timeout: 5_000 }).catch(() => undefined);
            if (label === 'mobile') {
                await page.getByRole('button', { name: 'Open sidebar', exact: true }).click();
                await page.getByRole('button', { name: 'More options', exact: true }).click();
            }
            const form = page.getByRole('dialog', { name: 'Create your account', exact: true });
            await expect(form).toBeVisible({ timeout: 30_000 });
            const inviteCode = form.getByRole('textbox', { name: 'Invite code (from your invite link)', exact: true });
            await expect(inviteCode).not.toHaveValue('');
            await saveEvidence(info, `registration-${kind}-${label}`, {
                body: await page.screenshot({ mask: [inviteCode] }), contentType: 'image/png',
            });
            const token = await inviteCode.inputValue();
            const emailField = form.getByRole('textbox', { name: 'Email', exact: true });
            await emailField.fill(`${email}.typo`);
            await form.getByLabel('Password', { exact: true }).fill('DisposableInvitee!123');
            await form.getByLabel('Confirm password', { exact: true }).fill('DisposableInvitee!123');

            // Exercise the real preflight and rendered errors before correcting
            // the form. Rejected attempts must leave this invitation usable.
            for (const [code, message] of [
                [token, 'This invitation is for a different email address. Check for typos or use the email that received the invite.'],
                [`${token}x`, 'This invite code is invalid or has expired. Check your invite link or ask for a new invitation.'],
            ] as const) {
                await inviteCode.fill(code);
                const rejected = page.waitForResponse(response =>
                    new URL(response.url()).pathname === '/api/basic-auth/register' && response.request().method() === 'POST');
                await form.getByRole('button', { name: 'Create account', exact: true }).click();
                expect((await rejected).status()).toBe(403);
                await expect(form.getByRole('alert')).toHaveText(message);
                await expect(emailField).toHaveValue(`${email}.typo`);
                await saveEvidence(info, `rejected-${kind}-invite-${label}-${code === token ? 'email' : 'code'}`, {
                    body: await page.screenshot({ mask: [inviteCode] }), contentType: 'image/png',
                });
            }
            // Codes work when typed in lowercase, grouped, or copied with spaces.
            await inviteCode.fill(kind === 'signup' ? ` ${token.slice(0, 4).toLowerCase()}-${token.slice(4).toLowerCase()} ` : token);
            await emailField.fill(email.toUpperCase());
            const registration = page.waitForResponse(response =>
                new URL(response.url()).pathname === '/api/basic-auth/register' && response.request().method() === 'POST');
            await form.getByRole('button', { name: 'Create account', exact: true }).click();
            const registered = await registration;
            expect(registered.ok(), await registered.text()).toBe(true);
            await expect(form).not.toBeVisible();

            const verifySession = async () => {
                const response = await page.request.get('/api/auth/session');
                expect(response.ok()).toBe(true);
                const payload = await response.json();
                expect(payload.appAccessAllowed).toBe(true);
                expect(payload.session).toMatchObject({
                    authenticated: true, provider: 'basic-auth', role: kind === 'signup' ? 'owner' : 'viewer',
                    user: { email },
                });
                if (kind === 'team') expect(payload.session.workspace.id).toBe(workspaceId);
                else {
                    expect(payload.session.workspace.id).not.toBe(workspaceId);
                    expect(payload.session.workspace.name).toBe('My Workspace');
                    const deniedPull = await page.request.post('/api/sync/pull', { data: { scope: { workspaceId }, cursor: 0, limit: 10 } });
                    expect(deniedPull.status()).toBe(403);
                    const deniedFile = await page.request.post('/api/storage/presign-download', { data: { workspace_id: workspaceId, hash: 'a'.repeat(64) } });
                    expect(deniedFile.status()).toBe(403);
                }
                expect(payload.session.workspace).toMatchObject({ id: expect.any(String),
                });
                return payload.session;
            };
            const completed = await verifySession();
            await page.reload();
            await verifySession();
            await expect(page.locator('.ProseMirror p.is-editor-empty')).not.toHaveAttribute('data-placeholder', SIGN_IN_PROMPT);
            await saveEvidence(info, `completed-${kind}-invite-${label}`, {
                body: JSON.stringify({ inviteKind: kind, email, inviterWorkspaceId: workspaceId, workspaceId: completed.workspace.id, role: completed.role, registrationStatus: registered.status(), sessionAfterReload: true }),
                contentType: 'application/json',
            });
            await saveEvidence(info, `completed-${kind}-invite-${label}-screen`, { body: await page.screenshot(), contentType: 'image/png' });
        });

        test('signed-in user without a key still gets the OpenRouter connect flow', async ({ page }, info) => {
            const origin = new URL(info.project.use.baseURL!).origin;
            const signIn = await page.request.post('/api/basic-auth/sign-in', {
                headers: { origin, 'x-or3-cloud-intent': 'mutation' },
                data: credentials,
            });
            expect(signIn.ok(), await signIn.text()).toBe(true);

            const composer = await openComposer(page);
            await expect(page.locator('.ProseMirror p.is-editor-empty')).not.toHaveAttribute('data-placeholder', SIGN_IN_PROMPT);

            await typeAndSend(page, composer, 'hello from a signed-in user');

            await expect(page.getByText('Connect to OpenRouter', { exact: true }).last()).toBeVisible();
            await expect(page.getByText(SIGN_IN_PROMPT)).toHaveCount(0);
            await saveEvidence(info, `signed-in-${label}`, { body: await page.screenshot(), contentType: 'image/png' });
        });
    });
}

test('instance admin controls load without a Chat account or selected workspace', async ({ page }, info) => {
    const origin = new URL(info.project.use.baseURL!).origin;
    const login = await page.request.post('/api/admin/auth/login', {
        headers: { origin, 'x-or3-admin-intent': 'admin' },
        data: { username: process.env.OR3_ADMIN_USERNAME, password: process.env.OR3_ADMIN_PASSWORD },
    });
    expect(login.ok()).toBe(true);
    const inventory = await page.request.get('/api/admin/plugins-page');
    expect(inventory.ok()).toBe(true);
    expect((await inventory.json()).workspaceState).toBeNull();
    await page.goto('/admin/plugins');
    await expect(page.getByRole('button', { name: 'Instance', exact: true })).toBeVisible();
    await expect(page.getByRole('dialog', { name: 'Select a Workspace' })).not.toBeVisible();
    await expect(page.getByText('Site catalog approvals', { exact: true })).toBeVisible();
    const historyLoaded = page.waitForResponse(r => new URL(r.url()).pathname === '/api/admin/signup-invites/list');
    await page.goto('/admin/signup-invites');
    await historyLoaded;
    await expect(page.getByRole('heading', { name: 'Registration', exact: true })).toBeVisible();
    await expect(page).toHaveURL(/\/admin\/registration\?tab=invitations$/);
    await expect(page.getByText('Each recipient gets their own private workspace.', { exact: true })).toBeVisible();
    const email = 'admin-ui-'+crypto.randomUUID()+'@example.test';
    await page.getByLabel('Recipient email', {exact:true}).fill(email);
    await expect(page.getByLabel('Recipient email', {exact:true})).toHaveValue(email);
    const created = page.waitForResponse(r => new URL(r.url()).pathname === '/api/admin/signup-invites/create');
    await page.getByRole('button',{name:'Create invite',exact:true}).click();
    expect((await created).ok()).toBe(true);
    const shortCode = page.getByRole('textbox', { name: 'Invite code', exact: true });
    await expect(shortCode).toHaveValue(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
    await expect(page.getByRole('button', { name: 'Copy code', exact: true })).toBeVisible();
    const visibleLink = await page.getByLabel(/Invite link/).inputValue();
    expect(new URL(visibleLink).searchParams.get('invite')).toBe((await shortCode.inputValue()).replace('-', ''));
    await saveEvidence(info, 'short-invitation', { body: await page.screenshot({ mask: [shortCode, page.getByLabel(/Invite link/)] }), contentType: 'image/png' });
    expect(new URL(visibleLink).origin).toBe(origin);
    await page.getByRole('listitem').filter({hasText:email}).getByRole('button',{name:'Revoke',exact:true}).click();
    await expect(page.getByRole('listitem').filter({hasText:email})).toContainText('revoked');
    // Clear the one-time token before saving the redacted UI evidence.
    await page.reload();
    await saveEvidence(info, 'instance-admin-without-workspace', { body: await page.screenshot(), contentType: 'image/png' });
});

test('signup invite setup failures guide the administrator without exposing server errors', async ({ page }, info) => {
    const origin = new URL(info.project.use.baseURL!).origin;
    const login = await page.request.post('/api/admin/auth/login', {
        headers: { origin, 'x-or3-admin-intent': 'admin' },
        data: { username: process.env.OR3_ADMIN_USERNAME, password: process.env.OR3_ADMIN_PASSWORD },
    });
    expect(login.ok()).toBe(true);
    let missingSecret = true;
    await page.route('**/api/admin/signup-invites/create', route => route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ statusCode: 503, statusMessage: missingSecret
            ? 'Invite token secret not configured'
            : 'Unexpected failure: secret=private-server-value' }),
    }));
    const historyLoaded = page.waitForResponse(r => new URL(r.url()).pathname === '/api/admin/signup-invites/list');
    await page.goto('/admin/registration?tab=invitations');
    await historyLoaded;
    await page.getByLabel('Recipient email', { exact: true }).fill('invite-setup@example.test');
    await expect(page.getByLabel('Recipient email', { exact: true })).toHaveValue('invite-setup@example.test');
    const setupFailure = page.waitForResponse(r => new URL(r.url()).pathname === '/api/admin/signup-invites/create');
    await page.getByRole('button', { name: 'Create invite', exact: true }).click();
    expect((await setupFailure).status()).toBe(503);
    const alert = page.getByRole('alert');
    await expect(alert).toContainText('OR3_AUTH_INVITE_TOKEN_SECRET');
    await expect(alert).toContainText('Restart OR3');
    await expect(alert).toContainText('No invitation was created');
    await expect(alert).not.toContainText('response was lost');
    await expect(page.getByRole('link', { name: 'View invite setup instructions' })).toHaveAttribute('href', '/documentation/cloud/environment-reference#invite-signing-setup');
    await saveEvidence(info, 'signup-invite-setup-guidance', { body: await page.screenshot(), contentType: 'image/png' });

    // Unclassified failures still use safe copy and uncertain-outcome recovery.
    missingSecret = false;
    await page.getByRole('button', { name: 'Create invite', exact: true }).click();
    await expect(alert).toContainText('The service could not complete the request.');
    await expect(alert).toContainText('response was lost');
    await expect(alert).not.toContainText('private-server-value');
    await expect(page.getByRole('link', { name: 'View invite setup instructions' })).toHaveCount(0);
});

test('admin invite guidance distinguishes open registration from required invitations', async ({ page }, info) => {
    const origin = new URL(info.project.use.baseURL!).origin;
    const login = await page.request.post('/api/admin/auth/login', {
        headers: { origin, 'x-or3-admin-intent': 'admin' },
        data: { username: process.env.OR3_ADMIN_USERNAME, password: process.env.OR3_ADMIN_PASSWORD },
    });
    expect(login.ok()).toBe(true);
    const history = await page.request.get('/api/admin/signup-invites/list');
    expect(history.ok()).toBe(true);
    const payload = await history.json();
    expect(payload.registrationMode).toBe('invite_only');

    let mode = 'open';
    await page.route('**/api/admin/signup-invites/list*', route => route.fulfill({
        json: { ...payload, registrationMode: mode },
    }));
    await page.goto('/admin/registration?tab=invitations');
    await expect(page.getByText('Invites are optional', { exact: true })).toBeVisible();
    await expect(page.getByText('Registration is open. New users can sign up without an invitation.', { exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Invitation history', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Create invite', exact: true })).toBeEnabled();
    await saveEvidence(info, 'admin-open-registration-guidance', { body: await page.screenshot(), contentType: 'image/png' });

    for (mode of ['invite_only', 'disabled']) {
        await page.reload();
        await expect(page.getByRole('heading', { name: 'Invitation history', exact: true })).toBeVisible();
        await expect(page.getByText('Invites are optional', { exact: true })).toHaveCount(0);
    }
});

test('registration settings preserve saved and active modes across tabs and reloads', async ({ page }, info) => {
    const origin = new URL(info.project.use.baseURL!).origin;
    const headers = { origin, 'x-or3-admin-intent': 'admin' };
    expect((await page.request.get('/api/admin/registration')).status()).toBe(401);
    expect((await page.request.post('/api/admin/auth/login', {
        headers, data: { username: process.env.OR3_ADMIN_USERNAME, password: process.env.OR3_ADMIN_PASSWORD },
    })).ok()).toBe(true);
    expect((await page.request.post('/api/admin/registration', { headers: { origin }, data: { mode: 'open' } })).status()).toBe(403);
    expect((await page.request.post('/api/admin/registration', { headers, data: { mode: 'invalid' } })).status()).toBe(400);

    let currentMode = 'invite_only';
    let savedMode = currentMode;
    let failSave = true;
    const writes: Array<{ mode: string; intent: string | undefined }> = [];
    const settings = () => ({ currentMode, savedMode, restartRequired: currentMode !== savedMode, inviteSigningConfigured: true });
    // Browser saves are intercepted; the user's source .env is never modified.
    // Disk persistence and policy validation belong to the real route fixture.
    await page.route('**/api/admin/registration', async route => {
        if (route.request().method() === 'POST') {
            const { mode } = route.request().postDataJSON();
            writes.push({ mode, intent: route.request().headers()['x-or3-admin-intent'] });
            if (failSave) return route.fulfill({ status: 500, json: { statusMessage: 'Unable to save registration settings.' } });
            savedMode = mode;
        }
        return route.fulfill({ json: settings() });
    });
    await page.goto('/admin/registration');
    await expect(page.getByRole('heading', { name: 'Registration', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Registration', exact: true })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Settings', exact: true })).toHaveAttribute('aria-selected', 'true');
    await page.getByRole('radio', { name: 'Open registration', exact: true }).click();
    await page.getByRole('button', { name: 'Save settings', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('Unable to save registration settings');
    await expect(page.getByRole('radio', { name: 'Open registration', exact: true })).toBeChecked();
    failSave = false;
    await page.getByRole('button', { name: 'Save settings', exact: true }).click();
    await expect(page.getByText('Restart required', { exact: true })).toBeVisible();
    await expect(page.getByText('Current mode: Invite only', { exact: true })).toBeVisible();
    await expect(page.getByText('Saved mode: Open registration', { exact: true })).toBeVisible();
    expect(writes).toEqual([{ mode: 'open', intent: 'admin' }, { mode: 'open', intent: 'admin' }]);
    await page.reload();
    await expect(page.getByText('Saved mode: Open registration', { exact: true })).toBeVisible();
    await page.getByRole('tab', { name: 'Invitations', exact: true }).click();
    await expect(page).toHaveURL(/tab=invitations/);
    await expect(page.getByRole('heading', { name: 'Invitation history', exact: true })).toBeVisible();
    await expect(page.getByText('Invites are optional', { exact: true })).toHaveCount(0);
    await page.goBack();
    await expect(page.getByRole('tab', { name: 'Settings', exact: true })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('radio', { name: 'Open registration', exact: true })).toBeChecked();
    await page.setViewportSize({ width: 390, height: 844 });
    await saveEvidence(info, 'registration-settings-pending-mobile', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
    currentMode = savedMode;
    await page.reload();
    await expect(page.getByText('Current mode: Open registration', { exact: true })).toBeVisible();
    await expect(page.getByText('Restart required', { exact: true })).toHaveCount(0);
    await saveEvidence(info, 'registration-settings-active-mobile', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
});

test('registration restart requires confirmation, handles failures, and respects server controls', async ({ page }, info) => {
    const origin = new URL(info.project.use.baseURL!).origin;
    expect((await page.request.post('/api/admin/auth/login', {
        headers: { origin, 'x-or3-admin-intent': 'admin' },
        data: { username: process.env.OR3_ADMIN_USERNAME, password: process.env.OR3_ADMIN_PASSWORD },
    })).ok()).toBe(true);
    const statusResponse = await page.request.get('/api/admin/system/status');
    expect(statusResponse.ok()).toBe(true);
    const payload = await statusResponse.json();
    expect(payload.session.role).toBe('owner');
    let allowRestart = true;
    await page.route('**/api/admin/system/status', route => route.fulfill({ json: {
        ...payload, status: { ...payload.status, admin: { ...payload.status.admin, allowRestart } },
    } }));
    await page.route('**/api/admin/registration', route => route.fulfill({ json: {
        currentMode: 'open', savedMode: 'invite_only', restartRequired: true, inviteSigningConfigured: true,
    } }));
    const requests: Array<{ method: string; intent: string | undefined }> = [];
    let response: 'development' | 'failure' | 'success' = 'development';
    let releaseRestart = () => {};
    // Intercept every restart request; this test must never stop a running server.
    await page.route('**/api/admin/system/restart', async route => {
        requests.push({ method: route.request().method(), intent: route.request().headers()['x-or3-admin-intent'] });
        if (response === 'development') return route.fulfill({ status: 409, json: { statusMessage: 'Restart not supported in development mode' } });
        if (response === 'failure') return route.fulfill({ status: 500, json: { statusMessage: 'Restart failed' } });
        await new Promise<void>(resolve => { releaseRestart = resolve; });
        return route.fulfill({ json: { ok: true } });
    });
    await page.goto('/admin/registration');
    const restart = page.getByRole('button', { name: 'Restart now', exact: true });
    await expect(restart).toBeEnabled();
    await restart.click();
    const confirmation = page.getByRole('dialog', { name: 'Restart Server', exact: true });
    await expect(confirmation).toContainText('temporary downtime');
    await confirmation.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(restart).toBeEnabled();
    expect(requests).toEqual([]);

    for (const outcome of ['development', 'failure'] as const) {
        response = outcome;
        await restart.click();
        await confirmation.getByRole('button', { name: 'Restart', exact: true }).click();
        await expect(page.getByText(outcome === 'development' ? 'Restart unavailable in dev' : 'The service could not complete the request. Please try again later.', { exact: true })).toBeVisible();
        await expect(restart).toBeEnabled();
        await expect(page.getByText('Restart required', { exact: true })).toBeVisible();
    }

    response = 'success';
    await restart.click();
    await confirmation.getByRole('button', { name: 'Restart', exact: true }).click();
    try {
        await expect.poll(() => requests.length).toBe(3);
        await expect(restart).toBeDisabled();
        await saveEvidence(info, 'registration-restart-pending', { body: await page.screenshot(), contentType: 'image/png' });
    } finally { releaseRestart(); }
    await expect(page.getByText('Restart initiated', { exact: true })).toBeVisible();
    await expect(restart).toBeEnabled();
    expect(requests).toEqual(Array.from({ length: 3 }, () => ({ method: 'POST', intent: 'admin' })));
    await expect(page.getByText('Current mode: Open registration', { exact: true })).toBeVisible();
    await expect(page.getByText('Restart required', { exact: true })).toBeVisible();

    allowRestart = false;
    await page.reload();
    await expect(restart).toBeDisabled();
    await expect(page.getByText('Restart from the dashboard is unavailable. Ask the person managing your server to restart OR3.', { exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Go to Operations', exact: true })).toHaveAttribute('href', '/admin/system');
    await page.setViewportSize({ width: 390, height: 844 });
    await saveEvidence(info, 'registration-restart-unavailable-mobile', { body: await page.screenshot(), contentType: 'image/png' });
});

test('registration settings recover from load failures and explain missing invitation setup', async ({ page }, info) => {
    const origin = new URL(info.project.use.baseURL!).origin;
    expect((await page.request.post('/api/admin/auth/login', {
        headers: { origin, 'x-or3-admin-intent': 'admin' },
        data: { username: process.env.OR3_ADMIN_USERNAME, password: process.env.OR3_ADMIN_PASSWORD },
    })).ok()).toBe(true);
    let failLoad = true;
    await page.route('**/api/admin/registration', route => route.fulfill(failLoad
        ? { status: 503, json: { statusMessage: 'Unavailable' } }
        : { json: { currentMode: 'open', savedMode: 'open', restartRequired: false, inviteSigningConfigured: false } }));
    await page.goto('/admin/registration');
    await expect(page.getByRole('alert')).toContainText('Unable to load registration settings');
    failLoad = false;
    await page.getByRole('button', { name: 'Try again', exact: true }).click();
    await expect(page.getByText('Invitations need one-time setup', { exact: true })).toBeVisible();
    await page.getByRole('radio', { name: 'Invite only', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Save settings', exact: true })).toBeDisabled();
    await expect(page.getByText('Set up invitations before choosing Invite only.', { exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'View invite setup instructions' })).toHaveAttribute('href', '/documentation/cloud/environment-reference#invite-signing-setup');
    await page.getByRole('radio', { name: 'Registration closed', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Save settings', exact: true })).toBeEnabled();
    await saveEvidence(info, 'registration-settings-invitation-setup', { body: await page.screenshot(), contentType: 'image/png' });
});

test('admin storage notice opens usage for an explicitly selected workspace', async ({ page }, info) => {
    const origin = new URL(info.project.use.baseURL!).origin;
    const login = await page.request.post('/api/admin/auth/login', {
        headers: { origin, 'x-or3-admin-intent': 'admin' },
        data: { username: process.env.OR3_ADMIN_USERNAME, password: process.env.OR3_ADMIN_PASSWORD },
    });
    expect(login.ok()).toBe(true);
    const response = await page.request.get('/api/admin/system/status');
    expect(response.ok()).toBe(true);
    const payload = await response.json();
    expect(payload.status.storage).toMatchObject({ enabled: true, provider: 'fs' });
    expect(payload.status.storage.actions).toContainEqual(expect.objectContaining({ id: 'storage.usage' }));
    const rawWarning = 'Destructive filesystem blob GC is disabled until provider-owned deletion coordination is available.';
    let usageAvailable = true;
    await page.route('**/api/admin/system/status', route => route.fulfill({ json: {
        ...payload,
        status: { ...payload.status, storage: {
            ...payload.status.storage,
            actions: payload.status.storage.actions.filter((action: { id: string }) => usageAvailable || action.id !== 'storage.usage'),
        } },
        warnings: [{ level: 'warning', message: rawWarning }, { level: 'error', message: 'Another provider needs attention.' }],
    } }));
    await page.route('**/api/admin/workspaces?*', route => route.fulfill({ json: {
        items: [
            { id: 'ux-workspace', name: 'Walkthrough workspace', memberCount: 1 },
            { id: 'other-workspace', name: 'Second workspace', memberCount: 1 },
        ], total: 2,
    } }));
    // Summary contract: readable units, unknown is not zero, partial totals stay
    // qualified, and the full provider response is available only on request.
    const completeUsage = {
        consistency: 'non_atomic_observation',
        canonical: {
            activeMetadataBytes: 16 * 1024 ** 2, retainedDeletedMetadataBytes: 4 * 1024 ** 2,
            reservedUploadBytes: 0,
            complete: { activeMetadata: true, retainedDeletedMetadata: true, reservedUploads: true },
        },
        filesystem: { complete: true, apparentFileBytes: 24 * 1024 ** 2, allocatedFileBytes: 28 * 1024 ** 2 },
        volume: { totalBytes: 100 * 1024 ** 3, availableBytes: 40 * 1024 ** 3, freeBytes: 42 * 1024 ** 3 },
        warnings: [],
    };
    const usageResults = [completeUsage, {
        consistency: 'non_atomic_observation',
        canonical: {
            activeMetadataBytes: null, retainedDeletedMetadataBytes: null, reservedUploadBytes: null,
            complete: { activeMetadata: false, retainedDeletedMetadata: false, reservedUploads: false },
        },
        filesystem: {
            complete: false, apparentFileBytes: null, allocatedFileBytes: null,
            categories: { retainedDeletedBlobs: { files: 0, apparentBytes: 0 } },
        },
        volume: null, warnings: ['filesystem_workspace_missing'],
    }, {
        ...completeUsage,
        canonical: { ...completeUsage.canonical, activeMetadataBytes: 0, retainedDeletedMetadataBytes: 0 },
        filesystem: { complete: false, apparentFileBytes: 1024, allocatedFileBytes: 4096 },
        warnings: ['filesystem_entry_limit'],
    }];
    const requests: unknown[] = [];
    await page.route('**/api/admin/system/provider-action', route => {
        requests.push(route.request().postDataJSON());
        return route.fulfill({ json: { ok: true, result: usageResults[requests.length - 1] } });
    });

    const statusReady = page.waitForResponse(response => new URL(response.url()).pathname === '/api/admin/system/status' && response.ok());
    await page.goto('/admin');
    await statusReady;
    await expect(page.getByText('Deleted files still use storage', { exact: true })).toBeVisible();
    await expect(page.getByText(rawWarning, { exact: true })).toBeHidden();
    await expect(page.getByText('Another provider needs attention.', { exact: true })).toBeVisible();
    await saveEvidence(info, 'admin-storage-notice', { body: await page.screenshot(), contentType: 'image/png' });
    await page.getByRole('link', { name: 'View storage usage', exact: true }).click();
    const picker = page.getByRole('dialog', { name: 'Select a Workspace' });
    await expect(picker).toBeVisible();
    await expect(page).toHaveURL(/\/admin\/system$/);
    await page.keyboard.press('Escape');
    await expect(picker).toBeHidden();
    expect(requests).toHaveLength(0);

    // The same notice must work again on Operations after cancellation, without
    // finding and clicking a second action card or scrolling the page manually.
    await page.getByRole('link', { name: 'View storage usage', exact: true }).click();
    await expect(picker).toBeVisible();
    await picker.getByRole('button', { name: /Walkthrough workspace/ }).click();
    await expect.poll(() => requests).toEqual([{ kind: 'storage', actionId: 'storage.usage', workspaceId: 'ux-workspace' }]);
    const result = page.getByRole('status').filter({ hasText: 'Storage usage for Walkthrough workspace' });
    await expect(result.getByText('Active files', { exact: true })).toBeVisible();
    await expect(result.getByText('16 MB', { exact: true })).toBeVisible();
    await expect(result.getByText('In Trash', { exact: true })).toBeVisible();
    await expect(result.getByText('4 MB', { exact: true })).toBeVisible();
    await expect(result.getByText('Files on disk', { exact: true })).toBeVisible();
    await expect(result.getByText('24 MB', { exact: true })).toBeVisible();
    await expect(result.getByText('Server space available', { exact: true })).toBeVisible();
    await expect(result.getByText('40 GB', { exact: true })).toBeVisible();
    await expect(result.locator('pre')).toBeHidden();
    await expect(result).toBeInViewport();
    await expect(result).toBeFocused();
    await expect(page.getByText('Action completed', { exact: true })).toHaveCount(0);
    await saveEvidence(info, 'admin-workspace-storage-usage', { body: await result.screenshot(), contentType: 'image/png' });
    const disclosure = result.getByText('Show JSON', { exact: true });
    await disclosure.focus();
    await page.keyboard.press('Enter');
    await expect(result.locator('pre')).toBeVisible();
    await expect(result.locator('pre')).toContainText('non_atomic_observation');
    await expect(result.locator('pre')).toContainText('"allocatedFileBytes": 29360128');
    await disclosure.click();
    await expect(result.locator('pre')).toBeHidden();

    // Repeat on mobile and explicitly choose a different workspace.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('link', { name: 'View storage usage', exact: true }).click();
    await expect(picker).toBeVisible();
    await picker.getByRole('button', { name: /Second workspace/ }).click();
    await expect.poll(() => requests).toEqual([
        { kind: 'storage', actionId: 'storage.usage', workspaceId: 'ux-workspace' },
        { kind: 'storage', actionId: 'storage.usage', workspaceId: 'other-workspace' },
    ]);
    const secondResult = page.getByRole('status').filter({ hasText: 'Storage usage for Second workspace' });
    await expect(secondResult).toBeInViewport();
    await expect(secondResult).toBeFocused();
    await expect(secondResult.getByText('Storage usage couldn’t be measured for this workspace.', { exact: true })).toBeVisible();
    await expect(secondResult.getByText('0 B', { exact: true })).toHaveCount(0);
    await expect(secondResult.locator('pre')).toBeHidden();
    await saveEvidence(info, 'admin-workspace-storage-unavailable-mobile', { body: await secondResult.screenshot(), contentType: 'image/png' });

    await page.locator('#storage-usage').getByRole('button', { name: 'View storage usage', exact: true }).click();
    await expect(picker).toBeVisible();
    await picker.getByRole('button', { name: /Walkthrough workspace/ }).click();
    await expect(picker).toBeHidden();
    await expect.poll(() => requests.length).toBe(3);
    await expect(result.getByText('0 B', { exact: true })).toHaveCount(2);
    await expect(result.getByText('1 KB', { exact: true })).toBeVisible();
    await expect(result.getByText('Partial scan', { exact: true })).toBeVisible();
    await expect(result.getByText('The disk total may be higher. Some files could not be checked.', { exact: true })).toBeVisible();
    await expect(result.locator('pre')).toBeHidden();
    await saveEvidence(info, 'admin-workspace-storage-partial-mobile', { body: await result.screenshot(), contentType: 'image/png' });
    await result.getByText('Show JSON', { exact: true }).click();
    await expect(result.locator('pre')).toBeVisible();
    await expect(result.locator('pre')).toContainText('filesystem_entry_limit');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await result.getByText('Show JSON', { exact: true }).click();
    await expect(result.locator('pre')).toBeHidden();
    await saveEvidence(info, 'admin-storage-summary-responses', { body: JSON.stringify(usageResults, null, 2), contentType: 'application/json' });

    usageAvailable = false;
    // A hash-only navigation retains the existing status. Reload to simulate
    // the server no longer advertising this capability before opening its link.
    await page.reload();
    await expect(page.getByRole('link', { name: 'View storage usage', exact: true })).toHaveCount(0);
    await page.goto('/admin/system#storage-usage');
    await expect(page.getByText('Storage usage unavailable', { exact: true })).toBeVisible();
    await expect(picker).toBeHidden();
    await expect(page.getByRole('link', { name: 'View storage usage', exact: true })).toHaveCount(0);
    expect(requests).toHaveLength(3);
});

test('ordinary sign-in finishes credential-first signup with a replacement invite', async ({ page, browser }, info) => {
    const origin = new URL(info.project.use.baseURL!).origin;
    const admin = await browser.newContext({ baseURL: origin });
    const email = `interrupted-${crypto.randomUUID()}@example.test`;
    const password = 'DisposableInterrupted!123';
    const headers = { origin, 'x-or3-admin-intent': 'admin' };
    try {
        expect((await admin.request.post('/api/admin/auth/login', { headers, data: { username: process.env.OR3_ADMIN_USERNAME, password: process.env.OR3_ADMIN_PASSWORD } })).ok()).toBe(true);
        const create = async () => {
            const response = await admin.request.post('/api/admin/signup-invites/create', { headers, data: { email } });
            expect(response.ok()).toBe(true);
            return (await response.json()).invite;
        };
        const first = await create();
        // Registration commits provider credentials; no canonical session request has run yet.
        const registration = await page.request.post('/api/basic-auth/register', {
            headers: { origin, 'x-or3-cloud-intent': 'mutation' }, data: { email, password, confirmPassword: password, inviteToken: first.token },
        });
        expect(registration.ok()).toBe(true);
        expect((await admin.request.post('/api/admin/signup-invites/revoke', { headers, data: { id: first.id } })).ok()).toBe(true);
        const refused = await page.request.get('/api/auth/session');
        if (refused.ok()) expect((await refused.json()).appAccessAllowed).toBe(false);
        else expect([401, 403, 503]).toContain(refused.status());
        await page.request.post('/api/basic-auth/sign-out', { headers: { origin, 'x-or3-cloud-intent': 'mutation' } });
        const replacement = await create();
        // A stale cookie/link must not override a manually pasted replacement token.
        await page.goto(first.inviteUrl);
        const registrationForm = page.getByRole('dialog', { name: 'Create your account', exact: true });
        await expect(registrationForm).toBeVisible({ timeout: 30_000 });
        await registrationForm.getByRole('textbox', { name: 'Invite code (from your invite link)', exact: true }).fill(replacement.token);
        await registrationForm.getByRole('button', { name: 'Sign in', exact: true }).click();
        const signIn = page.getByRole('dialog', { name: 'Sign In', exact: true });
        await expect(signIn).toBeVisible();
        await signIn.getByRole('textbox', { name: 'Email', exact: true }).fill(email);
        await signIn.getByLabel('Password', { exact: true }).fill(password);
        await signIn.getByRole('button', { name: 'Sign In', exact: true }).click();
        await expect.poll(async () => {
            const response = await page.request.get('/api/auth/session');
            return response.ok() ? (await response.json()).session?.role : null;
        }).toBe('owner');
        await expect(signIn).not.toBeVisible();
        await expect(page.getByLabel('Message input', { exact: true })).toBeVisible();
        await expect(page.locator('.ProseMirror p.is-editor-empty')).not.toHaveAttribute('data-placeholder', SIGN_IN_PROMPT);
        await page.reload();
        const session = (await (await page.request.get('/api/auth/session')).json()).session;
        expect(session.workspace.name).toBe('My Workspace');
        const history = await admin.request.get('/api/admin/signup-invites/list');
        const rows = (await history.json()).invites;
        expect(rows.find((row: { id: string }) => row.id === first.id).status).toBe('revoked');
        expect(rows.find((row: { id: string }) => row.id === replacement.id).status).toBe('accepted');
        await saveEvidence(info, 'interrupted-signup-receipt', { body: JSON.stringify({ completed: true, privateWorkspace: session.workspace.id, originalInviteRevoked: true, replacementAccepted: true }), contentType: 'application/json' });
    } finally { await admin.close(); }
});

test('signup preflight rejects revoked tokens and native accept/revoke has one winner', async ({ page, browser }, info) => {
    const origin = new URL(info.project.use.baseURL!).origin;
    const admin = await browser.newContext({ baseURL: origin });
    const headers = { origin, 'x-or3-admin-intent': 'admin' };
    const email = `signup-race-${crypto.randomUUID()}@example.test`;
    const password = 'DisposableSignupRace!123';
    try {
        expect((await admin.request.post('/api/admin/auth/login', { headers, data: { username: process.env.OR3_ADMIN_USERNAME, password: process.env.OR3_ADMIN_PASSWORD } })).ok()).toBe(true);
        const create = async () => {
            const response = await admin.request.post('/api/admin/signup-invites/create', { headers, data: { email } });
            expect(response.ok()).toBe(true);
            return (await response.json()).invite;
        };
        const revokedInvite = await create();
        expect((await admin.request.post('/api/admin/signup-invites/revoke', { headers, data: { id: revokedInvite.id } })).ok()).toBe(true);
        const register = (inviteToken: string) => page.request.post('/api/basic-auth/register', {
            headers: { origin, 'x-or3-cloud-intent': 'mutation' }, data: { email, password, confirmPassword: password, inviteToken },
        });
        expect((await register(revokedInvite.token)).status()).toBe(403);
        // Move only this disposable fixture past its expiry; no wall-clock wait.
        const expired = await create();
        expect(process.env.OR3_SQLITE_DB_PATH).toContain('or3-sign-in-gate-e2e-');
        const Database = createRequire(import.meta.url)('better-sqlite3');
        const db = new Database(process.env.OR3_SQLITE_DB_PATH);
        try { db.prepare('UPDATE signup_invites SET expires_at = ? WHERE id = ?').run(Date.now() - 1000, expired.id); }
        finally { db.close(); }
        expect((await register(expired.token)).status()).toBe(403);
        const valid = await create();
        // Success with the same email proves preflight did not preclaim credentials.
        expect((await register(valid.token)).ok()).toBe(true);
        const [sessionResponse, revokeResponse] = await Promise.all([
            page.request.get('/api/auth/session'),
            admin.request.post('/api/admin/signup-invites/revoke', { headers, data: { id: valid.id } }),
        ]);
        const rows = (await (await admin.request.get('/api/admin/signup-invites/list')).json()).invites;
        const row = rows.find((candidate: { id: string }) => candidate.id === valid.id);
        if (row.status === 'accepted') {
            expect(revokeResponse.status()).toBe(409);
            expect(sessionResponse.ok()).toBe(true);
            const session = (await sessionResponse.json()).session;
            expect(session.role).toBe('owner');
            const detail = await admin.request.get(`/api/admin/workspaces/${session.workspace.id}`);
            expect(detail.ok()).toBe(true);
            expect((await detail.json()).members).toHaveLength(1);
            const replay = (await (await page.request.get('/api/auth/session')).json()).session;
            expect(replay.workspace.id).toBe(session.workspace.id);
            const outsider = await browser.newContext({ baseURL: origin });
            try {
                const reused = await outsider.request.post('/api/basic-auth/register', {
                    headers: { origin, 'x-or3-cloud-intent': 'mutation' },
                    data: { email, password, confirmPassword: password, inviteToken: valid.token },
                });
                expect(reused.status()).toBe(403);
            } finally { await outsider.close(); }
        } else {
            expect(row.status).toBe('revoked');
            expect(revokeResponse.ok()).toBe(true);
            if (sessionResponse.ok()) expect((await sessionResponse.json()).appAccessAllowed).toBe(false);
            else expect([401, 403]).toContain(sessionResponse.status());
        }
        await saveEvidence(info, 'native-signup-race', { body: JSON.stringify({ preflightLeftNoCredentials: true, singleWinner: row.status, replayChecked: row.status === 'accepted' }), contentType: 'application/json' });
    } finally { await admin.close(); }
});

test('plugin workspace target stays explicit while instance controls have no selector', async ({ page }, info) => {
    const origin = new URL(info.project.use.baseURL!).origin;
    const headers = { origin, 'x-or3-admin-intent': 'admin' };
    expect((await page.request.post('/api/admin/auth/login', { headers, data: { username: process.env.OR3_ADMIN_USERNAME, password: process.env.OR3_ADMIN_PASSWORD } })).ok()).toBe(true);
    expect((await page.request.post('/api/basic-auth/sign-in', { headers: { origin, 'x-or3-cloud-intent': 'mutation' }, data: { email: process.env.OR3_BASIC_AUTH_BOOTSTRAP_EMAIL, password: process.env.OR3_BASIC_AUTH_BOOTSTRAP_PASSWORD } })).ok()).toBe(true);
    const chat = (await (await page.request.get('/api/auth/session')).json()).session;
    const targets: { id: string; name: string }[] = [];
    for (const label of ['A', 'B']) {
        const name = `Admin target ${label} ${crypto.randomUUID()}`;
        const result = await page.request.post('/api/admin/workspaces', { headers, data: { name, ownerUserId: chat.user.id } });
        expect(result.ok()).toBe(true);
        targets.push({ id: (await result.json()).workspaceId, name });
    }
    await page.goto(`/admin/plugins?scope=workspace&workspaceId=${targets[0].id}&plugin=retained-link&rollout=retained-rollout`);
    await expect(page.getByText(targets[0].name, { exact: true })).toBeVisible();
    await expect(page.getByText('Site catalog approvals', { exact: true })).not.toBeVisible();
    await page.getByRole('button', { name: 'Choose workspace', exact: true }).click();
    const selector = page.getByRole('dialog', { name: 'Select a Workspace' });
    await expect(selector).toBeVisible();
    await selector.getByRole('button').filter({ hasText: targets[1].name }).click();
    await expect.poll(() => new URL(page.url()).searchParams.get('workspaceId')).toBe(targets[1].id);
    await expect(selector).not.toBeVisible();
    await expect(page.getByText(targets[1].name, { exact: true })).toBeVisible();
    expect(new URL(page.url()).searchParams.get('workspaceId')).toBe(targets[1].id);
    expect(new URL(page.url()).searchParams.get('plugin')).toBe('retained-link');
    expect(new URL(page.url()).searchParams.get('rollout')).toBe('retained-rollout');
    expect((await (await page.request.get('/api/auth/session')).json()).session.workspace.id).toBe(chat.workspace.id);
    // Exercise the actual upload control and candidate endpoint with an explicit
    // admin target distinct from Chat. Scope navigation alone missed this flow.
    await page.getByText('Advanced source plugins and development admission', { exact: true }).click();
    await expect(page.getByRole('button', { name: 'Add from .zip', exact: true })).toBeVisible();
    const pluginId = `scope-upload-${crypto.randomUUID()}`;
    const archive = Buffer.from(zipSync({
        'or3.manifest.json': strToU8(JSON.stringify({
            manifestVersion: 2, kind: 'plugin', id: pluginId, name: 'Workspace upload', version: '1.0.0',
            capabilities: [], engines: { or3: '^0.3.0', pluginApi: '^2.0.0' },
            runtime: { client: { entry: 'client.mjs', format: 'esm', isolation: 'host' } },
            requestedGrants: [], features: { required: [], optional: [] },
            dependencies: { required: [], optional: [] }, trust: 'trusted-host', settings: { version: 1 },
            stateCompatibility: { version: 1, reads: { minimum: 1, maximum: 1 }, rollback: 'safe' },
        })),
        'client.mjs': strToU8('export default {};\n'),
    }));
    await page.locator('input[type=file][accept=".zip"]').setInputFiles({ name: 'workspace-plugin.zip', mimeType: 'application/zip', buffer: archive });
    const uploaded = page.waitForResponse(response => response.url().endsWith('/api/admin/extensions/install') && response.request().method() === 'POST');
    await page.getByRole('button', { name: 'Install anyway', exact: true }).click();
    const uploadResponse = await uploaded;
    expect(uploadResponse.ok(), await uploadResponse.text()).toBe(true);
    const candidate = await uploadResponse.json();
    expect(candidate.kind).toBe('v2-candidate');
    expect(candidate.workspaceId).toBe(targets[1].id);
    expect(candidate.ok, JSON.stringify(candidate)).toBe(true);
    await expect(page.locator('#managed-v2')).toContainText(pluginId);
    const workspaceInventory = await (await page.request.get(`/api/admin/plugins-page?workspaceId=${targets[1].id}`)).json();
    expect(workspaceInventory.packagePlugins.find((entry: { pluginId: string }) => entry.pluginId === pluginId).pointer.candidate.packageDigest).toBe(candidate.packageDigest);
    await saveEvidence(info, 'workspace-upload-receipt', { body: JSON.stringify({ workspaceId: targets[1].id, pluginId, candidate }), contentType: 'application/json' });
    await page.getByRole('button', { name: 'Instance', exact: true }).click();
    await expect.poll(() => new URL(page.url()).searchParams.get('scope')).toBe('instance');
    await expect(page.getByText('Site catalog approvals', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Choose workspace', exact: true })).not.toBeVisible();
    expect(new URL(page.url()).searchParams.has('workspaceId')).toBe(false);
    const inventory = await page.request.get('/api/admin/plugins-page');
    expect((await inventory.json()).workspaceState).toBeNull();
    const marketplaceInventory = page.waitForResponse(response => new URL(response.url()).pathname === '/api/admin/plugins-page');
    await page.goto('/chat?dashboard=marketplace&page=installed');
    const marketplaceResponse = await marketplaceInventory;
    expect(marketplaceResponse.ok()).toBe(true);
    expect(new URL(marketplaceResponse.url()).searchParams.get('workspaceId')).toBe(chat.workspace.id);
    await saveEvidence(info, 'plugin-scope-receipt', { body: JSON.stringify({ explicitTarget: targets[1].id, chatWorkspace: chat.workspace.id, preservedDeepLink: true, instanceNeedsNoWorkspace: true }), contentType: 'application/json' });
});
