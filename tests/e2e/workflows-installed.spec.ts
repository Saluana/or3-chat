import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

test.skip(
    process.env.OR3_WORKFLOW_INSTALLED_TEST_HARNESS !== 'true',
    'Run against a disposable host with the Workflows V2 package installed and enabled.',
);

const outputDir = resolve('output/playwright/workflows-installed');
const sidebarClip = { x: 0, y: 0, width: 320, height: 700 };
const expectCoreFallback = process.env.OR3_WORKFLOW_PARITY_CORE_FALLBACK === 'true';

test('installed Workflows imports and executes a no-model workflow after slash selection', async ({ page, baseURL }) => {
    test.skip(process.env.OR3_WORKFLOW_NO_MODEL_SMOKE !== 'true', 'Requires a disposable per-user-key host');
    test.setTimeout(120_000);
    await mkdir(outputDir, { recursive: true });
    await page.setViewportSize({ width: 1440, height: 960 });
    const origin = new URL(baseURL!).origin;
    const signIn = await page.request.post('/api/basic-auth/sign-in', {
        headers: { origin },
        data: {
            email: process.env.OR3_WORKFLOW_INSTALLED_TEST_EMAIL,
            password: process.env.OR3_WORKFLOW_INSTALLED_TEST_PASSWORD,
        },
    });
    expect(signIn.ok()).toBe(true);
    await page.goto('/chat');
    const welcome = page.locator('[data-welcome-card]');
    await expect(welcome).toBeVisible();
    await welcome.getByRole('textbox', { name: 'OpenRouter API key' }).fill('sk-or-disposable-test-key');
    await welcome.getByRole('button', { name: 'Save', exact: true }).click();

    const name = `Disposable workflow ${Date.now()}`;
    const fixture = {
        meta: { version: '2.0.0', name },
        nodes: [
            { id: 'start', type: 'start', position: { x: 0, y: 0 }, data: { label: 'Start' } },
            { id: 'output', type: 'output', position: { x: 260, y: 0 }, data: { label: 'Output', mode: 'combine', format: 'text', sources: ['start'] } },
        ],
        edges: [{ id: 'start-output', source: 'start', target: 'output' }],
    };
    await page.getByRole('button', { name: 'Workflows', exact: true }).click();
    await page.locator('input[type=file][accept=".json"]').setInputFiles({
        name: 'workflow.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(fixture)),
    });
    await expect(page.getByText(name, { exact: true }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Run workflow' })).toBeEnabled();
    await page.screenshot({ path: resolve(outputDir, 'imported-no-model-workflow.png'), fullPage: true, animations: 'disabled' });
    await page.getByRole('button', { name: 'Run workflow' }).click();

    const composer = page.getByRole('textbox', { name: 'Message input' });
    await expect(composer).toContainText(name);
    await page.waitForTimeout(500);
    await composer.fill('');
    await composer.press('/');
    const suggestion = page.locator('.suggestion-panel[data-context="workflow"]').getByText(name, { exact: true });
    await expect(suggestion).toBeVisible({ timeout: 15_000 });
    await suggestion.click();
    await expect(composer.locator('[data-workflow]')).toHaveCount(1);
    await composer.press('End');
    await composer.type('Smoke input');
    const backgroundResponses: number[] = [];
    page.on('response', (response) => {
        if (new URL(response.url()).pathname === '/api/plugins/or3-workflows/workflows/background') {
            backgroundResponses.push(response.status());
        }
    });
    await composer.press('Enter');
    await expect(page.getByText('Result', { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Smoke input', { exact: true }).last()).toBeVisible();
    expect(backgroundResponses).toContain(200);
    await page.screenshot({ path: resolve(outputDir, 'completed-no-model-workflow.png'), fullPage: true, animations: 'disabled' });

    const manifestResponse = await page.request.get('/api/plugins/runtime-manifest');
    const manifest = await manifestResponse.json() as { runtime?: Record<string, { descriptor?: { artifact?: { packageDigest?: string } } }> };
    const sessionResponse = await page.request.get('/api/auth/session');
    const session = await sessionResponse.json() as { session?: { workspace?: { id?: string } } };
    await page.reload();
    await expect(page.getByText('Result', { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Smoke input', { exact: true }).last()).toBeVisible();
    await writeFile(resolve(outputDir, 'no-model-smoke-receipt.json'), `${JSON.stringify({
        pluginId: 'or3-workflows',
        packageDigest: manifest.runtime?.['or3-workflows']?.descriptor?.artifact?.packageDigest ?? null,
        workspaceId: session.session?.workspace?.id ?? null,
        checks: ['JSON imported', 'slash suggestion selected', 'background route 200', 'result completed', 'result persisted after refresh'],
        modelExecution: false,
    }, null, 2)}\n`);
});

async function screenshotDifference(page: Page, beforePath: string, afterPath: string) {
    const images = await Promise.all([beforePath, afterPath].map(async (path) =>
        `data:image/png;base64,${(await readFile(path)).toString('base64')}`));
    return page.evaluate(async ([before, after]) => {
        const pixels = async (src: string) => {
            const image = new Image();
            image.src = src;
            await image.decode();
            const canvas = document.createElement('canvas');
            canvas.width = image.width;
            canvas.height = image.height;
            const context = canvas.getContext('2d')!;
            context.drawImage(image, 0, 0);
            return { width: image.width, height: image.height, data: context.getImageData(0, 0, image.width, image.height).data };
        };
        const first = await pixels(before);
        const second = await pixels(after);
        if (first.width !== second.width || first.height !== second.height) {
            throw new Error('Parity screenshots have different dimensions');
        }
        let changed = 0;
        for (let index = 0; index < first.data.length; index += 4) {
            if (
                first.data[index] !== second.data[index] ||
                first.data[index + 1] !== second.data[index + 1] ||
                first.data[index + 2] !== second.data[index + 2]
            ) changed++;
        }
        return {
            width: first.width,
            height: first.height,
            changedPixels: changed,
            changedPercent: Number((changed / (first.width * first.height) * 100).toFixed(3)),
        };
    }, images);
}

test('installed Workflows editor, slash menu, routes, and disable continuity', async ({ page, baseURL }) => {
    test.setTimeout(120_000);
    await mkdir(outputDir, { recursive: true });
    await page.setViewportSize({ width: 1440, height: 960 });
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.stack ?? error.message));
    const origin = new URL(baseURL!).origin;
    const password = process.env.OR3_WORKFLOW_INSTALLED_TEST_PASSWORD;
    if (!password) throw new Error('OR3_WORKFLOW_INSTALLED_TEST_PASSWORD is required');

    const signIn = await page.request.post('/api/basic-auth/sign-in', {
        headers: { origin },
        data: {
            email: process.env.OR3_WORKFLOW_INSTALLED_TEST_EMAIL || 'workflow-test@example.test',
            password,
        },
    });
    expect(signIn.ok()).toBe(true);
    await page.goto('/chat');

    if (process.env.OR3_WORKFLOW_NO_MODEL_SMOKE === 'true') {
        const welcome = page.locator('[data-welcome-card]');
        await expect(welcome).toBeVisible();
        await welcome.getByRole('textbox', { name: 'OpenRouter API key' }).fill('sk-or-disposable-test-key');
        await welcome.getByRole('button', { name: 'Save', exact: true }).click();
    }

    const manifestResponse = await page.request.get('/api/plugins/runtime-manifest');
    expect(manifestResponse.ok()).toBe(true);
    const manifest = await manifestResponse.json() as {
        runtime?: Record<string, {
            descriptorStatus?: string;
            descriptor?: { source?: string; artifact?: { kind?: string; client?: { isolation?: string } } };
        }>;
    };
    expect(manifest.runtime?.['or3-workflows']).toMatchObject({
        descriptorStatus: 'ready',
        descriptor: { source: 'package', artifact: { kind: 'package-v2', client: { isolation: 'host' } } },
    });

    await page.getByRole('button', { name: 'Workflows', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Workflows', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'New workflow' }).click();
    const title = `Installed parity ${Date.now()}`;
    await page.getByRole('textbox', { name: 'Name' }).fill(title);
    await page.getByRole('button', { name: 'Create', exact: true }).click();
    await expect(page.getByText(title, { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Start', { exact: true }).first()).toBeVisible();
    await page.getByText('Node Palette', { exact: true }).click();
    await expect(page.getByText('AI Agent', { exact: true }).first()).toBeVisible();
    await page.screenshot({ path: resolve(outputDir, 'workflow-editor.png'), fullPage: true, animations: 'disabled' });

    await page.getByRole('button', { name: 'Close Workflows' }).click();
    await page.getByRole('button', { name: 'New chat', exact: true }).first().click();
    await page.getByRole('textbox', { name: 'Message input' }).fill('/');
    const workflowSuggestion = page.locator('.suggestion-panel[data-context="workflow"]');
    await expect(workflowSuggestion.getByText(title, { exact: true })).toBeVisible();
    await page.screenshot({ path: resolve(outputDir, 'workflow-slash-menu.png'), fullPage: true, animations: 'disabled' });
    await page.getByRole('textbox', { name: 'Message input' }).fill('');

    for (const route of ['background', 'hitl']) {
        const response = await page.request.post(`/api/plugins/or3-workflows/workflows/${route}`, {
            headers: { origin },
            data: {},
        });
        expect(response.status()).toBe(400);
        expect(await response.text()).toContain(route === 'background' ? 'Missing workflowId' : 'Missing requestId');
    }

    await page.getByRole('tab', { name: 'Workflows', exact: true }).click();
    const installedPath = resolve(outputDir, 'installed-sidebar.png');
    await page.screenshot({ path: installedPath, clip: sidebarClip, animations: 'disabled' });

    const sessionResponse = await page.request.get('/api/auth/session');
    const session = await sessionResponse.json() as { session?: { workspace?: { id?: string } } };
    const workspaceId = session.session?.workspace?.id;
    if (!workspaceId) throw new Error('Disposable workspace ID is unavailable');
    const adminSignIn = await page.request.post('/api/admin/auth/login', {
        headers: { origin, 'x-or3-admin-intent': 'admin' },
        data: {
            username: process.env.OR3_WORKFLOW_INSTALLED_TEST_USERNAME || 'workflow-test',
            password: process.env.OR3_WORKFLOW_INSTALLED_TEST_ADMIN_PASSWORD || password,
        },
    });
    expect(adminSignIn.ok()).toBe(true);
    const stylesheet = page.locator('link[href*="/api/plugins/packages/or3-workflows/"]');
    await expect(stylesheet).toHaveCount(1);
    const setEnabled = async (enabled: boolean) => page.request.post('/api/admin/plugins/workspace-enable', {
        headers: { origin, 'x-or3-admin-intent': 'admin' },
        data: { pluginId: 'or3-workflows', workspaceId, enabled },
    });
    try {
        const disable = await setEnabled(false);
        expect(disable.ok()).toBe(true);
        await page.evaluate(() => window.dispatchEvent(new Event('focus')));
        await expect(stylesheet).toHaveCount(0);
        await page.getByRole('textbox', { name: 'Message input' }).fill('/');
        await expect(workflowSuggestion).toHaveCount(0);
        await page.getByRole('textbox', { name: 'Message input' }).fill('');
        await page.reload();
        if (expectCoreFallback) {
            await page.getByRole('button', { name: 'Workflows', exact: true }).click();
            await page.getByRole('tab', { name: 'Workflows', exact: true }).click();
            await expect(page.getByText(title, { exact: true }).first()).toBeVisible();
            const fallbackPath = resolve(outputDir, 'core-fallback-sidebar.png');
            await page.screenshot({ path: fallbackPath, clip: sidebarClip, animations: 'disabled' });
            const difference = await screenshotDifference(page, installedPath, fallbackPath);
            await writeFile(resolve(outputDir, 'sidebar-parity.json'), `${JSON.stringify(difference, null, 2)}\n`);
            expect(difference.changedPercent).toBeLessThan(5);
        } else {
            await expect(page.getByRole('button', { name: 'Workflows', exact: true })).toHaveCount(0);
        }
    } finally {
        const enable = await setEnabled(true);
        expect(enable.ok()).toBe(true);
    }
    if (!expectCoreFallback) {
        expect(pageErrors).toEqual([]);
        await page.reload();
        await expect(page.getByRole('button', { name: 'Workflows', exact: true })).toBeVisible();
        await page.getByRole('textbox', { name: 'Message input' }).fill('/');
        await expect(workflowSuggestion.getByText(title, { exact: true })).toBeVisible();
        await page.getByRole('textbox', { name: 'Message input' }).fill('');
        await expect(workflowSuggestion).toHaveCount(0);
        expect(pageErrors).toEqual([]);
        await page.getByRole('button', { name: 'Workflows', exact: true }).click();
        await page.getByText(title, { exact: true }).first().click();
        await expect(page.getByText('Start', { exact: true }).first()).toBeVisible();
        try {
            const disableWithPane = await setEnabled(false);
            expect(disableWithPane.ok()).toBe(true);
            await page.evaluate(() => window.dispatchEvent(new Event('focus')));
            await expect(stylesheet).toHaveCount(0);
            await expect(page.getByText('Unknown Pane Type')).toHaveCount(0);
        } finally {
            const enableWithPane = await setEnabled(true);
            expect(enableWithPane.ok()).toBe(true);
        }
        await page.reload();
        await expect(stylesheet).toHaveCount(1);
        await page.getByRole('button', { name: 'Workflows', exact: true }).click();
        await page.getByText(title, { exact: true }).first().click();
        await expect(page.getByText('Start', { exact: true }).first()).toBeVisible();
    }
    expect(pageErrors).toEqual([]);
});
