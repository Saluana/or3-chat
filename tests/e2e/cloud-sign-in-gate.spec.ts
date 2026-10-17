import { test, expect, type Page, type TestInfo } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
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
                || await page.getByRole('dialog', { name: 'Create Account' }).isVisible()).toBe(true);
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
                inviteUrl = (await created.json()).invite.inviteUrl;
            } finally {
                await owner.close();
            }

            await page.goto(inviteUrl);
            await page.getByRole('button', { name: 'Dismiss welcome', exact: true }).click({ timeout: 5_000 }).catch(() => undefined);
            if (label === 'mobile') {
                await page.getByRole('button', { name: 'Open sidebar', exact: true }).click();
                await page.getByRole('button', { name: 'More options', exact: true }).click();
            }
            const form = page.getByRole('dialog', { name: 'Create Account', exact: true });
            await expect(form).toBeVisible({ timeout: 30_000 });
            await expect(form.getByRole('textbox', { name: 'Invite token (from your invite link)', exact: true })).not.toHaveValue('');
            await form.getByRole('textbox', { name: 'Email', exact: true }).fill(email);
            await form.getByLabel('Password', { exact: true }).fill('DisposableInvitee!123');
            await form.getByLabel('Confirm password', { exact: true }).fill('DisposableInvitee!123');
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
    await expect(page.getByRole('heading', { name: 'Signup invites', exact: true })).toBeVisible();
    await expect(page.getByText('Each recipient gets their own private workspace.', { exact: true })).toBeVisible();
    const email = 'admin-ui-'+crypto.randomUUID()+'@example.test';
    await page.getByLabel('Recipient email', {exact:true}).fill(email);
    await expect(page.getByLabel('Recipient email', {exact:true})).toHaveValue(email);
    const created = page.waitForResponse(r => new URL(r.url()).pathname === '/api/admin/signup-invites/create');
    await page.getByRole('button',{name:'Create invite',exact:true}).click();
    expect((await created).ok()).toBe(true);
    const visibleLink = await page.getByLabel(/Invite link/).inputValue();
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
    await page.goto('/admin/signup-invites');
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
    await page.goto('/admin/signup-invites');
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
    const rawWarning = 'Destructive filesystem blob GC is disabled until provider-owned deletion coordination is available.';
    await page.route('**/api/admin/system/status', route => route.fulfill({ json: {
        ...payload,
        status: { ...payload.status, storage: {
            enabled: true, provider: 'fs',
            details: { gcStatus: 'disabled', gcDisabledReason: 'deletion_coordination_required' },
            actions: [{ id: 'storage.usage', label: 'Observe Storage Usage', description: 'Read-only storage usage.' }],
        } },
        warnings: [{ level: 'warning', message: rawWarning }, { level: 'error', message: 'Another provider needs attention.' }],
    } }));
    await page.route('**/api/admin/workspaces?*', route => route.fulfill({ json: {
        items: [{ id: 'ux-workspace', name: 'Walkthrough workspace', memberCount: 1 }], total: 1,
    } }));
    const requests: unknown[] = [];
    await page.route('**/api/admin/system/provider-action', route => {
        requests.push(route.request().postDataJSON());
        return route.fulfill({ json: { ok: true, result: {
            consistency: 'non_atomic_observation', filesystem: { complete: false, apparentFileBytes: 1024 },
            warnings: ['filesystem_entry_limit'],
        } } });
    });

    await page.goto('/admin');
    await expect(page.getByText('Deleted files still use storage', { exact: true })).toBeVisible();
    await expect(page.getByText(rawWarning, { exact: true })).toBeHidden();
    await expect(page.getByText('Another provider needs attention.', { exact: true })).toBeVisible();
    await saveEvidence(info, 'admin-storage-notice', { body: await page.screenshot(), contentType: 'image/png' });
    await page.getByRole('link', { name: 'View storage usage', exact: true }).click();
    await expect(page).toHaveURL(/\/admin\/system#storage-usage$/);
    const action = page.locator('#storage-usage');
    await action.getByRole('button', { name: 'View storage usage', exact: true }).click();
    const picker = page.getByRole('dialog', { name: 'Select a Workspace' });
    await expect(picker).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(picker).toBeHidden();
    expect(requests).toHaveLength(0);

    await action.getByRole('button', { name: 'View storage usage', exact: true }).click();
    await picker.getByRole('button', { name: /Walkthrough workspace/ }).click();
    await expect.poll(() => requests).toEqual([{ kind: 'storage', actionId: 'storage.usage', workspaceId: 'ux-workspace' }]);
    const result = page.getByRole('status').filter({ hasText: 'Storage usage for Walkthrough workspace' });
    await expect(result).toContainText('filesystem_entry_limit');
    await expect(result).toContainText('1024');
    await result.scrollIntoViewIfNeeded();
    await saveEvidence(info, 'admin-workspace-storage-usage', { body: await page.screenshot(), contentType: 'image/png' });
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
        const registrationForm = page.getByRole('dialog', { name: 'Create Account', exact: true });
        await expect(registrationForm).toBeVisible({ timeout: 30_000 });
        await registrationForm.getByRole('textbox', { name: 'Invite token (from your invite link)', exact: true }).fill(replacement.token);
        await registrationForm.getByRole('button', { name: 'Already registered? Sign in', exact: true }).click();
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
