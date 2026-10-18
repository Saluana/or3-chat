import { randomUUID } from 'node:crypto';
import { createShutdownController } from './controller';

function createRuntime() {
    const controller = createShutdownController({
        shutdownTimeoutMs: Math.min(15_000, Math.max(1_000, Number(process.env.OR3_SHUTDOWN_TIMEOUT_MS) || 15_000)),
        async getBackgroundJobCount() {
            const store = await import('../background-jobs/store');
            if (!store.isBackgroundStreamingEnabled()) return 0;
            const provider = await store.getJobProvider();
            if (!provider.getShutdownBlockerCount) throw new Error('Background execution cannot be drained safely');
            return await provider.getShutdownBlockerCount();
        },
    });
    return { bootId: randomUUID(), controller };
}

const key = Symbol.for('or3.shutdown.runtime.v1');
const registry = globalThis as typeof globalThis & { [key]?: ReturnType<typeof createRuntime> };
/** Process/worker-owned state survives module reload without changing boot identity. */
export function getShutdownRuntime() { return registry[key] ??= createRuntime(); }
