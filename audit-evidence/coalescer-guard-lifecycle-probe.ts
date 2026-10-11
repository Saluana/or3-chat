/** Production coalescer in Chromium; real unload dialogs, mocked writes, no provider invocation. */
import { chromium, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import type { RecoveryProbeWindow } from './probe-types';
const output = process.env.OR3_GUARD_LIFECYCLE_OUTPUT ?? '/workspace/or3-chat/test-results/recovery-coalescer-guard-lifecycle';
await mkdir(output, { recursive: true });
const browser = await chromium.launch(); const context = await browser.newContext(); const scripts: string[] = [];
context.on('request', request => { if (request.resourceType() === 'script') scripts.push(request.url()); });
await context.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort('blockedbyclient'));
try {
    const page = await context.newPage();
    await page.route('**/api/__or3-e2e/models*', route => route.fulfill({ json: { data: [], links: { next: null }, total_count: 0 } }));
    await page.goto('http://127.0.0.1:3127/__or3-chat-journey-test');
    const input = page.getByRole('textbox', { name: 'Message input' }); await input.waitFor({ timeout: 45_000 });
    await input.click(); expect(await page.evaluate(() => navigator.userActivation.hasBeenActive)).toBe(true);
    const clientURL = scripts.find(url => /\/db\/client\.ts(?:\?|$)/.test(url));
    const moduleURL = scripts.find(url => /\/streamWriteCoalescer\.ts(?:\?|$)/.test(url))
        ?? clientURL?.replace(/\/db\/client\.ts(?:\?.*)?$/, '/utils/chat/useAi-internal/streamWriteCoalescer.ts');
    expect(moduleURL).toBeTruthy(); expect(new URL(moduleURL!).hostname).toBe('127.0.0.1');
    const state = await page.evaluate(async url => {
        const { createStreamWriteCoalescer } = (await import(url!) as typeof import('../app/utils/chat/useAi-internal/streamWriteCoalescer'));
        const guards: Array<{ op: string; name: string }> = [];
        const add = window.addEventListener.bind(window); const remove = window.removeEventListener.bind(window);
        window.addEventListener = ((type: string, listener: EventListener, options?: boolean | AddEventListenerOptions) => { if (type === 'beforeunload') guards.push({ op: 'add', name: typeof listener === 'function' ? listener.name : 'object' }); return add(type, listener, options); }) as typeof window.addEventListener;
        window.removeEventListener = ((type: string, listener: EventListener, options?: boolean | EventListenerOptions) => { if (type === 'beforeunload') guards.push({ op: 'remove', name: typeof listener === 'function' ? listener.name : 'object' }); return remove(type, listener, options); }) as typeof window.removeEventListener;
        const first = createStreamWriteCoalescer(); const second = createStreamWriteCoalescer(); let lateWrites = 0;
        for (const writer of [first, second]) { writer.markDirty(); await writer.flush(async () => { throw new DOMException('Synthetic rejected write', 'QuotaExceededError'); }).catch(() => {}); }
        await first.dispose(); await first.dispose(); first.markDirty(); await first.flush(async () => { lateWrites++; });
        let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
        let savedText = 'earlier acknowledged prefix';
        const retry = second.flush(async () => { await gate; savedText = 'acknowledged retry snapshot'; });
        await Promise.resolve(); second.markDirty(30); release(); await retry;
        const late = createStreamWriteCoalescer(); late.markDirty(); let reject!: (error: Error) => void;
        const held = new Promise<void>((_resolve, no) => { reject = no; }); const prepared = late.flush(() => held).catch(() => {});
        await Promise.resolve(); const disposal = late.dispose(); reject(new Error('failure after disposal')); await prepared; await disposal;
        (globalThis as unknown as RecoveryProbeWindow).__guardLifecycle = { first, second, guards, lateWrites, savedText };
        return { guards, lateWrites, savedText, newerSuffixDirty: second.hasDirty() };
    }, moduleURL);
    expect(state.lateWrites).toBe(0); expect(state.newerSuffixDirty).toBe(true);
    expect(state.savedText).toBe('acknowledged retry snapshot');
    const dialogs: string[] = []; page.on('dialog', async dialog => { dialogs.push(dialog.type()); await dialog.dismiss(); });
    let blockedNavigation = false;
    try { await page.reload({ timeout: 2_000 }); } catch { blockedNavigation = true; }
    expect(blockedNavigation).toBe(true); expect(dialogs).toEqual(['beforeunload']);
    const repaired = await page.evaluate(async () => {
        const state = (globalThis as unknown as RecoveryProbeWindow).__guardLifecycle;
        await state.second.flush(async () => { state.savedText = 'acknowledged retry snapshot plus newer suffix'; });
        await state.second.dispose();
        return { savedText: state.savedText, guards: state.guards, newerSuffixDirty: state.second.hasDirty(), lateWrites: state.lateWrites };
    });
    expect(repaired.savedText).toBe('acknowledged retry snapshot plus newer suffix'); expect(repaired.newerSuffixDirty).toBe(false);
    expect(repaired.guards.filter((event) => event.op === 'add' && event.name === 'guardFailedUnload')).toHaveLength(2);
    expect(repaired.guards.filter((event) => event.op === 'remove' && event.name === 'guardFailedUnload')).toHaveLength(2);
    await page.reload(); await input.waitFor({ timeout: 45_000 }); expect(dialogs).toEqual(['beforeunload']);
    await writeFile(output + '/evidence.json', JSON.stringify({ state, repaired, dialogs, blockedNavigation,
        evidenceLevel: 'production coalescer in actual Chromium; one real beforeunload dialog; persistence callbacks mocked; mounted stream/IndexedDB not exercised',
        checks: 'independent failed writers; repeated disposal; late deltas/flush ignored; rejection after disposal; retry acknowledges older snapshot while newer suffix remains dirty; final acknowledgement permits actual refresh', externalRequests: 'denied' }, null, 2));
    console.log(JSON.stringify({ dialogs, lateWrites: repaired.lateWrites, guardAdds: 2, guardRemoves: 2, acknowledgedByMockWrite: repaired.savedText }));
} finally { await context.close(); await browser.close(); }
