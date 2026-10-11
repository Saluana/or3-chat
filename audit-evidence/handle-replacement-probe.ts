/** Actual Chromium IndexedDB/composable probe; bypasses UI, with synthetic scopes. */
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

const browser = await chromium.launch();
const context = await browser.newContext();
const scriptURLs: string[] = [];
context.on('request', request => {
    if (request.resourceType() === 'script') scriptURLs.push(request.url());
});
await context.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1'
    ? route.continue() : route.abort('blockedbyclient'));
try {
    const page = await context.newPage();
    await page.goto('http://127.0.0.1:3127/chat');
    await page.getByRole('textbox', { name: 'Message input' }).waitFor({ timeout: 60_000 });
    const moduleURLs = { client: scriptURLs.find(url => /\/db\/client\.ts(?:\?|$)/.test(url)),
        drafts: scriptURLs.find(url => /useWorkspaceTabDrafts\.ts(?:\?|$)/.test(url)) };
    if (!moduleURLs.client || !moduleURLs.drafts) throw new Error(`Loaded Vite module URLs unavailable: ${JSON.stringify(scriptURLs.filter(url => /client|WorkspaceTabDrafts/.test(url)).map(url => new URL(url).pathname))}`);
    const evidence = await page.evaluate(async (urls) => {
        const client = (await import(urls.client!) as typeof import('../app/db/client'));
        const module = (await import(urls.drafts!) as typeof import('../app/composables/core/useWorkspaceTabDrafts'));
        const drafts = module.useWorkspaceTabDrafts();
        const original = client.setActiveWorkspaceDb('synthetic-recovery-origin');
        await original.open();
        const owner = drafts.scope();
        const put = IDBObjectStore.prototype.put;
        IDBObjectStore.prototype.put = function (...args: Parameters<typeof put>) {
            if (this.name === 'workspace_tab_drafts' && (args[0] as { tab_id?: string }).tab_id === 'recovery-handle-tab') {
                throw new DOMException('Synthetic retained-draft quota', 'QuotaExceededError');
            }
            return put.apply(this, args);
        };
        const buffer = (text: string) => ({ version: 1 as const, text, attachments: [], largeTextBlocks: [], updatedAt: Date.now() });
        drafts.write('recovery-handle-tab', buffer('Synthetic retained handle buffer'), owner);
        await drafts.flush();
        const failureBefore = drafts.saveFailed.value;
        IDBObjectStore.prototype.put = put;
        const other = client.setActiveWorkspaceDb('synthetic-recovery-other');
        await other.open();
        client.evictWorkspaceDb('synthetic-recovery-origin');
        const originalClosed = !original.isOpen();
        const replacement = client.setActiveWorkspaceDb('synthetic-recovery-origin');
        await replacement.open();
        const loaded = await drafts.load('recovery-handle-tab');
        await drafts.flush();
        const failureAfter = drafts.saveFailed.value;
        const saved = await replacement.workspace_tab_drafts.get(`${owner.accountKey}\u0000recovery-handle-tab`);
        client.setActiveWorkspaceDb('synthetic-recovery-other');
        drafts.write('recovery-handle-tab', buffer('Synthetic late callback retains origin'), owner);
        await drafts.flush();
        const late = await replacement.workspace_tab_drafts.get(`${owner.accountKey}\u0000recovery-handle-tab`);
        const otherRows = await other.workspace_tab_drafts.count();
        return { failureBefore, failureAfter, originalClosed, distinctReplacement: original !== replacement,
            loaded: loaded?.text, recovered: saved?.draft.text, lateRecovered: late?.draft.text, otherRows,
            closedHandleReopened: original.isOpen(), evidenceLevel: 'actual Chromium IndexedDB and production composable; UI bypassed' };
    }, moduleURLs);
    if (!evidence.failureBefore || evidence.failureAfter || !evidence.originalClosed || !evidence.distinctReplacement
        || evidence.recovered !== 'Synthetic retained handle buffer'
        || evidence.lateRecovered !== 'Synthetic late callback retains origin'
        || evidence.otherRows !== 0 || evidence.closedHandleReopened) throw new Error(`Unexpected recovery: ${JSON.stringify(evidence)}`);
    await mkdir('test-results/recovery-handle-replacement', { recursive: true });
    await writeFile('test-results/recovery-handle-replacement/evidence.json', JSON.stringify(evidence, null, 2));
    console.log(JSON.stringify(evidence));
} finally {
    await context.close();
    await browser.close();
}
