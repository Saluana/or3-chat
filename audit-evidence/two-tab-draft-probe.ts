/** Characterization probe, not a contract test: reports both competing buffers. */
import { chromium, type Page } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

const browser = await chromium.launch();
const context = await browser.newContext();
await context.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1'
    ? route.continue() : route.abort('blockedbyclient'));
const first = await context.newPage();
const baseURL = 'http://127.0.0.1:3127';
const input = (page: Page) => page.getByRole('textbox', { name: 'Message input' });
async function rows(page: Page) {
    return page.evaluate(async () => {
        const result: Array<{ tab: string; text: string }> = [];
        for (const { name } of await indexedDB.databases()) {
            if (!name) continue;
            const db = await new Promise<IDBDatabase>((resolve, reject) => {
                const request = indexedDB.open(name);
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error);
            });
            if (db.objectStoreNames.contains('workspace_tab_drafts')) {
                const saved = await new Promise<Array<{ tab_id: string; draft: { text: string } }>>((resolve, reject) => {
                    const request = db.transaction('workspace_tab_drafts').objectStore('workspace_tab_drafts').getAll();
                    request.onsuccess = () => resolve(request.result);
                    request.onerror = () => reject(request.error);
                });
                result.push(...saved.map(row => ({ tab: row.tab_id, text: row.draft.text })));
            }
            db.close();
        }
        return result;
    });
}
async function waitForText(page: Page, text: string) {
    await page.waitForFunction(async ({ text }) => {
        for (const { name } of await indexedDB.databases()) {
            if (!name) continue;
            const db = await new Promise<IDBDatabase>(resolve => {
                const request = indexedDB.open(name);
                request.onsuccess = () => resolve(request.result);
            });
            if (!db.objectStoreNames.contains('workspace_tab_drafts')) { db.close(); continue; }
            const found = await new Promise<boolean>(resolve => {
                const request = db.transaction('workspace_tab_drafts').objectStore('workspace_tab_drafts').getAll();
                request.onsuccess = () => resolve(request.result.some(row => row.draft.text === text));
            });
            db.close();
            if (found) return true;
        }
        return false;
    }, { text }, { timeout: 10_000 });
}
try {
    await first.goto(`${baseURL}/chat`);
    await input(first).waitFor({ timeout: 60_000 });
    await input(first).fill('Synthetic shared tab baseline');
    await waitForText(first, 'Synthetic shared tab baseline');
    const second = await context.newPage();
    await second.goto(`${baseURL}/chat`);
    await input(second).waitFor({ timeout: 60_000 });
    await input(second).filter({ hasText: 'Synthetic shared tab baseline' }).waitFor();
    await input(first).fill('Synthetic first browser buffer');
    await waitForText(first, 'Synthetic first browser buffer');
    const afterFirstSave = await rows(first);
    await input(second).fill('Synthetic competing browser buffer');
    await waitForText(second, 'Synthetic competing browser buffer');
    const afterSecondSave = await rows(second);
    const liveBuffers = { first: await input(first).textContent(), second: await input(second).textContent() };
    const failureNoticeVisible = await second.getByText('Draft could not be saved', { exact: true }).isVisible();
    await first.reload();
    await input(first).waitFor({ timeout: 60_000 });
    const afterFirstRefresh = await input(first).textContent();
    const evidence = { afterFirstSave, afterSecondSave, liveBuffers, failureNoticeVisible, afterFirstRefresh,
        lostEarlierBufferOnRefresh: afterFirstRefresh !== liveBuffers.first };
    await mkdir('test-results/recovery-two-tab-drafts', { recursive: true });
    await writeFile('test-results/recovery-two-tab-drafts/evidence.json', JSON.stringify(evidence, null, 2));
    console.log(JSON.stringify(evidence));
} finally {
    await context.close();
    await browser.close();
}
