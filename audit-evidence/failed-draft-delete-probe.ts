/** Mounted composer discard interrupted at native IndexedDB, retained tombstone and explicit repair. */
import { chromium, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import type { WorkspaceTabDraftRow } from '../app/db/client';
import type { RecoveryProbeWindow } from './probe-types';
const output = process.env.OR3_DELETE_DRAFT_OUTPUT ?? '/workspace/or3-chat/test-results/recovery-failed-draft-delete';
await mkdir(output, { recursive: true });
const browser = await chromium.launch(); const context = await browser.newContext();
await context.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort('blockedbyclient'));
try {
    const page = await context.newPage(); await page.goto('http://127.0.0.1:3127/chat');
    const input = page.getByRole('textbox', { name: 'Message input' }); await input.waitFor({ timeout: 45_000 });
    const marker = 'Synthetic draft explicitly cleared before a rejected delete';
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
    await input.fill(marker); await expect.poll(async () => (await read()).map(row => row.draft.text)).toContain(marker);
    const before = await read(); const rowId = before.find(row => row.draft.text === marker)!.id;
    const install = (id: string) => {
        const remove = IDBObjectStore.prototype.delete; let faults = 0;
        IDBObjectStore.prototype.delete = function (...args: Parameters<typeof remove>) {
            if (this.name === 'workspace_tab_drafts' && args[0] === id && !sessionStorage.getItem('draft-delete-repaired')) {
                faults++; throw new DOMException('Synthetic rejected draft discard', 'QuotaExceededError');
            }
            return remove.apply(this, args);
        };
        (globalThis as unknown as RecoveryProbeWindow).__deleteDraftProbe = { get faults() { return faults; } };
    };
    await page.evaluate(install, rowId); await page.addInitScript(install, rowId);
    await input.fill(''); await expect(input).toHaveText('');
    await expect.poll(() => page.evaluate(() => (globalThis as unknown as RecoveryProbeWindow).__deleteDraftProbe.faults)).toBeGreaterThan(0);
    await expect(page.getByText('Draft could not be saved', { exact: true })).toBeVisible();
    const failed = { rows: await read(), journals: await page.evaluate(() => Object.fromEntries(Object.entries(localStorage).filter(([key]) => key.startsWith('or3:tab-draft-journal:')))) };
    expect(failed.rows.some(row => row.id === rowId && row.draft.text === marker)).toBe(true);
    expect(Object.values(failed.journals).some(raw => JSON.parse(raw as string).draft === null)).toBe(true);
    await writeFile(output + '/before-refresh.json', JSON.stringify({ before, failed, faults: await page.evaluate(() => (globalThis as unknown as RecoveryProbeWindow).__deleteDraftProbe.faults) }, null, 2));
    const dialogs: string[] = []; page.on('dialog', async dialog => { dialogs.push(dialog.type()); await dialog.accept(); });
    await page.reload(); await input.waitFor({ timeout: 45_000 }); await expect(input).toHaveText('');
    await expect.poll(() => page.evaluate(() => (globalThis as unknown as RecoveryProbeWindow).__deleteDraftProbe.faults)).toBeGreaterThan(0);
    const stillRejected = await read(); expect(stillRejected.some(row => row.id === rowId)).toBe(true);
    const restoreFailureVisible = await page.getByText('Draft could not be restored', { exact: true }).isVisible();
    const saveFailureVisible = await page.getByText('Draft could not be saved', { exact: true }).isVisible();
    await writeFile(output + '/after-rejected-reload.json', JSON.stringify({ stillRejected, liveText: await input.innerText(), restoreFailureVisible, saveFailureVisible }, null, 2));
    await page.screenshot({ path: output + '/rejected-reload.png' });
    await page.evaluate(() => sessionStorage.setItem('draft-delete-repaired', '1'));
    const retryLabel = restoreFailureVisible ? 'Retry restore' : 'Retry';
    const retry = page.getByRole('button', { name: retryLabel, exact: true });
    try { await retry.click({ timeout: 5_000 }); }
    catch { await expect.poll(async () => (await read()).some(row => row.id === rowId)).toBe(false); }
    await expect.poll(async () => (await read()).some(row => row.id === rowId)).toBe(false);
    const repaired = await read();
    await page.reload(); await input.waitFor({ timeout: 45_000 }); await expect(input).toHaveText('');
    const final = await read(); expect(final.some(row => row.id === rowId)).toBe(false);
    await writeFile(output + '/evidence.json', JSON.stringify({ before, failed, stillRejected, restoreFailureVisible, saveFailureVisible, retryLabel, repaired, final, dialogs, liveText: await input.innerText(),
        fault: 'native draft delete throws quota until explicit repair; reload explicitly accepted after failure receipt',
        outcome: 'discard tombstone prevents old text from returning; repaired delete stays durable', externalRequests: 'denied' }, null, 2));
    console.log(JSON.stringify({ retainedDeletedRowUntilRepair: true, liveText: await input.innerText(), dialogs, restoreFailureVisible, retryLabel }));
} finally { await context.close(); await browser.close(); }
