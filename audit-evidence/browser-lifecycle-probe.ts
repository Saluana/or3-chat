/** Real Chromium lifecycle protocol probe; no provider or cloud traffic. */
import { chromium, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

const headed = process.env.OR3_RECOVERY_HEADED === 'true';
const browser = await chromium.launch({ headless: !headed, ...(headed ? {
    ignoreDefaultArgs: ['--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', '--disable-background-timer-throttling'],
} : {}) });
const context = await browser.newContext();
await context.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1'
    ? route.continue() : route.abort('blockedbyclient'));
try {
    const page = await context.newPage();
    await page.goto('http://127.0.0.1:3127/__or3-document-journey-test');
    const body = page.getByRole('textbox', { name: 'Document body' });
    await body.waitFor({ timeout: 60_000 });
    await page.evaluate(() => {
        const states: string[] = [];
        (window as unknown as { recoveryLifecycleStates: string[] }).recoveryLifecycleStates = states;
        document.addEventListener('visibilitychange', () => states.push(`visibility:${document.visibilityState}`));
        document.addEventListener('freeze', () => states.push('freeze'));
        document.addEventListener('resume', () => states.push('resume'));
    });
    const session = await context.newCDPSession(page);
    if (headed) await session.send('Emulation.setFocusEmulationEnabled', { enabled: false });
    const target = await session.send('Target.getTargetInfo');
    const window = headed ? await session.send('Browser.getWindowForTarget', { targetId: target.targetInfo.targetId }) : null;
    if (headed) await expect.poll(() => page.evaluate(() => document.visibilityState)).toBe('visible');
    await body.fill('Synthetic lifecycle recovery marker');
    if (window) {
        await session.send('Browser.setWindowBounds', { windowId: window.windowId, bounds: { windowState: 'minimized' } });
        await expect.poll(() => page.evaluate(() => document.visibilityState)).toBe('hidden');
    }
    await session.send('Page.setWebLifecycleState', { state: 'frozen' });
    await new Promise(resolve => setTimeout(resolve, 50));
    await session.send('Page.setWebLifecycleState', { state: 'active' });
    await expect(page.getByTestId('persisted-document-body')).toHaveText('Synthetic lifecycle recovery marker', { timeout: 10_000 });
    const events = await page.evaluate(() => (window as unknown as { recoveryLifecycleStates: string[] }).recoveryLifecycleStates);
    if (window) await session.send('Browser.setWindowBounds', { windowId: window.windowId, bounds: { windowState: 'normal' } });
    await page.reload();
    await expect(body).toHaveText('Synthetic lifecycle recovery marker', { timeout: 60_000 });
    const evidence = { headed, events, recovered: await body.textContent(), protocol: 'Page.setWebLifecycleState: frozen then active' };
    await mkdir('test-results/recovery-browser-lifecycle', { recursive: true });
    await writeFile(`test-results/recovery-browser-lifecycle/${headed ? 'headed' : 'headless'}-evidence.json`, JSON.stringify(evidence, null, 2));
    console.log(JSON.stringify(evidence));
} finally {
    await context.close();
    await browser.close();
}
