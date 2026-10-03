import { chromium, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

// Capture only an explicitly assigned local preview. This script starts no server.
const origin = process.env.OR3_COMPACTION_PRESENTATION_ORIGIN;
if (!origin || !/^http:\/\/(?:127\.0\.0\.1|localhost):\d+$/.test(origin))
    throw new Error('Set OR3_COMPACTION_PRESENTATION_ORIGIN to the assigned local preview.');
const output = resolve(process.env.OR3_COMPACTION_PRESENTATION_OUTPUT ?? 'evidence/compaction-presentation');
await mkdir(output, { recursive: true });
const sourceSha = Bun.spawnSync(['git', 'rev-parse', 'HEAD'], { stdout: 'pipe' }).stdout.toString().trim();
const sourceDiff = Bun.spawnSync(['git', 'diff', '--binary', 'HEAD'], { stdout: 'pipe' }).stdout;
const sourceDiffSha256 = new Bun.CryptoHasher('sha256').update(sourceDiff).digest('hex');
const browser = await chromium.launch();
const artifacts: Array<{ file: string; state: string; theme: string; viewport: { width: number; height: number } }> = [];
try {
    for (const scheme of ['light', 'dark'] as const) {
        const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, colorScheme: scheme });
        // No paid inference, remote resources, or real browser profile/data.
        await context.route('**/*', (route) => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
        const page = await context.newPage();
        page.on('console', (message) => { if (message.type() === 'error') console.error(message.text()); });
        page.on('pageerror', (error) => console.error(error.message));
        await page.goto(`${origin}/__or3-chat-journey-test?compaction=1&presentation=1`);
        await expect(page.getByRole('textbox', { name: 'Message input' })).toBeVisible({ timeout: 90_000 });
        const header = page.locator('[data-family-kind="group-header"]').filter({ hasText: 'Launch checklist' }).first();
        await expect(header).toBeVisible();
        const root = await header.getAttribute('data-thread-family'); if (!root) throw new Error('Family root unavailable.');
        const contextIndicator = page.locator('[data-context-indicator]');
        await expect(contextIndicator.getByRole('meter')).toBeVisible();
        await expect(page.getByRole('button', { name: 'Compact conversation', exact: true }).first()).toBeVisible();
        const theme = await page.evaluate(() => `${document.documentElement.className}; ${document.documentElement.getAttribute('data-theme') ?? 'default theme'}`);
        async function capture(state: string, target?: ReturnType<typeof page.locator>) {
            const file = `${scheme}-${state}.png`;
            if (target) await target.screenshot({ path: resolve(output, file), animations: 'disabled' });
            else await page.screenshot({ path: resolve(output, file), animations: 'disabled' });
            artifacts.push({ file, state, theme, viewport: page.viewportSize()! });
        }
        await capture('family-collapsed-full');
        const toggle = header.getByRole('button', { name: /^Expand / }); await toggle.focus();
        await page.keyboard.press('Enter');
        await expect(header.getByRole('button', { name: /^Collapse / })).toHaveAttribute('aria-expanded', 'true');
        await expect(page.locator(`[data-family-kind="thread-member"][data-thread-family="${root}"]`)).toHaveCount(4);
        await capture('family-expanded-full');
        await capture('family-expanded-sidebar', page.getByTestId('sidebar-inner'));
        await capture('context-and-compact', page.locator('#chat-input-main'));
        await header.hover();
        await header.getByRole('button', { name: 'Open actions', exact: true }).click();
        await expect(page.getByRole('button', { name: 'Compact conversation', exact: true }).last()).toBeVisible();
        await capture('manual-compaction-menu');
        await page.keyboard.press('Escape');
        await contextIndicator.getByRole('button', { name: /^Context \d+% used/ }).click();
        await expect(page.getByText(/Reply available/)).toBeVisible(); await capture('context-details');
        await page.keyboard.press('Escape');
        await page.setViewportSize({ width: 390, height: 844 });
        await expect(page.getByRole('button', { name: 'Open sidebar', exact: true }).first()).toBeVisible();
        await capture('mobile-composer');
        await page.getByRole('button', { name: 'Open sidebar', exact: true }).first().click();
        await expect(header).toBeVisible(); await capture('mobile-expanded-sidebar');
        await context.close();
    }
} finally { await browser.close(); }
await writeFile(resolve(output, 'manifest.json'), JSON.stringify({ source: 'real PageShell, disposable scripted fixture',
    sourceSha, sourceDiffSha256, fixture: 'production-chat-journey-v2', providerTraffic: 'scripted only', inspected: false, artifacts }, null, 2));
// Inspect PNGs with the host image viewer before setting inspected or uploading.
