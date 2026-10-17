import { test, expect, type Page, type TestInfo } from '@playwright/test';
import { execFileSync, spawn } from 'node:child_process';
import { readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { networkInterfaces, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { stopAppServer } from './fixtures/setup-wizard-app';

// Journeys W1–W6 in planning/setup-ux/journeys.md. They write credentials and
// start OR3, so run them with `bun run test:e2e:setup-wizard`.
const wizardUrl = process.env.OR3_SETUP_WIZARD_URL ?? '';
const instanceDir = process.env.OR3_SETUP_WIZARD_INSTANCE ?? '';
const timingsFile = process.env.OR3_SETUP_WIZARD_TIMINGS ?? '';

test.skip(!wizardUrl, 'Requires the setup wizard harness: bun run test:e2e:setup-wizard');
// The first wizard page compiles on demand and deploys start OR3 cold.
test.describe.configure({ timeout: 360_000 });

const APP = 'http://127.0.0.1:3000';
const START = 'bun run dev';
const SELF_HOSTED = 'Self-hosted OR3 — accounts, SQLite, and filesystem storage';
const BROWSER_ONLY = 'This device only — private, offline, and no account';
// Deploys install missing packages, prepare Nuxt and wait for the first start.
const DEPLOY_TIMEOUT = 240_000;

async function evidence(page: Page, info: TestInfo, name: string) {
    const path = info.outputPath(`${name}.png`);
    await page.screenshot({ path, fullPage: true });
    await info.attach(name, { path, contentType: 'image/png' });
}

/**
 * Interactive means the client has hydrated and loaded its wizard session (the
 * browser's own session request), not just that server-rendered HTML arrived.
 */
async function openWizard(page: Page) {
    const sessionLoaded = page.waitForResponse(
        (response) => response.url().includes('/api/wizard/session') && response.request().method() === 'GET',
        { timeout: 180_000 }
    );
    await page.goto(wizardUrl, { timeout: 180_000 });
    await sessionLoaded;
    await expect(page.getByText(SELF_HOSTED, { exact: true })).toBeVisible({ timeout: 30_000 });
}

const heading = (page: Page) => page.locator('.wizard-content h2').first();
const advanced = (page: Page) => page.getByRole('button', { name: /^Advanced setup/ });
const resultBanner = (page: Page) => page.locator('.wizard-content [role="status"]');

async function continueTo(page: Page, title: string) {
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await expect(heading(page)).toHaveText(title);
}

async function reachReview(page: Page) {
    for (let step = 0; step < 10; step += 1) {
        if ((await heading(page).textContent())?.trim() === 'Review & Confirm') return;
        await page.getByRole('button', { name: 'Continue', exact: true }).click();
        await expect(heading(page)).not.toHaveText('', { timeout: 15_000 });
        await page.waitForTimeout(250);
    }
    await expect(heading(page)).toHaveText('Review & Confirm');
}

async function recommendedToReview(page: Page, email: string) {
    await openWizard(page);
    await page.getByText(SELF_HOSTED, { exact: true }).click();
    await continueTo(page, 'Login Setup');
    await page.getByLabel('Your admin email').fill(email);
    await continueTo(page, 'Review & Confirm');
}

async function readEnv(key: string): Promise<string | undefined> {
    const env = await readFile(join(instanceDir, '.env'), 'utf8');
    return env.match(new RegExp(`^${key}=(.*)$`, 'm'))?.[1];
}

/** Command lines of the process group serving the app. */
function appCommandLines(): string[] {
    const pid = execFileSync('lsof', ['-t', '-iTCP:3000', '-sTCP:LISTEN'], { encoding: 'utf8' }).split('\n')[0]!;
    const group = execFileSync('ps', ['-o', 'pgid=', '-p', pid], { encoding: 'utf8' }).trim();
    return execFileSync('ps', ['-o', 'args=', '-g', group], { encoding: 'utf8' }).split('\n').filter(Boolean);
}

async function stopApp() {
    stopAppServer(3000);
    await expect.poll(async () => {
        try {
            await fetch(`${APP}/api/health`);
            return 'up';
        } catch {
            return 'down';
        }
    }, { timeout: 30_000 }).toBe('down');
}

/** Launches `bun run setup` and resolves with its URL once printed. */
function launchSetup() {
    const child = spawn('bun', ['run', 'setup', '--ui', '--no-open', '--instance-dir', instanceDir, '--pm', 'bun'], {
        cwd: process.cwd(),
        detached: true,
        stdio: ['ignore', 'pipe', 'inherit'],
    });
    const url = new Promise<string>((resolveUrl, rejectUrl) => {
        let output = '';
        child.stdout.on('data', (chunk: Buffer) => {
            output += chunk.toString();
            const match = output.match(/http:\/\/127\.0\.0\.1:\d+\/wizard\?\S+/);
            if (match) resolveUrl(match[0]);
        });
        child.once('exit', () => rejectUrl(new Error(`setup exited before printing its URL:\n${output}`)));
    });
    return { child, url, stop: () => { try { process.kill(-child.pid!, 'SIGTERM'); } catch { /* already gone */ } } };
}

const wizardTempDirs = async () => (await readdir(tmpdir())).filter((name) => name.startsWith('or3-wizard-ui-')).sort();

test('R1 opens to an interactive first screen within 10 seconds, three cold runs', async ({ page }) => {
    const runs: number[] = [];
    for (let run = 0; run < 3; run += 1) {
        // Cold: no prebuilt page either, so each launch also builds it.
        await rm(resolve(process.cwd(), 'node_modules/.cache/or3-wizard-ui'), { recursive: true, force: true });
        const launchedAt = Date.now();
        const setup = launchSetup();
        try {
            const sessionLoaded = page.waitForResponse((r) => r.url().includes('/api/wizard/session') && r.request().method() === 'GET');
            await page.goto(await setup.url);
            await sessionLoaded;
            await page.getByText(SELF_HOSTED, { exact: true }).click();
            await expect(page.getByText('Selected')).toBeVisible();
            runs.push(Date.now() - launchedAt);
        } finally {
            setup.stop();
        }
    }
    if (timingsFile) {
        const previous = JSON.parse(await readFile(timingsFile, 'utf8').catch(() => '{}'));
        await writeFile(timingsFile, JSON.stringify({ ...previous, coldLaunchToInteractiveMs: runs }));
    }
    for (const ms of runs) expect(ms).toBeLessThan(10_000);
});

test('R2 serves only loopback, needs the token, and leaves no temporary files', async () => {
    const before = await wizardTempDirs();
    const setup = launchSetup();
    try {
        const url = new URL(await setup.url);
        const api = new URL('/api/wizard/session', url);
        expect((await fetch(api)).status).toBe(403);
        expect((await fetch(api, { headers: { 'x-wizard-token': 'wrong' } })).status).toBe(403);
        expect((await fetch(new URL('/wizard', url), { redirect: 'manual' })).status).toBe(403);
        const external = Object.values(networkInterfaces()).flat()
            .find((address) => address && address.family === 'IPv4' && !address.internal);
        if (external) {
            await expect(fetch(`http://${external.address}:${url.port}/api/health`)).rejects.toThrow();
        }
    } finally {
        setup.stop();
    }
    await new Promise((resolveExit) => setup.child.once('exit', resolveExit));
    expect(await wizardTempDirs()).toEqual(before);
});

test('W1 saves the recommended setup from a template-first screen', async ({ page }, info) => {
    const openedAt = Date.now();
    await openWizard(page);
    const interactiveAt = Date.now();
    if (timingsFile) {
        const previous = JSON.parse(await readFile(timingsFile, 'utf8').catch(() => '{}'));
        await writeFile(timingsFile, JSON.stringify({
            ...previous,
            firstPageToInteractiveMs: interactiveAt - openedAt,
        }));
    }

    await expect(heading(page)).toHaveText('Choose a setup');
    await expect(page.getByRole('button', { name: 'Back', exact: true })).toHaveCount(0);
    await expect(advanced(page)).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByText('Project folder', { exact: true })).toHaveCount(0);
    await expect(page.locator('.wizard-content')).not.toContainText(/\b(Enabled|Disabled)\b/);
    await evidence(page, info, 'w1-first-step');

    await page.getByText(SELF_HOSTED, { exact: true }).click();
    await continueTo(page, 'Login Setup');
    await expect(page.getByRole('button', { name: 'Back', exact: true })).toBeVisible();
    await page.getByLabel('Your admin email').fill('owner-w1@example.test');
    await continueTo(page, 'Review & Confirm');

    await page.getByRole('button', { name: 'Save Settings', exact: true }).click();
    await expect(resultBanner(page)).toContainText('Settings saved');
    await expect(resultBanner(page)).toContainText(`Start the app with ${START}`);
    await expect(page.getByText(/^Settings saved\.?$/)).toHaveCount(1);
    await expect(page.getByText('Save your admin login now')).toBeVisible();
    await expect(page.locator('dd', { hasText: 'owner-w1@example.test' })).toBeVisible();
    expect(await readEnv('SSR_AUTH_ENABLED')).toBe('true');
    await evidence(page, info, 'w1-saved');
});

test('W2 advanced setup opens in place and adds the customization steps', async ({ page }, info) => {
    await openWizard(page);
    const sidebar = page.locator('aside');
    await expect(sidebar).not.toContainText('Your Brand');

    await advanced(page).click();
    await expect(advanced(page)).toHaveAttribute('aria-expanded', 'true');
    for (const label of ['Project folder', 'Settings file', 'Package manager', 'How will you run this?']) {
        await expect(page.getByText(label, { exact: true })).toBeVisible();
    }
    await expect(page.getByRole('checkbox', { name: 'Preview only? (no files will be changed)' })).toBeVisible();
    await expect(page.locator('.wizard-content')).not.toContainText(/\b(Enabled|Disabled)\b/);
    await expect(sidebar).toContainText('Your Brand');
    await evidence(page, info, 'w2-advanced-open');

    await continueTo(page, 'Your Brand');
    await expect(page.getByRole('button', { name: 'Back', exact: true })).toBeVisible();
    await sidebar.getByRole('button', { name: /Choose a setup/ }).click();
    await expect(heading(page)).toHaveText('Choose a setup');
    await expect(advanced(page)).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByRole('button', { name: 'Back', exact: true })).toHaveCount(0);

    await advanced(page).click();
    await expect(advanced(page)).toHaveAttribute('aria-expanded', 'false');
    await expect(sidebar).not.toContainText('Your Brand');

    await page.setViewportSize({ width: 390, height: 844 });
    await advanced(page).click();
    await evidence(page, info, 'w2-advanced-open-mobile');
});

test('W3 keeps field errors visible inside advanced setup', async ({ page }, info) => {
    await openWizard(page);
    await advanced(page).click();
    await page.getByRole('combobox').filter({ hasText: 'Local development' }).click();
    await page.getByRole('option', { name: 'Docker — laptop, home server, or VPS' }).click();
    await page.getByRole('combobox').filter({ hasText: 'Private / local network' }).click();
    await page.getByRole('option', { name: 'Public domain with HTTPS' }).click();
    await page.getByLabel('Public domain', { exact: true }).fill('https://bad/');
    await page.getByRole('button', { name: 'Continue', exact: true }).click();

    await expect(heading(page)).toHaveText('Choose a setup');
    await expect(page.locator('#wizard-advanced-setup')).toContainText('Enter a hostname such as chat.example.com.');
    await expect(page.locator('aside li').first().locator('.bg-\\[var\\(--md-error\\)\\]')).toBeVisible();
    await evidence(page, info, 'w3-field-error');
});

test('W4 reports a failed start without hiding the saved login', async ({ page }, info) => {
    const blocker = createServer();
    await new Promise<void>((resolve) => blocker.listen(3000, '127.0.0.1', resolve));
    try {
        await recommendedToReview(page, 'owner-w4@example.test');
        await page.getByRole('button', { name: 'Apply + Deploy' }).click();
        await expect(resultBanner(page)).toContainText('Settings saved, but OR3 did not start', { timeout: DEPLOY_TIMEOUT });
        await expect(resultBanner(page)).toContainText('Port 3000 is already in use');
        await expect(page.getByText('Deployment complete')).toHaveCount(0);
        await expect(page.getByText(`Start the app manually with: ${START}`)).toBeVisible();
        await expect(page.getByText('Save your admin login now')).toBeVisible();
        await evidence(page, info, 'w4-failed-start');
    } finally {
        await new Promise((resolve) => blocker.close(resolve));
    }
});

test('W6 starts an authenticated setup with the same command and the saved login signs in', async ({ page }, info) => {
    const email = 'owner-w6@example.test';
    try {
        await recommendedToReview(page, email);
        await page.getByRole('button', { name: 'Apply + Deploy' }).click();
        await expect(resultBanner(page)).toContainText('Deployment complete', { timeout: DEPLOY_TIMEOUT });
        await expect(page.getByText('Sign in with the admin email and password from setup.')).toBeVisible();
        const password = (await page.locator('dt', { hasText: 'Password' }).locator('+ dd').textContent())?.trim() ?? '';
        expect(password.length).toBeGreaterThan(11);
        await evidence(page, info, 'w6-deployed');

        expect(await readEnv('SSR_AUTH_ENABLED')).toBe('true');
        const commands = appCommandLines().join('\n');
        expect(commands).toContain('scripts/cli/dev.ts');
        expect(commands).not.toContain('--or3-ssr');

        const signIn = await page.request.post(`${APP}/api/basic-auth/sign-in`, {
            headers: { origin: APP, 'x-or3-cloud-intent': 'mutation' },
            data: { email, password },
        });
        expect(signIn.ok(), await signIn.text()).toBe(true);
        await page.goto(APP, { timeout: 180_000 });
        await page.reload({ timeout: 180_000 });
        const session = await page.request.get(`${APP}/api/auth/session`);
        expect((await session.json()).session?.user?.email).toBe(email);
        // Signed in after a reload: the composer is not gated behind sign-in.
        await expect(page.locator('.ProseMirror p.is-editor-empty'))
            .toHaveAttribute('data-placeholder', 'Write something…', { timeout: 120_000 });
        await evidence(page, info, 'w6-signed-in-app');
    } finally {
        await stopApp();
    }
});

// Runs last: a browser-only deploy hands off to the app and shuts the wizard down.
test('W5 starts a browser-only setup with the shared command', async ({ page }, info) => {
    try {
        await openWizard(page);
        await page.getByText(BROWSER_ONLY, { exact: true }).click();
        await reachReview(page);
        await page.getByRole('button', { name: 'Apply + Deploy' }).click();
        // Browser-only setups open the app when it is ready.
        await page.waitForURL((url) => url.port === '3000', { timeout: DEPLOY_TIMEOUT });
        const wizardHealth = new URL('/api/health', wizardUrl).toString();
        await expect.poll(async () => (await fetch(wizardHealth).catch(() => null))?.status ?? 0).not.toBe(200);
        expect(await readEnv('SSR_AUTH_ENABLED')).toBe('false');
        const commands = appCommandLines().join('\n');
        expect(commands).toContain('scripts/cli/dev.ts');
        expect(commands).not.toContain('--or3-ssr');
        await expect(page.getByLabel('Message input', { exact: true })).toBeVisible({ timeout: 120_000 });
        await expect(page.getByRole('button', { name: /sign in/i })).toHaveCount(0);
        await evidence(page, info, 'w5-browser-only-app');
    } finally {
        await stopApp();
    }
});
