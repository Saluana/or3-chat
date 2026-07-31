import { describe, expect, it, vi } from 'vitest';
import {
    LegacyPluginScope,
    ScopeOwnedAbortController,
    ScopeOwnedCleanupRecord,
} from '../legacy-plugin-scope';

describe('LegacyPluginScope ownership primitives', () => {
    it('makes abort and cleanup idempotent and rejects stale owners', () => {
        const owner = Symbol('current');
        const stale = Symbol('stale');
        const abortController = new ScopeOwnedAbortController(owner);
        const cleanup = vi.fn();
        const record = new ScopeOwnedCleanupRecord(owner, 0, cleanup);

        expect(abortController.abort(stale)).toBe(false);
        expect(abortController.signal.aborted).toBe(false);
        expect(abortController.abort(owner)).toBe(true);
        expect(abortController.abort(owner)).toBe(false);

        expect(record.invoke(stale).status).toBe('stale-owner');
        expect(record.invoke(owner).status).toBe('invoked');
        expect(record.invoke(owner).status).toBe('already-invoked');
        expect(cleanup).toHaveBeenCalledOnce();
    });

    it('invokes FIFO without serializing promise starts and awaits all settlement', async () => {
        const trace: string[] = [];
        let resolveFirst!: () => void;
        let resolveSecond!: () => void;
        const first = new Promise<void>((resolve) => {
            resolveFirst = resolve;
        });
        const second = new Promise<void>((resolve) => {
            resolveSecond = resolve;
        });
        const scope = new LegacyPluginScope({ cleanupTimeoutMs: 1_000 });
        scope.onCleanup(() => {
            trace.push('first:start');
            return first.then(() => {
                trace.push('first:end');
            });
        });
        scope.onCleanup(() => {
            trace.push('second:start');
            return second.then(() => {
                trace.push('second:end');
            });
        });

        const disposal = scope.dispose();
        expect(trace).toEqual(['first:start', 'second:start']);
        resolveSecond();
        await Promise.resolve();
        resolveFirst();

        await expect(disposal).resolves.toMatchObject({
            status: 'clean',
            timedOut: false,
            invokedCount: 2,
            settledThenableCount: 2,
        });
        expect(trace).toEqual([
            'first:start',
            'second:start',
            'second:end',
            'first:end',
        ]);
    });

    it('reports thrown and rejected cleanups while continuing later callbacks', async () => {
        const onCleanupError = vi.fn();
        const later = vi.fn();
        const scope = new LegacyPluginScope({ onCleanupError });
        scope.onCleanup(() => {
            throw new Error('invoke failure');
        });
        scope.onCleanup(() => Promise.reject(new Error('settle failure')));
        scope.onCleanup(later);

        const report = await scope.dispose();

        expect(later).toHaveBeenCalledOnce();
        expect(report.status).toBe('degraded');
        expect(report.errors.map((error) => error.phase)).toEqual(['invoke', 'settle']);
        expect(onCleanupError).toHaveBeenCalledTimes(2);
    });

    it('uses one overall timeout and completes a degraded stop', async () => {
        vi.useFakeTimers();
        try {
            const scope = new LegacyPluginScope({ cleanupTimeoutMs: 100 });
            scope.onCleanup(() => new Promise<void>(() => {}));
            scope.onCleanup(() => Promise.resolve());

            const disposal = scope.dispose('stop');
            expect(scope.signal.aborted).toBe(true);
            await vi.advanceTimersByTimeAsync(100);

            await expect(disposal).resolves.toMatchObject({
                status: 'degraded',
                timedOut: true,
                invokedCount: 2,
                settledThenableCount: 1,
            });
        } finally {
            vi.useRealTimers();
        }
    });

    it('returns the same report promise and invokes callbacks once', async () => {
        const cleanup = vi.fn();
        const scope = new LegacyPluginScope();
        scope.onCleanup(cleanup);

        const first = scope.dispose();
        const second = scope.dispose();

        expect(first).toBe(second);
        await first;
        expect(cleanup).toHaveBeenCalledOnce();
        expect(scope.onCleanup(vi.fn())).toBeNull();
    });
});

