/** Chromium foreground persistence; local scripted provider only, all external requests denied. */
import { chromium, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
const browser = await chromium.launch();
const context = await browser.newContext();
await context.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort('blockedbyclient'));
const output = process.env.OR3_TERMINAL_SAVE_OUTPUT ?? '/workspace/or3-chat/test-results/recovery-assistant-terminal-save-failure';
await mkdir(output, { recursive: true });
try {
    const page = await context.newPage(); const scripts: string[] = [];
    page.on('request', request => { if (request.resourceType() === 'script') scripts.push(request.url()); });
    await page.route('**/api/__or3-e2e/models*', route => route.fulfill({ json: { data: [], links: { next: null }, total_count: 0 } }));
    await page.goto('http://127.0.0.1:3127/__or3-chat-journey-test');
    const input = page.getByRole('textbox', { name: 'Message input' });
    await input.waitFor({ timeout: 45_000 }); await page.reload(); await input.waitFor({ timeout: 45_000 });
    await page.evaluate(() => {
        const put = IDBObjectStore.prototype.put; const fetch = globalThis.fetch.bind(globalThis);
        let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
        const guardEvents: Array<{ op: string; listener: string; at: number }> = [];
        const add = window.addEventListener.bind(window); const remove = window.removeEventListener.bind(window);
        window.addEventListener = ((type: string, listener: EventListener, options?: boolean | AddEventListenerOptions) => {
            if (type === 'beforeunload') guardEvents.push({ op: 'add', listener: typeof listener === 'function' ? listener.name : 'object', at: Date.now() });
            return add(type, listener, options);
        }) as typeof window.addEventListener;
        window.removeEventListener = ((type: string, listener: EventListener, options?: boolean | EventListenerOptions) => {
            if (type === 'beforeunload') guardEvents.push({ op: 'remove', listener: typeof listener === 'function' ? listener.name : 'object', at: Date.now() });
            return remove(type, listener, options);
        }) as typeof window.removeEventListener;
        const state = { providerCalls: 0, faults: 0, guardEvents, release, repair: () => { IDBObjectStore.prototype.put = put; } };
        IDBObjectStore.prototype.put = function (...args: Parameters<typeof put>) {
            const row = args[0] as { role?: string; data?: { content?: string } };
            if (this.name === 'messages' && row.role === 'assistant' && row.data?.content?.includes(' Ready to recover.')) {
                state.faults++; throw new DOMException('Synthetic transient assistant save quota', 'QuotaExceededError');
            }
            return put.apply(this, args);
        };
        globalThis.fetch = async (input, init) => {
            const url = input instanceof Request ? input.url : String(input);
            const response = await fetch(input, init);
            if (!url.includes('/api/__or3-e2e/chat/completions') || !response.body) return response;
            state.providerCalls++;
            const decoder = new TextDecoder();
            const body = response.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
                async transform(chunk, controller) {
                    if (decoder.decode(chunk).includes(' Ready to recover.')) await gate;
                    controller.enqueue(chunk);
                },
            }));
            return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
        };
        (window as unknown as { assistantSaveProbe: typeof state }).assistantSaveProbe = state;
    });
    await input.fill('journey:refresh'); await page.getByRole('button', { name: 'Send message', exact: true }).click();
    await expect(page.locator('.cm-text-user').getByText('journey:refresh', { exact: true })).toBeVisible();
    const threadId = (await page.getByTestId('chat-journey-thread-id').textContent())!.trim();
    const read = () => page.evaluate(async threadId => {
        const rows: Array<{ id: string; role: string; pending: boolean; thread_id: string; data: { content?: string } }> = [];
        for (const { name } of await indexedDB.databases()) {
            if (!name?.startsWith('or3-db')) continue;
            const db = await new Promise<IDBDatabase>((resolve, reject) => {
                const request = indexedDB.open(name); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
            });
            const saved = await new Promise<typeof rows>((resolve, reject) => {
                const request = db.transaction('messages', 'readonly').objectStore('messages').getAll();
                request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
            });
            rows.push(...saved.filter(row => row.thread_id === threadId)); db.close();
        }
        return rows;
    }, threadId);
    const prefix = 'Partial response before refresh.'; const completePrefix = prefix + ' Ready to recover.';
    await expect.poll(async () => (await read()).find(row => row.role === 'assistant')?.data.content, { timeout: 10_000 }).toBe(prefix);
    const before = await read(); const assistantId = before.find(row => row.role === 'assistant')!.id;
    await page.evaluate(() => (window as unknown as { assistantSaveProbe: { release: () => void } }).assistantSaveProbe.release());
    await expect.poll(() => page.evaluate(() => (window as any).assistantSaveProbe.faults), { timeout: 10_000 }).toBeGreaterThan(0);
    await expect(page.getByRole('button', { name: 'Stop generation', exact: true })).toHaveCount(0, { timeout: 35_000 });
    const terminalRows = await read();
    const terminalUi = await page.evaluate(() => ({
        containsExpandedPrefix: document.body.innerText.includes('Partial response before refresh. Ready to recover.'),
        containsLateSuffix: document.body.innerText.includes('Late response from the old page'),
        saveNotice: document.body.innerText.includes('Response could not be saved locally') || document.body.innerText.includes('Browser storage full') || document.body.innerText.includes('Could not save locally'),
        faults: (window as any).assistantSaveProbe.faults,
        providerCalls: (window as any).assistantSaveProbe.providerCalls,
        guardEvents: (window as any).assistantSaveProbe.guardEvents,
    }));
    const syntheticUnloadBlocked = await page.evaluate(() => {
        const event = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(event); return event.defaultPrevented;
    });
    const protectedDialogs: string[] = [];
    let protectedRefreshBlocked = false;
    if (process.env.OR3_EXPECT_TERMINAL_SAVE_RECOVERY === 'true') {
        const dismiss = async (dialog: import('@playwright/test').Dialog) => { protectedDialogs.push(dialog.type()); await dialog.dismiss(); };
        page.on('dialog', dismiss);
        try { await page.reload({ timeout: 2_000 }); } catch { protectedRefreshBlocked = true; }
        page.off('dialog', dismiss);
        expect(protectedRefreshBlocked).toBe(true); expect(protectedDialogs).toEqual(['beforeunload']);
    }
    let closedOrigin = false;
    if (process.env.OR3_TERMINAL_CLOSE_ORIGIN === 'true') {
        const clientURL = scripts.find(url => /\/db\/client\.ts(?:\?|$)/.test(url)); expect(clientURL).toBeTruthy();
        closedOrigin = await page.evaluate(async url => { const { getDb } = await import(url!); const origin = getDb(); origin.close(); return !origin.isOpen(); }, clientURL);
        expect(closedOrigin).toBe(true);
    }
    await page.evaluate(() => (window as any).assistantSaveProbe.repair());
    let healed = true;
    try { await expect.poll(async () => (await read()).find(row => row.id === assistantId)?.data.content?.includes(completePrefix), { timeout: 5_000 }).toBe(true); }
    catch { healed = false; }
    const afterRepair = await read();
    if (process.env.OR3_EXPECT_TERMINAL_SAVE_RECOVERY === 'true') {
        expect(syntheticUnloadBlocked).toBe(true); expect(terminalUi.saveNotice).toBe(true); expect(healed).toBe(true);
        expect(afterRepair.find(row => row.id === assistantId)?.data.content).toContain('Late response from the old page');
        expect(afterRepair.filter(row => row.role === 'user')).toHaveLength(1);
        expect(terminalUi.providerCalls).toBe(1);
    }
    await writeFile(output + '/before-refresh.json', JSON.stringify({ before, terminalRows, terminalUi, syntheticUnloadBlocked, afterRepair, healed,
        boundary: 'stream ended; all expanded-prefix puts rejected until native persistence repaired; no model retry requested' }, null, 2));
    await page.screenshot({ path: output + '/terminal-state.png' });
    const dialogs: string[] = []; page.on('dialog', async dialog => { dialogs.push(dialog.type()); await dialog.accept(); });
    await page.reload(); await input.waitFor({ timeout: 45_000 });
    const recovered = await read();
    await writeFile(output + '/evidence.json', JSON.stringify({ before, terminalRows, terminalUi, syntheticUnloadBlocked, afterRepair, recovered, healed, dialogs, closedOrigin, protectedDialogs, protectedRefreshBlocked,
        externalRequests: 'denied', provider: 'local deterministic stream', observation: 'terminal local-write retry and refresh; any dialog explicitly accepted after preserving receipts' }, null, 2));
    if (process.env.OR3_EXPECT_TERMINAL_SAVE_RECOVERY === 'true') { expect(dialogs).toEqual([]); expect(recovered.find(row => row.id === assistantId)?.data.content).toBe(afterRepair.find(row => row.id === assistantId)?.data.content); }
    console.log(JSON.stringify({ closedOrigin, protectedDialogs, protectedRefreshBlocked, assistantId, faults: terminalUi.faults, providerCalls: terminalUi.providerCalls, terminalUi, syntheticUnloadBlocked, healed, dialogs,
        latestDurableAfterRepair: afterRepair.find(row => row.id === assistantId)?.data.content,
        latestDurableAfterRefresh: recovered.find(row => row.id === assistantId)?.data.content }));
} finally { await context.close(); await browser.close(); }
