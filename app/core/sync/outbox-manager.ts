/**
 * @module app/core/sync/outbox-manager
 *
 * Purpose:
 * Manages the push loop that flushes locally captured writes
 * (`pending_ops`) to the sync provider. Handles coalescing,
 * batching, retry with exponential backoff, and circuit-breaker
 * coordination.
 *
 * Responsibilities:
 * - Periodically flush pending_ops to the server (default 1s heartbeat)
 * - Coalesce multiple updates to the same record (keep latest only)
 * - Retry transient failures with configurable delays
 * - Detect permanent failures (validation, oversized) and stop retrying
 * - Emit `sync.push:action:before/after`, `sync.error:action`, and
 *   `sync.retry:action` hooks for observability
 * - Emit `sync.queue:action:full` when the queue nears capacity
 *
 * Constraints:
 * - Maximum batch size: 50 ops per push (configurable)
 * - Capacity warning at 500 pending ops
 * - Retry delays: [250ms, 1s, 3s, 5s] (4 attempts, then permanent failure)
 * - Circuit breaker prevents flush attempts when the provider is down
 * - Payloads are re-sanitized before each push for safety
 *
 * @see core/sync/hook-bridge for the write capture side
 * @see shared/sync/circuit-breaker for circuit breaker implementation
 * @see shared/sync/sanitize for payload sanitization
 */
import type { Or3DB } from '~/db/client';
import type { SyncProvider, SyncScope, PendingOp } from '~~/shared/sync/types';
import { useHooks } from '~/core/hooks/useHooks';
import { nowSec } from '~/db/util';
import { sanitizePayloadForSync } from '~~/shared/sync/sanitize';
import { markRecentOpId } from './recent-op-cache';
import { getSyncCircuitBreaker } from '~~/shared/sync/circuit-breaker';

/** Default retry delays in milliseconds */
const DEFAULT_RETRY_DELAYS = [250, 1000, 3000, 5000];

/** Default flush interval */
const DEFAULT_FLUSH_INTERVAL_MS = 1000;

/** Default max batch size */
const DEFAULT_MAX_BATCH_SIZE = 50;

/** Max pending ops before emitting capacity warning */
const MAX_PENDING_OPS = 500;

/**
 * Purpose:
 * Configuration for OutboxManager push loop behavior.
 *
 * Constraints:
 * - Defaults are chosen to balance responsiveness with backend load
 */
export interface OutboxManagerConfig {
    flushIntervalMs?: number;
    maxBatchSize?: number;
    retryDelays?: number[];
}

/**
 * Purpose:
 * Flush locally captured pending ops to the active SyncProvider.
 *
 * Behavior:
 * - Runs a periodic loop that coalesces and batches `pending_ops`
 * - Retries transient failures with backoff and respects circuit breaker
 * - Marks pushed opIds in the recent-op cache to drop echoed changes
 * - Emits hooks for observability (`sync.push:*`, `sync.retry:*`, `sync.error:*`)
 *
 * Constraints:
 * - Designed to be long-lived per workspace scope
 * - `start()` is idempotent; caller owns lifecycle
 */
export class OutboxManager {
    private db: Or3DB;
    private provider: SyncProvider;
    private scope: SyncScope;
    private config: Required<OutboxManagerConfig>;
    private circuitBreakerKey: string;

    private flushTimeout: ReturnType<typeof setTimeout> | null = null;
    private isFlushing = false;
    private isRunning = false;
    private needsSyncingRecovery = true;

    constructor(
        db: Or3DB,
        provider: SyncProvider,
        scope: SyncScope,
        config: OutboxManagerConfig = {}
    ) {
        this.db = db;
        this.provider = provider;
        this.scope = scope;
        this.circuitBreakerKey = `${scope.workspaceId}:${provider.id}`;
        this.config = {
            flushIntervalMs: config.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS,
            maxBatchSize: config.maxBatchSize ?? DEFAULT_MAX_BATCH_SIZE,
            retryDelays: config.retryDelays ?? DEFAULT_RETRY_DELAYS,
        };
    }

    /**
     * Start the flush loop
     */
    start(): void {
        if (this.isRunning) return;
        this.isRunning = true;
        this.needsSyncingRecovery = true;
        // Purge permanently failed ops on startup — they will never succeed
        // and only generate noise (error notifications, wasted flush cycles).
        this.purgeFailedOps().catch((err) =>
            console.error('[OutboxManager] Failed to purge stale ops:', err)
        );
        this.scheduleNextFlush(0);
    }

    /**
     * Stop the flush loop
     */
    stop(): void {
        this.isRunning = false;
        if (this.flushTimeout) {
            clearTimeout(this.flushTimeout);
            this.flushTimeout = null;
        }
    }

    private scheduleNextFlush(delay: number): void {
        if (!this.isRunning || this.flushTimeout) return;

        this.flushTimeout = setTimeout(async () => {
            this.flushTimeout = null;
            if (!this.isRunning) return;

            let didWork = false;
            try {
                didWork = await this.flush();
            } catch (err) {
                console.error('[OutboxManager] Flush error:', err);
            }

            // If work was found, retry quickly, otherwise behave like a heartbeat
            const nextDelay = didWork ? 100 : this.config.flushIntervalMs;
            this.scheduleNextFlush(nextDelay);
        }, delay);
    }

    /**
     * Flush pending operations to the server
     * Returns true if operations were processed
     */
    async flush(): Promise<boolean> {
        if (this.isFlushing) return false;

        // E2E Test Hook: Allow tests to simulate offline mode (dev only)
        if (import.meta.dev && (globalThis as { __OR3_TEST_OFFLINE?: boolean }).__OR3_TEST_OFFLINE) {
            return false;
        }

        // Check circuit breaker before attempting flush
        const circuitBreaker = getSyncCircuitBreaker(this.circuitBreakerKey);
        if (!circuitBreaker.canRetry()) {
            return false;
        }

        this.isFlushing = true;

        try {
            const hooks = useHooks();

            // Crash recovery: reset stale syncing ops once when the loop starts.
            if (this.needsSyncingRecovery) {
                await this.db.pending_ops
                    .where('status')
                    .equals('syncing')
                    .modify({ status: 'pending', nextAttemptAt: Date.now() });
                this.needsSyncingRecovery = false;
            }

            // Get pending ops (limited to prevent O(N) memory usage)
            // We fetch more than maxBatchSize to allow for some coalescing
            const pendingOps = await this.db.pending_ops
                .where('status')
                .equals('pending')
                .limit(this.config.maxBatchSize * 10) 
                .toArray();
            
            // Sort by createdAt to ensure correct order
            pendingOps.sort((a, b) => a.createdAt - b.createdAt);

            if (!pendingOps.length) return false;

            // Log only when there's work to do

            // Check capacity
            if (pendingOps.length >= MAX_PENDING_OPS) {
                console.warn('[OutboxManager] Queue near capacity:', pendingOps.length);
                await hooks.doAction('sync.queue:action:full', {
                    pendingCount: pendingOps.length,
                    maxSize: MAX_PENDING_OPS,
                });
            }

            // Coalesce and batch
            const coalesced = this.coalesceOps(pendingOps);
            const now = Date.now();
            const dueOps = coalesced.filter(
                (op) => op.nextAttemptAt === undefined || op.nextAttemptAt <= now
            );

            // Mark dropped ops for deletion
            const coalescedIds = new Set(coalesced.map((op) => op.id));
            const dropped = pendingOps.filter((op) => !coalescedIds.has(op.id));
            if (dropped.length) {
                await this.db.pending_ops.bulkDelete(dropped.map((op) => op.id));
            }

            if (!dueOps.length) return false;

            const batch = dueOps.slice(0, this.config.maxBatchSize);

            if (import.meta.dev) {
                console.debug('[sync] outbox push start', {
                    scope: this.scope,
                    batchSize: batch.length,
                });
            }

            await hooks.doAction('sync.push:action:before', {
                scope: this.scope,
                count: batch.length,
            });

            // Mark as syncing
            await this.db.pending_ops.bulkPut(
                batch.map((op) => ({ ...op, status: 'syncing' as const }))
            );

             try {
                 const sanitizedBatch = batch.map((op) => ({
                     ...op,
                     payload: sanitizePayloadForSync(op.tableName, op.payload, op.operation),
                 }));

                 // Mark opIds as recent BEFORE push to avoid echo race conditions
                 for (const op of batch) {
                     markRecentOpId(op.stamp.opId);
                 }

                 // Push to provider
                 const result = await this.provider.push({
                     scope: this.scope,
                     ops: sanitizedBatch,
                 });

                // Process results
                const resultsById = new Map(result.results.map((res) => [res.opId, res]));
                let successCount = 0;
                let failCount = 0;

                for (const op of batch) {
                    const res = resultsById.get(op.stamp.opId);
                    if (!res) {
                        await this.handleFailedOp(op, 'Missing push result', 'UNKNOWN');
                        failCount += 1;
                        continue;
                    }

                    if (res.success) {
                        // Successfully synced - remove from outbox
                        if (op.operation === 'delete') {
                            await this.markTombstoneSynced(op);
                        }
                        await this.db.pending_ops.delete(op.id);
                        successCount += 1;
                    } else {
                        // Failed - handle retry
                        await this.handleFailedOp(op, res.error, res.errorCode);
                        failCount += 1;
                    }
                }

                await hooks.doAction('sync.push:action:after', {
                    scope: this.scope,
                    successCount,
                    failCount,
                });

                if (import.meta.dev) {
                    console.debug('[sync] outbox push done', {
                        scope: this.scope,
                        successCount,
                        failCount,
                    });
                }

                // Update circuit breaker based on results
                if (successCount > 0 && failCount === 0) {
                    circuitBreaker.recordSuccess();
                } else if (failCount > 0) {
                    circuitBreaker.recordFailure();
                }
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                let failCount = 0;
                for (const op of batch) {
                    await this.handleFailedOp(op, message);
                    failCount += 1;
                }
                await hooks.doAction('sync.push:action:after', {
                    scope: this.scope,
                    successCount: 0,
                    failCount,
                });
                circuitBreaker.recordFailure();
                console.error('[OutboxManager] Push error:', error);
            }
            return true;
        } finally {
            this.isFlushing = false;
        }
    }

    /**
     * Coalesce multiple ops for same record to latest.
     * If put -> delete sequence exists, only delete is kept (correct LWW behavior).
     * This ensures we don't waste bandwidth sending intermediate states.
     */
    private coalesceOps(ops: PendingOp[]): PendingOp[] {
        const byKey = new Map<string, PendingOp>();

        for (const op of ops) {
            const key = `${op.tableName}:${op.pk}`;
            const existing = byKey.get(key);

            if (!existing || op.createdAt > existing.createdAt) {
                byKey.set(key, op);
            }
        }

        // Return in original order (by createdAt)
        return Array.from(byKey.values()).sort((a, b) => a.createdAt - b.createdAt);
    }

    /**
     * Handle a failed operation
     */
    private async handleFailedOp(
        op: PendingOp,
        error?: string,
        errorCode?: string
    ): Promise<void> {
        const hooks = useHooks();
        const attempts = op.attempts + 1;
        const maxAttempts = this.config.retryDelays.length;

        // Check for permanent failures that should not be retried
        const isPermanent = this.isPermanentFailure(errorCode, error);

        if (isPermanent || attempts >= maxAttempts) {
            // Max retries reached or permanent failure - mark as failed
            const updatedOp = {
                ...op,
                status: 'failed' as const,
                attempts,
            };
            await this.db.pending_ops.put(updatedOp);
            
            // Log detailed info for debugging
            const payloadSize = op.payload ? JSON.stringify(op.payload).length : 0;
            console.error(
                '[OutboxManager] Op failed' + (isPermanent ? ' (permanent)' : ' after max retries') + ':',
                {
                    opId: op.stamp.opId,
                    table: op.tableName,
                    pk: op.pk,
                    operation: op.operation,
                    payloadSizeBytes: payloadSize,
                    error,
                }
            );
            
            await hooks.doAction('sync.error:action', { op: updatedOp, error, permanent: isPermanent });
        } else {
            // Schedule retry
            const delay = this.config.retryDelays[attempts - 1] ?? 0;
            const updatedOp = {
                ...op,
                status: 'pending' as const,
                attempts,
                nextAttemptAt: Date.now() + delay,
            };
            await this.db.pending_ops.put(updatedOp);
            console.warn('[OutboxManager] Op will retry:', op.stamp.opId, 'attempt', attempts);
            await hooks.doAction('sync.retry:action', { op: updatedOp, attempt: attempts });
        }
    }

    /**
     * Check if an error is permanent and should not be retried
     */
    private isPermanentFailure(errorCode?: string, error?: string): boolean {
        // Use error code if available (preferred)
        if (errorCode) {
            switch (errorCode) {
                case 'VALIDATION_ERROR':
                case 'OVERSIZED':
                case 'UNAUTHORIZED':
                    return true;
                case 'CONFLICT':
                case 'NETWORK_ERROR':
                case 'RATE_LIMITED':
                case 'SERVER_ERROR':
                case 'UNKNOWN':
                    return false;
                default:
                    return false;
            }
        }

        // Fallback to string matching for legacy/unstructured errors
        if (!error) return false;

        // Oversized document - can't be fixed without app changes
        if (error.includes('Value is too large')) return true;
        if (error.includes('Payload too large for')) return true;
        if (error.includes('exceeds 65536 bytes')) return true;

        // Schema validation errors - data doesn't match expected format
        if (error.includes('does not match the schema')) return true;
        if (error.includes('does not match validator')) return true;
        if (error.includes('missing the required field')) return true;
        if (error.includes('Value does not match validator')) return true;

        // Server-side Zod validation rejection (push.post.ts returns 400 with this prefix)
        // These are permanent: the payload shape is wrong and retrying won't fix it
        if (error.includes('Invalid payload for')) return true;

        // Empty payload errors - payload was captured incorrectly (HookBridge bug)
        // These can't be fixed by retrying; the data is permanently missing
        if (error.includes('invalid_type') && error.includes('received undefined')) return true;

        return false;
    }

    private async markTombstoneSynced(op: PendingOp): Promise<void> {
        const id = `${op.tableName}:${op.pk}`;
        const existing = await this.db.tombstones.get(id);
        const syncedAt = nowSec();

        if (!existing) {
            await this.db.tombstones.put({
                id,
                tableName: op.tableName,
                pk: op.pk,
                deletedAt: syncedAt,
                clock: op.stamp.clock,
                syncedAt,
            });
            return;
        }

        if (existing.clock <= op.stamp.clock) {
            await this.db.tombstones.update(id, { clock: op.stamp.clock, syncedAt });
        }
    }

    /**
     * Get current pending count
     */
    async getPendingCount(): Promise<number> {
        return this.db.pending_ops.where('status').equals('pending').count();
    }

    /**
     * Get failed ops
     */
    async getFailedOps(): Promise<PendingOp[]> {
        return this.db.pending_ops.where('status').equals('failed').toArray();
    }

    /**
     * Retry failed ops
     */
    async retryFailed(): Promise<void> {
        await this.db.pending_ops
            .where('status')
            .equals('failed')
            .modify({ status: 'pending', attempts: 0, nextAttemptAt: undefined });
    }

    /**
     * Purge corrupt ops that have empty or invalid payloads.
     * These ops cannot be synced and will continuously fail with validation errors.
     * Returns the count of deleted ops.
     */
    async purgeCorruptOps(): Promise<number> {
        const allPending = await this.db.pending_ops.toArray();
        const corruptIds: string[] = [];

        for (const op of allPending) {
            // Check for delete ops (which don't need full payload)
            if (op.operation === 'delete') continue;

            // Check if payload is missing or empty
            if (!op.payload || typeof op.payload !== 'object') {
                corruptIds.push(op.id);
                continue;
            }

            // For message ops, check required fields
            if (op.tableName === 'messages') {
                const requiredFields = ['thread_id', 'role', 'index'];
                const hasAllRequired = requiredFields.every(
                    (field) => (op.payload as Record<string, unknown>)[field] !== undefined
                );
                if (!hasAllRequired) {
                    corruptIds.push(op.id);
                }
            }
        }

        if (corruptIds.length > 0) {
            await this.db.pending_ops.where('id').anyOf(corruptIds).delete();
            console.log(`[OutboxManager] Purged ${corruptIds.length} corrupt ops`);
        }

        return corruptIds.length;
    }

    /**
     * Remove all permanently-failed ops from the outbox.
     * These ops have exhausted retries or were classified as permanent failures.
     * Leaving them pollutes future flush cycles and can re-trigger error notifications.
     */
    private async purgeFailedOps(): Promise<void> {
        const count = await this.db.pending_ops.where('status').equals('failed').count();
        if (count > 0) {
            await this.db.pending_ops.where('status').equals('failed').delete();
            console.log(`[OutboxManager] Purged ${count} permanently-failed ops on startup`);
        }
    }
}
