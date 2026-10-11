/** Mounted Chromium composer: refresh while the existing extension hook delays initialization. */
import { chromium, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
const browser = await chromium.launch(); const context = await browser.newContext();
const scripts: string[] = [];
context.on('request', request => { if (request.resourceType() === 'script') scripts.push(request.url()); });
await context.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort('blockedbyclient'));
const output = '/workspace/or3-chat/test-results/recovery-editor-initialization'; await mkdir(output, { recursive: true });
try {
    const page = await context.newPage(); await page.goto('http://127.0.0.1:3127/chat');
    const input = page.getByRole('textbox', { name: 'Message input' }); await input.waitFor({ timeout: 60_000 });
    const marker = 'Saved buffer before browser editor initialization is held'; await input.fill(marker);
    const read = () => page.evaluate(async () => {
        const drafts: Array<{ tab_id: string; draft: { text: string; editorJson?: unknown } }> = [];
        for (const { name } of await indexedDB.databases()) {
            if (!name?.startsWith('or3-db')) continue;
            const db = await new Promise<IDBDatabase>((resolve, reject) => {
                const request = indexedDB.open(name); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
            });
            const rows = await new Promise<typeof drafts>((resolve, reject) => {
                const request = db.transaction('workspace_tab_drafts', 'readonly').objectStore('workspace_tab_drafts').getAll();
                request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
            });
            drafts.push(...rows); db.close();
        }
        return drafts;
    });
    await expect.poll(async () => (await read()).map(row => row.draft.text)).toContain(marker);
    const urls = { drafts: scripts.find(url => /useWorkspaceTabDrafts\.ts(?:\?|$)/.test(url)) };
    expect(urls.drafts).toBeTruthy();
    await page.addInitScript(() => {
        const key = 'or3:e2e:startup-hook-held-once';
        if (sessionStorage.getItem(key)) return;
        sessionStorage.setItem(key, '1');
        let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
        (window as unknown as { editorInitializationProbe: { entered: number; release: () => void; gate: Promise<void> } }).editorInitializationProbe = { entered: 0, release, gate };
    });
    // Inject only a latency hook into the local Vite response. Composer and DB code are unchanged.
    await page.route('**/core/hooks/useHooks.ts*', async route => {
        const response = await route.fetch(); const body = await response.text();
        const needle = 'cachedEngine = engine;';
        expect(body).toContain(needle);
        await route.fulfill({ response, body: body.replace(needle, needle + `
            if (engine && globalThis.editorInitializationProbe) engine.addAction('editor:request-extensions', async () => {
                globalThis.editorInitializationProbe.entered++; await globalThis.editorInitializationProbe.gate;
            }, -1000);
        `) });
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect.poll(() => page.evaluate(() => (window as unknown as { editorInitializationProbe?: { entered: number } }).editorInitializationProbe?.entered ?? 0), { timeout: 30_000 }).toBeGreaterThan(0);
    await expect(input).toHaveCount(0);
    const before = await read();
    const prevented = await page.evaluate(async url => {
        const drafts = (await import(url!) as typeof import('../app/composables/core/useWorkspaceTabDrafts')); const event = new Event('beforeunload', { cancelable: true });
        window.dispatchEvent(event); await drafts.useWorkspaceTabDrafts().flush(); return event.defaultPrevented;
    }, urls.drafts);
    const after = await read();
    await writeFile(output + '/before-release.json', JSON.stringify({ before, after, prevented, externalRequests: 'denied',
        boundary: 'real mounted composer held at its existing editor extension hook; synthetic cancelable unload capture' }, null, 2));
    expect(after.map(row => row.draft.text)).toContain(marker);
    expect(after.find(row => row.draft.text === marker)?.draft.editorJson).toEqual(before.find(row => row.draft.text === marker)?.draft.editorJson);
    await page.reload(); await expect(input).toHaveText(marker, { timeout: 60_000 });
    await writeFile(output + '/evidence.json', JSON.stringify({ before, after, recovered: await input.innerText(),
        externalRequests: 'denied', browser: 'Chromium', startupHookPaused: true, localHookResponseInstrumented: true }, null, 2));
    console.log(JSON.stringify({ savedRows: after.length, recovered: await input.innerText(), startupHookPaused: true, localHookResponseInstrumented: true }));
} finally { await context.close(); await browser.close(); }
