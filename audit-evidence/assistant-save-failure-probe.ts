/** Chromium foreground persistence; local scripted provider only, all external requests denied. */
import { chromium, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
const browser = await chromium.launch();
const context = await browser.newContext();
await context.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort('blockedbyclient'));
const output = '/workspace/or3-chat/test-results/recovery-assistant-save-failure';
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
        const state = { providerCalls: 0, faults: 0, release };
        IDBObjectStore.prototype.put = function (...args: Parameters<typeof put>) {
            const row = args[0] as { role?: string; data?: { content?: string } };
            if (this.name === 'messages' && row.role === 'assistant' && row.data?.content?.includes(' Ready to recover.') && state.faults === 0) {
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
    await expect.poll(() => page.evaluate(() => (window as unknown as { assistantSaveProbe: { faults: number } }).assistantSaveProbe.faults), { timeout: 10_000 }).toBe(1);
    await expect(page.getByText(/^(Browser storage full|Could not save locally)$/).first()).toBeVisible();
    await page.screenshot({ path: output + '/assistant-save-visible.png' });
    await expect.poll(async () => (await read()).find(row => row.id === assistantId)?.data.content, { timeout: 5_000 }).toBe(completePrefix);
    const healed = await read(); const state = await page.evaluate(() => {
        const state = (window as unknown as { assistantSaveProbe: { faults: number; providerCalls: number } }).assistantSaveProbe;
        return { faults: state.faults, providerCalls: state.providerCalls };
    });
    expect(healed.filter(row => row.role === 'user')).toHaveLength(1);
    expect(healed.filter(row => row.role === 'assistant').map(row => row.id)).toEqual([assistantId]);
    expect(state).toEqual({ faults: 1, providerCalls: 1 });
    await page.reload(); await expect(page.getByText(completePrefix, { exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('button', { name: 'Continue generation', exact: true }).last()).toBeVisible({ timeout: 35_000 });
    await expect(page.getByText(/Late response from the old page/)).toHaveCount(0);
    const recovered = await read(); expect(recovered.find(row => row.id === assistantId)?.data.content).toBe(completePrefix);
    expect(recovered.filter(row => row.role === 'user')).toHaveLength(1);
    const evidence = { before, healed, recovered, ...state, externalRequests: 'denied', provider: 'local deterministic stream', fault: 'one native assistant message put quota after a gated durable prefix' };
    await writeFile(output + '/evidence.json', JSON.stringify(evidence, null, 2));
    console.log(JSON.stringify({ assistantId, faults: state.faults, providerCalls: state.providerCalls, recoveredContent: completePrefix, visibleSaveFailure: true }));
} finally { await context.close(); await browser.close(); }
