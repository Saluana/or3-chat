import { describe, expect, it, vi } from 'vitest';
import {
    PerPluginLifecycleMutex,
    PluginGenerationClock,
    SerializedReconcileCoordinator,
    StalePluginGenerationError,
    type PluginLifecycleBoundary,
} from '../lifecycle-coordinator';

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((done) => {
        resolve = done;
    });
    return { promise, resolve };
}

describe('plugin lifecycle coordination', () => {
    it.each([
        'fetch',
        'import',
        'register',
        'stop',
        'validation',
        'activation',
    ] as const)('rejects superseded work after the awaited %s boundary', async (boundary) => {
        const clock = new PluginGenerationClock();
        const first = clock.supersede('alpha');
        const operation = deferred<string>();
        const result = first.after(boundary as PluginLifecycleBoundary, operation.promise);

        const second = clock.supersede('alpha');
        expect(first.signal.aborted).toBe(true);
        expect(second.generation).toBe(2);
        operation.resolve('stale');

        await expect(result).rejects.toBeInstanceOf(StalePluginGenerationError);
    });

    it('serializes same-ID operations while unrelated IDs progress', async () => {
        const mutex = new PerPluginLifecycleMutex();
        const alphaGate = deferred<void>();
        const trace: string[] = [];
        const alphaFirst = mutex.runExclusive('alpha', async () => {
            trace.push('alpha-1:start');
            await alphaGate.promise;
            trace.push('alpha-1:end');
        });
        const alphaSecond = mutex.runExclusive('alpha', () => {
            trace.push('alpha-2');
        });
        const beta = mutex.runExclusive('beta', () => {
            trace.push('beta');
        });

        await beta;
        expect(trace).toEqual(['alpha-1:start', 'beta']);
        alphaGate.resolve();
        await Promise.all([alphaFirst, alphaSecond]);
        expect(trace).toEqual(['alpha-1:start', 'beta', 'alpha-1:end', 'alpha-2']);
    });

    it('coalesces concurrent reconcile triggers so the latest pending state wins', async () => {
        const firstGate = deferred<void>();
        const seen: Array<{ revision: number; value: string }> = [];
        const reconcile = vi.fn(async (request: { revision: number; value: string }) => {
            seen.push(request);
            if (request.revision === 1) await firstGate.promise;
        });
        const coordinator = new SerializedReconcileCoordinator(reconcile);

        const first = coordinator.request('workspace-1');
        coordinator.request('focus-refresh');
        coordinator.request('workspace-2');
        firstGate.resolve();
        await first;

        expect(seen).toEqual([
            { revision: 1, value: 'workspace-1' },
            { revision: 3, value: 'workspace-2' },
        ]);
        expect(reconcile).toHaveBeenCalledTimes(2);
    });
});

