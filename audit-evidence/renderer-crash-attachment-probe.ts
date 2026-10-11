/** Actual Chromium renderer crash after an acknowledged recovery journal but rejected IndexedDB save. */
import { chromium, expect, type Page } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
const output = '/workspace/or3-chat/test-results/recovery-renderer-crash-attachment';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ args: ['--disable-breakpad', '--disable-crash-reporter'] });
const context = await browser.newContext();
const fixture = { name: 'crash-recovery.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN1sAAAAASUVORK5CYII=', 'base64') };
const attachmentBytes = (page: Page) => page.evaluate(async () => {
    const blobs: Array<{ hash: string; bytes: number[] }> = [];
    for (const { name } of await indexedDB.databases()) {
        if (!name?.startsWith('or3-db')) continue;
        const db = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open(name); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
        const rows = await new Promise<any[]>((resolve, reject) => { const request = db.transaction('file_blobs', 'readonly').objectStore('file_blobs').getAll(); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
        for (const row of rows) blobs.push({ hash: row.hash, bytes: Array.from(new Uint8Array(await row.blob.arrayBuffer())) });
        db.close();
    } return blobs;
});
await context.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort('blockedbyclient'));
const read = (page: Page) => page.evaluate(async () => {
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
try {
    const page = await context.newPage(); await page.goto('http://127.0.0.1:3127/chat');
    const input = page.getByRole('textbox', { name: 'Message input' }); await input.waitFor({ timeout: 45_000 });
    const first = 'Synthetic acknowledged draft before renderer crash'; const pending = first + ' — journaled edit with rejected IndexedDB save';
    await input.fill(first); await expect.poll(async () => (await read(page)).map(row => row.draft.text)).toContain(first);
    const before = await read(page); const rowId = before.find(row => row.draft.text === first).id;
    await page.evaluate(marker => {
        const put = IDBObjectStore.prototype.put; let faults = 0;
        IDBObjectStore.prototype.put = function (...args: Parameters<typeof put>) {
            if (this.name === 'workspace_tab_drafts') {
                faults++; throw new DOMException('Synthetic rejected journaled draft save', 'QuotaExceededError');
            }
            return put.apply(this, args);
        };
        (globalThis as any).__crashDraftProbe = { get faults() { return faults; } };
    }, pending);
    await input.fill(pending);
    await expect(page.getByText('Draft could not be saved', { exact: true })).toBeVisible({ timeout: 10_000 });
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Add attachments', exact: true }).click();
    await (await chooser).setFiles(fixture);
    await expect.poll(() => page.evaluate(() => Object.entries(localStorage).filter(([key]) => key.startsWith('or3:tab-draft-journal:')).some(([, raw]) => JSON.parse(raw).draft?.attachments?.length === 1))).toBe(true);
    const committedBlobs = await attachmentBytes(page); expect(committedBlobs).toHaveLength(1);
    expect(committedBlobs[0]!.bytes).toEqual(Array.from(fixture.buffer));
    const journals = await page.evaluate(() => Object.fromEntries(Object.entries(localStorage).filter(([key]) => key.startsWith('or3:tab-draft-journal:'))));
    expect(Object.values(journals).some(raw => JSON.parse(raw as string).draft?.text === pending)).toBe(true);
    const failedRows = await read(page);
    expect(failedRows.find(row => row.id === rowId)?.draft.text).toBe(first);
    expect(failedRows.find(row => row.id === rowId)?.draft.attachments).toHaveLength(0);
    const faults = await page.evaluate(() => (globalThis as any).__crashDraftProbe.faults); expect(faults).toBeGreaterThan(0);
    await writeFile(output + '/before-crash.json', JSON.stringify({ before, failedRows, journals, committedBlobs, faults, liveText: await input.innerText() }, null, 2));
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
    await expect(recoveredPage.getByRole('button', { name: 'Remove image', exact: true })).toBeVisible();
    expect(recovered.find(row => row.id === rowId)?.draft.attachments.map((ref: any) => ref.hash)).toEqual([committedBlobs[0]!.hash]);
    const recoveredBlobs = await attachmentBytes(recoveredPage); expect(recoveredBlobs).toEqual(committedBlobs);
    await writeFile(output + '/evidence.json', JSON.stringify({ before, failedRows, journals, committedBlobs, recoveredBlobs, faults, recovered,
        liveText: await recoveredInput.innerText(), crash: 'actual Chromium Page.crash with crash event; new page in same isolated browser context',
        boundary: 'attachment bytes committed but their draft reference existed only in the acknowledged journal; IndexedDB draft still had prior text and no attachment refs',
        limitation: 'not an entire browser-process kill, disk corruption, storage-process crash or OS power loss', externalRequests: 'denied' }, null, 2));
    console.log(JSON.stringify({ faults, crashed: true, recovered: await recoveredInput.innerText(), unchangedRowId: rowId, recoveredAttachmentBytes: recoveredBlobs[0]!.bytes.length }));
} finally { await context.close(); await browser.close(); }
