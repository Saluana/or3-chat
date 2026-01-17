/**
 * OutboxManager - Manages the push loop for syncing local changes
 *
 * Responsibilities:
 * - Periodically flush pending_ops to the server
 * - Coalesce multiple updates to same record
 * - Retry failed operations with exponential backoff
 * - Emit hooks for observability
 */
import type { Or3DB } from '~/db/client';
import type { SyncProvider, SyncScope, PendingOp } from '~~/shared/sync/types';
import { useHooks } from '~/core/hooks/useHooks';
import { nowSec } from '~/db/util';
import { sanitizePayloadForSync } from '~~/shared/sync/sanitize';

/** Default retry delays in milliseconds */
const DEFAULT_RETRY_DELAYS = [250, 1000, 3000, 5000];

/** Default flush interval */
const DEFAULT_FLUSH_INTERVAL_MS = 1000;

/** Default max batch size */
const DEFAULT_MAX_BATCH_SIZE = 50;

/** Max pending ops before emitting capacity warning */
const MAX_PENDING_OPS = 500;

export interface OutboxManagerConfig {
    flushIntervalMs?: number;
    maxBatchSize?: number;
    retryDelays?: number[];
}

export class OutboxManager {
    private db: Or3DB;
    private provider: SyncProvider;
    private scope: SyncScope;
    private config: Required<OutboxManagerConfig>;

    private flushInterval: ReturnType<typeof setInterval> | null = null;
    private isFlushing = false;

    constructor(
        db: Or3DB,
        provider: SyncProvider,
        scope: SyncScope,
        config: OutboxManagerConfig = {}
    ) {
        this.db = db;
        this.provider = provider;
        this.scope = scope;
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
        if (this.flushInterval) return;

        this.flushInterval = setInterval(() => {
            this.flush().catch((err) => {
                console.error('[OutboxManager] Flush error:', err);
            });
        }, this.config.flushIntervalMs);

        // Initial flush
        this.flush().catch((err) => {
            console.error('[OutboxManager] Initial flush error:', err);
        });
    }

    /**
     * Stop the flush loop
     */
    stop(): void {
        if (this.flushInterval) {
            clearInterval(this.flushInterval);
            this.flushInterval = null;
        }
    }

    /**
     * Flush pending operations to the server
     */
    async flush(): Promise<void> {
        if (this.isFlushing) return;
        this.isFlushing = true;

        try {
            const hooks = useHooks();

            // Get pending ops
            const pendingOps = await this.db.pending_ops
                .where('status')
                .equals('pending')
                .sortBy('createdAt');

            if (!pendingOps.length) return;

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

            if (!dueOps.length) return;

            const batch = dueOps.slice(0, this.config.maxBatchSize);

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
                        await this.handleFailedOp(op, 'Missing push result');
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
                        await this.handleFailedOp(op, res.error);
                        failCount += 1;
                    }
                }

                await hooks.doAction('sync.push:action:after', {
                    scope: this.scope,
                    successCount,
                    failCount,
                });
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
                console.error('[OutboxManager] Push error:', error);
            }
        } finally {
            this.isFlushing = false;
        }
    }

    /**
     * Coalesce multiple ops for same record to latest
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
    private async handleFailedOp(op: PendingOp, error?: string): Promise<void> {
        const hooks = useHooks();
        const attempts = op.attempts + 1;
        const maxAttempts = this.config.retryDelays.length;

        // Check for permanent failures that should not be retried
        const isPermanent = this.isPermanentFailure(error);

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
    private isPermanentFailure(error?: string): boolean {
        if (!error) return false;

        // Oversized document - can't be fixed without app changes
        if (error.includes('Value is too large')) return true;

        // Schema validation errors - data doesn't match expected format
        if (error.includes('does not match the schema')) return true;
        if (error.includes('does not match validator')) return true;
        if (error.includes('missing the required field')) return true;
        if (error.includes('Value does not match validator')) return true;

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

        if ((existing.clock ?? 0) <= op.stamp.clock) {
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
}
