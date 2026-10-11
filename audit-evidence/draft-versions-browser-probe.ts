/** Mounted composers + native IDB commits, duplicated session hint, isolated profile; external requests denied. */
import { chromium, expect, type Page } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
const output = process.env.OR3_DRAFT_VERSIONS_OUTPUT ?? '/workspace/or3-chat/test-results/recovery-draft-versions-browser';
await mkdir(output, { recursive: true });
const browser = await chromium.launch(); const context = await browser.newContext();
await context.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort('blockedbyclient'));
const scripts = new Map<Page, string[]>();
function track(page: Page) { scripts.set(page, []); page.on('request', request => { if (request.resourceType() === 'script') scripts.get(page)!.push(request.url()); }); }
function moduleURL(page: Page, name: string) { const found = scripts.get(page)!.find(url => url.includes(name)); if (!found) throw new Error(`Loaded production module missing: ${name}`); return found; }
const input = (page: Page) => page.getByRole('textbox', { name: 'Message input' });
async function open(page: Page) { await page.goto('http://127.0.0.1:3127/chat'); await input(page).waitFor({ timeout: 60_000 }); }
async function snapshot(page: Page) {
    return page.evaluate(async url => {
        const { getDb } = await import(url); const name = getDb().name;
        const db = await new Promise<IDBDatabase>((resolve, reject) => { const r = indexedDB.open(name); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
        try {
            const read = (table: string) => new Promise<any[]>((resolve, reject) => { const tx = db.transaction(table, 'readonly'); const r = tx.objectStore(table).getAll(); let rows: any[]; r.onsuccess = () => { rows = r.result; }; tx.oncomplete = () => resolve(rows); tx.onerror = () => reject(tx.error); });
            return { name, version: db.version, canonical: await read('workspace_tab_drafts'), versions: await read('workspace_draft_versions') };
        } finally { db.close(); }
    }, moduleURL(page, '/db/client.ts'));
}
async function flush(page: Page) {
    // Mounted lifecycle captures the actual editor immediately, outside the debounce.
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide')));
    await page.evaluate(async url => { const module = await import(url); await module.flushWorkspaceTabDrafts(); }, moduleURL(page, '/composables/core/useWorkspaceTabDrafts.ts'));
}
async function set(page: Page, text: string) { await input(page).fill(text); await flush(page); await expect.poll(async () => (await snapshot(page)).versions.some(row => row.kind === 'version' && row.draft?.text === text), { timeout: 15_000 }).toBe(true); }
async function writer(page: Page) { return page.evaluate(async url => (await import(url)).useWorkspaceTabDrafts().writerId, moduleURL(page, '/composables/core/useWorkspaceTabDrafts.ts')); }
try {
    const a = await context.newPage(); track(a); await open(a);
    await set(a, 'Synthetic duplicated-tab baseline');
    const hint = await a.evaluate(() => Object.fromEntries(Object.entries(sessionStorage)));
    const writerA = await writer(a);
    const b = await context.newPage(); track(b);
    await b.addInitScript(values => { if (sessionStorage.getItem('or3:synthetic-cloned-hint')) return; for (const [key, value] of Object.entries(values)) sessionStorage.setItem(key, value); sessionStorage.setItem('or3:synthetic-cloned-hint', 'once'); }, hint);
    await open(b); await expect(input(b)).toHaveText('Synthetic duplicated-tab baseline');
    const writerB = await writer(b); expect(writerA).not.toBe(writerB);
    await set(a, 'Synthetic page A independent draft'); await set(b, 'Synthetic page B independent draft');
    const diverged = await snapshot(a);
    expect(diverged.versions.some(row => row.kind === 'version' && row.writer_id === writerA && row.draft?.text === 'Synthetic page A independent draft')).toBe(true);
    expect(diverged.versions.some(row => row.kind === 'version' && row.writer_id === writerB && row.draft?.text === 'Synthetic page B independent draft')).toBe(true);
    await writeFile(output + '/diverged-native.json', JSON.stringify(diverged, null, 2));
    await a.reload(); await input(a).waitFor({ timeout: 60_000 }); await expect(input(a)).toHaveText('Synthetic page A independent draft');
    await b.reload(); await input(b).waitFor({ timeout: 60_000 }); await expect(input(b)).toHaveText('Synthetic page B independent draft');
    const ownRefresh = { a: await input(a).textContent(), b: await input(b).textContent() };
    const storageFill = await a.evaluate(() => {
        let entries = 0; let quotaRejected = false;
        for (let i = 0; i < 84; i++) { try { localStorage.setItem(`or3:synthetic-fill:${i}`, 'q'.repeat(65_536)); entries++; } catch { quotaRejected = true; break; } }
        return { entries, quotaRejected, approximateCharacters: entries * 65_536 };
    });
    expect(storageFill.quotaRejected).toBe(true);
    await set(b, 'Synthetic B saved while localStorage is full');
    await expect(a.getByTestId('draft-saved-versions').getByText('Synthetic B saved while localStorage is full', { exact: true })).toHaveCount(1);
    await a.evaluate(() => { for (const key of Object.keys(localStorage)) if (key.startsWith('or3:synthetic-fill:')) localStorage.removeItem(key); });
    await set(b, 'Synthetic page B independent draft');
    const chooser = a.getByTestId('draft-saved-versions'); await chooser.locator('summary').click();
    const savedB = chooser.getByRole('listitem').filter({ hasText: 'Synthetic page B independent draft' }).first();
    await savedB.getByRole('button', { name: 'Restore this version', exact: true }).click();
    await expect(input(a)).toHaveText('Synthetic page B independent draft');
    await expect.poll(async () => (await snapshot(a)).versions.some(row => row.kind === 'version' && row.draft?.text === 'Synthetic page A independent draft')).toBe(true);
    const afterSelection = await snapshot(a);
    // Two current pages submit concurrently, then one clears while the other survives.
    await Promise.all([input(a).fill('Synthetic concurrent A survives discard'), input(b).fill('Synthetic concurrent B before discard')]);
    await Promise.all([flush(a), flush(b)]);
    await expect.poll(async () => { const rows = (await snapshot(a)).versions; return ['Synthetic concurrent A survives discard', 'Synthetic concurrent B before discard'].every(text => rows.some(row => row.kind === 'version' && row.draft?.text === text)); }, { timeout: 15_000 }).toBe(true);
    await input(b).fill(''); await flush(b);
    const currentB = await writer(b);
    await expect.poll(async () => (await snapshot(b)).versions.some(row => row.kind === 'version' && row.writer_id === currentB && row.draft === null)).toBe(true);
    await a.reload(); await input(a).waitFor({ timeout: 60_000 }); await expect(input(a)).toHaveText('Synthetic concurrent A survives discard');
    await b.reload(); await input(b).waitFor({ timeout: 60_000 }); await expect(input(b)).toHaveText('');
    const afterDiscardAndRefresh = await snapshot(a);
    await writeFile(output + '/evidence.json', JSON.stringify({ writerA, writerB, duplicatedHintDistinctWriters: true, diverged, ownRefresh, storageFill, afterSelection, afterDiscardAndRefresh,
        checks: ['native per-page commits', 'duplicated session hint creates fresh writer', 'both own drafts survive actual refresh', 'post-commit cross-page chooser updates with physically full localStorage', 'mounted explicit selection preserves replaced buffer', 'concurrent set/set then set/discard survives own refresh'], externalRequests: 'denied', evidenceLevel: 'actual Chromium mounted composers and native IndexedDB transaction completion' }, null, 2));
    console.log(JSON.stringify({ duplicatedHintDistinctWriters: true, ownRefresh, version: diverged.version, retainedVersions: afterDiscardAndRefresh.versions.filter(row => row.kind === 'version').length, concurrentDiscardPreservedA: true }));
} finally { await context.close(); await browser.close(); }
