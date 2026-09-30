import { expect, test } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

test.use({ storageState: process.env.OR3_PLUGIN_DEV_RESTART === 'true'
    ? process.env.OR3_PLUGIN_DEV_BROWSER_STATE
    : undefined });
test.skip(process.env.OR3_PLUGIN_DEV_HARNESS !== 'true', 'Run with bun run test:e2e:plugin-development');

test('a fresh portable plugin updates without a page reload across 60 saves', async ({ page, context }) => {
    test.skip(process.env.OR3_PLUGIN_DEV_RESTART === 'true', 'Fresh-run scenario');
    test.setTimeout(360_000);
    const root = process.env.OR3_PLUGIN_DEV_ROOT!;
    const entry = join(root, 'client.mjs');
    const password = process.env.OR3_PLUGIN_DEV_PASSWORD!;
    const profile = process.env.OR3_PLUGIN_DEV_TEST_PROFILE!;
    const privateFileResponse = await page.request.get(`/_nuxt/@fs${join(profile, 'password')}`);
    expect(await privateFileResponse.text()).not.toContain(password);
    expect((await page.request.get('/api/admin/plugins/development/watch')).status()).toBe(401);
    await page.goto('/admin/login?next=/chat');
    await expect(page.getByRole('heading', { name: 'Plugin development sign-in' })).toBeVisible();
    await page.waitForLoadState('networkidle');
    await page.getByLabel('Local sign-in password').fill('wrong-local-password');
    await page.getByRole('button', { name: 'Sign In' }).click();
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page).toHaveURL(/\/admin\/login$/);
    await page.getByLabel('Local sign-in password').fill(password);
    await expect(page.getByLabel('Local sign-in password')).toHaveValue(password);
    await page.getByRole('button', { name: 'Sign In' }).click();
    await expect(page).toHaveURL(/\/chat$/, { timeout: 30_000 });
    const cookieNames = (await context.cookies()).map((cookie) => cookie.name);
    const scope = createHash('sha256').update(profile).digest('hex').slice(0, 16);
    expect(cookieNames).toContain(`or3_admin_${scope}`);
    expect(cookieNames).toContain(`or3_access_${scope}`);
    expect(cookieNames).toContain(`or3_refresh_${scope}`);
    await expect(page.locator('[data-welcome-backdrop]')).toHaveCount(0);
    expect((await page.request.get('/api/admin/plugins/development/watch', {
        headers: { origin: 'http://untrusted.example' },
    })).status()).toBe(403);
    const review = page.getByRole('button', { name: 'Approve these permissions' });
    await expect(review).toBeVisible({ timeout: 30_000 });
    await review.click();
    await expect(page.getByRole('tab', { name: 'Live Harness', selected: true })).toBeVisible({ timeout: 30_000 });
    const view = page.getByTestId('portable-plugin-view');
    await expect(view).toContainText('Greeting: Hello from OR3', { timeout: 30_000 });
    await expect(page.getByRole('button', { name: 'Dismiss plugin development status' })).toHaveCount(0);

    let source = await readFile(entry, 'utf8');
    const durations: number[] = [];
    for (let number = 1; number <= 60; number += 1) {
        const started = performance.now();
        source = source.replace(/Hello from OR3|Live edit \d+/, `Live edit ${number}`);
        await writeFile(entry, source);
        await expect(view).toContainText(`Greeting: Live edit ${number}`, { timeout: 20_000 });
        durations.push(performance.now() - started);
    }
    const sorted = durations.slice().sort((a, b) => a - b);
    const p95 = sorted[Math.ceil(sorted.length * 0.95) - 1]!;
    console.log(`Plugin live edit p95: ${Math.round(p95)} ms across ${durations.length} saves`);
    expect(p95).toBeLessThanOrEqual(3000);

    const broken = source.replace('\n', '\nconst broken = ;\n');
    await writeFile(entry, broken);
    await expect(page.getByRole('status')).toContainText('client.mjs:2:', { timeout: 20_000 });
    await expect(view).toContainText('Greeting: Live edit 60');
    await page.getByRole('button', { name: 'Dismiss plugin development status' }).click();
    await expect(page.getByRole('button', { name: 'Plugin needs attention' })).toBeVisible();
    await writeFile(entry, source);
    await expect(page.getByRole('status')).toContainText('running', { timeout: 20_000 });
    await expect(view).toContainText('Greeting: Live edit 60');
    await expect(page.getByRole('button', { name: 'Plugin needs attention' })).toHaveCount(0);

    const second = await context.newPage();
    await second.goto('/chat');
    await expect(second.getByRole('tab', { name: 'Live Harness', selected: true })).toBeVisible({ timeout: 30_000 });
    await expect(second.getByTestId('portable-plugin-view')).toContainText('Greeting: Live edit 60', { timeout: 30_000 });
    await second.close();

    // Authoring-only source changes produce a new verified receipt without
    // changing runnable package bytes, so the controller must not re-admit.
    const watch = async () => (await (await page.request.get('/api/admin/plugins/development/watch')).json()) as {
        generation: number; selectedDigest: string | null; state: string;
    };
    const before = await watch();
    let admissionRequests = 0;
    page.on('request', (request) => {
        if (request.method() === 'POST' && request.url().endsWith('/api/admin/plugins/development/admit')) admissionRequests += 1;
    });
    await writeFile(join(root, '.authoring', 'watch-notes.md'), 'Source-only note.\n');
    await expect.poll(async () => (await watch()).generation).toBeGreaterThan(before.generation);
    await expect.poll(async () => (await watch()).state).toBe('ready');
    expect((await watch()).selectedDigest).toBe(before.selectedDigest);
    await page.waitForTimeout(700); // one completed controller poll
    expect(admissionRequests).toBe(0);

    // The next edit expands authority in the single authoring source. The
    // page must stop for a fresh, digest-bound permission review.
    const authoringPath = join(root, '.authoring', 'profile.config.mjs');
    const authoring = await readFile(authoringPath, 'utf8');
    await writeFile(authoringPath, authoring
        .replace("dataScopes: ['settings.read']", "dataScopes: ['settings.read', 'storage.read']")
        .replace("writes: ['settings.write']", "writes: ['settings.write', 'storage.write']")
        .replace("requestedGrants: ['settings.read', 'settings.write', 'ui.dashboard.register']",
            "requestedGrants: ['settings.read', 'storage.read', 'storage.write', 'settings.write', 'ui.dashboard.register']"));
    await expect(review).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('storage.read', { exact: true })).toBeVisible();
    await review.click();
    await expect(page.getByRole('status')).toContainText('running', { timeout: 30_000 });
    await expect(view).toContainText('Greeting: Live edit 60');
    source = source.replace(
        "            context.contributions.register({",
        `            const storedNote = await context.storage.get('dev-note');
            context.onRequest('runtime.ui-event', async ({ action }) => {
                if (action !== 'save-dev-note') return { ok: false };
                const saved = await context.storage.set('dev-note', 'kept');
                if (!saved.ok) return saved;
                context.render(definePortableUi({
                    title: 'Example Plugin',
                    nodes: [ui.text(\`Greeting: \${greeting}\`), ui.text('Stored: kept'), ui.button('save-dev-note', 'Save note', 'save-dev-note')],
                }));
                return { ok: true };
            });

            context.contributions.register({`,
    ).replace(
        "                        ui.text('Edit client.mjs and save to update this view.'),",
        "                        ui.text(`Stored: ${storedNote.ok ? storedNote.value ?? 'empty' : 'unavailable'}`),\n                        ui.button('save-dev-note', 'Save note', 'save-dev-note'),",
    );
    await writeFile(entry, source);
    await expect(view).toContainText('Stored: empty', { timeout: 30_000 });
    await view.getByRole('button', { name: 'Save note' }).click();
    await expect(view).toContainText('Stored: kept', { timeout: 30_000 });
    const packageStore = join(process.env.OR3_PLUGIN_DEV_TEST_PROFILE!, 'extensions', '.store', 'or3.live-harness');
    await expect.poll(async () => (await readdir(packageStore)).filter((name) => name.startsWith('sha256-')).length)
        .toBeLessThanOrEqual(3);

    let failCleanup = true;
    await page.route('**/api/admin/plugins/development/cleanup', async (route) => {
        if (failCleanup) {
            failCleanup = false;
            await route.fulfill({ status: 503, body: 'Simulated local cleanup failure' });
        } else {
            await route.continue();
        }
    });
    source = source.replace('Live edit 60', 'Live edit 61');
    await writeFile(entry, source);
    await expect(view).toContainText('Greeting: Live edit 61', { timeout: 20_000 });
    await expect(view).toContainText('Stored: kept');
    await expect(page.getByRole('status')).toContainText('cleanup failed', { timeout: 20_000 });
    source = source.replace('Live edit 61', 'Live edit 62');
    await writeFile(entry, source);
    await page.waitForTimeout(700);
    await expect(view).toContainText('Greeting: Live edit 61');
    await page.getByRole('button', { name: 'Retry' }).click();
    await expect(view).toContainText('Greeting: Live edit 62', { timeout: 30_000 });
    await expect(view).toContainText('Stored: kept');
    await context.clearCookies();
    await expect(page.getByRole('link', { name: 'Sign in again' })).toBeVisible({ timeout: 15_000 });
    await page.goto('/admin/login?next=https://untrusted.example');
    await page.waitForLoadState('networkidle');
    await page.getByLabel('Local sign-in password').fill(password);
    await page.getByRole('button', { name: 'Sign In' }).click();
    await expect.poll(async () => (await page.request.get('/api/admin/auth/session')).status()).toBe(200);
    await expect(page).toHaveURL(/\/chat$/, { timeout: 30_000 });
    await expect(page.getByTestId('portable-plugin-view')).toContainText('Stored: kept', { timeout: 30_000 });
    await context.storageState({ path: process.env.OR3_PLUGIN_DEV_BROWSER_STATE!, indexedDB: true });
});

test('the installed SDK resumes the latest selected plugin after host restart', async ({ page }) => {
    test.skip(process.env.OR3_PLUGIN_DEV_RESTART !== 'true', 'Restart scenario');
    await page.goto('/chat');
    if (/\/admin\/login(?:\?|$)/.test(page.url())) {
        await page.getByLabel('Local sign-in password').fill(process.env.OR3_PLUGIN_DEV_PASSWORD!);
        await page.getByRole('button', { name: 'Sign In' }).click();
    }
    await expect(page).toHaveURL(/\/chat$/, { timeout: 30_000 });
    await expect(page.getByRole('tab', { name: 'Live Harness', selected: true })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('portable-plugin-view')).toContainText('Greeting: Live edit 62', { timeout: 30_000 });
    await expect(page.getByTestId('portable-plugin-view')).toContainText('Stored: kept');
    await expect(page.getByRole('status')).toContainText('running');
    await expect(page.getByRole('button', { name: 'Approve these permissions' })).toHaveCount(0);
});
