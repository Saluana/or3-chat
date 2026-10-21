/* @vitest-environment node */
import { afterEach, expect, it, vi } from 'vitest';

// Failures: idle instances hammer the provider, cleanup runs at recovery cadence,
// useful recovery never resumes promptly, or a closed app keeps scheduling work.
// The plugin owns timers; immediate admission remains covered by lifecycle tests.
const state = vi.hoisted(() => ({
    cleanup: vi.fn(async () => {}), history: vi.fn(async () => 0),
    recover: vi.fn(async () => 0), provider: vi.fn(),
}));
vi.mock('nitropack/runtime', () => ({ defineNitroPlugin: (fn: unknown) => fn }));
vi.mock('../../utils/background-jobs/store', () => ({
    isBackgroundStreamingEnabled: () => true,
    getBackgroundJobEncryptionKey: () => 'a'.repeat(32),
    getJobConfig: () => ({ maxConcurrentJobs: 2 }),
    getJobProvider: state.provider,
}));
vi.mock('../../utils/background-jobs/lifecycle', () => ({ reconcileBackgroundJobs: state.recover }));
vi.mock('../../utils/background-jobs/history', () => ({ reconcilePendingBackgroundHistory: state.history }));
vi.mock('../../utils/background-jobs/stream-handler', () => ({ executeBackgroundJob: vi.fn() }));
vi.mock('../../utils/shutdown/runtime', () => ({ getShutdownRuntime: () => ({ controller: {
    phase: () => 'running', canStartWork: () => true, track: (work: unknown) => work,
} }) }));
afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });
it('backs off empty recovery, bounds cleanup frequency, and stops on close', async () => {
    vi.useFakeTimers();
    state.provider.mockResolvedValue({ cleanupExpired: state.cleanup });
    const close = vi.fn();
    const plugin = (await import('../25.background-jobs')).default as any;
    plugin({ hooks: { hook: (_event: string, callback: () => void) => close.mockImplementation(callback) } });
    try {
        await vi.advanceTimersByTimeAsync(60_000);
        expect(state.provider.mock.calls.length).toBeLessThanOrEqual(5);
        expect(state.cleanup).toHaveBeenCalledTimes(1);
        close();
        const scans = state.provider.mock.calls.length;
        await vi.advanceTimersByTimeAsync(120_000);
        expect(state.provider).toHaveBeenCalledTimes(scans);
    } finally { close(); }
});
