import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStreamWriteCoalescer } from '../streamWriteCoalescer';

const coalescers: ReturnType<typeof createStreamWriteCoalescer>[] = [];
function create() { const coalescer = createStreamWriteCoalescer(); coalescers.push(coalescer); return coalescer; }
function unloadBlocked() {
    const event = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(event); return event.defaultPrevented;
}
function deferred() { let resolve!: () => void; let reject!: (error: Error) => void; const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }

describe('failed streamed progress durability', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(async () => { for (const coalescer of coalescers.splice(0)) await coalescer.dispose(); vi.useRealTimers(); });

    it('keeps storage-error semantics without browser globals', async () => {
        vi.stubGlobal('window', undefined);
        try {
            const coalescer = create(); coalescer.markDirty();
            await expect(coalescer.flush(async () => { throw new Error('server-side blocked write'); })).rejects.toThrow('server-side blocked write');
            await coalescer.dispose();
        } finally { vi.unstubAllGlobals(); }
    });

    it('protects failed content while retry is pending and releases the guard only after acknowledgement', async () => {
        const coalescer = create(); coalescer.markDirty(100);
        await expect(coalescer.flush(async () => { throw new DOMException('synthetic full storage', 'QuotaExceededError'); })).rejects.toThrow('synthetic full storage');
        expect(unloadBlocked()).toBe(true);
        const gate = deferred(); const retry = coalescer.flush(() => gate.promise); await Promise.resolve();
        expect(unloadBlocked()).toBe(true);
        gate.resolve(); await retry;
        expect(unloadBlocked()).toBe(false);
    });

    it('does not let one successful writer acknowledge another failed writer', async () => {
        const first = create(); const second = create();
        for (const coalescer of [first, second]) {
            coalescer.markDirty(); await coalescer.flush(async () => { throw new Error('blocked'); }).catch(() => {});
        }
        await first.flush(async () => {}); expect(unloadBlocked()).toBe(true);
        await second.dispose(); expect(unloadBlocked()).toBe(false);
    });

    it('cannot install a stale guard from a write failing after its owner disposed', async () => {
        const coalescer = create(); coalescer.markDirty(); const gate = deferred();
        const write = coalescer.flush(() => gate.promise).catch(() => {}); await Promise.resolve();
        const disposal = coalescer.dispose(); gate.reject(new Error('late storage failure')); await write; await disposal;
        expect(unloadBlocked()).toBe(false);
    });
});
