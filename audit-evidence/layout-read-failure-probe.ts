/** Native storage receipts when the first layout read fails but writes still work. */
import { chromium, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import type { WorkspaceTabDraftRow } from '../app/db/client';
import type { RecoveryProbeWindow } from './probe-types';
const output = process.env.OR3_LAYOUT_READ_OUTPUT ?? '/workspace/or3-chat/test-results/recovery-layout-read-failure'; await mkdir(output, { recursive: true });
const browser = await chromium.launch(); const context = await browser.newContext();
await context.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort('blockedbyclient'));
try {
    const page = await context.newPage(); await page.goto('http://127.0.0.1:3127/chat');
    const input = page.getByRole('textbox', { name: 'Message input' }); await input.waitFor({ timeout: 45_000 });
    const marker = 'Synthetic draft retained through unavailable layout read'; await input.fill(marker);
    const read = () => page.evaluate(async () => {
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
    await expect.poll(async () => (await read()).map(row => row.draft.text)).toContain(marker);
    await expect.poll(() => page.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith('or3:workspace-tabs:v1:')).length)).toBeGreaterThan(0);
    const before = await page.evaluate(() => Object.fromEntries(Object.entries(localStorage).filter(([key]) => key.startsWith('or3:workspace-tabs:v1:'))));
    await page.addInitScript(() => {
        const originalGet = Storage.prototype.getItem; const originalSet = Storage.prototype.setItem;
        const observations: Array<{ op: string; key: string; value?: string | null }> = []; let faults = 0;
        Storage.prototype.getItem = function (key) {
            if (key.startsWith('or3:workspace-tabs:v1:') && !key.endsWith(':corrupt') && !sessionStorage.getItem('layout-read-fault-used')) {
                sessionStorage.setItem('layout-read-fault-used', '1'); faults++;
                observations.push({ op: 'rejected-get', key });
                throw new DOMException('Synthetic unavailable layout read', 'SecurityError');
            }
            const value = originalGet.call(this, key);
            if (key.startsWith('or3:workspace-tabs:v1:')) observations.push({ op: 'get', key, value });
            return value;
        };
        Storage.prototype.setItem = function (key, value) { const result = originalSet.call(this, key, value); if (key.startsWith('or3:workspace-tabs:v1:')) observations.push({ op: 'set', key, value }); return result; };
        (globalThis as unknown as RecoveryProbeWindow).__layoutStartupProbe = { observations, get faults() { return faults; } };
    });
    await page.reload(); await input.waitFor({ timeout: 45_000 });
    await expect.poll(() => page.evaluate(() => (globalThis as unknown as RecoveryProbeWindow).__layoutStartupProbe.faults)).toBe(1);
    await page.waitForTimeout(1_000);
    let failure: string | undefined; try { await expect(input).toHaveText(marker, { timeout: 2_000 }); } catch (error) { failure = String(error); }
    const receipt = { before, after: await page.evaluate(() => Object.fromEntries(Object.entries(localStorage).filter(([key]) => key.startsWith('or3:workspace-tabs:v1:')))),
        rows: await read(), liveText: await input.innerText(), failure, probe: await page.evaluate(() => (globalThis as unknown as RecoveryProbeWindow).__layoutStartupProbe),
        fault: 'one native layout getItem throws once; native writes remain available', externalRequests: 'denied' };
    await writeFile(output + '/evidence.json', JSON.stringify(receipt, null, 2)); console.log(JSON.stringify({ liveText: receipt.liveText, failure, faults: receipt.probe.faults }));
    await page.screenshot({ path: output + '/read-failure.png' });
    expect(receipt.probe.faults).toBe(1);
    expect(receipt.rows.some((row) => row.draft.text === marker)).toBe(true);
    const priorIds = Object.values(receipt.before).flatMap((raw) => (JSON.parse(raw) as { tabs: Array<{ id: string }> }).tabs.map((tab) => tab.id));
    const afterIds = Object.values(receipt.after).flatMap((raw) => (JSON.parse(raw) as { tabs: Array<{ id: string }> }).tabs.map((tab) => tab.id));
    expect(afterIds).toEqual(priorIds);
    expect(receipt.probe.observations.filter((row) => row.op === 'set')).toHaveLength(0);
    await expect(page.getByText('Tab layout could not be saved', { exact: true })).toBeVisible();
    const dialogs: string[] = [];
    page.on('dialog', async dialog => { dialogs.push(dialog.type()); await dialog.accept(); });
    await page.reload(); await input.waitFor({ timeout: 45_000 });
    await expect(input).toHaveText(marker, { timeout: 12_000 });
    const recovered = { liveText: await input.innerText(), rows: await read(), dialogs,
        layout: await page.evaluate(() => Object.fromEntries(Object.entries(localStorage).filter(([key]) => key.startsWith('or3:workspace-tabs:v1:')))),
        externalRequests: 'denied', repair: 'next real refresh retries the previously rejected read' };
    await writeFile(output + '/recovered.json', JSON.stringify(recovered, null, 2));
    console.log(JSON.stringify({ recoveredText: recovered.liveText, dialogs }));

} finally { await context.close(); await browser.close(); }
