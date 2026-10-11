/** Mounted offline/reconnect recovery with a deterministic local response-body error; no real provider. */
import { chromium, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import type { RecoveryProbeWindow } from './probe-types';
const browser = await chromium.launch();
const context = await browser.newContext();
let observedProviderHttpRequests = 0;
context.on('request', request => { if (request.url().includes('/api/__or3-e2e/chat/completions')) observedProviderHttpRequests++; });
await context.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort('blockedbyclient'));
const output = process.env.OR3_OFFLINE_STREAM_OUTPUT ?? '/workspace/or3-chat/test-results/recovery-offline-stream';
await mkdir(output, { recursive: true });
try {
    const page = await context.newPage();
    await page.route('**/api/__or3-e2e/models*', route => route.fulfill({ json: { data: [], links: { next: null }, total_count: 0 } }));
    await page.goto('http://127.0.0.1:3127/__or3-chat-journey-test');
    const input = page.getByRole('textbox', { name: 'Message input' });
    await input.waitFor({ timeout: 45_000 }); await page.reload(); await input.waitFor({ timeout: 45_000 });
    await page.evaluate(() => {
        const fetch = globalThis.fetch.bind(globalThis);
        let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
        const state = { providerCalls: 0, faults: 0, release };
        globalThis.fetch = async (input, init) => {
            const url = input instanceof Request ? input.url : String(input);
            const response = await fetch(input, init);
            if (!url.includes('/api/__or3-e2e/chat/completions') || !response.body) return response;
            state.providerCalls++;
            const decoder = new TextDecoder();
            const body = response.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
                async transform(chunk, controller) {
                    if (decoder.decode(chunk).includes(' Ready to recover.')) {
                        await gate; state.faults++;
                        controller.error(new TypeError('Synthetic offline response-body interruption'));
                        return;
                    }
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
    const prefix = 'Partial response before refresh.';
    await expect.poll(async () => (await read()).find(row => row.role === 'assistant')?.data.content, { timeout: 10_000 }).toBe(prefix);
    const before = await read(); const assistantId = before.find(row => row.role === 'assistant')!.id;
    await context.setOffline(true);
    expect(await page.evaluate(() => navigator.onLine)).toBe(false);
    await page.evaluate(() => (window as unknown as RecoveryProbeWindow).assistantSaveProbe.release());
    await expect.poll(() => page.evaluate(() => (window as unknown as RecoveryProbeWindow).assistantSaveProbe.faults), { timeout: 10_000 }).toBe(1);
    await expect(page.getByRole('button', { name: 'Stop generation', exact: true })).toHaveCount(0, { timeout: 10_000 });
    const offlineRows = await read();
    const offlineUi = await page.evaluate(() => ({ online: navigator.onLine, text: document.body.innerText, providerCalls: (window as unknown as RecoveryProbeWindow).assistantSaveProbe.providerCalls }));
    expect(offlineRows.find(row => row.id === assistantId)?.data.content).toBe(prefix);
    expect(offlineRows.filter(row => row.role === 'user')).toHaveLength(1);
    expect(offlineRows.filter(row => row.role === 'assistant').map(row => row.id)).toEqual([assistantId]);
    await page.screenshot({ path: output + '/offline-state.png' });
    await writeFile(output + '/offline.json', JSON.stringify({ before, offlineRows, offlineUi, observedProviderHttpRequests }, null, 2));
    await context.setOffline(false);
    expect(await page.evaluate(() => navigator.onLine)).toBe(true);
    await page.reload(); await input.waitFor({ timeout: 45_000 });
    await expect(page.getByText(prefix, { exact: true })).toBeVisible({ timeout: 30_000 });
    const recovered = await read();
    expect(recovered.find(row => row.id === assistantId)?.data.content).toBe(prefix);
    expect(recovered.filter(row => row.role === 'user')).toHaveLength(1);
    expect(recovered.filter(row => row.role === 'assistant').map(row => row.id)).toEqual([assistantId]);
    expect(offlineUi.providerCalls).toBe(1);
    expect(observedProviderHttpRequests).toBe(0);
    await writeFile(output + '/evidence.json', JSON.stringify({ before, offlineRows, offlineUi, recovered, observedProviderHttpRequests,
        fault: 'Chromium offline mode plus deterministic TypeError in the gated local Response body; native storage remains available',
        evidenceLevel: 'mounted Chromium UI and native IndexedDB; provider interruption is synthetic, not proof that offline mode alone closes an existing socket',
        externalRequests: 'denied', provider: 'one local scripted fetch invocation resolved by the in-browser journey fixture; zero provider HTTP requests observed' }, null, 2));
    console.log(JSON.stringify({ assistantId, observedProviderHttpRequests, providerCalls: offlineUi.providerCalls, offline: !offlineUi.online, recoveredPrefix: prefix }));

} finally { await context.close(); await browser.close(); }
