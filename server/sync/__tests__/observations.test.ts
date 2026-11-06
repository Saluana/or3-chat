import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { H3Event } from 'h3';
const record = vi.hoisted(() => vi.fn());
vi.mock('../../admin/stores/registry', () => ({ getWorkspaceAccessStore: () => ({ recordSyncObservation: record }) }));

/*
 * Failure inventory:
 * - a diagnostic write failure or slow write must never delay, fail or replace the request result/error;
 * - raw provider error text must never reach diagnostics;
 * - a mixed push rejection is a classified failure, not a success;
 * - a flood of identical outcomes (e.g. 429s) from one user/workspace must not write per request;
 * - coalescing must never hide a state change: a new outcome or failure code persists immediately,
 *   and the latest coalesced repeat of the previous state persists first so its timestamp is not stale;
 * - coalesced repeats must still persist within the window with their own observation time;
 * - tracking must stay bounded; evicting a key must persist its pending observation.
 */
let observeSyncRequest: typeof import('../observations').observeSyncRequest;
let WINDOW: number;
const event = {} as H3Event;
const ok = (operation: 'push' | 'pull' | 'snapshot' | 'cursor' = 'pull', user = 'u', workspace = 'w') =>
    observeSyncRequest(event, user, workspace, operation, async () => ({ changes: [] }));
const rateLimited = (user = 'u') => observeSyncRequest(event, user, 'w', 'pull', async () => { throw Object.assign(new Error('Too many requests'), { statusCode: 429 }); }).catch(() => {});
const settle = () => new Promise(resolve => setImmediate(resolve));

beforeEach(async () => {
    record.mockReset();
    record.mockResolvedValue(undefined);
    vi.resetModules();
    ({ observeSyncRequest, SYNC_OBSERVATION_WINDOW_MS: WINDOW } = await import('../observations'));
});
afterEach(() => { vi.useRealTimers(); });

describe('authenticated gateway sync observations', () => {
    it('reports no-op completion and survives a diagnostic disk failure', async () => {
        record.mockRejectedValue(new Error('disk full'));
        const result = { changes: [], hasMore: false };
        expect(await observeSyncRequest(event, 'u', 'w', 'pull', async () => result)).toBe(result);
        await settle();
        expect(record).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u', workspaceId: 'w', operation: 'pull', outcome: 'success' }));
    });

    it('keeps failures classified and preserves the actual request error', async () => {
        const error = Object.assign(new Error('private provider details'), { statusCode: 503 });
        await expect(observeSyncRequest(event, 'u', 'w', 'pull', async () => { throw error; })).rejects.toBe(error);
        await settle();
        expect(record).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'failure', code: 'provider_failed' }));
        expect(JSON.stringify(record.mock.calls)).not.toContain('private provider details');
    });

    it('records mixed push failures separately from transport success', async () => {
        const result = { results: [{ success: false }] };
        expect(await observeSyncRequest(event, 'u', 'w', 'push', async () => result)).toBe(result);
        await settle();
        expect(record).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'failure', code: 'operation_rejected' }));
    });

    it('returns without waiting for a slow diagnostic write', async () => {
        record.mockImplementation(() => new Promise<void>(() => {}));
        expect(await observeSyncRequest(event, 'u', 'w', 'pull', async () => 'done')).toBe('done');
    });

    it('coalesces a rate-limit flood to one write per window with the latest time', async () => {
        vi.useFakeTimers({ now: 1_000_000, toFake: ['Date', 'setTimeout', 'clearTimeout'] });
        for (let i = 0; i < 200; i++) { await rateLimited(); vi.setSystemTime(1_000_000 + i * 100); }
        await settle();
        expect(record).toHaveBeenCalledOnce();
        expect(record).toHaveBeenLastCalledWith(expect.objectContaining({ outcome: 'failure', code: 'rate_limited', observedAt: 1_000_000 }));
        const lastRepeat = 1_000_000 + 198 * 100;
        await vi.advanceTimersByTimeAsync(WINDOW);
        await settle();
        expect(record).toHaveBeenCalledTimes(2);
        expect(record).toHaveBeenLastCalledWith(expect.objectContaining({ code: 'rate_limited', observedAt: lastRepeat }));
    });

    it('persists state changes immediately after the previous state\'s latest repeat', async () => {
        vi.useFakeTimers({ now: 2_000_000, toFake: ['Date', 'setTimeout', 'clearTimeout'] });
        await ok();
        vi.setSystemTime(2_000_500);
        await ok('push');
        vi.setSystemTime(2_001_000);
        await rateLimited();
        vi.setSystemTime(2_001_500);
        await observeSyncRequest(event, 'u', 'w', 'pull', async () => { throw Object.assign(new Error('x'), { statusCode: 503 }); }).catch(() => {});
        vi.setSystemTime(2_002_000);
        await ok('cursor');
        await settle();
        expect(record.mock.calls.map(([call]) => [call.outcome, call.code ?? null, call.operation, call.observedAt])).toEqual([
            ['success', null, 'pull', 2_000_000],
            ['success', null, 'push', 2_000_500],
            ['failure', 'rate_limited', 'pull', 2_001_000],
            ['failure', 'provider_failed', 'pull', 2_001_500],
            ['success', null, 'cursor', 2_002_000],
        ]);
        await vi.advanceTimersByTimeAsync(WINDOW * 2);
        expect(record).toHaveBeenCalledTimes(5);
    });

    it('tracks keys independently, stays bounded and persists pending repeats on eviction', async () => {
        await ok('pull', 'a');
        await ok('push', 'a');
        await ok('pull', 'b');
        await settle();
        expect(record).toHaveBeenCalledTimes(2);
        for (let i = 0; i < 10_050; i++) await ok('pull', `bulk-${i}`);
        await settle();
        // Every new key is written once; evicting "a" persists its coalesced push.
        expect(record).toHaveBeenCalledTimes(10_053);
        expect(record.mock.calls.filter(([call]) => call.userId === 'a').map(([call]) => call.operation)).toEqual(['pull', 'push']);
        // "a" is no longer tracked, so its next observation is written rather than coalesced.
        await ok('pull', 'a');
        await settle();
        expect(record).toHaveBeenCalledTimes(10_054);
    });
});
