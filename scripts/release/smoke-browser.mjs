#!/usr/bin/env node
/**
 * Clean-browser journey smoke for the OR3 Cloud release candidate.
 *
 * Runs a fresh (no persisted profile) Chromium session against a running
 * candidate deployment (default http://127.0.0.1:3017) and asserts the
 * invite-only sign-in gate, owner sign-in, admin access, workspace/chat
 * shell, storage upload/download, sign-out, and re-login.
 *
 * Account identifiers are read from deployment metadata and plaintext
 * passwords only from the owner-only first-run handoff, mirroring
 * scripts/release/smoke-create-docker.mjs.
 *
 * The anonymous sign-in surface may be either the lock page ("Sign in" button)
 * or the workspace shell with a sidebar "Login" button, depending on whether
 * the deployment enables the lock page. Both are accepted; the invariant is
 * that an anonymous visitor is never shown an authenticated workspace.
 *
 * Usage:
 *   OR3_SMOKE_URL=http://127.0.0.1:3017 node scripts/release/smoke-browser.mjs
 *
 * Exits non-zero with a clear message on any failed assertion.
 */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

const baseUrl = (process.env.OR3_SMOKE_URL ?? 'http://127.0.0.1:3017').replace(/\/$/, '');
const NAV_TIMEOUT = 30_000;
const SHELL_TIMEOUT = 30_000;

function parseEnv(source) {
    const values = {};
    for (const rawLine of source.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith('#')) continue;
        const separator = line.indexOf('=');
        if (separator < 1) continue;
        const key = line.slice(0, separator).trim();
        let value = line.slice(separator + 1).trim();
        if (value.startsWith("'") && value.endsWith("'")) {
            value = value.slice(1, -1).replaceAll(/\\([\\'])/g, '$1');
        } else if (value.startsWith('"') && value.endsWith('"')) {
            value = value.slice(1, -1);
        }
        values[key] = value;
    }
    return values;
}

async function deploymentCredentials() {
    const env = parseEnv(await readFile(resolve('.env'), 'utf8'));
    const handoff = parseEnv(await readFile(resolve('.or3-initial-credentials'), 'utf8'));
    return {
        ownerEmail: env.OR3_MANAGED_OWNER_EMAIL || handoff.OR3_BASIC_AUTH_BOOTSTRAP_EMAIL,
        ownerPassword: handoff.OR3_BASIC_AUTH_BOOTSTRAP_PASSWORD,
        adminUsername: env.OR3_ADMIN_USERNAME || handoff.OR3_ADMIN_USERNAME,
        adminPassword: handoff.OR3_ADMIN_PASSWORD,
    };
}

function assert(condition, message) {
    if (!condition) {
        throw new Error(`[browser-smoke] ${message}`);
    }
}

async function waitForVisible(locator, message, timeout = SHELL_TIMEOUT) {
    try {
        await locator.waitFor({ state: 'visible', timeout });
    } catch {
        throw new Error(`[browser-smoke] ${message}`);
    }
}

async function waitForHidden(locator, message, timeout = SHELL_TIMEOUT) {
    try {
        await locator.waitFor({ state: 'hidden', timeout });
    } catch {
        throw new Error(`[browser-smoke] ${message}`);
    }
}

async function responseError(response) {
    const body = await response.text().catch(() => '');
    return new Error(
        `${response.url()} returned ${response.status()}: ${body.slice(0, 300)}`
    );
}

async function expectOk(response) {
    if (!response.ok()) throw await responseError(response);
    return response;
}

async function jsonRequest(request, path, { body, cookie, method = 'POST' } = {}) {
    const response = await request.fetch(new URL(path, baseUrl).toString(), {
        method,
        headers: {
            accept: 'application/json',
            ...(body === undefined ? {} : { 'content-type': 'application/json' }),
            ...(cookie ? { cookie } : {}),
        },
        ...(body === undefined ? {} : { data: JSON.stringify(body) }),
    });
    await expectOk(response);
    return await response.json();
}

async function sessionIsAuthenticated(request) {
    const payload = await jsonRequest(request, '/api/auth/session', { method: 'GET' });
    return Boolean(payload.session && payload.session.authenticated === true);
}

async function browserFetch(
    page,
    url,
    { bodyBytes, bodyText, headers = {}, method = 'GET' } = {},
) {
    return page.evaluate(
        async ({ bodyBytes: bytes, bodyText: text, headers: requestHeaders, method: requestMethod, url: requestUrl }) => {
            const response = await fetch(requestUrl, {
                method: requestMethod,
                headers: requestHeaders,
                credentials: 'include',
                ...(bytes === undefined && text === undefined
                    ? {}
                    : { body: bytes === undefined ? text : Uint8Array.from(bytes) }),
            });
            const body = new Uint8Array(await response.arrayBuffer());
            return {
                status: response.status,
                statusText: response.statusText,
                bodyBytes: Array.from(body),
                bodyText: new TextDecoder().decode(body),
            };
        },
        { bodyBytes, bodyText, headers, method, url },
    );
}

async function browserJsonRequest(page, path, { body, method = 'POST' } = {}) {
    const response = await browserFetch(page, new URL(path, baseUrl).toString(), {
        method,
        headers: {
            accept: 'application/json',
            ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        ...(body === undefined ? {} : { bodyText: JSON.stringify(body) }),
    });
    assert(
        response.status >= 200 && response.status < 300,
        `${path} returned ${response.status}: ${response.bodyText.slice(0, 300)}`,
    );
    return JSON.parse(response.bodyText);
}

async function browserSession(page) {
    const result = await page.evaluate(async () => {
        const response = await fetch('/api/auth/session', {
            method: 'GET',
            headers: { accept: 'application/json' },
            credentials: 'include',
            cache: 'no-store',
        });
        const text = await response.text();
        let payload = null;
        try {
            payload = JSON.parse(text);
        } catch {
            // Preserve the response body below so the assertion is useful.
        }
        return { status: response.status, payload, body: text.slice(0, 300) };
    });
    if (result.status === 429) {
        throw new Error(
            '[browser-smoke] session hydration was rate limited; refusing to loop against a live deployment'
        );
    }
    assert(
        result.status >= 200 && result.status < 300,
        `/api/auth/session returned ${result.status}: ${result.body}`
    );
    return result.payload ?? {};
}

async function waitForOwnerSession(page, email) {
    // The first navigation can finish before workspace provisioning has
    // hydrated the client session. Keep retries sparse so this qualification
    // check cannot trip the provider's own sign-in/session rate limiter.
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 1_500));
    let latest = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
        latest = await browserSession(page);
        if (
            latest.session?.authenticated === true &&
            latest.session?.user?.email === email &&
            latest.session?.workspace?.id
        ) {
            return latest;
        }
        if (attempt < 2) {
            await new Promise((resolvePromise) => setTimeout(resolvePromise, 1_500));
        }
    }
    throw new Error(
        `[browser-smoke] authenticated owner session did not hydrate a workspace: ${JSON.stringify({
            authenticated: latest?.session?.authenticated,
            email: latest?.session?.user?.email,
        })}`
    );
}

async function dismissWelcomeCard(page) {
    const backdrop = page.locator('[data-welcome-backdrop]');
    if (!(await backdrop.isVisible().catch(() => false))) return;
    await backdrop
        .getByRole('button', { name: 'Dismiss welcome' })
        .click();
    await waitForHidden(backdrop, 'welcome card did not dismiss');
}

const uploadBytes = Buffer.from(
    '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489',
    'hex'
);

async function verifyStorageRoundTrip(page, workspaceId) {
    const hash = `sha256:${createHash('sha256').update(uploadBytes).digest('hex')}`;
    const presign = await browserJsonRequest(page, '/api/storage/presign-upload', {
        body: {
            workspace_id: workspaceId,
            hash,
            mime_type: 'image/png',
            size_bytes: uploadBytes.length,
            disposition: 'inline',
        },
    });
    const upload = await browserFetch(
        page,
        new URL(presign.url, baseUrl).toString(),
        {
            method: presign.method ?? 'PUT',
            headers: {
                'content-type': 'image/png',
                ...(presign.headers ?? {}),
            },
            bodyBytes: Array.from(uploadBytes),
        }
    );
    assert(upload.status >= 200 && upload.status < 300, `storage upload returned ${upload.status}: ${upload.bodyText.slice(0, 300)}`);

    await browserJsonRequest(page, '/api/storage/commit', {
        body: {
            workspace_id: workspaceId,
            hash,
            storage_id: presign.storageId,
            storage_provider_id: 'fs',
            mime_type: 'image/png',
            size_bytes: uploadBytes.length,
            name: 'or3-browser-smoke.png',
            kind: 'image',
        },
    });

    const downloadPresign = await browserJsonRequest(page, '/api/storage/presign-download', {
        body: {
            workspace_id: workspaceId,
            hash,
            storage_id: presign.storageId,
            mime_type: 'image/png',
            disposition: 'attachment',
        },
    });
    const download = await browserFetch(page, new URL(downloadPresign.url, baseUrl).toString());
    assert(download.status >= 200 && download.status < 300, `storage download returned ${download.status}: ${download.bodyText.slice(0, 300)}`);
    const restored = Buffer.from(download.bodyBytes);
    assert(
        restored.equals(uploadBytes),
        'uploaded fixture did not round-trip through the storage API'
    );
}

// The anonymous sign-in surface is either the lock page "Sign in" button or
// the workspace shell's sidebar "Login" button. Both open the same
// BasicAuthSignInModal.
async function openSignInModal(page) {
    await dismissWelcomeCard(page);
    const lockSignIn = page.getByRole('button', { name: /sign in/i }).first();
    const sidebarLogin = page.getByRole('button', { name: /login/i }).first();
    await Promise.race([
        lockSignIn.waitFor({ state: 'visible', timeout: SHELL_TIMEOUT }),
        sidebarLogin.waitFor({ state: 'visible', timeout: SHELL_TIMEOUT }),
    ]).catch(() => {
        throw new Error('[browser-smoke] sign-in UI did not render for an anonymous visitor');
    });
    if (await lockSignIn.isVisible().catch(() => false)) {
        await lockSignIn.click();
    } else {
        await sidebarLogin.click();
    }
    const dialog = page.getByRole('dialog');
    await waitForVisible(dialog, 'sign-in modal did not open');
    return dialog;
}

async function signInOwner(page, email, password) {
    await page.goto(`${baseUrl}/`, { waitUntil: 'domcontentloaded' });
    const dialog = await openSignInModal(page);
    await dialog.locator('input[type="email"]').fill(email);
    await dialog.locator('input[type="password"]').fill(password);
    await dialog.locator('button[type="submit"]').click();
    // The anonymous shell can already contain the chat input behind the
    // sign-in modal. Require the authenticated session and provisioned
    // workspace before navigating elsewhere, or the in-flight sign-in request
    // can be aborted while this check reports a false positive.
    const session = await waitForOwnerSession(page, email);
    await waitForVisible(
        page.locator('#chat-input-main'),
        'workspace/chat shell did not render after owner sign-in'
    );
    return session;
}

async function verifyAdminAccess(page, username, password) {
    // A signed-in deployment admin is allowed onto the workspace-scoped
    // /admin surface. Navigate to the explicit login route so this journey
    // deterministically exercises elevation to the separate super-admin
    // session instead of depending on the user's current grant state.
    await page.goto(`${baseUrl}/admin/login`, { waitUntil: 'domcontentloaded' });
    const usernameInput = page.locator('#admin-username');
    try {
        await usernameInput.waitFor({ state: 'visible', timeout: SHELL_TIMEOUT });
    } catch {
        throw new Error(
            `[browser-smoke] admin login form did not render at ${page.url()}`
        );
    }
    // Allow the client-side form to hydrate before filling/submitting.
    await page.waitForTimeout(2000);
    await usernameInput.fill(username);
    await page.locator('#admin-password').fill(password);
    await page.getByRole('button', { name: /sign in/i }).click();
    await waitForVisible(
        page.getByRole('heading', { name: /overview/i }),
        'admin dashboard did not render after admin sign-in'
    );
}

async function verifyAnonymousRegistrationDenied(page) {
    const response = await browserFetch(
        page,
        new URL('/api/basic-auth/register', baseUrl).toString(),
        {
            method: 'POST',
            headers: {
                accept: 'application/json',
                'content-type': 'application/json',
            },
            bodyText: JSON.stringify({
                email: `or3-browser-smoke-${Date.now()}@example.com`,
                password: 'AnonymousDenied123',
                confirmPassword: 'AnonymousDenied123',
            }),
        },
    );
    assert(
        response.status === 403,
        `anonymous registration was not denied: ${response.status} ${response.bodyText.slice(0, 300)}`,
    );
}

async function verifySecurityHeaders(page) {
    const headers = await page.evaluate(async () => {
        const response = await fetch('/api/does-not-exist', {
            credentials: 'include',
            cache: 'no-store',
        });
        return {
            status: response.status,
            contentType: response.headers.get('x-content-type-options'),
            frameOptions: response.headers.get('x-frame-options'),
            contentSecurityPolicy: response.headers.get('content-security-policy'),
        };
    });
    assert(headers.status === 404, `security-header probe returned ${headers.status}`);
    assert(headers.contentType === 'nosniff', 'X-Content-Type-Options is missing or unsafe');
    assert(headers.frameOptions === 'DENY', 'X-Frame-Options is missing or unsafe');
    assert(
        headers.contentSecurityPolicy?.includes("frame-ancestors 'none'"),
        'Content-Security-Policy does not deny framing',
    );
}

async function signOutOwner(page) {
    await dismissWelcomeCard(page);
    const accountMenu = page.getByRole('button', { name: 'Account menu' });
    await waitForVisible(accountMenu, 'account menu control was not visible');
    await accountMenu.click();
    const signOut = page.getByRole('button', { name: /sign out/i });
    await waitForVisible(signOut, 'sign-out control did not appear in the account menu');
    await signOut.click();
    await waitForHidden(accountMenu, 'account menu remained visible after sign-out');
}

async function main() {
    const {
        ownerEmail: email,
        ownerPassword: password,
        adminUsername,
        adminPassword,
    } = await deploymentCredentials();
    assert(email && password, 'Managed owner credentials missing from the first-run handoff');
    assert(
        adminUsername && adminPassword,
        'Managed admin credentials missing from the first-run handoff'
    );

    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();
    page.setDefaultTimeout(NAV_TIMEOUT);

    try {
        // 1. Anonymous visit: invite-only gate, never an authenticated workspace.
        await page.goto(`${baseUrl}/`, { waitUntil: 'domcontentloaded' });
        await openSignInModal(page);
        assert(
            (await page.locator('[aria-label="Account menu"]').count()) === 0,
            'anonymous visitor was shown an authenticated workspace'
        );
        assert(
            !(await sessionIsAuthenticated(page.request)),
            'anonymous visitor had an authenticated session'
        );
        await verifyAnonymousRegistrationDenied(page);
        await verifySecurityHeaders(page);
        console.log('PASS anonymous visit shows the invite-only sign-in gate');

        // 2. Owner sign-in via the UI.
        const ownerSession = await signInOwner(page, email, password);
        console.log('PASS owner sign-in via the UI');

        // 3. Admin access.
        await verifyAdminAccess(page, adminUsername, adminPassword);
        console.log('PASS admin dashboard renders (protected)');

        // 4. Workspace/chat shell loads.
        await page.goto(`${baseUrl}/`, { waitUntil: 'domcontentloaded' });
        await waitForVisible(
            page.locator('#chat-input-main'),
            'workspace/chat shell did not render'
        );
        await waitForVisible(
            page.locator('.chat-input-editor'),
            'chat composer editor did not render'
        );
        console.log('PASS workspace/chat shell and composer render');

        // 5. Storage upload/download driven from the browser context.
        await verifyStorageRoundTrip(page, ownerSession.session.workspace.id);
        console.log('PASS storage upload/download round-trip via the browser context');

        // 6. Logout.
        await signOutOwner(page);
        assert(
            !(await browserSession(page)).session?.authenticated,
            'session endpoint still reported an authenticated session after sign-out'
        );
        console.log('PASS sign-out clears the session');

        // 7. Re-login.
        await signInOwner(page, email, password);
        console.log('PASS re-login restores the workspace');

        console.log('Clean-browser journey smoke passed.');
    } finally {
        await context.close();
        await browser.close();
    }
}

main().catch((error) => {
    console.error(error.message);
    process.exit(1);
});
