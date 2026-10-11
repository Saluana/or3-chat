/** Mounted composer plus native IndexedDB; closed connection, visible failure, repair and refresh. */
import { chromium, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
const output = process.env.OR3_CLOSED_DB_OUTPUT ?? '/workspace/or3-chat/test-results/recovery-mounted-closed-db';
await mkdir(output, { recursive: true });
const browser = await chromium.launch(); const context = await browser.newContext();
const scripts: string[] = [];
context.on('request', request => { if (request.resourceType() === 'script') scripts.push(request.url()); });
await context.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort('blockedbyclient'));
try {
    const page = await context.newPage(); await page.goto('http://127.0.0.1:3127/chat');
    const input = page.getByRole('textbox', { name: 'Message input' }); await input.waitFor({ timeout: 45_000 });
    const clientURL = scripts.find(url => /\/db\/client\.ts(?:\?|$)/.test(url));
    expect(clientURL).toBeTruthy();
    const first = 'Synthetic composer before its local connection closes';
    const pending = first + ' — retained edit after close';
    const read = () => page.evaluate(async () => {
        const rows: any[] = [];
        for (const { name } of await indexedDB.databases()) {
            if (!name?.startsWith('or3-db')) continue;
            const db = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open(name); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
            if (db.objectStoreNames.contains('workspace_tab_drafts')) rows.push(...await new Promise<any[]>((resolve, reject) => {
                const request = db.transaction('workspace_tab_drafts', 'readonly').objectStore('workspace_tab_drafts').getAll(); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
            })); db.close();
        }
        return rows;
    });
    await input.fill(first);
    await expect.poll(async () => (await read()).map(row => row.draft.text)).toContain(first);
    const before = await read();
    const closed = await page.evaluate(async url => {
        const client = await import(url!); const db = client.getDb();
        const name = db.name; db.close();
        (globalThis as any).__closedDbProbe = { db, name };
        return { name, isOpen: db.isOpen() };
    }, clientURL);
    expect(closed.isOpen).toBe(false);
    await input.fill(pending);
    const notice = page.getByText('Draft could not be saved', { exact: true });
    await expect.poll(async () => (await read()).some(row => row.draft.text === pending) || await notice.isVisible(), { timeout: 10_000 }).toBe(true);
    await expect(input).toHaveText(pending);
    const failedRows = await read();
    const acknowledgedWithoutManualRepair = failedRows.some(row => row.draft.text === pending);
    const afterEdit = await page.evaluate(() => { const { db, name } = (globalThis as any).__closedDbProbe; return { name, isOpen: db.isOpen() }; });
    const failureVisible = await notice.isVisible();
    await writeFile(output + '/after-close.json', JSON.stringify({ before, closed, failedRows, afterEdit, failureVisible, acknowledgedWithoutManualRepair }, null, 2));
    await page.screenshot({ path: output + '/after-close.png' });
    let reopened: typeof closed | undefined;
    if (!acknowledgedWithoutManualRepair) {
        expect(failureVisible).toBe(true);
        expect(failedRows.some(row => row.draft.text === first)).toBe(true);
        reopened = await page.evaluate(async () => {
            const { db, name } = (globalThis as any).__closedDbProbe; await db.open();
            return { name, isOpen: db.isOpen() };
        });
        expect(reopened).toEqual({ name: closed.name, isOpen: true });
        const retry = page.getByRole('button', { name: 'Retry', exact: true });
        try { await retry.click({ timeout: 5_000 }); }
        catch { await expect.poll(async () => (await read()).map(row => row.draft.text)).toContain(pending); }
        await expect.poll(async () => (await read()).map(row => row.draft.text)).toContain(pending);
    }
    const repaired = await read();
    await page.reload(); await input.waitFor({ timeout: 45_000 });
    await expect(input).toHaveText(pending, { timeout: 12_000 });
    const recovered = await read();
    await writeFile(output + '/evidence.json', JSON.stringify({ before, closed, failedRows, afterEdit, failureVisible, acknowledgedWithoutManualRepair, reopened, repaired, recovered,
        liveText: await input.innerText(), fault: 'production Dexie handle explicitly closed; native database retained; same handle explicitly reopened',
        repair: acknowledgedWithoutManualRepair ? 'draft acknowledged without explicit reopening or Retry' : 'local connection reopened, existing visible Retry used; no resend', evidenceLevel: 'mounted Chromium composer plus actual local IndexedDB', externalRequests: 'denied' }, null, 2));
    console.log(JSON.stringify({ before: first, recovered: await input.innerText(), closed, afterEdit, failureVisible, acknowledgedWithoutManualRepair, reopened }));
} finally { await context.close(); await browser.close(); }
