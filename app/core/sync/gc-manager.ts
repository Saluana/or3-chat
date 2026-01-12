/**
 * GcManager - Cleanup tombstones and change log retention.
 *
 * Runs during idle periods to avoid interfering with hot paths.
 */
import type { Or3DB } from '~/db/client';
import type { SyncProvider, SyncScope } from '~~/shared/sync/types';
import { nowSec } from '~/db/util';
import { useHooks } from '~/core/hooks/useHooks';

const DEFAULT_RETENTION_SECONDS = 30 * 24 * 60 * 60;
const DEFAULT_INTERVAL_MS = 10 * 60 * 1000;
const DEFAULT_IDLE_TIMEOUT_MS = 2000;

export interface GcManagerConfig {
    retentionSeconds?: number;
    intervalMs?: number;
    idleTimeoutMs?: number;
}

type IdleHandle = number | ReturnType<typeof setTimeout>;

export class GcManager {
    private db: Or3DB;
    private provider: SyncProvider;
    private scope: SyncScope;
    private config: Required<GcManagerConfig>;
    private interval: ReturnType<typeof setInterval> | null = null;
    private idleHandle: IdleHandle | null = null;
    private running = false;

    constructor(
        db: Or3DB,
        provider: SyncProvider,
        scope: SyncScope,
        config: GcManagerConfig = {}
    ) {
        this.db = db;
        this.provider = provider;
        this.scope = scope;
        this.config = {
            retentionSeconds: config.retentionSeconds ?? DEFAULT_RETENTION_SECONDS,
            intervalMs: config.intervalMs ?? DEFAULT_INTERVAL_MS,
            idleTimeoutMs: config.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS,
        };
    }

    start(): void {
        if (this.interval) return;

        this.interval = setInterval(() => {
            this.scheduleGc();
        }, this.config.intervalMs);

        this.scheduleGc();
    }

    stop(): void {
        if (this.interval) {
            clearInterval(this.interval);
            this.interval = null;
        }
        this.clearIdleHandle();
    }

    private scheduleGc(): void {
        if (this.idleHandle) return;

        const run = () => {
            this.idleHandle = null;
            void this.runGc();
        };

        const requestIdleCallback = (
            globalThis as {
                requestIdleCallback?: (
                    cb: (deadline: { didTimeout: boolean; timeRemaining: () => number }) => void,
                    options?: { timeout?: number }
                ) => number;
            }
        ).requestIdleCallback;

        if (requestIdleCallback) {
            this.idleHandle = requestIdleCallback(run, {
                timeout: this.config.idleTimeoutMs,
            });
            return;
        }

        this.idleHandle = setTimeout(run, this.config.idleTimeoutMs);
    }

    private clearIdleHandle(): void {
        if (!this.idleHandle) return;

        const cancelIdleCallback = (
            globalThis as { cancelIdleCallback?: (handle: number) => void }
        ).cancelIdleCallback;

        if (typeof this.idleHandle === 'number' && cancelIdleCallback) {
            cancelIdleCallback(this.idleHandle);
        } else {
            clearTimeout(this.idleHandle as ReturnType<typeof setTimeout>);
        }

        this.idleHandle = null;
    }

    private async runGc(): Promise<void> {
        if (this.running) return;
        this.running = true;

        try {
            const cutoff = nowSec() - this.config.retentionSeconds;
            const candidates = await this.db.tombstones
                .where('deletedAt')
                .belowOrEqual(cutoff)
                .toArray();

            const eligibleIds = candidates
                .filter((row) => row.syncedAt && row.syncedAt <= cutoff)
                .map((row) => row.id);

            if (eligibleIds.length) {
                await this.db.tombstones.bulkDelete(eligibleIds);
            }

            if (this.provider.gcTombstones) {
                await this.provider.gcTombstones(this.scope, this.config.retentionSeconds);
            }

            if (this.provider.gcChangeLog) {
                await this.provider.gcChangeLog(this.scope, this.config.retentionSeconds);
            }
        } catch (error) {
            console.error('[GcManager] GC failed:', error);
            void useHooks().doAction('sync.gc:action:error', {
                error: error instanceof Error ? error.message : String(error),
            });
        } finally {
            this.running = false;
        }
    }
}
