/* @vitest-environment node */
import { afterEach, expect, it, vi } from 'vitest';

// Failures: idle instances hammer the provider, cleanup runs at recovery cadence,
// useful recovery never resumes promptly, or a closed app keeps scheduling work.
// The plugin owns timers; immediate admission remains covered by lifecycle tests.
const state = vi.hoisted(() => ({
    cleanup: vi.fn(async () => {}), history: vi.fn(async () => 0),
    coordinate: vi.fn(async () => 0), recover: vi.fn(async () => 0), provider: vi.fn(),
    phase: 'running' as 'running' | 'preparing',
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
vi.mock('../../utils/background-jobs/delegation-coordinator', () => ({ reconcileDueDelegationWaits: state.coordinate }));
vi.mock('../../utils/background-jobs/stream-handler', () => ({ executeBackgroundJob: vi.fn() }));
vi.mock('../../utils/shutdown/runtime', () => ({ getShutdownRuntime: () => ({ controller: {
    phase: () => state.phase, canStartWork: () => state.phase === 'running', track: (work: unknown) => work,
} }) }));
afterEach(() => { state.phase = 'running'; vi.useRealTimers(); vi.clearAllMocks(); });
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

it.each(['cleanup', 'history', 'coordinate'] as const)(
    'continues unrelated recovery when %s fails', async failed => {
        vi.useFakeTimers();
        state.provider.mockResolvedValue({ cleanupExpired: state.cleanup });
        state[failed].mockRejectedValueOnce(new Error('private-fixture-secret'));
        const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const close = vi.fn();
        const plugin = (await import('../25.background-jobs')).default as any;
        plugin({ hooks: { hook: (_event: string, callback: () => void) => close.mockImplementation(callback) } });
        try {
            await vi.advanceTimersByTimeAsync(1_000);
            expect(state.history).toHaveBeenCalledOnce();
            expect(state.coordinate).toHaveBeenCalledOnce();
            expect(state.recover).toHaveBeenCalledOnce();
            expect(warning).toHaveBeenCalled();
            expect(JSON.stringify(warning.mock.calls)).not.toContain('private-fixture-secret');
            await vi.advanceTimersByTimeAsync(5_000);
            expect(state.recover).toHaveBeenCalledTimes(2);
        } finally { close(); warning.mockRestore(); }
    },
);

it('continues bookkeeping after a failure during preparation without starting model work', async () => {
    vi.useFakeTimers();
    state.phase = 'preparing';
    state.provider.mockResolvedValue({ cleanupExpired: state.cleanup });
    state.history.mockRejectedValueOnce(new Error('private-fixture-secret'));
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const close = vi.fn();
    const plugin = (await import('../25.background-jobs')).default as any;
    plugin({ hooks: { hook: (_event: string, callback: () => void) => close.mockImplementation(callback) } });
    try {
        await vi.advanceTimersByTimeAsync(1_000);
        expect(state.coordinate).toHaveBeenCalledOnce();
        expect(state.recover).not.toHaveBeenCalled();
        expect(JSON.stringify(warning.mock.calls)).not.toContain('private-fixture-secret');
    } finally { close(); warning.mockRestore(); }
});
