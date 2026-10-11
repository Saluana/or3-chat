/** Actual Chromium renderer crash after an acknowledged recovery journal but rejected IndexedDB save. */
import { chromium, expect, type Page } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import type { WorkspaceTabDraftRow } from '../app/db/client';
import type { RecoveryProbeWindow } from './probe-types';
const output = '/workspace/or3-chat/test-results/recovery-renderer-crash-draft';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ args: ['--disable-breakpad', '--disable-crash-reporter'] });
const context = await browser.newContext();
await context.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort('blockedbyclient'));
const read = (page: Page) => page.evaluate(async () => {
    const rows: WorkspaceTabDraftRow[] = [];
    for (const { name } of await indexedDB.databases()) {
        if (!name?.startsWith('or3-db')) continue;
        const db = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open(name); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
        if (db.objectStoreNames.contains('workspace_tab_drafts')) rows.push(...await new Promise<WorkspaceTabDraftRow[]>((resolve, reject) => {
            const request = db.transaction('workspace_tab_drafts', 'readonly').objectStore('workspace_tab_drafts').getAll(); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
        })); db.close();
    }
    return rows;
});
try {
    const page = await context.newPage(); await page.goto('http://127.0.0.1:3127/chat');
    const input = page.getByRole('textbox', { name: 'Message input' }); await input.waitFor({ timeout: 45_000 });
    const first = 'Synthetic acknowledged draft before renderer crash'; const pending = first + ' — journaled edit with rejected IndexedDB save';
    await input.fill(first); await expect.poll(async () => (await read(page)).map(row => row.draft.text)).toContain(first);
    const before = await read(page); const rowId = before.find(row => row.draft.text === first)!.id;
    await page.evaluate(marker => {
        const put = IDBObjectStore.prototype.put; let faults = 0;
        IDBObjectStore.prototype.put = function (...args: Parameters<typeof put>) {
            if (this.name === 'workspace_tab_drafts' && (args[0] as Partial<WorkspaceTabDraftRow>).draft?.text === marker) {
                faults++; throw new DOMException('Synthetic rejected journaled draft save', 'QuotaExceededError');
            }
            return put.apply(this, args);
        };
        (globalThis as unknown as RecoveryProbeWindow).__crashDraftProbe = { get faults() { return faults; } };
    }, pending);
    await input.fill(pending);
    await expect(page.getByText('Draft could not be saved', { exact: true })).toBeVisible({ timeout: 10_000 });
    const journals = await page.evaluate(() => Object.fromEntries(Object.entries(localStorage).filter(([key]) => key.startsWith('or3:tab-draft-journal:'))));
    expect(Object.values(journals).some(raw => JSON.parse(raw as string).draft?.text === pending)).toBe(true);
    const failedRows = await read(page);
    expect(failedRows.find(row => row.id === rowId)?.draft.text).toBe(first);
    const faults = await page.evaluate(() => (globalThis as unknown as RecoveryProbeWindow).__crashDraftProbe.faults); expect(faults).toBeGreaterThan(0);
    await writeFile(output + '/before-crash.json', JSON.stringify({ before, failedRows, journals, faults, liveText: await input.innerText() }, null, 2));
    await page.screenshot({ path: output + '/before-crash.png' });
    const cdp = await context.newCDPSession(page);
    const crashed = page.waitForEvent('crash', { timeout: 10_000 });
    void cdp.send('Page.crash').catch(() => {});
    await crashed;
    const recoveredPage = await context.newPage(); await recoveredPage.goto('http://127.0.0.1:3127/chat');
    const recoveredInput = recoveredPage.getByRole('textbox', { name: 'Message input' }); await recoveredInput.waitFor({ timeout: 45_000 });
    await expect(recoveredInput).toHaveText(pending, { timeout: 15_000 });
    await expect.poll(async () => (await read(recoveredPage)).find(row => row.id === rowId)?.draft.text).toBe(pending);
    const recovered = await read(recoveredPage);
    expect(recovered.filter(row => row.draft.text === pending).map(row => row.id)).toEqual([rowId]);
    await writeFile(output + '/evidence.json', JSON.stringify({ before, failedRows, journals, faults, recovered,
        liveText: await recoveredInput.innerText(), crash: 'actual Chromium Page.crash with crash event; new page in same isolated browser context',
        boundary: 'journal was acknowledged before renderer failure; IndexedDB still had prior text',
        limitation: 'not an entire browser-process kill, disk corruption, storage-process crash or OS power loss', externalRequests: 'denied' }, null, 2));
    console.log(JSON.stringify({ faults, crashed: true, recovered: await recoveredInput.innerText(), unchangedRowId: rowId }));
} finally { await context.close(); await browser.close(); }
