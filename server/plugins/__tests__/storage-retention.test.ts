import { afterEach, expect, it, vi } from 'vitest';
// Scheduler contracts absent from manual cleanup coverage: explicit opt-in,
// scope bounds, no overlapping ticks, cursor retry and shutdown ownership.
const deps = vi.hoisted(() => ({ run: vi.fn() }));
vi.mock('../../utils/storage/reclamation', () => ({ runAutomaticStorageCleanupBatch: deps.run }));
vi.mock('nitropack/runtime', () => ({ defineNitroPlugin: (fn: unknown) => fn }));
import plugin from '../storage-retention';
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); deps.run.mockReset(); });
function start() {
    let close!: () => Promise<void>;
    plugin({ hooks: { hook: (_name: string, fn: typeof close) => { close = fn; } } } as never);
    return () => close?.();
}
it('does nothing without an explicit workspace opt-in', async () => {
    vi.useFakeTimers(); vi.stubEnv('OR3_STORAGE_RETENTION_WORKSPACES', '');
    start(); await vi.advanceTimersByTimeAsync(3_600_000);
    expect(deps.run).not.toHaveBeenCalled();
});
it('bounds scope and refuses malformed workspace configuration', () => {
    vi.stubEnv('OR3_STORAGE_RETENTION_WORKSPACES', '../unsafe');
    expect(start).toThrow();
});
it('serializes batches, retains a pending cursor and waits on shutdown', async () => {
    vi.useFakeTimers(); vi.stubEnv('OR3_STORAGE_RETENTION_WORKSPACES', 'workspace');
    let finish!: (value: unknown) => void;
    deps.run.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }))
        .mockResolvedValue({ nextCursor: 'next', pending: 0 });
    const close = start();
    await vi.advanceTimersByTimeAsync(3_600_000);
    await vi.advanceTimersByTimeAsync(3_600_000);
    expect(deps.run).toHaveBeenCalledTimes(1);
    let closed = false;
    const stopping = close()?.then(() => { closed = true; });
    await Promise.resolve(); expect(closed).toBe(false);
    finish({ nextCursor: null, pending: 1 }); await stopping;
    await vi.advanceTimersByTimeAsync(3_600_000);
    expect(deps.run).toHaveBeenCalledTimes(1);
});
it('advances successful pages but retries the same cursor after pending work or failure', async () => {
    vi.useFakeTimers(); vi.stubEnv('OR3_STORAGE_RETENTION_WORKSPACES', 'workspace');
    deps.run.mockResolvedValueOnce({ nextCursor: 'next', pending: 0 })
        .mockResolvedValueOnce({ nextCursor: 'ignored', pending: 1 })
        .mockRejectedValueOnce(new Error('interrupted'))
        .mockResolvedValueOnce({ nextCursor: null, pending: 0 });
    const close = start();
    await vi.advanceTimersByTimeAsync(4 * 3_600_000);
    expect(deps.run.mock.calls).toEqual([['workspace', undefined], ['workspace', 'next'], ['workspace', 'next'], ['workspace', 'next']]);
    await close();
});
