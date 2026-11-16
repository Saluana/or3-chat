import { invalidateFirstBindEligibility, readHistory, sameHistory, requestHistoryReset, changedHistoryFromError, isHistoryProtocolBoundary, pauseHistoryProtocol, protocolPauseId, type HistoryGuard } from './history-incarnation';
import { createRuntimeUuid } from '~~/shared/runtime-id';
import { errorDiagnostics, presentError, type ErrorMetadata } from '~~/shared/errors';
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
 * - Retry delays: [250ms, 1s, 3s, 5s], then capped retries until recovery
 * - Circuit breaker prevents flush attempts when the provider is down
 * - Wire payloads are normalized durably before their first push
 *
 * @see core/sync/hook-bridge for the write capture side
 * @see shared/sync/circuit-breaker for circuit breaker implementation
 * @see shared/sync/sanitize for payload sanitization
 */
import type { Or3DB, SyncQuarantineRow } from '~/db/client';
import type { SyncProvider, SyncScope, PendingOp, PushWinner } from '~~/shared/sync/types';
import { observeSyncAction } from './sync-observers';
import { useHooks } from '~/core/hooks/useHooks';
import { nowSec } from '~/db/util';
import { sanitizePayloadForSync, SyncPayloadTooLargeError } from '~~/shared/sync/sanitize';
import {
    MAX_SYNC_PUSH_BATCH_BYTES,
    PushResultItemSchema,
    syncJsonByteLength,
} from '~~/shared/sync/schemas';
import { markRecentOpId, unmarkRecentOpId } from './recent-op-cache';
import { getHookBridge, SYNCED_TABLES } from './hook-bridge';
import { getSyncCircuitBreaker } from '~~/shared/sync/circuit-breaker';
import { compareSyncRevision } from '~~/shared/sync/revision';
import { normalizeSyncPayload } from './sync-payload-normalizer';
import {
    discardQuarantined,
    exportQuarantined,
    listQuarantined,
    pruneResolvedQuarantineBestEffort,
    quarantineCorruptOps,
    type QuarantineSummary,
} from './sync-quarantine';

/** Default retry delays in milliseconds */
const DEFAULT_RETRY_DELAYS = [250, 1000, 3000, 5000];
const MAX_AUTH_RETRY_DELAY_MS = 60_000;

/** Default flush interval */
const DEFAULT_FLUSH_INTERVAL_MS = 1000;

/** Default max batch size */
const DEFAULT_MAX_BATCH_SIZE = 50;

/** Max pending ops before emitting capacity warning */
const MAX_PENDING_OPS = 500;

// A request ends before its durable claim expires. If a tab is suspended, the
// next tab can reclaim it and every late settlement is conditional on the token.
const PUSH_TIMEOUT_MS = 30_000;
const CLAIM_DURATION_MS = 60_000;

class InvalidServerWinnerError extends Error {}

type EligibleStatus = 'pending' | 'retry_wait';

function getReadyAt(op: PendingOp): number {
    if (typeof op.readyAt === 'number' && Number.isFinite(op.readyAt)) {
        return op.readyAt;
    }
    if (typeof op.nextAttemptAt === 'number' && Number.isFinite(op.nextAttemptAt)) {
        return op.nextAttemptAt;
    }
    return 0;
}

function compareSchedulingKey(a: PendingOp, b: PendingOp): number {
    const readyOrder = getReadyAt(a) - getReadyAt(b);
    if (readyOrder) return readyOrder;
    const createdOrder = a.createdAt - b.createdAt;
    if (createdOrder) return createdOrder;
    return a.id.localeCompare(b.id);
}

function stripReadyAt(op: PendingOp): Omit<PendingOp, 'readyAt' | 'claimId' | 'claimExpiresAt' | 'wireNormalized'> {
    const { readyAt: _omitted, claimId: _claim, claimExpiresAt: _expiry, wireNormalized: _normalized, ...rest } = op;
    return rest;
}

// Persisted rows are untrusted until this check passes.
type UncheckedOp = Partial<Omit<PendingOp, 'stamp'>> & { stamp?: Partial<PendingOp['stamp']> };

function hasComparableRevision(op: UncheckedOp): boolean {
    return !!op.stamp && typeof op.stamp.clock === 'number' && Number.isFinite(op.stamp.clock)
        && typeof op.stamp.hlc === 'string' && !!op.stamp.hlc
        && typeof op.stamp.opId === 'string' && !!op.stamp.opId
        && typeof op.tableName === 'string' && (SYNCED_TABLES as readonly string[]).includes(op.tableName)
        && (op.operation === 'put' || op.operation === 'delete')
        && typeof op.pk === 'string' && !!op.pk;
}

type LocalRevision = { clock: number; hlc: string; opId: string };

function materializedRevisionFromRow(row: unknown): LocalRevision {
    const rec = (row && typeof row === 'object' ? row : {}) as Record<string, unknown>;
    return {
        clock: typeof rec.clock === 'number' && Number.isFinite(rec.clock) ? rec.clock : 0,
        hlc: typeof rec.hlc === 'string' ? rec.hlc : '',
        opId:
            typeof rec.op_id === 'string'
                ? rec.op_id
                : typeof rec.opId === 'string'
                  ? rec.opId
                  : '',
    };
}

function winnerRevisionFromPayload(payload: unknown, fallback: LocalRevision): LocalRevision {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        return fallback;
    }
    const rec = payload as Record<string, unknown>;
    return {
        clock:
            typeof rec.clock === 'number' && Number.isFinite(rec.clock)
                ? rec.clock
                : fallback.clock,
        hlc: typeof rec.hlc === 'string' ? rec.hlc : '',
        opId:
            typeof rec.op_id === 'string'
                ? rec.op_id
                : typeof rec.opId === 'string'
                  ? rec.opId
                  : fallback.opId,
    };
}

function tombstoneRevisionFromRow(row: unknown): LocalRevision | undefined {
    if (!row || typeof row !== 'object') return undefined;
    const rec = row as { clock?: unknown; hlc?: unknown; opId?: unknown; op_id?: unknown };
    if (typeof rec.clock !== 'number' || !Number.isFinite(rec.clock)) return undefined;
    return {
        clock: rec.clock,
        hlc: typeof rec.hlc === 'string' ? rec.hlc : '',
        opId: typeof rec.opId === 'string' ? rec.opId : typeof rec.op_id === 'string' ? rec.op_id : '',
    };
}

// Fail closed like the pull path: an equal-clock tombstone without full
// tie-break metadata blocks the incoming revision until repaired.
function tombstoneBlocksRevision(
    tombstone: { clock: number; hlc?: string; opId?: string } | undefined,
    incoming: LocalRevision
): boolean {
    if (!tombstone) return false;
    if (tombstone.clock !== incoming.clock) return tombstone.clock > incoming.clock;
    if (!tombstone.hlc || !tombstone.opId) return true;
    return (
        compareSyncRevision(
            { clock: tombstone.clock, hlc: tombstone.hlc, opId: tombstone.opId },
            incoming
        ) >= 0
    );
}

function interleaveByStatus<T extends PendingOp>(
    pending: T[],
    retryWait: T[],
    limit: number,
    first: EligibleStatus
): T[] {
    const merged: T[] = [];
    let pendingIndex = 0;
    let retryIndex = 0;
    let turn: EligibleStatus = first;
    while (merged.length < limit && (pendingIndex < pending.length || retryIndex < retryWait.length)) {
        if (turn === 'pending' && pendingIndex < pending.length) {
            merged.push(pending[pendingIndex++]!);
            turn = 'retry_wait';
        } else if (turn === 'retry_wait' && retryIndex < retryWait.length) {
            merged.push(retryWait[retryIndex++]!);
            turn = 'pending';
        } else if (pendingIndex < pending.length) {
            merged.push(pending[pendingIndex++]!);
        } else {
            merged.push(retryWait[retryIndex++]!);
        }
    }
    return merged;
}

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
    private pushAbortController: AbortController | null = null;
    private isRunning = false;
    private needsSyncingRecovery = true;
    private providerRateLimitedUntil = 0;
    // A revoked permission keeps returning 403, and each rejection refreshes
    // the session, so consecutive auth failures back off instead of looping.
    private authFailures = 0;
    private lifecycleGeneration = 0;
    private historyGuard: HistoryGuard | undefined;
    private superseded = new Map<string, PendingOp[]>();
    private nextStatus: EligibleStatus = 'retry_wait';

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
        this.authFailures = 0;
        this.scheduleNextFlush(0, generation);
    }

    /**
     * Stop the flush loop
     */
    stop(): void {
        this.lifecycleGeneration++;
        this.isRunning = false;
        this.pushAbortController?.abort(new Error('Sync push stopped'));
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

    // Read ownership afresh after awaits; another flush may have acquired it.
    private canFlush(generation: number): boolean {
        return generation === this.lifecycleGeneration && this.flushOwner === null;
    }

    /**
     * Flush pending operations to the server
     * Returns true if operations were processed
     */
    async flush(generation = this.lifecycleGeneration): Promise<boolean> {
        if (!this.canFlush(generation)) return false;

        // Offline time must not consume the retry budget of durable local edits.
        // The existing heartbeat sends the retained queue once connectivity returns.
        if (typeof navigator !== 'undefined' && navigator.onLine === false) return false;

        // E2E Test Hook: Allow tests to simulate offline mode (dev only)
        if (import.meta.dev && (globalThis as { __OR3_TEST_OFFLINE?: boolean }).__OR3_TEST_OFFLINE) {
            return false;
        }

        if ((await this.db.sync_state.get(protocolPauseId(this.provider.id, this.scope)))?.protocolPause) return false;
        if (this.provider.capabilities?.historyIncarnation === 'v1') {
            const captured = await readHistory(this.db);
            if (!this.canFlush(generation)) return false;
            this.historyGuard = captured;
            if (this.historyGuard.phase !== 'ready' || !this.historyGuard.historyIncarnation) return false;
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
        const controller = new AbortController();
        this.pushAbortController = controller;
        const deadline = setTimeout(() => controller.abort(new Error('Sync push timed out')), PUSH_TIMEOUT_MS);
        let claimed: PendingOp[] = [];
        try {
            const hooks = useHooks();

            // A startup in another tab must not steal an active push. Recovery
            // runs on every heartbeat so an abandoned lease also recovers when
            // this manager was already open at the time of the crash.
            await this.recoverAbandonedOps();
            if (generation !== this.lifecycleGeneration) return false;
            if (this.needsSyncingRecovery) {
                await this.db.transaction('rw', ['pending_ops', 'sync_state'], async () => {
                    if (!await this.historyMatches()) return;
                    await this.db.pending_ops.where('status').equals('failed_retryable')
                        .modify({ status: 'retry_wait', nextAttemptAt: undefined, failureKind: undefined, failedAt: undefined });
                });
                await pruneResolvedQuarantineBestEffort(this.db);
                if (generation !== this.lifecycleGeneration) return false;
                this.needsSyncingRecovery = false;
            }

            // Select already-due work with bounded indexed reads. Each status
            // stream is ordered by (readyAt, createdAt, id) before limiting;
            // the streams share the combined scan limit fairly.
            const scanLimit = this.config.maxBatchSize * 10;
            const now = Date.now();
            const [pendingDue, retryDue] = await Promise.all([
                this.queryEligibleOps('pending', now, scanLimit),
                this.queryEligibleOps('retry_wait', now, scanLimit),
            ]);
            if (generation !== this.lifecycleGeneration) return false;

            const pendingOps = interleaveByStatus(
                pendingDue,
                retryDue,
                scanLimit,
                this.nextStatus
            );

            if (!pendingOps.length) return false;

            // Log only when there's work to do

            // Check capacity from indexed queue counts; the ready candidate
            // count is no longer a suitable proxy for total backlog.
            const totalQueued = await this.getPendingCount();
            if (generation !== this.lifecycleGeneration) return false;
            if (totalQueued >= MAX_PENDING_OPS) {
                console.warn('[OutboxManager] Queue near capacity:', totalQueued);
                await observeSyncAction(hooks, 'sync.queue:action:full', {
                    pendingCount: totalQueued,
                    maxSize: MAX_PENDING_OPS,
                });
            }

            // Reject malformed persisted revisions before comparison. Preserve
            // the original and local content through the existing quarantine
            // transaction rather than letting one row jam every selected key.
            const malformed = pendingOps.filter((op) => !hasComparableRevision(op));
            if (malformed.length) await quarantineCorruptOps(this.db, 'manual', malformed);
            if (generation !== this.lifecycleGeneration) return false;

            // Selection is optimistic, ownership is not: re-read, coalesce and
            // claim in one IndexedDB write transaction shared by every tab.
            const batch = await this.claimBatch(pendingOps.filter(hasComparableRevision));
            claimed = batch;
            if (!batch.length) return false;

            const probe = circuitBreaker.acquireProbe();
            if (!probe) {
                await this.releaseBatchForDeferredRetry(batch, 0);
                return false;
            }
            // Consume the turn only when a batch actually starts a push
            // attempt. Empty or gated flushes preserve it. The last packed
            // operation decides so single-op and byte-limited batches do not
            // reserve unused slots.
            const lastStatus = batch[batch.length - 1]?.status;
            if (lastStatus === 'pending' || lastStatus === 'retry_wait') {
                this.nextStatus =
                    lastStatus === 'pending' ? 'retry_wait' : 'pending';
            }
            const cancelProbe = () => probe.cancel();
            controller.signal.addEventListener('abort', cancelProbe, { once: true });
            if (controller.signal.aborted) probe.cancel();
            let probeSettled = false;

            try {
                const outcome = await this.pushBatchWithSplit(
                    batch,
                    generation,
                    hooks
                );
                if (generation !== this.lifecycleGeneration) return false;

                if (outcome.deferred) {
                    probe.success();
                    probeSettled = true;
                    return false;
                }

                if (outcome.successCount > 0 && outcome.failCount === 0) {
                    probe.success();
                } else if (outcome.serviceFailure ?? outcome.failCount > 0) {
                    probe.failure();
                } else {
                    probe.success();
                }
                probeSettled = true;
                return true;
            } finally {
                controller.signal.removeEventListener('abort', cancelProbe);
                if (!probeSettled) {
                    if (controller.signal.aborted || generation !== this.lifecycleGeneration) probe.cancel();
                    else probe.failure();
                }
            }
        } finally {
            clearTimeout(deadline);
            if (generation !== this.lifecycleGeneration && claimed.length) {
                await this.releaseBatchForDeferredRetry(claimed, 0);
            }
            this.superseded.clear();
            if (this.pushAbortController === controller) this.pushAbortController = null;
            if (this.flushOwner === owner) this.flushOwner = null;
        }
    }

    /** Hold uncertain committed intent without reconstruction or automatic re-ID. */
    private async holdOp(op: PendingOp, reason: string, serverWinner?: PushWinner, evidenceRef?: string): Promise<void> {
        await this.db.transaction('rw', ['pending_ops', 'sync_quarantine', 'tombstones', 'sync_state', op.tableName], async () => {
            if (!await this.ownsClaim(op)) return;
            await this.db.sync_quarantine.put({
                id: op.id, tableName: op.tableName, pk: op.pk, source: 'manual',
                status: 'quarantined', op, diagnostics: [reason], serverWinner,
                localRow: await this.db.table(op.tableName).get(op.pk),
                localTombstone: await this.db.tombstones.get(`${op.tableName}:${op.pk}`),
                ...(evidenceRef ? { variant: 'stored_record' as const, evidenceRef, accountId: this.scope.principalId, scope: this.scope } : {}),
                quarantinedAt: Date.now(),
            });
            await this.db.pending_ops.delete(op.id);
        });
        unmarkRecentOpId(op.stamp.opId, { dbName: this.db.name, historyIncarnation: this.historyGuard?.historyIncarnation ?? this.db.syncHistoryAtOpen });
    }

    private async recoverAbandonedOps(): Promise<void> {
        await this.db.transaction('rw', ['pending_ops', 'sync_state'], async () => {
            if (!await this.historyMatches()) return;
            for (const status of ['syncing', 'in_flight'] as const) {
                const rows = await this.db.pending_ops.where('status').equals(status).toArray();
                for (const op of rows) {
                    if (op.claimId && (op.claimExpiresAt ?? 0) > Date.now()) continue;
                    await this.db.pending_ops.put({ ...op, status: 'pending', nextAttemptAt: undefined, wireNormalized: op.wireNormalized ?? false,
                        claimId: undefined, claimExpiresAt: undefined });
                }
            }
        });
    }

    private async claimBatch(selected: PendingOp[]): Promise<PendingOp[]> {
        return this.db.transaction('rw', ['pending_ops', 'sync_state'], async () => {
            if (!await this.historyMatches()) return [];
            const current = (await Promise.all(selected.map((op) => this.db.pending_ops.get(op.id))))
                .filter((op): op is PendingOp => !!op && (op.status === 'pending' || op.status === 'retry_wait')
                    && getReadyAt(op) <= Date.now() && hasComparableRevision(op));
            const winners = this.coalesceOps(current);
            const winnerIds = new Set(winners.map((op) => op.id));
            const dropped = current.filter((op) => !winnerIds.has(op.id));
            if (!this.historyGuard && dropped.length) await this.db.pending_ops.bulkDelete(dropped.map((op) => op.id));
            const claimId = createRuntimeUuid();
            const batch = this.packDueOps(this.restoreFairOrder(winners)).map((op) => ({
                ...op, claimId, claimExpiresAt: Date.now() + CLAIM_DURATION_MS,
            }));
            if (this.historyGuard) for (const winner of batch) {
                this.superseded.set(winner.id, dropped.filter(op => op.tableName === winner.tableName && op.pk === winner.pk));
            }
            await this.db.pending_ops.bulkPut(batch.map((op) => ({ ...op, status: 'in_flight' as const })));
            return batch;
        });
    }

    private async historyMatches(): Promise<boolean> {
        return !this.historyGuard || sameHistory(await readHistory(this.db), this.historyGuard);
    }

    private async ownsClaim(op: PendingOp): Promise<boolean> {
        if (!await this.historyMatches()) return false;
        const current = await this.db.pending_ops.get(op.id);
        return !!current && current.status === 'in_flight' && !!op.claimId
            && current.claimId === op.claimId && (current.claimExpiresAt ?? 0) > Date.now();
    }

    private async updateClaimedOp(op: PendingOp, update: PendingOp): Promise<boolean> {
        return this.db.transaction('rw', ['pending_ops', 'sync_state'], async () => {
            if (!await this.ownsClaim(op)) return false;
            const current = (await this.db.pending_ops.get(op.id))!;
            // A cancellation can still hold the pre-normalization claim copy.
            // Never let its scheduling update undo already-frozen wire intent.
            await this.db.pending_ops.put({ ...update,
                ...(current.wireNormalized === true ? { payload: current.payload, wireNormalized: true } : {}),
                claimId: undefined, claimExpiresAt: undefined });
            return true;
        });
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

    private async queryEligibleOps(
        status: EligibleStatus,
        now: number,
        limit: number
    ): Promise<PendingOp[]> {
        const rows = (await (this.db.pending_ops as unknown as {
            where: (index: string) => {
                between: (
                    lower: unknown[],
                    upper: unknown[],
                    lowerOpen: boolean,
                    upperOpen: boolean
                ) => { limit: (n: number) => { toArray: () => Promise<PendingOp[]> } };
            };
        })
            .where('[status+readyAt+createdAt+id]')
            .between(
                [status, 0, 0, ''],
                [status, now, Number.MAX_SAFE_INTEGER, '\uffff'],
                true,
                true
            )
            .limit(limit)
            .toArray()) as PendingOp[];
        // The index range already enforces eligibility and ordering. Filter
        // and sort defensively so doubles without the projection (legacy mock
        // rows) behave identically without moving policy into test doubles.
        return rows
            .filter((op) => op.status === status && getReadyAt(op) <= now)
            .sort(compareSchedulingKey)
            .slice(0, limit);
    }

    private restoreFairOrder(winners: PendingOp[]): PendingOp[] {
        const pending = winners
            .filter((op) => op.status === 'pending')
            .sort(compareSchedulingKey);
        const retryWait = winners
            .filter((op) => op.status === 'retry_wait')
            .sort(compareSchedulingKey);
        const rest = winners
            .filter((op) => op.status !== 'pending' && op.status !== 'retry_wait')
            .sort(compareSchedulingKey);
        return [
            ...interleaveByStatus(
                pending,
                retryWait,
                pending.length + retryWait.length,
                this.nextStatus
            ),
            ...rest,
        ];
    }

    private packDueOps(dueOps: PendingOp[]): PendingOp[] {
        const packed: PendingOp[] = [];
        for (const op of dueOps) {
            if (packed.length >= this.config.maxBatchSize) break;
            // Size the wire form without the local-only projection.
            const candidate = [...packed, op].map(stripReadyAt);
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
    ): Promise<{ successCount: number; failCount: number; deferred: boolean; serviceFailure?: boolean }> {
        if (generation !== this.lifecycleGeneration) {
            return { successCount: 0, failCount: 0, deferred: false };
        }

        if (import.meta.dev) {
            console.debug('[sync] outbox push start', {
                scope: this.scope,
                batchSize: batch.length,
            });
        }

        await observeSyncAction(hooks, 'sync.push:action:before', {
            scope: this.scope,
            count: batch.length,
        });
        if (generation !== this.lifecycleGeneration) {
            return { successCount: 0, failCount: 0, deferred: false };
        }

        const valid: PendingOp[] = [];
        const sanitizedBatch: PendingOp[] = [];
        let localFailCount = 0;
        for (const op of batch) {
            if (generation !== this.lifecycleGeneration) {
                return { successCount: 0, failCount: 0, deferred: false };
            }
            // Old code used the send-time wall clock for missing thread times.
            // An attempted legacy op cannot be safely normalized under its UUID.
            const payload = op.payload as Record<string, unknown> | undefined;
            const unstableLegacy = op.wireNormalized !== true && op.tableName === 'threads' && payload &&
                (typeof payload.created_at !== 'number' || typeof payload.updated_at !== 'number');
            if (unstableLegacy && (op.attempts > 0 || op.status === 'retry_wait' || op.wireNormalized === false)) {
                await this.holdOp(op, 'Legacy timestamp normalization has uncertain prior wire intent');
                localFailCount++;
                continue;
            }
            let normalized: PendingOp;
            try {
                normalized = op.wireNormalized === true ? op : {
                    ...op, payload: sanitizePayloadForSync(op.tableName, op.payload, op.operation), wireNormalized: true,
                };
            } catch (error) {
                await this.handleFailedOp(op, generation, error instanceof Error ? error.message : String(error),
                    error instanceof SyncPayloadTooLargeError ? error.code : 'VALIDATION_ERROR',
                    errorDiagnostics(error, { source: 'sync' }));
                localFailCount++;
                continue;
            }
            // Persist before the provider sees the UUID; retries, split batches
            // and a replacement manager all reuse the exact same wire payload.
            const owned = await this.db.transaction('rw', ['pending_ops', 'sync_state'], async () => {
                if (!await this.ownsClaim(op)) return false;
                await this.db.pending_ops.put({ ...normalized, status: 'in_flight' });
                return true;
            });
            if (!owned) continue;
            sanitizedBatch.push(stripReadyAt(normalized));
            valid.push(normalized);
        }
        batch = valid;
        if (!batch.length) return { successCount: 0, failCount: localFailCount, deferred: false, serviceFailure: false };

        try {
            if (generation !== this.lifecycleGeneration) {
                return { successCount: 0, failCount: 0, deferred: false };
            }
            for (const op of batch) {
                markRecentOpId(op.stamp.opId, { dbName: this.db.name, historyIncarnation: this.historyGuard?.historyIncarnation ?? this.db.syncHistoryAtOpen });
            }

            if (!this.historyGuard) await this.db.transaction('rw', ['sync_state'], () => invalidateFirstBindEligibility(this.db));
            const signal = this.pushAbortController?.signal;
            // Race the provider with cancellation as third-party direct providers
            // may not yet honor the optional AbortSignal themselves.
            const result = await new Promise<Awaited<ReturnType<SyncProvider['push']>>>((resolve, reject) => {
                const aborted = () => reject(signal?.reason ?? new Error('Sync push aborted'));
                if (signal?.aborted) { aborted(); return; }
                signal?.addEventListener('abort', aborted, { once: true });
                this.provider.push({ scope: this.scope, ops: sanitizedBatch, storedRecordCapability: 'stored-record-v1', ...(this.historyGuard ? { historyIncarnation: this.historyGuard.historyIncarnation, historyIncarnationCapability: 'incarnation-v1' } : {}) }, { signal })
                    .then(resolve, reject)
                    .finally(() => signal?.removeEventListener('abort', aborted));
            });
            if (generation !== this.lifecycleGeneration) {
                return { successCount: 0, failCount: 0, deferred: false };
            }
            if (!await this.historyMatches()) return { successCount: 0, failCount: 0, deferred: true };
            if (this.historyGuard && result.historyIncarnation !== this.historyGuard.historyIncarnation) {
                if (result.historyIncarnation) await requestHistoryReset(this.db, this.historyGuard, result.historyIncarnation);
                else await pauseHistoryProtocol(this.db, this.provider.id, this.scope, null, this.historyGuard);
                return { successCount: 0, failCount: 0, deferred: true };
            }
            this.authFailures = 0;

            // Direct providers share this boundary with the gateway. An invalid
            // evidence contract pauses before any sibling is settled.
            if (result.results.some(res => res.errorCode === 'STORED_RECORD_UNAVAILABLE' && !PushResultItemSchema.safeParse(res).success)) {
                throw Object.assign(new Error('Invalid stored-record hold response'), { code: 'OR3_SYNC_HISTORY_UNSUPPORTED' });
            }
            const resultsById = new Map(result.results.map((res) => [res.opId, res]));
            let successCount = 0;
            let failCount = localFailCount;
            let serviceFailure = false;

            for (const op of batch) {
                if (generation !== this.lifecycleGeneration) {
                    return { successCount: 0, failCount: 0, deferred: false };
                }
                const res = resultsById.get(op.stamp.opId);
                if (!res) {
                    await this.handleFailedOp(op, generation, 'Missing push result', 'UNKNOWN');
                    serviceFailure = true;
                    failCount += 1;
                    continue;
                }

                if (res.success && res.applied === false) {
                    // Older providers return a live winner as payload. Newer
                    // providers also identify tombstone winners and their
                    // authoritative revision explicitly.
                    const winner: PushWinner | undefined = res.winner ??
                        (res.payload && typeof res.payload === 'object' && !Array.isArray(res.payload)
                            ? {
                                  kind: 'put',
                                  payload: res.payload as Record<string, unknown>,
                                  revision: winnerRevisionFromPayload(res.payload, op.stamp),
                              }
                            : undefined);
                    if (!winner) {
                        await this.handleFailedOp(
                            op,
                            generation,
                            'Missing winner state',
                            'UNKNOWN'
                        );
                        failCount += 1;
                        serviceFailure = true;
                        continue;
                    }
                    try {
                        if (await this.acknowledgeOp(op, winner)) {
                            unmarkRecentOpId(op.stamp.opId, { dbName: this.db.name, historyIncarnation: this.historyGuard?.historyIncarnation ?? this.db.syncHistoryAtOpen });
                            successCount++;
                        }
                    } catch (error) {
                        if (!(error instanceof InvalidServerWinnerError)) throw error;
                        await this.holdOp(op, 'Invalid server winner', winner);
                        failCount++;
                    }
                    continue;
                }

                if (res.success) {
                    if (await this.acknowledgeOp(op, undefined, res.serverVersion)) successCount += 1;
                } else {
                    // SQLite's explicit identity-reuse reason is terminal;
                    // unrelated provider CONFLICT outcomes keep their retry policy.
                    const identityReuse = res.errorCode === 'CONFLICT' &&
                        res.error === `Conflicting operation reuses processed op_id ${op.stamp.opId}`;
                    if (res.errorCode === 'STORED_RECORD_UNAVAILABLE') await this.holdOp(op, res.error!, undefined, res.evidenceRef);
                    else if (identityReuse) await this.holdOp(op, 'Server rejected reused operation identity');
                    else {
                        await this.handleFailedOp(op, generation, res.error, res.errorCode);
                        // Retryable content conflicts and throttling are not
                        // evidence that the shared sync service is unavailable.
                        if (!this.isPermanentFailure(res.errorCode) &&
                            !['CONFLICT', 'NOT_FOUND', 'RATE_LIMITED'].includes(res.errorCode ?? '')) serviceFailure = true;
                    }
                    failCount++;
                }
            }

            if (generation !== this.lifecycleGeneration) {
                return { successCount: 0, failCount: 0, deferred: false };
            }
            await observeSyncAction(hooks, 'sync.push:action:after', {
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

            return { successCount, failCount, deferred: false, serviceFailure };
        } catch (error) {
            if (generation !== this.lifecycleGeneration) {
                return { successCount: 0, failCount: 0, deferred: false };
            }

            if (isHistoryProtocolBoundary(error)) {
                await pauseHistoryProtocol(this.db, this.provider.id, this.scope, error, this.historyGuard);
                await this.releaseBatchForDeferredRetry(batch, 0);
                console.error('[OutboxManager] Sync paused: server history contract is unavailable', error);
                return { successCount: 0, failCount: 0, deferred: true };
            }
            const target = changedHistoryFromError(error);
            if (this.historyGuard && target) {
                await requestHistoryReset(this.db, this.historyGuard, target);
                return { successCount: 0, failCount: 0, deferred: true };
            }
            if (!await this.historyMatches()) return { successCount: 0, failCount: 0, deferred: true };
            const status = httpStatusOf(error);
            // Connectivity can disappear after flush() claims the batch. A
            // transport failure while offline must preserve the same retry
            // budget and op_ids as edits queued before going offline.
            if (status === null && typeof navigator !== 'undefined' && navigator.onLine === false) {
                await this.releaseBatchForDeferredRetry(batch, 0);
                if (generation !== this.lifecycleGeneration) {
                    return { successCount: 0, failCount: 0, deferred: false };
                }
                await observeSyncAction(hooks, 'sync.push:action:after', {
                    scope: this.scope,
                    successCount: 0,
                    failCount: 0,
                });
                return { successCount: 0, failCount: 0, deferred: true };
            }
            if (status === 401 || status === 403) {
                const firstDelay = this.config.retryDelays[0] ?? DEFAULT_RETRY_DELAYS[0] ?? 250;
                await this.releaseBatchForDeferredRetry(
                    batch,
                    Math.min(MAX_AUTH_RETRY_DELAY_MS, firstDelay * 2 ** this.authFailures++)
                );
                if (generation !== this.lifecycleGeneration) {
                    return { successCount: 0, failCount: 0, deferred: false };
                }
                await observeSyncAction(hooks, 'sync.push:action:after', {
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
                    failCount: localFailCount + left.failCount + right.failCount,
                    deferred: left.deferred || right.deferred,
                    serviceFailure: !!left.serviceFailure || !!right.serviceFailure,
                };
            }

            const deferredRetryDelayMs = this.getDeferredRetryDelayMs(error);
            if (deferredRetryDelayMs !== null) {
                await this.releaseBatchForDeferredRetry(batch, deferredRetryDelayMs);
                this.providerRateLimitedUntil = Math.max(
                    this.providerRateLimitedUntil,
                    Date.now() + deferredRetryDelayMs
                );
                if (generation !== this.lifecycleGeneration) {
                    return { successCount: 0, failCount: 0, deferred: false };
                }
                await observeSyncAction(hooks, 'sync.push:action:after', {
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
            let failCount = localFailCount;
            for (const op of batch) {
                if (generation !== this.lifecycleGeneration) {
                    return { successCount: 0, failCount: 0, deferred: false };
                }
                await this.handleFailedOp(op, generation, message, undefined, errorDiagnostics(error, { source: 'sync' }));
                failCount += 1;
            }
            if (generation !== this.lifecycleGeneration) {
                return { successCount: 0, failCount: 0, deferred: false };
            }
            await observeSyncAction(hooks, 'sync.push:action:after', {
                scope: this.scope,
                successCount: 0,
                failCount,
            });
            console.error('[OutboxManager] Push error:', error);
            return { successCount: 0, failCount, deferred: false, serviceFailure: !this.isPermanentFailure(undefined, errorDiagnostics(error, { source: 'sync' })) };
        }
    }

    private isWholeRequestClientError(error: unknown): boolean {
        const status = httpStatusOf(error);
        return status === 400 || status === 413 || status === 422;
    }

    private async acknowledgeOp(op: PendingOp, winner?: PushWinner, serverVersion?: number): Promise<boolean> {
        return this.db.transaction('rw', Array.from(new Set(['pending_ops', 'sync_state', 'tombstones', op.tableName])), async () => {
            if (!await this.ownsClaim(op)) return false;
            if (winner) {
                // Direct-provider responses are not structurally validated yet.
                const candidate: {
                    kind: unknown;
                    revision?: PushWinner['revision'] | null;
                    payload?: unknown;
                    serverDeletedAt?: unknown;
                } = winner;
                // Legacy live-winner payloads may omit HLC; keep that existing
                // comparison domain while rejecting malformed revisions.
                if (!candidate.revision || !Number.isSafeInteger(candidate.revision.clock) || candidate.revision.clock < 0 ||
                    typeof candidate.revision.hlc !== 'string' || typeof candidate.revision.opId !== 'string' ||
                    (candidate.kind !== 'put' && candidate.kind !== 'delete') ||
                    (candidate.kind === 'delete' && candidate.serverDeletedAt !== undefined &&
                        (typeof candidate.serverDeletedAt !== 'number' || !Number.isFinite(candidate.serverDeletedAt) || candidate.serverDeletedAt < 0)) ||
                    (candidate.kind === 'put' && (!candidate.payload || typeof candidate.payload !== 'object' || Array.isArray(candidate.payload) ||
                        !normalizeSyncPayload(op.tableName, op.pk, candidate.payload, candidate.revision).isValid))) {
                    throw new InvalidServerWinnerError('Invalid server winner');
                }
                await this.applyRemoteWinner(op, winner);
            }
            else if (op.operation === 'delete') await this.markTombstoneSynced(op, serverVersion);
            for (const original of this.superseded.get(op.id) ?? []) {
                const current = await this.db.pending_ops.get(original.id);
                if (current && (current.status === 'pending' || current.status === 'retry_wait') &&
                    current.stamp.opId === original.stamp.opId && current.attempts === original.attempts) {
                    await this.db.pending_ops.delete(current.id);
                }
            }
            await this.db.pending_ops.delete(op.id);
            return true;
        });
    }

    private async applyRemoteWinner(op: PendingOp, winner: PushWinner): Promise<void> {
        const hookBridge = getHookBridge(this.db);
        const tableNames = Array.from(new Set([op.tableName, 'tombstones', 'sync_state']));
        await this.db.transaction('rw', tableNames, async (tx) => {
            hookBridge.markSyncTransaction(tx);
            if (!await this.historyMatches()) return;
            await invalidateFirstBindEligibility(tx);
            const table = tx.table(op.tableName);
            if (winner.kind === 'put') {
                // Eligibility-first selection can push an older revision while a
                // newer revision for the same record stays deferred. The server
                // winner is newer than the pushed op but may still be older
                // than local materialized state; applying it unconditionally
                // would overwrite newer local data that the deferred row alone
                // cannot restore. Fail closed on ambiguous ties.
                const winnerRev = winner.revision;
                const local: unknown = await table.get(op.pk);
                if (local) {
                    if (compareSyncRevision(winnerRev, materializedRevisionFromRow(local)) <= 0) {
                        return;
                    }
                }
                const tombstone: unknown = await tx.table('tombstones').get(`${op.tableName}:${op.pk}`);
                const tombRev = tombstoneRevisionFromRow(tombstone);
                if (
                    tombRev &&
                    tombstoneBlocksRevision(
                        {
                            clock: tombRev.clock,
                            hlc: tombRev.hlc || undefined,
                            opId: tombRev.opId || undefined,
                        },
                        winnerRev
                    )
                ) {
                    return;
                }
                const normalized = normalizeSyncPayload(op.tableName, op.pk, winner.payload, winnerRev);
                if (!normalized.isValid) {
                    throw new InvalidServerWinnerError(`Invalid server winner for ${op.tableName}:${op.pk}: ${normalized.errors?.join(', ')}`);
                }
                const localRefCount = (local as { ref_count?: unknown } | undefined)?.ref_count;
                const payload = op.tableName === 'file_meta'
                    ? {
                          ...normalized.payload,
                          ref_count:
                              typeof localRefCount === 'number' &&
                              Number.isSafeInteger(localRefCount) &&
                              localRefCount >= 0
                                  ? localRefCount
                                  : 0,
                      }
                    : normalized.payload;
                await table.put(payload);
                await tx.table('tombstones').delete(`${op.tableName}:${op.pk}`);
                return;
            }
            // A tombstone winner can supersede either a put or a delete.
            const local: unknown = await table.get(op.pk);
            if (local && compareSyncRevision(winner.revision, materializedRevisionFromRow(local)) <= 0) {
                return;
            }
            const existingTombstone: unknown = await tx.table('tombstones').get(`${op.tableName}:${op.pk}`);
            const existingRev = tombstoneRevisionFromRow(existingTombstone);
            if (
                existingRev &&
                tombstoneBlocksRevision(
                    {
                        clock: existingRev.clock,
                        hlc: existingRev.hlc || undefined,
                        opId: existingRev.opId || undefined,
                    },
                    winner.revision
                )
            ) {
                return;
            }
            await table.delete(op.pk);
            const deletedAt = winner.serverDeletedAt ?? nowSec();
            await tx.table('tombstones').put({
                id: `${op.tableName}:${op.pk}`,
                tableName: op.tableName,
                pk: op.pk,
                deletedAt,
                clock: winner.revision.clock,
                hlc: winner.revision.hlc,
                opId: winner.revision.opId,
                syncedAt: nowSec(),
            });
        });
    }

    /**
     * Handle a failed operation
     */
    private async handleFailedOp(
        op: PendingOp,
        generation: number,
        error?: string,
        errorCode?: string,
        details?: ErrorMetadata
    ): Promise<void> {
        const hooks = useHooks();
        if (details?.code === 'ERR_RATE_LIMIT' || errorCode === 'RATE_LIMITED') {
            const rateLimitDelayMs =
                details?.retryAfterMs ??
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
            if (!await this.updateClaimedOp(op, updatedOp)) return;
            if (generation !== this.lifecycleGeneration) return;
            await observeSyncAction(hooks, 'sync.retry:action', { op: updatedOp, attempt: op.attempts });
            return;
        }

        const attempts = Math.min(op.attempts + 1, Number.MAX_SAFE_INTEGER);

        // Check for permanent failures that should not be retried
        const isPermanent = this.isPermanentFailure(errorCode, details);

        if (isPermanent) {
            // Permanent content/admission failures remain visible until explicitly resolved
            const updatedOp = {
                ...op,
                status: 'failed_permanent' as const,
                attempts,
                lastError: details ? presentError(details).message : error,
                lastErrorDetails: details,
                lastErrorCode: errorCode as PendingOp['lastErrorCode'],
                failureKind: 'permanent' as const,
                failedAt: Date.now(),
            };
            if (!await this.updateClaimedOp(op, updatedOp)) return;
            if (generation !== this.lifecycleGeneration) return;
            
            // Log detailed info for debugging
            const payloadSize = op.payload ? syncJsonByteLength(op.payload) : 0;
            console.error(
                '[OutboxManager] Op failed (permanent):',
                {
                    opId: op.stamp.opId,
                    table: op.tableName,
                    pk: op.pk,
                    operation: op.operation,
                    payloadSizeBytes: payloadSize,
                    error: details ?? errorDiagnostics(error, { source: 'sync' }),
                }
            );
            
            await observeSyncAction(hooks, 'sync.error:action', { op: updatedOp, error: details ?? error, permanent: isPermanent });
        } else {
            // Schedule retry
            const delay = this.config.retryDelays[Math.min(attempts - 1, this.config.retryDelays.length - 1)]
                ?? DEFAULT_RETRY_DELAYS[DEFAULT_RETRY_DELAYS.length - 1]!;
            const updatedOp = {
                ...op,
                status: 'retry_wait' as const,
                attempts,
                lastError: details ? presentError(details).message : error,
                lastErrorDetails: details,
                lastErrorCode: errorCode as PendingOp['lastErrorCode'],
                nextAttemptAt: Date.now() + delay,
            };
            if (!await this.updateClaimedOp(op, updatedOp)) return;
            if (generation !== this.lifecycleGeneration) return;
            console.warn('[OutboxManager] Op will retry:', op.stamp.opId, 'attempt', attempts);
            await observeSyncAction(hooks, 'sync.retry:action', { op: updatedOp, attempt: attempts });
        }
    }

    /**
     * Check if an error is permanent and should not be retried
     */
    private isPermanentFailure(errorCode?: string, details?: ErrorMetadata): boolean {
        return errorCode === 'VALIDATION_ERROR' || errorCode === 'OVERSIZED' || errorCode === 'UNAUTHORIZED' ||
            details?.status === 400 || details?.status === 413 || details?.status === 422;
    }

    private getDeferredRetryDelayMs(error: unknown): number | null {
        if (!error || typeof error !== 'object') return null;
        const candidate = error as { retryAfterMs?: unknown };
        const status = httpStatusOf(error);
        if (status === null || ![429, 502, 503, 504].includes(status)) return null;

        if (
            typeof candidate.retryAfterMs === 'number' &&
            Number.isFinite(candidate.retryAfterMs) &&
            candidate.retryAfterMs > 0
        ) {
            return candidate.retryAfterMs;
        }

        return this.config.retryDelays[0] ?? DEFAULT_RETRY_DELAYS[0] ?? 250;
    }

    private async releaseBatchForDeferredRetry(batch: PendingOp[], retryAfterMs: number): Promise<void> {
        const nextAttemptAt = Date.now() + retryAfterMs;
        for (const op of batch) {
            await this.updateClaimedOp(op, { ...op, status: 'retry_wait', nextAttemptAt });
        }
    }

    private async markTombstoneSynced(op: PendingOp, serverVersion?: number): Promise<void> {
        await this.db.transaction('rw', ['tombstones'], async () => {
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
        });
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
    getFailedOps(): Promise<PendingOp[]> {
        return readFailedOps(this.db);
    }

    /** Requeue one failed op (by row id or op id), or every failed op. */
    async retryFailed(opId?: string): Promise<void> {
        await retryFailedOps(this.db, opId);
    }

    /** Retain an auditable terminal record of an intentional user discard. */
    discardFailed(opId: string, reason = 'user_discarded'): Promise<boolean> {
        return discardFailedOp(this.db, opId, reason);
    }

    /**
     * Set aside queued ops that can no longer be pushed or replayed, preserving
     * each original with diagnostics, and rebuild the sync intent from the
     * matching local row where that is unambiguous. Never deletes user content.
     * Refuses while a push is running so an in-flight result cannot resurrect
     * a quarantined row.
     */
    async quarantineCorruptOps(): Promise<QuarantineSummary> {
        if (this.flushOwner) {
            throw new Error('A sync push is running; try again in a moment');
        }
        const owner = Symbol('outbox-quarantine');
        this.flushOwner = owner;
        try {
            return await quarantineCorruptOps(this.db, 'manual');
        } finally {
            if (this.flushOwner === owner) this.flushOwner = null;
        }
    }

    /** Quarantine entries, oldest first, for inspection. */
    getQuarantined(): Promise<SyncQuarantineRow[]> {
        return listQuarantined(this.db, this.scope.principalId);
    }

    /** Self-contained JSON of every quarantine entry for support or manual recovery. */
    exportQuarantined(): Promise<string> {
        return exportQuarantined(this.db, this.scope.principalId);
    }

    /** Give up on one unresolved entry. Returns false when it is missing or already resolved. */
    discardQuarantined(id: string): Promise<boolean> {
        return discardQuarantined(this.db, id, this.scope.principalId);
    }

}

const FAILED_STATUSES = ['failed', 'failed_retryable', 'failed_permanent'] as const;

/**
 * A failed op by row id or op id, or as a recovery view listed it. The pair
 * form refuses a row whose operation changed since it was listed.
 */
export type FailedOpRef = string | { id: string; opId: string };

function isFailedOp(op: PendingOp | undefined): op is PendingOp {
    return !!op && (FAILED_STATUSES as readonly string[]).includes(op.status);
}

async function readFailedOps(db: Or3DB, limit?: number): Promise<PendingOp[]> {
    const groups = await Promise.all(FAILED_STATUSES.map((status) => {
        const rows = db.pending_ops.where('status').equals(status);
        return (limit === undefined ? rows : rows.limit(limit)).toArray();
    }));
    return groups.flat();
}

async function findFailedOp(db: Or3DB, ref: FailedOpRef): Promise<PendingOp | undefined> {
    if (typeof ref !== 'string') {
        const op = await db.pending_ops.get(ref.id);
        return isFailedOp(op) && op.stamp.opId === ref.opId ? op : undefined;
    }
    const direct = await db.pending_ops.get(ref);
    if (isFailedOp(direct)) return direct;
    return (await readFailedOps(db)).find((op) => op.stamp.opId === ref);
}

/**
 * A bounded sample of failed ops with the total failed count. Reads at most
 * `limit` rows per failed status, then orders that sample newest first.
 */
export async function listFailedOps(db: Or3DB, limit = 50): Promise<{ ops: PendingOp[]; total: number }> {
    const [ops, counts] = await Promise.all([
        readFailedOps(db, limit),
        Promise.all(FAILED_STATUSES.map((status) => db.pending_ops.where('status').equals(status).count())),
    ]);
    ops.sort((a, b) => (b.failedAt ?? b.createdAt) - (a.failedAt ?? a.createdAt) || b.id.localeCompare(a.id));
    return { ops: ops.slice(0, limit), total: counts.reduce((sum, count) => sum + count, 0) };
}

/**
 * Requeue one failed op, or every failed op, keeping its id, stamp and payload
 * so the server's op-id idempotency still applies. The read and write share
 * one transaction, so a row another tab already settled is never resurrected.
 * Returns the number requeued.
 */
export function retryFailedOps(db: Or3DB, ref?: FailedOpRef): Promise<number> {
    return db.transaction('rw', ['pending_ops', 'sync_state'], async () => {
        const guard = await db.sync_state.get('sync_history');
        if (guard && guard.phase !== 'ready') return 0;
        const failed = ref === undefined ? await readFailedOps(db) : [await findFailedOp(db, ref)].filter(isFailedOp);
        if (failed.length) {
            await db.pending_ops.bulkPut(failed.map((op) => ({
                ...op,
                status: 'pending' as const,
                attempts: 0,
                nextAttemptAt: undefined,
                lastError: undefined,
                lastErrorDetails: undefined,
                lastErrorCode: undefined,
                failureKind: undefined,
                failedAt: undefined,
            })));
        }
        return failed.length;
    });
}

/**
 * Mark one failed op as intentionally discarded. The row and payload remain
 * as an auditable record and the local record is untouched. Returns false when
 * the op is no longer failed (for example, another tab retried it).
 */
export function discardFailedOp(db: Or3DB, ref: FailedOpRef, reason = 'user_discarded'): Promise<boolean> {
    return db.transaction('rw', ['pending_ops', 'sync_state'], async () => {
        const guard = await db.sync_state.get('sync_history');
        if (guard && guard.phase !== 'ready') return false;
        const failed = await findFailedOp(db, ref);
        if (!failed) return false;
        await db.pending_ops.put({ ...failed, status: 'discarded', discardedAt: Date.now(), discardReason: reason });
        return true;
    });
}
