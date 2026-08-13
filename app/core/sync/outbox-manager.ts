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
import {
    MAX_SYNC_PUSH_BATCH_BYTES,
    syncJsonByteLength,
} from '~~/shared/sync/schemas';
import { markRecentOpId, unmarkRecentOpId } from './recent-op-cache';
import { getHookBridge } from './hook-bridge';
import { getSyncCircuitBreaker } from '~~/shared/sync/circuit-breaker';
import { compareSyncRevision } from '~~/shared/sync/revision';

/** Default retry delays in milliseconds */
const DEFAULT_RETRY_DELAYS = [250, 1000, 3000, 5000];

/** Default flush interval */
const DEFAULT_FLUSH_INTERVAL_MS = 1000;

/** Default max batch size */
const DEFAULT_MAX_BATCH_SIZE = 50;

/** Max pending ops before emitting capacity warning */
const MAX_PENDING_OPS = 500;

function httpStatusOf(error: unknown): number | null {
    if (!error || typeof error !== 'object') return null;
    const candidate = error as { status?: unknown; statusCode?: unknown };
    if (typeof candidate.status === 'number') return candidate.status;
    if (typeof candidate.statusCode === 'number') return candidate.statusCode;
    return null;
}

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
    private flushOwner: symbol | null = null;
    private isRunning = false;
    private needsSyncingRecovery = true;
    private providerRateLimitedUntil = 0;
    private lifecycleGeneration = 0;

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
        const generation = ++this.lifecycleGeneration;
        this.isRunning = true;
        this.needsSyncingRecovery = true;
        this.providerRateLimitedUntil = 0;
        this.scheduleNextFlush(0, generation);
    }

    /**
     * Stop the flush loop
     */
    stop(): void {
        this.lifecycleGeneration++;
        this.isRunning = false;
        if (this.flushTimeout) {
            clearTimeout(this.flushTimeout);
            this.flushTimeout = null;
        }
    }

    private scheduleNextFlush(delay: number, generation: number): void {
        if (!this.isRunning || generation !== this.lifecycleGeneration || this.flushTimeout) return;

        this.flushTimeout = setTimeout(async () => {
            this.flushTimeout = null;
            if (!this.isRunning || generation !== this.lifecycleGeneration) return;

            let didWork = false;
            try {
                didWork = await this.flush(generation);
            } catch (err) {
                console.error('[OutboxManager] Flush error:', err);
            }

            // If work was found, retry quickly, otherwise behave like a heartbeat
            const nextDelay = didWork ? 100 : this.config.flushIntervalMs;
            this.scheduleNextFlush(nextDelay, generation);
        }, delay);
    }

    /**
     * Flush pending operations to the server
     * Returns true if operations were processed
     */
    async flush(generation = this.lifecycleGeneration): Promise<boolean> {
        if (generation !== this.lifecycleGeneration || this.flushOwner) return false;

        // E2E Test Hook: Allow tests to simulate offline mode (dev only)
        if (import.meta.dev && (globalThis as { __OR3_TEST_OFFLINE?: boolean }).__OR3_TEST_OFFLINE) {
            return false;
        }

        // Check circuit breaker before attempting flush
        const circuitBreaker = getSyncCircuitBreaker(this.circuitBreakerKey);
        if (!circuitBreaker.canRetry()) {
            return false;
        }
        if (Date.now() < this.providerRateLimitedUntil) {
            return false;
        }

        const owner = Symbol('outbox-flush');
        this.flushOwner = owner;
        try {
            const hooks = useHooks();

            // Crash recovery: reset stale in-flight ops once when the loop starts.
            if (this.needsSyncingRecovery) {
                await this.db.pending_ops
                    .where('status')
                    .equals('syncing')
                    .modify({ status: 'pending', nextAttemptAt: Date.now() });
                if (generation !== this.lifecycleGeneration) return false;
                await this.db.pending_ops
                    .where('status')
                    .equals('in_flight')
                    .modify({ status: 'pending', nextAttemptAt: Date.now() });
                if (generation !== this.lifecycleGeneration) return false;
                this.needsSyncingRecovery = false;
            }

            // Get pending ops (limited to prevent O(N) memory usage)
            // We fetch more than maxBatchSize to allow for some coalescing
            const scanLimit = this.config.maxBatchSize * 10;
            const pendingOps = [
                ...(await this.db.pending_ops
                    .where('status')
                    .equals('pending')
                    .limit(scanLimit)
                    .toArray()),
                ...(await this.db.pending_ops
                    .where('status')
                    .equals('retry_wait')
                    .limit(scanLimit)
                    .toArray()),
            ].slice(0, scanLimit);
            if (generation !== this.lifecycleGeneration) return false;
            
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

            const batch = this.packDueOps(dueOps);
            if (!batch.length) return false;

            if (!circuitBreaker.beginProbe()) return false;
            let probeSettled = false;

            try {
                const outcome = await this.pushBatchWithSplit(
                    batch,
                    generation,
                    hooks
                );
                if (generation !== this.lifecycleGeneration) return false;

                if (outcome.deferred) {
                    circuitBreaker.recordSuccess();
                    probeSettled = true;
                    return false;
                }

                if (outcome.successCount > 0 && outcome.failCount === 0) {
                    circuitBreaker.recordSuccess();
                } else if (outcome.failCount > 0) {
                    circuitBreaker.recordFailure();
                } else {
                    circuitBreaker.recordSuccess();
                }
                probeSettled = true;
                return true;
            } finally {
                if (!probeSettled) circuitBreaker.recordFailure();
            }
        } finally {
            if (this.flushOwner === owner) this.flushOwner = null;
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

            if (
                !existing ||
                compareSyncRevision(op.stamp, existing.stamp) > 0
            ) {
                byKey.set(key, op);
            }
        }

        return Array.from(byKey.values()).sort((a, b) => {
            const captureOrder = a.createdAt - b.createdAt;
            if (captureOrder) return captureOrder;
            const revisionOrder = compareSyncRevision(a.stamp, b.stamp);
            return revisionOrder || a.id.localeCompare(b.id);
        });
    }

    private packDueOps(dueOps: PendingOp[]): PendingOp[] {
        const packed: PendingOp[] = [];
        for (const op of dueOps) {
            if (packed.length >= this.config.maxBatchSize) break;
            const candidate = [...packed, op];
            const bytes = syncJsonByteLength({
                scope: this.scope,
                ops: candidate,
            });
            if (packed.length > 0 && bytes > MAX_SYNC_PUSH_BATCH_BYTES) break;
            packed.push(op);
        }
        return packed;
    }

    private async pushBatchWithSplit(
        batch: PendingOp[],
        generation: number,
        hooks: ReturnType<typeof useHooks>
    ): Promise<{ successCount: number; failCount: number; deferred: boolean }> {
        if (generation !== this.lifecycleGeneration) {
            return { successCount: 0, failCount: 0, deferred: false };
        }

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
        if (generation !== this.lifecycleGeneration) {
            return { successCount: 0, failCount: 0, deferred: false };
        }

        await this.db.pending_ops.bulkPut(
            batch.map((op) => ({ ...op, status: 'in_flight' as const }))
        );
        if (generation !== this.lifecycleGeneration) {
            return { successCount: 0, failCount: 0, deferred: false };
        }

        try {
            const sanitizedBatch = batch.map((op) => ({
                ...op,
                payload: sanitizePayloadForSync(op.tableName, op.payload, op.operation),
            }));

            for (const op of batch) {
                markRecentOpId(op.stamp.opId);
            }

            const result = await this.provider.push({
                scope: this.scope,
                ops: sanitizedBatch,
            });
            if (generation !== this.lifecycleGeneration) {
                return { successCount: 0, failCount: 0, deferred: false };
            }

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

                if (res.success && res.applied === false) {
                    const hasWinner =
                        res.payload !== undefined && res.payload !== null;
                    if (!hasWinner && op.operation !== 'delete') {
                        await this.handleFailedOp(
                            op,
                            'Missing winner payload',
                            'UNKNOWN'
                        );
                        failCount += 1;
                        continue;
                    }
                    await this.applyRemoteWinner(op, res.payload);
                    unmarkRecentOpId(op.stamp.opId);
                    if (op.operation === 'delete') {
                        await this.markTombstoneSynced(op, res.serverVersion);
                    }
                    await this.db.pending_ops.put({ ...op, status: 'applied' });
                    await this.db.pending_ops.delete(op.id);
                    successCount += 1;
                    continue;
                }

                if (res.success) {
                    if (op.operation === 'delete') {
                        await this.markTombstoneSynced(op, res.serverVersion);
                    }
                    await this.db.pending_ops.put({ ...op, status: 'applied' });
                    await this.db.pending_ops.delete(op.id);
                    successCount += 1;
                } else {
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

            return { successCount, failCount, deferred: false };
        } catch (error) {
            if (generation !== this.lifecycleGeneration) {
                return { successCount: 0, failCount: 0, deferred: false };
            }

            const status = httpStatusOf(error);
            if (status === 401 || status === 403) {
                await this.releaseBatchForDeferredRetry(
                    batch,
                    this.config.retryDelays[0] ?? DEFAULT_RETRY_DELAYS[0] ?? 250
                );
                await hooks.doAction('sync.push:action:after', {
                    scope: this.scope,
                    successCount: 0,
                    failCount: 0,
                });
                return { successCount: 0, failCount: 0, deferred: true };
            }

            if (this.isWholeRequestClientError(error) && batch.length > 1) {
                const mid = Math.ceil(batch.length / 2);
                const left = await this.pushBatchWithSplit(
                    batch.slice(0, mid),
                    generation,
                    hooks
                );
                if (generation !== this.lifecycleGeneration) {
                    return { successCount: 0, failCount: 0, deferred: false };
                }
                const right = await this.pushBatchWithSplit(
                    batch.slice(mid),
                    generation,
                    hooks
                );
                return {
                    successCount: left.successCount + right.successCount,
                    failCount: left.failCount + right.failCount,
                    deferred: left.deferred || right.deferred,
                };
            }

            const deferredRetryDelayMs = this.getDeferredRetryDelayMs(error);
            if (deferredRetryDelayMs !== null) {
                await this.releaseBatchForDeferredRetry(batch, deferredRetryDelayMs);
                this.providerRateLimitedUntil = Math.max(
                    this.providerRateLimitedUntil,
                    Date.now() + deferredRetryDelayMs
                );
                await hooks.doAction('sync.push:action:after', {
                    scope: this.scope,
                    successCount: 0,
                    failCount: 0,
                });
                if (import.meta.dev) {
                    console.warn('[OutboxManager] Push deferred by transient upstream status', {
                        scope: this.scope,
                        batchSize: batch.length,
                        retryAfterMs: deferredRetryDelayMs,
                    });
                }
                return { successCount: 0, failCount: 0, deferred: true };
            }

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
            return { successCount: 0, failCount, deferred: false };
        }
    }

    private isWholeRequestClientError(error: unknown): boolean {
        const status = httpStatusOf(error);
        return status === 400 || status === 413;
    }

    private async applyRemoteWinner(op: PendingOp, winnerPayload: unknown): Promise<void> {
        const hookBridge = getHookBridge(this.db);
        const tableNames = Array.from(new Set([op.tableName, 'tombstones']));
        await this.db.transaction('rw', tableNames, async (tx) => {
            hookBridge.markSyncTransaction(tx);
            const table = tx.table(op.tableName);
            if (winnerPayload && typeof winnerPayload === 'object' && !Array.isArray(winnerPayload)) {
                await table.put(winnerPayload as Record<string, unknown>);
                return;
            }
            if (op.operation === 'delete') {
                await table.delete(op.pk);
                const deletedAt = nowSec();
                await tx.table('tombstones').put({
                    id: `${op.tableName}:${op.pk}`,
                    tableName: op.tableName,
                    pk: op.pk,
                    deletedAt,
                    clock: op.stamp.clock,
                    hlc: op.stamp.hlc,
                    opId: op.stamp.opId,
                });
            }
        });
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
        if (errorCode === 'RATE_LIMITED' || this.isRateLimitMessage(error)) {
            const rateLimitDelayMs =
                this.parseRetryAfterFromMessage(error) ??
                this.config.retryDelays[0] ??
                DEFAULT_RETRY_DELAYS[0] ??
                250;
            const nextAttemptAt = Date.now() + rateLimitDelayMs;
            this.providerRateLimitedUntil = Math.max(this.providerRateLimitedUntil, nextAttemptAt);
            const updatedOp = {
                ...op,
                status: 'retry_wait' as const,
                nextAttemptAt,
            };
            await this.db.pending_ops.put(updatedOp);
            await hooks.doAction('sync.retry:action', { op: updatedOp, attempt: op.attempts });
            return;
        }

        const attempts = op.attempts + 1;
        const maxAttempts = this.config.retryDelays.length;

        // Check for permanent failures that should not be retried
        const isPermanent = this.isPermanentFailure(errorCode, error);

        if (isPermanent || attempts >= maxAttempts) {
            // Max retries reached or permanent failure - mark as failed
            const updatedOp = {
                ...op,
                status: isPermanent ? 'failed_permanent' as const : 'failed_retryable' as const,
                attempts,
                lastError: error,
                lastErrorCode: errorCode as PendingOp['lastErrorCode'],
                failureKind: isPermanent
                    ? 'permanent' as const
                    : 'retry_exhausted' as const,
                failedAt: Date.now(),
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
                status: 'retry_wait' as const,
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

    private getDeferredRetryDelayMs(error: unknown): number | null {
        if (!error || typeof error !== 'object') return null;
        const candidate = error as {
            status?: unknown;
            retryAfterMs?: unknown;
            message?: unknown;
        };

        const status = typeof candidate.status === 'number' ? candidate.status : null;
        if (status === null || ![429, 502, 503, 504].includes(status)) return null;

        if (
            typeof candidate.retryAfterMs === 'number' &&
            Number.isFinite(candidate.retryAfterMs) &&
            candidate.retryAfterMs > 0
        ) {
            return candidate.retryAfterMs;
        }

        if (typeof candidate.message === 'string') {
            const fromMessage = this.parseRetryAfterFromMessage(candidate.message);
            if (fromMessage !== null) return fromMessage;
        }

        return this.config.retryDelays[0] ?? DEFAULT_RETRY_DELAYS[0] ?? 250;
    }

    private parseRetryAfterFromMessage(message?: string): number | null {
        if (!message) return null;
        const match = /retry after\s+(\d+(?:\.\d+)?)s/i.exec(message);
        if (!match) return null;
        const seconds = Number(match[1]);
        if (!Number.isFinite(seconds) || seconds <= 0) return null;
        return Math.ceil(seconds * 1000);
    }

    private isRateLimitMessage(message?: string): boolean {
        if (!message) return false;
        return message.toLowerCase().includes('rate limit');
    }

    private async releaseBatchForDeferredRetry(batch: PendingOp[], retryAfterMs: number): Promise<void> {
        const nextAttemptAt = Date.now() + retryAfterMs;
        await this.db.pending_ops.bulkPut(
            batch.map((op) => ({
                ...op,
                status: 'retry_wait' as const,
                nextAttemptAt,
            }))
        );
    }

    private async markTombstoneSynced(op: PendingOp, serverVersion?: number): Promise<void> {
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
                hlc: op.stamp.hlc,
                opId: op.stamp.opId,
                serverVersion,
                syncedAt,
            });
            return;
        }

        const shouldAdvance = existing.clock < op.stamp.clock || (
            existing.clock === op.stamp.clock && (
                !existing.hlc ||
                !existing.opId ||
                compareSyncRevision(op.stamp, {
                    clock: existing.clock,
                    hlc: existing.hlc,
                    opId: existing.opId,
                }) >= 0
            )
        );
        if (shouldAdvance) {
            await this.db.tombstones.update(id, {
                clock: op.stamp.clock,
                hlc: op.stamp.hlc,
                opId: op.stamp.opId,
                serverVersion: serverVersion ?? existing.serverVersion,
                syncedAt,
            });
        }
    }

    /**
     * Get current pending count
     */
    async getPendingCount(): Promise<number> {
        const [pending, retryWait] = await Promise.all([
            this.db.pending_ops.where('status').equals('pending').count(),
            this.db.pending_ops.where('status').equals('retry_wait').count(),
        ]);
        return pending + retryWait;
    }

    /**
     * Get failed ops
     */
    async getFailedOps(): Promise<PendingOp[]> {
        const [legacy, retryable, permanent] = await Promise.all([
            this.db.pending_ops.where('status').equals('failed').toArray(),
            this.db.pending_ops.where('status').equals('failed_retryable').toArray(),
            this.db.pending_ops.where('status').equals('failed_permanent').toArray(),
        ]);
        return [...legacy, ...retryable, ...permanent];
    }

    /**
     * Retry failed ops
     */
    async retryFailed(opId?: string): Promise<void> {
        if (opId) {
            const failed = (await this.getFailedOps()).find(
                (op) => op.id === opId || op.stamp.opId === opId
            );
            if (!failed) return;
            await this.db.pending_ops.put({
                ...failed,
                status: 'pending',
                attempts: 0,
                nextAttemptAt: undefined,
                lastError: undefined,
                lastErrorCode: undefined,
                failureKind: undefined,
                failedAt: undefined,
            });
            return;
        }

        const failed = await this.getFailedOps();
        await this.db.pending_ops.bulkPut(failed.map((op) => ({
            ...op,
            status: 'pending' as const,
            attempts: 0,
            nextAttemptAt: undefined,
            lastError: undefined,
            lastErrorCode: undefined,
            failureKind: undefined,
            failedAt: undefined,
        })));
    }

    /** Retain an auditable terminal record of an intentional user discard. */
    async discardFailed(opId: string, reason = 'user_discarded'): Promise<boolean> {
        const failed = (await this.getFailedOps()).find(
            (op) => op.id === opId || op.stamp.opId === opId
        );
        if (!failed) return false;
        await this.db.pending_ops.put({
            ...failed,
            status: 'discarded',
            discardedAt: Date.now(),
            discardReason: reason,
        });
        return true;
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
            if (import.meta.dev) {
                console.log(`[OutboxManager] Purged ${corruptIds.length} corrupt ops`);
            }
        }

        return corruptIds.length;
    }

}
