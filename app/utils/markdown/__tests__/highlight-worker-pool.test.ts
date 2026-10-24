import { afterEach, describe, expect, it, vi } from 'vitest';
import { reactive } from 'vue';
import { createHighlightWorkerPool, type HighlightRequest, type HighlightResponse } from '../highlight-worker-pool';

function fixture() {
    const workers: Array<{
        onmessage: ((event: MessageEvent<HighlightResponse>) => void) | null;
        onerror: (() => void) | null;
        onmessageerror: (() => void) | null;
        postMessage: ReturnType<typeof vi.fn>;
        terminate: ReturnType<typeof vi.fn>;
    }> = [];
    const pool = createHighlightWorkerPool(() => {
        const worker = { onmessage: null, onerror: null, onmessageerror: null, postMessage: vi.fn((message) => structuredClone(message)), terminate: vi.fn() };
        workers.push(worker);
        return worker as unknown as Worker;
    });
    const finish = (index: number, html: string) => {
        const worker = workers[index]!;
        const request = worker.postMessage.mock.lastCall![0] as HighlightRequest;
        worker.onmessage?.({ data: { id: request.id, html } } as MessageEvent<HighlightResponse>);
    };
    return { pool, workers, finish };
}
const input = (code: string) => ({ code, language: 'ts', theme: 'github-light' });
afterEach(() => vi.useRealTimers());

describe('syntax highlighting worker ownership', () => {
    it('shares one worker, coalesces queued snapshots, and releases it with its last owner', async () => {
        const { pool, workers, finish } = fixture();
        const left = pool.acquire(), right = pool.acquire();
        expect(workers).toHaveLength(0);
        try {
            const first = left.highlight(input('first'));
            const replaced = left.highlight(input('second')).catch(() => 'superseded');
            const theme = reactive({ light: 'github-light', dark: 'github-dark' });
            const latest = left.highlight({ ...input('latest'), theme });
            theme.light = 'changed after enqueue';
            const other = right.highlight(input('other'));
            expect(await replaced).toBe('superseded');
            expect(workers).toHaveLength(1);
            expect(workers[0]!.postMessage).toHaveBeenCalledTimes(1);
            finish(0, 'first html');
            expect(await first).toBe('first html');
            expect(workers[0]!.postMessage.mock.lastCall![0].code).toBe('latest');
            expect(workers[0]!.postMessage.mock.lastCall![0].theme.light).toBe('github-light');
            finish(0, 'latest html');
            expect(await latest).toBe('latest html');
            expect(workers[0]!.postMessage.mock.lastCall![0].code).toBe('other');
            finish(0, 'other html');
            expect(await other).toBe('other html');
            left.release();
            expect(workers[0]!.terminate).not.toHaveBeenCalled();
            right.release();
            expect(workers[0]!.terminate).toHaveBeenCalledOnce();
            const next = pool.acquire();
            const result = next.highlight(input('new owner'));
            expect(workers).toHaveLength(2);
            finish(1, 'new html');
            expect(await result).toBe('new html');
            next.release();
        } finally { pool.dispose(); }
    });

    it('drops unmounted consumers while allowing another block to finish', async () => {
        const { pool, workers, finish } = fixture();
        const left = pool.acquire(), right = pool.acquire();
        try {
            const removed = left.highlight(input('removed')).catch(() => 'released');
            const pending = right.highlight(input('remaining'));
            left.release();
            expect(await removed).toBe('released');
            finish(0, 'obsolete html');
            finish(0, 'remaining html');
            expect(await pending).toBe('remaining html');
            right.release();
            expect(workers[0]!.terminate).toHaveBeenCalledOnce();
            await expect(left.highlight(input('late'))).rejects.toThrow('unavailable');
        } finally { pool.dispose(); }
    });

    it.each(['error', 'messageerror', 'timeout'] as const)('settles every pending job after %s and avoids a streaming restart loop', async (failure) => {
        vi.useFakeTimers();
        const { pool, workers, finish } = fixture();
        const left = pool.acquire(), right = pool.acquire();
        try {
            const first = left.highlight(input('first')).catch(() => 'failed');
            const second = right.highlight(input('second')).catch(() => 'failed');
            if (failure === 'timeout') vi.advanceTimersByTime(20_000);
            else if (failure === 'error') workers[0]!.onerror?.();
            else workers[0]!.onmessageerror?.();
            expect(await first).toBe('failed');
            expect(await second).toBe('failed');
            expect(workers[0]!.terminate).toHaveBeenCalledOnce();
            await expect(left.highlight(input('next token'))).rejects.toThrow('unavailable');
            expect(workers).toHaveLength(1);
            left.release(); right.release();
            const next = pool.acquire();
            const result = next.highlight(input('new owner'));
            finish(0, 'late old worker message');
            finish(1, 'new html');
            expect(await result).toBe('new html');
            next.release();
        } finally { pool.dispose(); }
    });

    it('bounds queued snapshots and rejects excessive code without starting a worker', async () => {
        const { pool, workers } = fixture();
        const first = pool.acquire();
        try {
            await expect(first.highlight(input('x'.repeat(250_001)))).rejects.toThrow('unavailable');
            expect(workers).toHaveLength(0);
            const pending = [first.highlight(input('active')).catch(() => 'released')];
            for (let i = 0; i < 64; i++) pending.push(pool.acquire().highlight(input('queued')).catch(() => 'released'));
            await expect(pool.acquire().highlight(input('over capacity'))).rejects.toThrow('unavailable');
            expect(workers[0]!.postMessage).toHaveBeenCalledTimes(1);
            pool.dispose();
            expect(await Promise.all(pending)).toHaveLength(65);
            expect(workers[0]!.terminate).toHaveBeenCalledOnce();
        } finally { pool.dispose(); }
    });
});
