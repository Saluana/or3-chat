/** Chromium IndexedDB + production draft composable; composer UI bypassed. */
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import type { WorkspaceTabDraftRow } from '../app/db/client';
const browser = await chromium.launch();
const context = await browser.newContext();
const scripts: string[] = [];
context.on('request', request => { if (request.resourceType() === 'script') scripts.push(request.url()); });
await context.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort('blockedbyclient'));
try {
    const page = await context.newPage();
    await page.goto('http://127.0.0.1:3127/chat');
    await page.getByRole('textbox', { name: 'Message input' }).waitFor({ timeout: 60_000 });
    const urls = { client: scripts.find(url => /\/db\/client\.ts(?:\?|$)/.test(url)),
        drafts: scripts.find(url => /useWorkspaceTabDrafts\.ts(?:\?|$)/.test(url)) };
    if (!urls.client || !urls.drafts) throw new Error('Loaded production modules unavailable');
    const evidence = await page.evaluate(async urls => {
        const client = (await import(urls.client!) as typeof import('../app/db/client')); const module = (await import(urls.drafts!) as typeof import('../app/composables/core/useWorkspaceTabDrafts'));
        const drafts = module.useWorkspaceTabDrafts(); const table = client.getDb().workspace_tab_drafts;
        const put = table.put.bind(table); const tabId = 'synthetic-same-tab-save-ack';
        let completeOlder: (() => void) | undefined;
        table.put = ((row: WorkspaceTabDraftRow) => {
            if (row.tab_id !== tabId) return put(row);
            if (row.draft.text === 'Older accepted synthetic buffer') {
                return put(row).then((id: string) => new Promise<string>(resolve => { completeOlder = () => resolve(id); }));
            }
            return Promise.reject(new DOMException('Synthetic latest-edit quota', 'QuotaExceededError'));
        }) as typeof table.put;
        const buffer = (text: string) => ({ version: 1 as const, text, attachments: [], largeTextBlocks: [], updatedAt: Date.now() });
        drafts.write(tabId, buffer('Older accepted synthetic buffer'));
        const older = drafts.flush();
        for (let attempt = 0; !completeOlder && attempt < 200; attempt++) await new Promise(resolve => setTimeout(resolve, 10));
        if (!completeOlder) throw new Error('Older native IndexedDB commit did not reach the receipt gate');
        const latest = 'Synthetic latest buffer beyond journal size '.repeat(3_000);
        drafts.write(tabId, buffer(latest)); await drafts.flush();
        const failedBeforeOlderReceipt = drafts.saveFailed.value;
        completeOlder(); await older;
        const failedAfterOlderReceipt = drafts.saveFailed.value;
        const before = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(before);
        const scope = drafts.scope(); const savedOlder = await table.get(`${scope.accountKey}\u0000${tabId}`);
        const liveLatestRetained = drafts.read(tabId)?.text === latest;
        table.put = put; await drafts.flush();
        const savedLatest = await table.get(`${scope.accountKey}\u0000${tabId}`);
        const after = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(after);
        const result = { failedBeforeOlderReceipt, failedAfterOlderReceipt, beforeUnloadProtected: before.defaultPrevented,
            oldRowRetained: savedOlder?.draft.text === 'Older accepted synthetic buffer', liveLatestRetained,
            latestChars: latest.length, repairedFailure: drafts.saveFailed.value,
            latestSaved: savedLatest?.draft.text === latest, confirmationClearedAfterRetry: !after.defaultPrevented,
            evidenceLevel: 'actual Chromium IndexedDB + production composable and synthetic beforeunload event; composer UI bypassed; deferred Dexie receipt, quota mocked; external requests denied' };
        drafts.discard(tabId); await drafts.flush(); return result;
    }, urls);
    if (!evidence.failedBeforeOlderReceipt || !evidence.failedAfterOlderReceipt || !evidence.beforeUnloadProtected ||
        !evidence.oldRowRetained || !evidence.liveLatestRetained || evidence.repairedFailure || !evidence.latestSaved ||
        !evidence.confirmationClearedAfterRetry) throw new Error(`Unexpected receipt state: ${JSON.stringify(evidence)}`);
    await mkdir('test-results/recovery-same-tab-ack', { recursive: true });
    await writeFile('test-results/recovery-same-tab-ack/evidence.json', JSON.stringify(evidence, null, 2));
    console.log(JSON.stringify(evidence));
} finally { await context.close(); await browser.close(); }
