/**
 * @module app/core/sync/gc-manager
 *
 * Purpose:
 * Periodically garbage-collects tombstones and change log entries that
 * have exceeded the retention window. Runs during browser idle periods
 * to avoid interfering with hot-path operations.
 *
 * Behavior:
 * - Schedules GC on a configurable interval (default 10 minutes)
 * - Uses `requestIdleCallback` when available; falls back to `setTimeout`
 * - Deletes local tombstones older than retention (default 30 days)
 * - Delegates server-side GC to the sync provider if it supports it
 * - Respects the circuit breaker (skips external calls when tripped)
 *
 * Constraints:
 * - Only eligible tombstones (with `syncedAt` in the past) are deleted
 * - GC is serialized (no concurrent runs)
 * - Errors are logged and emitted as `sync.gc:action:error` hooks
 *
 * @see core/sync/hook-bridge for tombstone creation
 * @see shared/sync/circuit-breaker for circuit breaker logic
 */
import type { Or3DB } from '~/db/client';
import type { SyncProvider, SyncScope } from '~~/shared/sync/types';
import { nowSec } from '~/db/util';
import { useHooks } from '~/core/hooks/useHooks';
import { isAbortLikeError } from './providers/gateway-sync-provider';
import { getSyncCircuitBreaker } from '~~/shared/sync/circuit-breaker';

const DEFAULT_RETENTION_SECONDS = 30 * 24 * 60 * 60;
const DEFAULT_INTERVAL_MS = 10 * 60 * 1000;
const DEFAULT_IDLE_TIMEOUT_MS = 2000;

/**
 * Purpose:
 * Configuration for local and provider-side sync garbage collection.
 *
 * Constraints:
 * - Defaults are intentionally conservative to reduce accidental data loss
 */
export interface GcManagerConfig {
    retentionSeconds?: number;
    intervalMs?: number;
    idleTimeoutMs?: number;
}

type IdleHandle = number | ReturnType<typeof setTimeout>;

/**
 * Purpose:
 * Periodically garbage-collect old tombstones and server-side change logs.
 *
 * Behavior:
 * - Runs during idle time when possible
 * - Respects circuit breaker to avoid hammering a failing provider
 * - Emits hooks for errors and diagnostics
 *
 * Constraints:
 * - Serialized; at most one GC run at a time
 */
export class GcManager {
    private db: Or3DB;
    private provider: SyncProvider;
    private scope: SyncScope;
    private config: Required<GcManagerConfig>;
    private circuitBreakerKey: string;
    private interval: ReturnType<typeof setInterval> | null = null;
    private idleHandle: IdleHandle | null = null;
    private active = false;
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
        this.circuitBreakerKey = `${scope.workspaceId}:${provider.id}`;
        this.config = {
            retentionSeconds: config.retentionSeconds ?? DEFAULT_RETENTION_SECONDS,
            intervalMs: config.intervalMs ?? DEFAULT_INTERVAL_MS,
            idleTimeoutMs: config.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS,
        };
    }

    start(): void {
        if (this.interval) return;
        this.active = true;

        this.interval = setInterval(() => {
            this.scheduleGc();
        }, this.config.intervalMs);

        this.scheduleGc();
    }

    stop(): void {
        this.active = false;
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
        if (!this.active || this.running) return;
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

            if (!this.active) {
                return;
            }

            // Check circuit breaker before external provider calls
            const circuitBreaker = getSyncCircuitBreaker(this.circuitBreakerKey);
            if (!circuitBreaker.canRetry()) {
                return;
            }

            if (this.provider.gcTombstones) {
                await this.provider.gcTombstones(this.scope, this.config.retentionSeconds);
            }

            if (this.provider.gcChangeLog) {
                await this.provider.gcChangeLog(this.scope, this.config.retentionSeconds);
            }
        } catch (error) {
            if (!this.active || isAbortLikeError(error)) {
                return;
            }
            console.error('[GcManager] GC failed:', error);
            void useHooks().doAction('sync.gc:action:error', {
                error: error instanceof Error ? error.message : String(error),
            });
        } finally {
            this.running = false;
        }
    }
}
