// Native-default and listener-lifecycle qualification on the real scroll canary.
// bun audit-evidence/performance-20261023/scroll-wheel-owner-probe.mjs /tmp/wheel-owner.json http://127.0.0.1:3116
import { chromium, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const [output, origin = 'http://127.0.0.1:3116'] = process.argv.slice(2);
assert(output, 'Supply an output path');
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const phases = [];
const errors = [];
page.on('pageerror', error => errors.push(String(error)));
const timer = setTimeout(() => browser.close().catch(() => {}), 90000);
try {
    await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    await page.addInitScript(() => {
        window.__wheelDefaults = [];
        document.addEventListener('wheel', event => {
            if (event.target instanceof Element && event.target.closest('.canary-scroll'))
                window.__wheelDefaults.push({ deltaY: event.deltaY, cancelable: event.cancelable,
                    defaultPrevented: event.defaultPrevented });
        }, { passive: true });
    });
    await page.goto(origin + '/__or3-scroll-test');
    await expect(page.getByTestId('ready')).toHaveText('ready', { timeout: 30000 });
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(() => {
        window.__wheelRouter = document.querySelector('#__nuxt').__vue_app__.config.globalProperties.$router;
    });
    const client = await page.context().newCDPSession(page);
    const { result } = await client.send('Runtime.evaluate', { expression: 'globalThis.__wheelRoot = document.querySelector(".canary-scroll")' });
    assert(result.objectId);
    const listeners = async () => (await client.send('DOMDebugger.getEventListeners', { objectId: result.objectId })).listeners
        .filter(listener => listener.type === 'wheel')
        .map(({ passive, useCapture, once }) => ({ passive, useCapture, once }));
    for (const browsing of [false, true, false]) {
        await page.evaluate(async browsing => {
            const api = window.__or3ScrollCanary;
            await api.scrollToIndex(50);
            api.setBrowsing(browsing);
        }, browsing);
        let previous = '';
        await expect.poll(async () => {
            const current = await page.locator('.canary-scroll').evaluate(root => JSON.stringify([root.scrollTop, root.scrollHeight]));
            const equal = previous === current;
            previous = current;
            return equal;
        }, { intervals: [100], timeout: 5000 }).toBe(true);
        const registered = await listeners();
        assert.deepEqual(registered, [{ passive: browsing, useCapture: false, once: false }]);
        const before = await page.locator('.canary-scroll').evaluate(root => root.scrollTop);
        await page.locator('.canary-scroll').hover();
        await page.mouse.wheel(0, -120);
        await expect.poll(() => page.locator('.canary-scroll').evaluate(root => root.scrollTop)).toBeLessThan(before);
        const after = await page.locator('.canary-scroll').evaluate(root => root.scrollTop);
        assert(after > 0, 'A small wheel must not become a top jump');
        phases.push({ browsing, registered, before, after });
    }
    await page.evaluate(async () => {
        await window.__wheelRouter.push('/');
    });
    await expect.poll(() => page.evaluate(() => window.__wheelRoot.isConnected)).toBe(false);
    const afterDeactivation = await listeners();
    // NuxtPage retains up to three pages. Detachment alone is not unmount.
    for (const path of ['/images', '/docs']) await page.evaluate(async path => {
        await window.__wheelRouter.push(path);
    }, path);
    await expect.poll(async () => (await listeners()).length).toBe(0);
    const afterUnmount = await listeners();
    const devUnmountFlag = await page.evaluate(() => window.__wheelRoot.__vueParentComponent?.isUnmounted ?? null);
    assert.deepEqual(afterUnmount, [], 'The detached old root must have no wheel listener');
    const nativeDefaults = await page.evaluate(() => window.__wheelDefaults);
    assert.equal(nativeDefaults.length, 3);
    assert(nativeDefaults.every(event => event.defaultPrevented === false));
    assert.deepEqual(errors, []);
    await writeFile(output, JSON.stringify({ browser: browser.version(), origin, phases,
        nativeDefaults, afterDeactivation, afterUnmount, devUnmountFlag, errors }, null, 2) + '\n');
    console.log(JSON.stringify({ phases, nativeDefaults, afterDeactivation, afterUnmount, devUnmountFlag, errors }));
} finally {
    clearTimeout(timer);
    await browser.close();
}
