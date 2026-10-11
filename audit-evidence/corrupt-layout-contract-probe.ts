/** Native mounted-browser dependency check of the merged corrupt-layout recovery contract. */
import { chromium, expect } from '@playwright/test';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
const output = '/workspace/or3-chat/test-results/recovery-corrupt-layout-contract';
await mkdir(output, { recursive: true });
const browser = await chromium.launch(); const context = await browser.newContext();
await context.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort('blockedbyclient'));
try {
    const page = await context.newPage();
    await page.route('**openrouter.ai/**', route => route.abort());
    await page.goto('http://127.0.0.1:3127/chat');
    const input = page.getByRole('textbox', { name: 'Message input' });
    await expect(input).toBeVisible({ timeout: 60_000 });
    const layoutKey = () => page.evaluate(() => Object.keys(localStorage).find(key => /^or3:workspace-tabs:v1:[^:]+:[^:]+$/.test(key)) ?? '');
    await expect.poll(layoutKey).not.toBe('');
    const key = await layoutKey();

    // The next load finds a truncated layout where the saved one used to be.
    const unreadable = '{"schemaVersion":1,"tabs":[{"id":"tab-1","resource":';
    await context.addInitScript(([storageKey, value]) => {
        if (sessionStorage.getItem('or3-test-layout-seeded')) return;
        sessionStorage.setItem('or3-test-layout-seeded', '1');
        localStorage.setItem(storageKey!, value!);
    }, [key, unreadable]);
    await page.reload();

    const toast = page.getByText('Saved tab layout was unreadable', { exact: true });
    await expect(toast).toBeVisible({ timeout: 30_000 });
    await expect(input).toBeVisible();
    // The original was copied aside before anything could replace it.
    expect(await page.evaluate(storageKey => localStorage.getItem(`${storageKey}:corrupt`), key)).toBe(unreadable);

    const [download] = await Promise.all([
        page.waitForEvent('download'),
        page.getByRole('button', { name: 'Download original' }).click(),
    ]);
    expect(download.suggestedFilename()).toBe('or3-tab-layout-backup.txt');
    expect(await (await import('node:fs/promises')).readFile(await download.path(), 'utf8')).toBe(unreadable);
    // Choosing an action closes the notice; the copy stays until it is discarded.
    await expect(toast).toHaveCount(0);
    expect(await page.evaluate(storageKey => localStorage.getItem(`${storageKey}:corrupt`), key)).toBe(unreadable);

    // A second unreadable layout is reported again, and this time the user discards the copy.
    await expect.poll(() => page.evaluate(storageKey => {
        try { return JSON.parse(localStorage.getItem(storageKey) ?? '').schemaVersion; } catch { return null; }
    }, key)).toBe(1);
    await page.evaluate(([storageKey, value]) => localStorage.setItem(storageKey!, value!), [key, unreadable]);
    await page.reload();
    await expect(toast).toBeVisible({ timeout: 30_000 });
    await page.getByRole('button', { name: 'Discard original' }).click();
    await expect(toast).toHaveCount(0);
    expect(await page.evaluate(storageKey => localStorage.getItem(`${storageKey}:corrupt`), key)).toBeNull();

    // A fresh layout replaces the unreadable one, and the composer still works.
    await expect(input).toBeVisible();
    await input.fill('Still usable');
    await expect(input).toHaveText('Still usable');
    await expect.poll(() => page.evaluate(storageKey => {
        try { return JSON.parse(localStorage.getItem(storageKey) ?? '').schemaVersion; } catch { return null; }
    }, key)).toBe(1);
    const receipt = { key, unreadable, downloadedOriginal: await readFile((await download.path())!, 'utf8'),
        backupAfterDiscard: await page.evaluate(storageKey => localStorage.getItem(`${storageKey}:corrupt`), key),
        liveText: await input.innerText(), layout: await page.evaluate(storageKey => localStorage.getItem(storageKey), key),
        dependency: 'merged #235 corrupt-layout backup/download/discard contract', externalRequests: 'denied' };
    await writeFile(output + '/evidence.json', JSON.stringify(receipt, null, 2));
    await page.screenshot({ path: output + '/recovered-workspace.png' });
    console.log(JSON.stringify({ downloadedOriginalMatches: receipt.downloadedOriginal === unreadable,
        discarded: receipt.backupAfterDiscard === null, liveText: receipt.liveText }));
} finally { await context.close(); await browser.close(); }
