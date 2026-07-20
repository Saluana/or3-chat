import { describe, expect, it, vi } from 'vitest';
import { GcManager } from '../gc-manager';
import {
    canRunSyncHistoryGc,
    SYNC_HISTORY_GC_POLICY,
} from '~~/shared/sync/history-gc-policy';

describe('GcManager snapshot safety gate', () => {
    it('enables the verified global contract while providers remain explicit', () => {
        expect(SYNC_HISTORY_GC_POLICY).toMatchObject({
            enabled: true,
            snapshotBootstrapVerified: true,
        });
        expect(canRunSyncHistoryGc()).toBe(true);
    });

    it('never deletes local tombstones or invokes provider GC', async () => {
        vi.useFakeTimers();
        const bulkDelete = vi.fn();
        const toArray = vi.fn(async () => [
            { id: 'eligible', deletedAt: 1, syncedAt: 1 },
        ]);
        const db = {
            tombstones: {
                where: vi.fn(() => ({
                    belowOrEqual: vi.fn(() => ({ toArray })),
                })),
                bulkDelete,
            },
        };
        const provider = {
            id: 'provider-1',
            mode: 'gateway',
            gcTombstones: vi.fn(),
            gcChangeLog: vi.fn(),
        };

        const manager = new GcManager(
            db as never,
            provider as never,
            { workspaceId: 'ws-1' },
            { intervalMs: 1, idleTimeoutMs: 0, retentionSeconds: 1 }
        );

        manager.start();
        await vi.advanceTimersByTimeAsync(60_000);
        manager.stop();

        expect(db.tombstones.where).not.toHaveBeenCalled();
        expect(toArray).not.toHaveBeenCalled();
        expect(bulkDelete).not.toHaveBeenCalled();
        expect(provider.gcTombstones).not.toHaveBeenCalled();
        expect(provider.gcChangeLog).not.toHaveBeenCalled();
        vi.useRealTimers();
    });
});
