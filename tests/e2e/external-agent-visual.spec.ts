import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';

test.skip(
    process.env.OR3_AGENT_INSTALLED_TEST_HARNESS !== 'true',
    'Run against a disposable host with the External Agents package installed and enabled.',
);

const outputDir = resolve('output/playwright/agents-installed');
const expectCoreFallback = process.env.OR3_AGENT_PARITY_CORE_FALLBACK === 'true';

async function compareScreenshots(page: import('@playwright/test').Page, first: string, second: string) {
    const imageData = await Promise.all([first, second].map(async (name) =>
        `data:image/png;base64,${(await readFile(resolve(outputDir, name))).toString('base64')}`));
    const comparisonPage = await page.context().newPage();
    try {
        return await comparisonPage.evaluate(async ([before, after]) => {
        const load = async (src: string) => {
            const image = new Image();
            image.src = src;
            await image.decode();
            const canvas = document.createElement('canvas');
            canvas.width = image.width;
            canvas.height = image.height;
            const context = canvas.getContext('2d')!;
            context.drawImage(image, 0, 0);
            return { width: image.width, height: image.height, pixels: context.getImageData(0, 0, image.width, image.height).data };
        };
        const [a, b] = await Promise.all([load(before), load(after)]);
        if (a.width !== b.width || a.height !== b.height) throw new Error('Parity screenshots have different dimensions');
        let changedPixels = 0;
        let absoluteRgbDifference = 0;
        for (let index = 0; index < a.pixels.length; index += 4) {
            const delta = Math.abs(a.pixels[index]! - b.pixels[index]!)
                + Math.abs(a.pixels[index + 1]! - b.pixels[index + 1]!)
                + Math.abs(a.pixels[index + 2]! - b.pixels[index + 2]!);
            absoluteRgbDifference += delta;
            if (delta > 0) changedPixels++;
        }
        return {
            width: a.width, height: a.height, changedPixels,
            changedPercent: Number((changedPixels / (a.width * a.height) * 100).toFixed(3)),
            meanRgbDifference: Number((absoluteRgbDifference / (a.width * a.height * 3)).toFixed(3)),
        };
        }, imageData);
    } finally {
        await comparisonPage.close();
    }
}

test('installed package registers and renders its sidebar and pane', async ({ page, baseURL }) => {
    await mkdir(outputDir, { recursive: true });
    await page.setViewportSize({ width: 1440, height: 960 });
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    const password = process.env.OR3_AGENT_INSTALLED_TEST_PASSWORD;
    if (!password) throw new Error('OR3_AGENT_INSTALLED_TEST_PASSWORD is required for this host');
    const signIn = await page.request.post(`${baseURL}/api/basic-auth/sign-in`, {
        headers: { origin: new URL(baseURL!).origin },
        data: { email: process.env.OR3_AGENT_INSTALLED_TEST_EMAIL || 'agent-test@example.test', password },
    });
    expect(signIn.ok()).toBe(true);
    await page.goto('/chat');

    const manifest = await page.request.get('/api/plugins/runtime-manifest');
    expect(manifest.ok()).toBe(true);
    const runtime = await manifest.json() as {
        runtime?: Record<string, {
            descriptorStatus?: string;
            descriptor?: {
                source?: string;
                artifact?: { kind?: string; client?: { isolation?: string } };
            };
        }>;
    };
    expect(runtime.runtime?.['or3-external-agents']).toMatchObject({
        descriptorStatus: 'ready',
        descriptor: {
            source: 'package',
            artifact: { kind: 'package-v2', client: { isolation: 'host' } },
        },
    });

    await page.getByRole('button', { name: 'Agents', exact: true }).click();
    const sidebar = page.locator('section[aria-label="Agents"]');
    await expect(sidebar).toBeVisible();
    await expect(sidebar.getByRole('button', { name: 'New agent' }).first()).toBeVisible();
    await expect(sidebar.getByRole('button', { name: 'Connection settings' })).toBeVisible();
    await expect(sidebar.getByRole('textbox', { name: 'Search agent sessions' })).toBeVisible();
    await sidebar.getByRole('button', { name: 'Connection settings' }).click();
    await expect(page.getByText('Trusted hosts', { exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByText('Trusted hosts', { exact: true })).toBeHidden();
    await page.mouse.move(700, 800);
    await page.locator('body').click({ position: { x: 700, y: 800 } });
    await sidebar.screenshot({
        path: resolve(outputDir, 'agents-sidebar-empty.png'),
        animations: 'disabled',
    });
    await sidebar.getByRole('button', { name: 'New agent' }).first().click();
    const pane = page.locator('section[aria-label="External agent conversation"]');
    await expect(pane).toBeVisible();
    await expect(pane).toContainText('What should the agent do?');
    await pane.screenshot({
        path: resolve(outputDir, 'agents-pane-new.png'),
        animations: 'disabled',
    });
    await page.screenshot({ path: resolve(outputDir, 'agents-installed-new.png'), fullPage: true, animations: 'disabled' });

    await pane.getByRole('button', { name: 'Connection settings' }).click();
    await expect(page.getByText('Trusted hosts', { exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByText('Trusted hosts', { exact: true })).toBeHidden();

    await page.getByRole('button', { name: 'Open command palette' }).first().click();
    const palette = page.getByRole('dialog');
    await palette.getByRole('combobox').fill('agent');
    for (const label of [
        'New external agent session',
        'Open running external agent',
        'Review external agent approvals',
        'Reconnect external agent host',
    ]) {
        await expect(palette.getByText(label, { exact: true }).first()).toBeVisible();
    }
    expect(pageErrors).toEqual([]);

    const sessionResponse = await page.request.get(`${baseURL}/api/auth/session`);
    const session = await sessionResponse.json() as { session?: { workspace?: { id?: string } } };
    const workspaceId = session.session?.workspace?.id;
    if (!workspaceId) throw new Error('Disposable workspace session is unavailable');
    const adminSignIn = await page.request.post(`${baseURL}/api/admin/auth/login`, {
        headers: { origin: new URL(baseURL!).origin },
        data: {
            username: process.env.OR3_AGENT_INSTALLED_TEST_USERNAME || 'agent-test',
            password,
        },
    });
    expect(adminSignIn.ok()).toBe(true);
    const setEnabled = async (enabled: boolean) => {
        const response = await page.request.post(`${baseURL}/api/admin/plugins/workspace-enable`, {
            headers: { origin: new URL(baseURL!).origin, 'x-or3-admin-intent': 'admin' },
            data: { pluginId: 'or3-external-agents', workspaceId, enabled },
        });
        expect(response.ok()).toBe(true);
    };
    try {
        await setEnabled(false);
        // Reconcile the disabled manifest while the Agent pane is still open.
        await page.evaluate(() => window.dispatchEvent(new Event('focus')));
        await expect(page.locator('section[aria-label="External agent conversation"]')).toHaveCount(0);
        await expect(page.getByText('Unknown Pane Type')).toHaveCount(0);
        await expect(page.locator('[data-pane-mode="or3-external-agent"]')).toHaveCount(0);
        expect(pageErrors).toEqual([]);
        await page.reload();
        if (expectCoreFallback) {
            await page.getByRole('button', { name: 'Agents', exact: true }).click();
            const coreSidebar = page.locator('section[aria-label="Agents"]');
            await expect(coreSidebar.getByRole('button', { name: 'New agent' }).first()).toBeVisible();
            await coreSidebar.screenshot({ path: resolve(outputDir, 'agents-core-sidebar-empty.png'), animations: 'disabled' });
            await coreSidebar.getByRole('button', { name: 'New agent' }).first().click();
            await expect(page.locator('section[aria-label="External agent conversation"]')).toBeVisible();
            await page.screenshot({ path: resolve(outputDir, 'agents-core-new.png'), fullPage: true, animations: 'disabled' });
            const parity = {
                capture: '1440x960 viewport, Agents sidebar selected, new agent launcher active, no session or host',
                sidebar: await compareScreenshots(page, 'agents-core-sidebar-empty.png', 'agents-sidebar-empty.png'),
                launcher: await compareScreenshots(page, 'agents-core-new.png', 'agents-installed-new.png'),
            };
            await writeFile(resolve(outputDir, 'parity.json'), `${JSON.stringify(parity, null, 2)}\n`);
        } else {
            await expect(page.getByRole('button', { name: 'Agents', exact: true })).toHaveCount(0);
            await expect(page.locator('section[aria-label="External agent conversation"]')).toHaveCount(0);
            await expect(page.getByText('Unknown Pane Type')).toHaveCount(0);
            await expect(page.locator('[data-pane-mode="or3-external-agent"]')).toHaveCount(0);
        }
    } finally {
        await setEnabled(true);
    }
    await page.reload();
    await page.getByRole('button', { name: 'Agents', exact: true }).click();
    await expect(page.locator('section[aria-label="Agents"]').getByRole('button', { name: 'New agent' }).first()).toBeVisible();
    expect(pageErrors).toEqual([]);
});
