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
    it('keeps a newer suffix protected when an older retry snapshot is acknowledged', async () => {
        const coalescer = create(); coalescer.markDirty();
        await coalescer.flush(async () => { throw new Error('blocked prefix'); }).catch(() => {});
        const gate = deferred(); let saved = 'earlier durable prefix';
        const retry = coalescer.flush(async () => { await gate.promise; saved = 'retry snapshot'; });
        await Promise.resolve(); coalescer.markDirty(10);
        gate.resolve(); await retry;
        expect(saved).toBe('retry snapshot'); expect(coalescer.hasDirty()).toBe(true);
        expect(unloadBlocked()).toBe(true);
        await coalescer.flush(async () => { saved = 'retry snapshot plus newer suffix'; });
        expect(saved).toBe('retry snapshot plus newer suffix'); expect(unloadBlocked()).toBe(false);
    });

    it('waits for the newer queued write instead of reporting a premature flush', async () => {
        const coalescer = create(); coalescer.markDirty(); const older = deferred(); const newer = deferred();
        const first = coalescer.flush(() => older.promise);
        await Promise.resolve(); coalescer.markDirty();
        const nextWrite = vi.fn(() => newer.promise); const next = coalescer.flush(nextWrite);
        let followerSettled = false;
        const follower = coalescer.flush(vi.fn()).then(() => { followerSettled = true; }, () => { followerSettled = true; });
        older.resolve(); await first; await Promise.resolve();
        const settledTooSoon = followerSettled;
        newer.resolve(); await next; await follower;
        expect(nextWrite).toHaveBeenCalledTimes(1); expect(settledTooSoon).toBe(false);
    });

    it('does not start a waiting write after disposal begins', async () => {
        const coalescer = create(); coalescer.markDirty(); const gate = deferred();
        const first = coalescer.flush(() => gate.promise); await Promise.resolve();
        coalescer.markDirty(); const lateWrite = vi.fn(async () => {});
        const waiting = coalescer.flush(lateWrite); const disposal = coalescer.dispose();
        gate.resolve(); await first; await waiting; await disposal;
        expect(lateWrite).not.toHaveBeenCalled(); expect(unloadBlocked()).toBe(false);
    });

    it('ignores new flushes and deltas after its owner has disposed', async () => {
        const coalescer = create(); await coalescer.dispose();
        coalescer.markDirty(); const lateWrite = vi.fn(async () => {}); await coalescer.flush(lateWrite);
        expect(lateWrite).not.toHaveBeenCalled(); expect(coalescer.hasDirty()).toBe(false);
        expect(unloadBlocked()).toBe(false);
    });

    it('propagates failure of the newer joined write and retains its unsaved suffix', async () => {
        const coalescer = create(); coalescer.markDirty(); const older = deferred(); const newer = deferred();
        const first = coalescer.flush(() => older.promise); await Promise.resolve(); coalescer.markDirty();
        const nextOutcome = coalescer.flush(() => newer.promise).then(() => null, error => error);
        const unusedWrite = vi.fn(async () => {});
        const followerOutcome = coalescer.flush(unusedWrite).then(() => null, error => error);
        older.resolve(); await first;
        const failure = new Error('newer suffix rejected'); newer.reject(failure);
        expect(await nextOutcome).toBe(failure); expect(await followerOutcome).toBe(failure);
        expect(unusedWrite).not.toHaveBeenCalled(); expect(coalescer.hasDirty()).toBe(true);
        expect(unloadBlocked()).toBe(true);
        await coalescer.flush(async () => {}); expect(unloadBlocked()).toBe(false);
    });

    it('cancels its idle retry and releases only its own guard during teardown', async () => {
        const idle = vi.fn(async () => {});
        const first = createStreamWriteCoalescer({ maxDelayMs: 1, onIdleFlush: idle }); coalescers.push(first);
        const second = create();
        for (const writer of [first, second]) {
            writer.markDirty(); await writer.flush(async () => { throw new Error('blocked'); }).catch(() => {});
        }
        await first.dispose(); await first.dispose();
        await vi.advanceTimersByTimeAsync(1_000);
        expect(idle).not.toHaveBeenCalled(); expect(unloadBlocked()).toBe(true);
        await second.dispose(); expect(unloadBlocked()).toBe(false);
    });

});
