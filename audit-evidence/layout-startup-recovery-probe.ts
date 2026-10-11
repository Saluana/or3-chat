/** Native storage receipts while a local-only latency fault delays layout restoration. */
import { chromium, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import type { WorkspaceTabDraftRow } from '../app/db/client';
import type { RecoveryProbeWindow } from './probe-types';
const output = process.env.OR3_LAYOUT_STARTUP_OUTPUT ?? '/workspace/or3-chat/test-results/recovery-layout-startup'; await mkdir(output, { recursive: true });
const browser = await chromium.launch(); const context = await browser.newContext();
await context.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort('blockedbyclient'));
try {
    const page = await context.newPage(); await page.goto('http://127.0.0.1:3127/chat');
    const input = page.getByRole('textbox', { name: 'Message input' }); await input.waitFor({ timeout: 45_000 });
    const marker = 'Synthetic draft retained through delayed layout restoration'; await input.fill(marker);
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
        const observations: Array<{ op: string; key: string; value?: string | null }> = [];
        Storage.prototype.getItem = function (key) { const value = originalGet.call(this, key); if (key.startsWith('or3:workspace-tabs:v1:')) observations.push({ op: 'get', key, value }); return value; };
        Storage.prototype.setItem = function (key, value) { const result = originalSet.call(this, key, value); if (key.startsWith('or3:workspace-tabs:v1:')) observations.push({ op: 'set', key, value }); return result; };
        (globalThis as unknown as RecoveryProbeWindow).__layoutStartupProbe = { observations, entered: 0,
            pause: async () => { (globalThis as unknown as RecoveryProbeWindow).__layoutStartupProbe.entered!++; await new Promise(resolve => setTimeout(resolve, 1_000)); } };
    });
    await page.route('**/components/PageShell.vue*', async route => {
        const response = await route.fetch(); const body = await response.text();
        const needle = 'restoredWorkspaceTabs = await workspaceTabs.restore();'; expect(body).toContain(needle);
        await route.fulfill({ response, body: body.replace(needle, 'await globalThis.__layoutStartupProbe.pause();\n' + needle) });
    });
    await page.reload(); await input.waitFor({ timeout: 45_000 });
    let failure: string | undefined; try { await expect(input).toHaveText(marker, { timeout: 12_000 }); } catch (error) { failure = String(error); }
    const receipt = { before, after: await page.evaluate(() => Object.fromEntries(Object.entries(localStorage).filter(([key]) => key.startsWith('or3:workspace-tabs:v1:')))),
        rows: await read(), liveText: await input.innerText(), failure, probe: await page.evaluate(() => (globalThis as unknown as RecoveryProbeWindow).__layoutStartupProbe),
        fault: 'one-second delay at mounted shell before existing layout restore', externalRequests: 'denied' };
    await writeFile(output + '/evidence.json', JSON.stringify(receipt, null, 2)); console.log(JSON.stringify({ liveText: receipt.liveText, failure, entered: receipt.probe.entered }));
    expect(receipt.probe.entered).toBe(1); expect(receipt.liveText).toBe(marker);
} finally { await context.close(); await browser.close(); }
