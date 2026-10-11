/** Chromium foreground persistence; local scripted provider only, all external requests denied. */
import { chromium, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import type { RecoveryProbeWindow } from './probe-types';
const browser = await chromium.launch();
const context = await browser.newContext();
await context.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort('blockedbyclient'));
const output = process.env.OR3_ASSISTANT_PERSISTENT_OUTPUT ?? '/workspace/or3-chat/test-results/recovery-assistant-persistent-save-failure';
await mkdir(output, { recursive: true });
try {
    const page = await context.newPage();
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
    await expect.poll(() => page.evaluate(() => (window as unknown as RecoveryProbeWindow).assistantSaveProbe.faults), { timeout: 10_000 }).toBeGreaterThan(0);
    await expect(page.getByText(completePrefix, { exact: true })).toBeVisible();
    await expect(page.getByText(/^(Browser storage full|Could not save locally)$/).first()).toBeVisible();
    const beforeReload = await read();
    const state = await page.evaluate(() => ({ faults: (window as unknown as RecoveryProbeWindow).assistantSaveProbe.faults, providerCalls: (window as unknown as RecoveryProbeWindow).assistantSaveProbe.providerCalls, guardEvents: (window as unknown as RecoveryProbeWindow).assistantSaveProbe.guardEvents,
        stopVisible: Array.from(document.querySelectorAll('button')).some(button => button.getAttribute('aria-label') === 'Stop generation') }));
    const dialogs: string[] = []; page.on('dialog', async dialog => { dialogs.push(dialog.type()); await dialog.dismiss(); });
    let reloadError: string | undefined; await page.reload({ timeout: 2_000 }).catch(error => { reloadError = String(error); });
    const held = dialogs.includes('beforeunload') ? await page.evaluate(() => ({ faults: (window as unknown as RecoveryProbeWindow).assistantSaveProbe.faults,
        providerCalls: (window as unknown as RecoveryProbeWindow).assistantSaveProbe.providerCalls, guardEvents: (window as unknown as RecoveryProbeWindow).assistantSaveProbe.guardEvents })) : undefined;
    let healedGuardEvents: unknown[] | undefined;
    if (dialogs.includes('beforeunload')) {
        await page.evaluate(() => (window as unknown as RecoveryProbeWindow).assistantSaveProbe.repair());
        await expect.poll(async () => (await read()).find(row => row.id === assistantId)?.data.content, { timeout: 5_000 }).toBe(completePrefix);
        await expect.poll(() => page.evaluate(() => (window as unknown as RecoveryProbeWindow).assistantSaveProbe.guardEvents.some((event) => event.op === 'remove' && event.listener === 'guardFailedUnload'))).toBe(true);
        healedGuardEvents = await page.evaluate(() => (window as unknown as RecoveryProbeWindow).assistantSaveProbe.guardEvents);
        await page.reload();
        await expect(page.getByText(completePrefix, { exact: true })).toBeVisible({ timeout: 30_000 });
    } else {
        await expect(page.getByText(prefix, { exact: true })).toBeVisible({ timeout: 30_000 });
    }
    const recovered = await read();
    const evidence = { before, beforeReload, recovered, dialogs, reloadError, ...state, held, healedGuardEvents,
        latestDisplayed: completePrefix, latestDurableBeforeReload: beforeReload.find(row => row.id === assistantId)?.data.content,
        latestDurableAfterReload: recovered.find(row => row.id === assistantId)?.data.content,
        externalRequests: 'denied', provider: 'local deterministic stream', fault: 'all native assistant message puts containing the expanded prefix rejected until reload or explicit repair' };
    await writeFile(output + '/evidence.json', JSON.stringify(evidence, null, 2));
    await page.screenshot({ path: output + '/after-refresh.png' });
    console.log(JSON.stringify({ assistantId, ...state, dialogs, latestDisplayed: completePrefix,
        latestDurableAfterReload: evidence.latestDurableAfterReload, reloadError }));
    if (process.env.OR3_EXPECT_ASSISTANT_FAILED_SAVE_GUARD === 'true') {
        expect(dialogs).toEqual(['beforeunload']); expect(evidence.latestDurableAfterReload).toBe(completePrefix);
        expect(held?.faults).toBeGreaterThan(1);
        expect(recovered.filter(row => row.role === 'user')).toHaveLength(1);
        expect(recovered.filter(row => row.role === 'assistant').map(row => row.id)).toEqual([assistantId]);
        expect(state.providerCalls).toBe(1);
    }
} finally { await context.close(); await browser.close(); }
