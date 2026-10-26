/**
 * @module app/core/sync/subscription-manager
 *
 * Purpose:
 * Manages the real-time sync subscription lifecycle for a workspace.
 * Coordinates bootstrap pull, incremental subscription, change application,
 * and reconnection with exponential backoff.
 *
 * Responsibilities:
 * - Perform paginated bootstrap pull on cold start (cursor = 0)
 * - Perform full rescan when cursor is expired (stale > 24h)
 * - Subscribe to real-time changes from the sync provider
 * - Route incoming changes through the ConflictResolver
 * - Filter echoed changes via the recent-op-cache
 * - Drain any backlog between subscription cursor and current server version
 * - Re-apply pending local ops after rescan to preserve unsynced work
 * - Handle subscription errors with reconnection (exponential backoff)
 * - Emit hooks for bootstrap, pull, subscription status, and errors
 *
 * Constraints:
 * - Singleton per workspace scope (via `createSubscriptionManager`)
 * - Retries outages indefinitely with capped backoff
 * - Change application is serialized (queued) to prevent cursor races
 * - Registers a `beforeunload` listener for clean shutdown
 * - Circuit breaker prevents bootstrap/rescan during provider outages
 *
 * @see core/sync/conflict-resolver for LWW change application
 * @see core/sync/cursor-manager for cursor persistence
 * @see core/sync/recent-op-cache for echo filtering
 */
import { subscriptionManagerInstances, getScopeKey } from './subscription-registry';
import type { Or3DB } from '~/db/client';
import type {
    SyncProvider,
    SyncScope,
    SyncChange,
    PullResponse,
    PullRequest,
} from '~~/shared/sync/types';
import { ConflictResolver } from './conflict-resolver';
import { getCursorManager, type CursorManager } from './cursor-manager';
import { useHooks } from '~/core/hooks/useHooks';
import { SYNCED_TABLES, getHookBridge } from './hook-bridge';
import { isRecentOpId } from './recent-op-cache';
import { isAbortLikeError } from './providers/gateway-sync-provider';
import { getSyncCircuitBreaker } from '~~/shared/sync/circuit-breaker';
import { getPullResponseContractError, PullResponseSchema } from '~~/shared/sync/schemas';
import { SnapshotStager, applyPendingOp } from './snapshot-applier';
import { QUARANTINE_SUPPORT_TABLES, collectReplayableOps, pruneResolvedQuarantineBestEffort } from './sync-quarantine';

/** Default tables to sync */
const DEFAULT_TABLES = ['threads', 'messages', 'projects', 'posts', 'kv', 'file_meta', 'notifications'];

/** Bootstrap pull page size */
const BOOTSTRAP_PAGE_SIZE = 300;

/** Reconnect delays (exponential backoff) */
const RECONNECT_DELAYS = [1000, 2000, 5000, 10000, 30000];

/** Emit diagnostics at this retry count; capped retries continue afterward. */
const MAX_RECONNECT_ATTEMPTS = 20;

/**
 * Purpose:
 * High-level subscription lifecycle state for UI and diagnostics.
 */
export type SubscriptionStatus = 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'error';

/**
 * Purpose:
 * Configuration for subscription bootstrap, polling, and reconnect behavior.
 */
export interface SubscriptionManagerConfig {
    tables?: string[];
    bootstrapPageSize?: number;
    reconnectDelays?: number[];
}

/**
 * Purpose:
 * Drive the pull + subscribe lifecycle for a workspace scope.
 *
 * Behavior:
 * - Performs bootstrap pull and incremental catch-up using a persisted cursor
 * - Applies remote changes through ConflictResolver in a serialized queue
 * - Filters echoed ops using recent-op-cache
 * - Handles reconnect with exponential backoff
 *
 * Constraints:
 * - Caller owns lifecycle; must call `stop()` when a workspace is disposed
 * - Designed to be singleton per scope via `createSubscriptionManager`
 */
export class SubscriptionManager {
    private db: Or3DB;
    private provider: SyncProvider;
    private scope: SyncScope;
    private config: Required<SubscriptionManagerConfig>;
    private circuitBreakerKey: string;

    private cursorManager: CursorManager;
    private conflictResolver: ConflictResolver;

    private unsubscribe: (() => void) | null = null;
    private status: SubscriptionStatus = 'disconnected';
    private reconnectAttempts = 0;
    private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
    private isBootstrapping = false;
    private boundBeforeUnload: (() => void) | null = null;
    private lastSubscriptionCursor: number | null = null;
    private recoveringExpiredCursor = false;
    private changeQueue: Promise<void> = Promise.resolve();
    /** Invalidates every async continuation created by an older lifecycle. */
    private lifecycleGeneration = 0;
    private requestController = new AbortController();
    private probeGeneration: number | null = null;
    private pendingCursorAcknowledgement: number | null = null;

    constructor(
        db: Or3DB,
        provider: SyncProvider,
        scope: SyncScope,
        config: SubscriptionManagerConfig = {}
    ) {
        this.db = db;
        this.provider = provider;
        this.scope = scope;
        this.circuitBreakerKey = `${scope.workspaceId}:${provider.id}`;
        this.config = {
            tables: config.tables ?? DEFAULT_TABLES,
            bootstrapPageSize: config.bootstrapPageSize ?? BOOTSTRAP_PAGE_SIZE,
            reconnectDelays: config.reconnectDelays ?? RECONNECT_DELAYS,
        };

        this.cursorManager = getCursorManager(db, this.scope);
        this.conflictResolver = new ConflictResolver(db);

        // Defensive cleanup for browser close/navigation
        const win = this.getWindow();
        if (win) {
            this.boundBeforeUnload = () => {
                this.stop().catch(() => {});
            };
            (win as Window & typeof globalThis).addEventListener('beforeunload', this.boundBeforeUnload);
        }
    }

    /**
     * Start the subscription
     * - Performs bootstrap pull if cursor is 0
     * - Subscribes to real-time changes
     */
    async start(): Promise<void> {
        if (this.status === 'connected' || this.status === 'connecting') {
            return;
        }

        this.requestController.abort();
        this.requestController = new AbortController();
        const generation = ++this.lifecycleGeneration;
        this.setStatus('connecting');

        try {
            const circuitBreaker = getSyncCircuitBreaker(this.circuitBreakerKey);
            if (!circuitBreaker.canRetry() || !circuitBreaker.beginProbe()) {
                throw new Error(
                    'Circuit breaker is open; subscription cannot start'
                );
            }
            this.probeGeneration = generation;
            let probeSettled = false;
            try {
                const needsBootstrap = await this.cursorManager.isBootstrapNeeded();
                if (!this.isCurrentGeneration(generation)) return;
                if (needsBootstrap) {
                    await this.bootstrap(generation);
                } else {
                    const recovered = await this.catchUpOrCheckRetention(generation);
                    if (!recovered) {
                        const cursorExpired =
                            await this.cursorManager.isCursorPotentiallyExpired();
                        if (!this.isCurrentGeneration(generation)) return;
                        if (cursorExpired) {
                            await this.rescan(generation);
                        }
                    }
                }
                if (!this.isCurrentGeneration(generation)) return;

                await this.subscribe(generation);
                if (!this.isCurrentGeneration(generation)) return;

                this.reconnectAttempts = 0;
                this.setStatus('connected');
                circuitBreaker.recordSuccess();
                probeSettled = true;
            } finally {
                if (this.probeGeneration === generation) this.probeGeneration = null;
                if (!probeSettled && this.isCurrentGeneration(generation)) {
                    circuitBreaker.recordFailure();
                }
            }
        } catch (error) {
            if (!this.isCurrentGeneration(generation) || isAbortLikeError(error)) {
                return;
            }
            console.error('[SubscriptionManager] Failed to start:', error);
            this.setStatus('error');
            this.scheduleReconnect(generation);
        }
    }

    /**
     * Stop the subscription
     */
    async stop(): Promise<void> {
        this.lifecycleGeneration++;
        this.requestController.abort();
        this.clearReconnectTimeout();

        if (this.unsubscribe) {
            this.unsubscribe();
            this.unsubscribe = null;
        }

        // Clean up beforeunload listener
        const win = this.getWindow();
        if (win && this.boundBeforeUnload) {
            (win as Window & typeof globalThis).removeEventListener('beforeunload', this.boundBeforeUnload);
            this.boundBeforeUnload = null;
        }

        this.setStatus('disconnected');
        // Ownership may move to another window as soon as stop resolves. Fence
        // queued callbacks above, then finish any transaction already applying.
        await this.changeQueue;
    }

    /**
     * Get current subscription status
     */
    getStatus(): SubscriptionStatus {
        return this.status;
    }

    /**
     * Check if currently bootstrapping
     */
    isCurrentlyBootstrapping(): boolean {
        return this.isBootstrapping;
    }

    /**
     * Perform bootstrap pull (paginated)
     *
     * Uses prefetch overlap: while applying page N, the fetch for page N+1
     * is already in flight. This hides network latency behind IndexedDB writes.
     */
    private async bootstrap(generation: number): Promise<void> {
        // Check circuit breaker to prevent retry storm during outages
        if (!this.canContinueProbe(generation)) {
            throw new Error(
                'Circuit breaker is open; bootstrap cannot complete'
            );
        }

        this.isBootstrapping = true;
        const startTime = Date.now();

        try {
            let cursor = 0;
            let hasMore = true;
            let totalPulled = 0;

            await useHooks().doAction('sync.bootstrap:action:start', {
                scope: this.scope,
            });
            if (!this.isCurrentGeneration(generation)) return;

            // Snapshot-capable providers bootstrap from materialized state so a
            // fresh client never depends on retained operation history.
            if (this.provider.snapshot) {
                await this.bootstrapFromSnapshot(generation, startTime);
                return;
            }

            // Kick off the first fetch
            let pendingFetch: Promise<PullResponse> | null = this.pull({
                scope: this.scope,
                cursor,
                limit: this.config.bootstrapPageSize,
                tables: this.config.tables,
            });

            while (hasMore) {
                if (!this.isCurrentGeneration(generation)) break;

                // Check circuit breaker each iteration
                if (!this.canContinueProbe(generation)) {
                    throw new Error(
                        'Circuit breaker opened during bootstrap'
                    );
                }

                const response = await pendingFetch!;
                if (!this.isCurrentGeneration(generation)) return;
                if (await this.honorRequiresSnapshot(response, generation)) return;

                // Loop guard: only error if backend says there is more data but cursor is stuck.
                if (response.hasMore && response.nextCursor <= cursor) {
                    console.error('[SubscriptionManager] Infinite loop detected during bootstrap: cursor not advancing', {
                        cursor,
                        nextCursor: response.nextCursor,
                    });
                    await useHooks().doAction('sync.bootstrap:action:error', {
                        scope: this.scope,
                        error: 'Infinite loop detected: cursor not advancing',
                    });
                    throw new Error(
                        'Bootstrap pagination cursor did not advance'
                    );
                }

                // Start prefetching the next page while we apply the current one
                if (response.hasMore && response.nextCursor > cursor) {
                    pendingFetch = this.pull({
                        scope: this.scope,
                        cursor: response.nextCursor,
                        limit: this.config.bootstrapPageSize,
                        tables: this.config.tables,
                    });
                } else {
                    pendingFetch = null;
                }

                if (response.changes.length > 0) {
                    const filtered = this.filterRecentOps(response.changes);
                    if (filtered.length) {
                        await this.applyChanges(filtered);
                        if (!this.isCurrentGeneration(generation)) return;
                    }
                    totalPulled += response.changes.length;
                }

                cursor = response.nextCursor;
                hasMore = response.hasMore;

                await useHooks().doAction('sync.bootstrap:action:progress', {
                    scope: this.scope,
                    cursor,
                    pulledCount: totalPulled,
                    hasMore,
                });
                if (!this.isCurrentGeneration(generation)) return;
            }

            if (!this.isCurrentGeneration(generation)) {
                return;
            }

            // Update cursor after bootstrap
            await this.cursorManager.setCursor(cursor);
            if (!this.isCurrentGeneration(generation)) return;
            await this.cursorManager.markSyncComplete();
            if (!this.isCurrentGeneration(generation)) return;

            // Fire-and-forget: remote cursor update is best-effort;
            // the local cursor is already persisted above.
            this.provider.updateCursor(
                this.scope,
                this.cursorManager.getDeviceId(),
                cursor, { signal: this.requestController.signal }
            ).catch((err) => {
                if (!this.isCurrentGeneration(generation) || isAbortLikeError(err)) {
                    return;
                }
                console.warn('[SubscriptionManager] Failed to update remote cursor after bootstrap:', err);
            });

            const elapsedMs = Date.now() - startTime;
            await useHooks().doAction('sync.bootstrap:action:complete', {
                scope: this.scope,
                cursor,
                totalPulled,
                elapsedMs,
            });

            if (import.meta.dev) {
                console.log(
                    `[SubscriptionManager] Bootstrap complete: ${totalPulled} changes in ${elapsedMs}ms`
                );
            }
        } finally {
            this.isBootstrapping = false;
        }
    }

    /**
     * Install a bounded provider snapshot, then replay only changes committed
     * after its high-watermark before opening the live subscription.
     */
    private async bootstrapFromSnapshot(
        generation: number,
        startTime: number,
        replacementTables: string[] = [],
        emitBootstrapEvents = true
    ): Promise<void> {
        const snapshot = this.provider.snapshot?.bind(this.provider);
        if (!snapshot) return;

        const stager = new SnapshotStager(this.db, this.scope, this.config.tables);
        const seenPageTokens = new Set<string>();
        let pageToken: string | undefined;
        let totalPulled = 0;
        let highWatermark: number;

        await stager.start();
        try {
            for (;;) {
                if (!this.isCurrentGeneration(generation)) return;
                if (!this.canContinueProbe(generation)) {
                    throw new Error('Circuit breaker opened during snapshot bootstrap');
                }

                const page = await snapshot({
                    scope: this.scope,
                    pageSize: this.config.bootstrapPageSize,
                    tables: this.config.tables,
                    ...(pageToken ? { pageToken } : {}),
                }, { signal: this.requestController.signal });
                if (!this.isCurrentGeneration(generation)) return;

                await stager.appendPage(page);
                totalPulled += page.items.length;
                if (emitBootstrapEvents) {
                    await useHooks().doAction('sync.bootstrap:action:progress', {
                        scope: this.scope,
                        cursor: page.highWatermark,
                        pulledCount: totalPulled,
                        hasMore: page.nextPageToken !== null,
                    });
                    if (!this.isCurrentGeneration(generation)) return;
                }

                if (page.nextPageToken === null) break;
                if (seenPageTokens.has(page.nextPageToken)) {
                    throw new Error('Snapshot pagination token repeated before completion');
                }
                seenPageTokens.add(page.nextPageToken);
                pageToken = page.nextPageToken;
            }

            highWatermark = await stager.apply(
                this.cursorManager.getDeviceId(),
                () => this.isCurrentGeneration(generation),
                replacementTables
            );
        } finally {
            await stager.dispose();
        }
        if (!this.isCurrentGeneration(generation)) return;

        // The watermark and materialized rows commit atomically. Pull semantics
        // are exclusive, so the first incremental request starts exactly here.
        const replay = await this.drainBacklog(highWatermark, generation, true);
        if (!this.isCurrentGeneration(generation)) return;
        totalPulled += replay.applied + replay.skipped;

        await this.cursorManager.setCursor(replay.cursor);
        if (!this.isCurrentGeneration(generation)) return;
        await this.cursorManager.markSyncComplete();
        if (!this.isCurrentGeneration(generation)) return;

        this.provider.updateCursor(
            this.scope,
            this.cursorManager.getDeviceId(),
            replay.cursor, { signal: this.requestController.signal }
        ).catch((error) => {
            if (!this.isCurrentGeneration(generation) || isAbortLikeError(error)) return;
            console.warn(
                '[SubscriptionManager] Failed to update remote cursor after snapshot bootstrap:',
                error
            );
        });

        const elapsedMs = Date.now() - startTime;
        if (emitBootstrapEvents) {
            await useHooks().doAction('sync.bootstrap:action:complete', {
                scope: this.scope,
                cursor: replay.cursor,
                totalPulled,
                elapsedMs,
            });
            if (!this.isCurrentGeneration(generation)) return;
        }

        if (import.meta.dev) {
            console.log(
                `[SubscriptionManager] Snapshot bootstrap complete: ${totalPulled} records/changes in ${elapsedMs}ms`
            );
        }
    }

    private async catchUpOrCheckRetention(generation: number): Promise<boolean> {
        let cursor = await this.cursorManager.getCursor();
        if (!this.isCurrentGeneration(generation)) return true;
        if (this.provider.capabilities?.subscriptionPages === 'v1') {
            // Ownership is reacquired on return to a visible/online tab. Use
            // this first request to apply the backlog immediately, instead of
            // discarding a one-row probe and waiting for the next poll timer.
            while (this.isCurrentGeneration(generation)) {
                const page = await this.pull({
                    scope: this.scope, cursor,
                    limit: this.config.bootstrapPageSize,
                    tables: this.config.tables,
                });
                if (!this.isCurrentGeneration(generation)) return true;
                await this.enqueuePage(cursor, page, generation);
                if (page.requiresSnapshot || !page.hasMore) return true;
                cursor = page.nextCursor;
            }
            return true;
        }
        try {
            const probe = await this.pull({
                scope: this.scope,
                cursor,
                limit: 1,
                tables: this.config.tables,
            });
            if (!this.isCurrentGeneration(generation)) return true;
            if (typeof probe.requiresSnapshot !== 'boolean') return false;
            if (probe.requiresSnapshot) {
                await this.recoverFromExpiredCursor(generation);
            }
            return true;
        } catch {
            return false;
        }
    }

    private async recoverFromExpiredCursor(generation: number): Promise<void> {
        if (this.recoveringExpiredCursor) {
            throw new Error('Snapshot recovery did not cover the requested cursor');
        }
        this.recoveringExpiredCursor = true;
        try {
            await this.rescan(generation);
        } finally {
            this.recoveringExpiredCursor = false;
        }
    }

    private async honorRequiresSnapshot(
        response: PullResponse,
        generation: number
    ): Promise<boolean> {
        if (!response.requiresSnapshot) return false;
        await this.recoverFromExpiredCursor(generation);
        return true;
    }

    /**
     * Perform a full rescan when cursor is expired
     */
    private async rescan(generation: number): Promise<void> {
        // Check circuit breaker to prevent retry storm during outages
        if (!this.canContinueProbe(generation)) {
            throw new Error('Circuit breaker is open; rescan cannot complete');
        }

        this.isBootstrapping = true;

        try {
            await useHooks().doAction('sync.rescan:action:starting', {
                scope: this.scope,
            });
            if (!this.isCurrentGeneration(generation)) return;

            if (this.provider.snapshot) {
                await this.bootstrapFromSnapshot(
                    generation,
                    Date.now(),
                    this.config.tables,
                    false
                );
                if (!this.isCurrentGeneration(generation)) return;
                await useHooks().doAction('sync.rescan:action:completed', {
                    scope: this.scope,
                });
                return;
            }

            await this.cursorManager.reset();
            if (!this.isCurrentGeneration(generation)) return;

            let cursor = 0;
            let hasMore = true;

            while (hasMore) {
                if (!this.isCurrentGeneration(generation)) break;

                // Check circuit breaker each iteration
                if (!this.canContinueProbe(generation)) {
                    throw new Error('Circuit breaker opened during rescan');
                }

                const response = await this.pull({
                    scope: this.scope,
                    cursor,
                    limit: this.config.bootstrapPageSize,
                    tables: this.config.tables,
                });
                if (!this.isCurrentGeneration(generation)) return;
                if (await this.honorRequiresSnapshot(response, generation)) return;

                if (response.changes.length) {
                    const filtered = this.filterRecentOps(response.changes);
                    if (filtered.length) {
                        await this.conflictResolver.applyChanges(filtered);
                        if (!this.isCurrentGeneration(generation)) return;
                    }
                }

                // Loop guard
                if (response.hasMore && response.nextCursor <= cursor) {
                    console.error('[SubscriptionManager] Infinite loop detected during rescan', {
                        cursor,
                        nextCursor: response.nextCursor,
                    });
                    throw new Error(
                        'Rescan pagination cursor did not advance'
                    );
                }

                cursor = response.nextCursor;
                hasMore = response.hasMore;
            }

            if (!this.isCurrentGeneration(generation)) {
                return;
            }

            await this.cursorManager.setCursor(cursor);
            if (!this.isCurrentGeneration(generation)) return;
            await this.cursorManager.markSyncComplete();
            if (!this.isCurrentGeneration(generation)) return;

            // Fire-and-forget: remote cursor update is best-effort
            this.provider.updateCursor(
                this.scope,
                this.cursorManager.getDeviceId(),
                cursor, { signal: this.requestController.signal }
            ).catch((err) => {
                if (!this.isCurrentGeneration(generation) || isAbortLikeError(err)) {
                    return;
                }
                console.warn('[SubscriptionManager] Failed to update remote cursor after rescan:', err);
            });

            await this.reapplyPendingOps();
            if (!this.isCurrentGeneration(generation)) return;

            await useHooks().doAction('sync.rescan:action:completed', {
                scope: this.scope,
            });
        } finally {
            this.isBootstrapping = false;
        }
    }

    private async reapplyPendingOps(): Promise<void> {
        const hookBridge = getHookBridge(this.db);
        const tables = [...SYNCED_TABLES, ...QUARANTINE_SUPPORT_TABLES]
            .map((name) => this.db.table(name));
        await this.db.transaction('rw', tables, async (tx) => {
            hookBridge.markSyncTransaction(tx);
            // Includes permanently failed work, and sets corrupt operations
            // aside (rebuilding them from local rows) rather than aborting.
            const ops = await collectReplayableOps(tx, () => true, hookBridge.getDeviceId());
            for (const op of ops) {
                await applyPendingOp(tx, op);
            }
        });
        await pruneResolvedQuarantineBestEffort(this.db);
    }

    /**
     * Subscribe to real-time changes
     */
    private async subscribe(generation: number): Promise<void> {
        const cursor = await this.cursorManager.getCursor();
        if (!this.isCurrentGeneration(generation)) return;

        if (this.lastSubscriptionCursor === cursor && this.unsubscribe) {
            return;
        }

        if (this.unsubscribe) {
            this.unsubscribe();
            this.unsubscribe = null;
        }

        const unsubscribe = await this.provider.subscribe(
            this.scope,
            this.config.tables,
            (changes) => this.enqueueChanges(changes, generation),
            {
                cursor, limit: this.config.bootstrapPageSize,
                ...(this.provider.capabilities?.subscriptionPages === 'v1' ? {
                    onPage: (fromCursor: number, page: PullResponse) => this.enqueuePage(fromCursor, page, generation),
                } : {}),
            }
        );
        if (!this.isCurrentGeneration(generation)) {
            unsubscribe();
            return;
        }
        this.lastSubscriptionCursor = cursor;
        this.unsubscribe = unsubscribe;
    }

    private enqueuePage(fromCursor: number, page: PullResponse, generation: number): Promise<void> {
        const apply = this.changeQueue.then(() => this.handlePage(fromCursor, page, generation));
        // Keep the queue usable after a failure, but reject this page's receipt
        // so the transport cannot advance past an unsuccessful apply.
        this.changeQueue = apply.catch(error => {
            if (this.isCurrentGeneration(generation) && !isAbortLikeError(error)) this.handleError(error, generation);
        });
        return apply;
    }

    private async handlePage(fromCursor: number, page: PullResponse, generation: number): Promise<void> {
        if (!this.isCurrentGeneration(generation)) return;
        const parsed = PullResponseSchema.parse(page);
        const error = getPullResponseContractError({
            scope: this.scope, cursor: fromCursor, limit: this.config.bootstrapPageSize,
            tables: this.config.tables,
        }, parsed);
        if (error) throw new Error(error);
        if (await this.honorRequiresSnapshot(parsed, generation)) {
            if (this.isCurrentGeneration(generation)) await this.subscribe(generation);
            return;
        }
        const cursor = await this.cursorManager.getCursor();
        if (!this.isCurrentGeneration(generation)) return;
        if (!Number.isSafeInteger(fromCursor) || fromCursor < 0 || fromCursor > cursor) {
            throw new Error('Subscription page skipped the durable cursor');
        }
        const changes = parsed.changes.filter(change => change.serverVersion > cursor);
        const filtered = this.filterRecentOps(changes);
        if (changes.length) {
            await useHooks().doAction('sync.pull:action:received', { scope: this.scope, changeCount: changes.length });
            if (!this.isCurrentGeneration(generation)) return;
        }
        const result = filtered.length
            ? await this.applyChanges(filtered)
            : { applied: 0, skipped: 0, conflicts: 0 };
        if (!this.isCurrentGeneration(generation)) return;
        if (parsed.nextCursor > cursor) {
            // nextCursor covers the full validated window, including rows
            // filtered by notification ownership or table selection.
            await this.cursorManager.setCursor(parsed.nextCursor);
            if (!this.isCurrentGeneration(generation)) return;
            await this.cursorManager.markSyncComplete();
            this.pendingCursorAcknowledgement = parsed.nextCursor;
        }
        if (!this.isCurrentGeneration(generation)) return;
        if (!parsed.hasMore && this.pendingCursorAcknowledgement !== null) {
            await this.provider.updateCursor(this.scope, this.cursorManager.getDeviceId(), this.pendingCursorAcknowledgement, { signal: this.requestController.signal });
            if (!this.isCurrentGeneration(generation)) return;
            this.pendingCursorAcknowledgement = null;
        }
        if (changes.length) {
            await useHooks().doAction('sync.pull:action:applied', {
                scope: this.scope, applied: result.applied, skipped: result.skipped, conflicts: result.conflicts,
            });
        }
        // The provider owns the next page and cursor. No confirming pull or
        // unsubscribe/resubscribe cycle is needed after an acknowledged page.
    }

    private enqueueChanges(changes: SyncChange[], generation: number): Promise<void> {
        if (!this.isCurrentGeneration(generation)) return Promise.resolve();
        // Providers can emit change batches back-to-back (especially gateway polling).
        // Serialize apply cycles to keep cursor accounting correct and avoid races.
        this.changeQueue = this.changeQueue
            .then(() => this.handleChanges(changes, generation))
            .catch((err) => {
                if (!this.isCurrentGeneration(generation) || isAbortLikeError(err)) {
                    return;
                }
                console.error('[SubscriptionManager] handleChanges error:', err);
                this.handleError(err, generation);
            });

        return this.changeQueue;
    }

    /**
     * Handle incoming changes from subscription
     */
    private async handleChanges(changes: SyncChange[], generation: number): Promise<void> {
        if (changes.length === 0 || !this.isCurrentGeneration(generation)) return;

        // Filter out changes we've already seen to avoid reprocessing
        const currentCursor = await this.cursorManager.getCursor();
        if (!this.isCurrentGeneration(generation)) return;
        const newChanges = changes.filter((c) => c.serverVersion > currentCursor);
        const filteredChanges = this.filterRecentOps(newChanges);

        if (import.meta.dev) {
            console.debug('[sync] subscription changes', {
                scope: this.scope,
                incoming: changes.length,
                newChanges: newChanges.length,
                filtered: filteredChanges.length,
                cursor: currentCursor,
            });
        }

        if (newChanges.length === 0) return; // Nothing new to process

        try {
            await useHooks().doAction('sync.pull:action:received', {
                scope: this.scope,
                changeCount: newChanges.length,
            });
            if (!this.isCurrentGeneration(generation)) return;

            const result = filteredChanges.length
                ? await this.applyChanges(filteredChanges)
                : { applied: 0, skipped: 0, conflicts: 0 };
            if (!this.isCurrentGeneration(generation)) return;

            // Update cursor to highest server version (loop-based to avoid spread stack overflow)
            let maxVersion = currentCursor;
            for (const change of newChanges) {
                if (change.serverVersion > maxVersion) {
                    maxVersion = change.serverVersion;
                }
            }

            if (import.meta.dev) {
                console.debug('[sync] subscription apply', {
                    applied: result.applied,
                    skipped: result.skipped,
                    conflicts: result.conflicts,
                    maxVersion,
                });
            }

            const drainStartCursor = this.getBacklogDrainStartCursor(currentCursor, newChanges);
            const drainResult = await this.drainBacklog(drainStartCursor, generation);
            if (!this.isCurrentGeneration(generation)) return;
            maxVersion = Math.max(maxVersion, drainResult.cursor);
            if (maxVersion > currentCursor) {
                await this.cursorManager.setCursor(maxVersion);
            }

            await this.cursorManager.markSyncComplete();
            await this.provider.updateCursor(
                this.scope,
                this.cursorManager.getDeviceId(),
                maxVersion, { signal: this.requestController.signal }
            );
            if (!this.isCurrentGeneration(generation)) return;

            await this.subscribe(generation);
            if (!this.isCurrentGeneration(generation)) return;

            await useHooks().doAction('sync.pull:action:applied', {
                scope: this.scope,
                applied: result.applied + drainResult.applied,
                skipped: result.skipped + drainResult.skipped,
                conflicts: result.conflicts + drainResult.conflicts,
            });
        } catch (error) {
            if (!this.isCurrentGeneration(generation) || isAbortLikeError(error)) {
                return;
            }
            console.error('[SubscriptionManager] Failed to apply changes:', error);
            await useHooks().doAction('sync.pull:action:error', {
                scope: this.scope,
                error: error instanceof Error ? error.message : String(error),
            });
            this.handleError(error, generation);
        }
    }

    /**
     * Apply changes via ConflictResolver
     */
    private async applyChanges(changes: SyncChange[]) {
        return this.conflictResolver.applyChanges(changes);
    }

    private filterRecentOps(changes: SyncChange[]): SyncChange[] {
        const filtered = changes.filter((c) => !isRecentOpId(c.stamp.opId));
        if (import.meta.dev) {
            const dropped = changes
                .filter((c) => !filtered.includes(c))
                .map((c) => ({
                    opId: c.stamp.opId,
                    table: c.tableName,
                    pk: c.pk,
                }));
            if (dropped.length) {
                console.debug('[sync] filtered echoed ops', dropped);
            }
        }
        return filtered;
    }

    private getBacklogDrainStartCursor(currentCursor: number, changes: SyncChange[]): number {
        const versions = changes
            .map((change) => change.serverVersion)
            .sort((a, b) => a - b);

        if (versions.length === 0) {
            return currentCursor;
        }

        let expected = currentCursor + 1;
        for (const version of versions) {
            if (version !== expected) {
                // A gap means we need to re-pull from current cursor to avoid missing versions.
                return currentCursor;
            }
            expected += 1;
        }

        // No observed gaps; continue from highest seen version to avoid duplicate re-pulls.
        return versions[versions.length - 1] ?? currentCursor;
    }

    private async drainBacklog(startCursor: number, generation: number, replayRecent = false) {
        let cursor = startCursor;
        let hasMore = true;
        const totals = { applied: 0, skipped: 0, conflicts: 0, cursor };

        while (hasMore) {
            if (!this.isCurrentGeneration(generation)) break;
            if (!this.canContinueProbe(generation)) {
                throw new Error(
                    'Circuit breaker opened during backlog drain'
                );
            }

            const response = await this.pull({
                scope: this.scope,
                cursor,
                limit: this.config.bootstrapPageSize,
                tables: this.config.tables,
            });
            if (!this.isCurrentGeneration(generation)) break;
            if (await this.honorRequiresSnapshot(response, generation)) {
                totals.cursor = await this.cursorManager.getCursor();
                break;
            }

            const newChanges = response.changes.filter(
                (change) => change.serverVersion > cursor
            );
            if (newChanges.length) {
                const filtered = replayRecent ? newChanges : this.filterRecentOps(newChanges);
                const result = filtered.length
                    ? await this.applyChanges(filtered)
                    : { applied: 0, skipped: 0, conflicts: 0 };
                if (!this.isCurrentGeneration(generation)) break;
                totals.applied += result.applied;
                totals.skipped += result.skipped;
                totals.conflicts += result.conflicts;
            }

            const previousCursor = cursor;
            cursor = Math.max(cursor, response.nextCursor);
            for (const change of newChanges) {
                cursor = Math.max(cursor, change.serverVersion);
            }
            totals.cursor = cursor;
            hasMore = response.hasMore;
            if (hasMore && cursor <= previousCursor) {
                console.error('[SubscriptionManager] Infinite loop detected during backlog drain', {
                    cursor: previousCursor,
                    nextCursor: response.nextCursor,
                });
                throw new Error('Backlog pagination cursor did not advance');
            }
        }

        return totals;
    }

    /**
     * Handle subscription error
     */
    private handleError(error: unknown, generation: number): void {
        if (!this.isCurrentGeneration(generation) || isAbortLikeError(error)) {
            return;
        }
        console.error('[SubscriptionManager] Subscription error:', error);
        if (this.unsubscribe) {
            this.unsubscribe();
            this.unsubscribe = null;
        }
        this.setStatus('error');
        this.scheduleReconnect(generation);
    }

    /**
     * Schedule reconnection attempt
     */
    private scheduleReconnect(generation: number): void {
        if (!this.isCurrentGeneration(generation)) return;
        this.clearReconnectTimeout();

        // Retain diagnostics at the former retry limit, but never strand a
        // durable cursor after a long outage. Backoff stays capped below.
        if (this.reconnectAttempts === MAX_RECONNECT_ATTEMPTS) {
            useHooks().doAction('sync.subscription:action:maxRetriesExceeded', {
                scope: this.scope, attempts: this.reconnectAttempts,
            }).catch(() => {});
        }

        const delayIndex = Math.min(
            this.reconnectAttempts,
            this.config.reconnectDelays.length - 1
        );
        const delay = this.config.reconnectDelays[delayIndex] ?? 30000;

        this.setStatus('reconnecting');
        this.reconnectAttempts++;

        this.reconnectTimeout = setTimeout(async () => {
            if (!this.isCurrentGeneration(generation)) return;
            try {
                await this.start();
            } catch (error) {
                if (!this.isCurrentGeneration(generation)) return;
                console.error('[SubscriptionManager] Reconnect failed:', error);
                this.scheduleReconnect(generation);
            }
        }, delay);
    }

    /**
     * Clear pending reconnect
     */
    private clearReconnectTimeout(): void {
        if (this.reconnectTimeout) {
            clearTimeout(this.reconnectTimeout);
            this.reconnectTimeout = null;
        }
    }

    /**
     * Set status and emit hook
     */
    private setStatus(status: SubscriptionStatus): void {
        const previousStatus = this.status;
        this.status = status;

        if (previousStatus !== status) {
            useHooks()
                .doAction('sync.subscription:action:statusChange', {
                    scope: this.scope,
                    previousStatus,
                    status,
                })
                .catch((error) => {
                    console.error('[SubscriptionManager] Hook error:', error);
                });
        }
    }

    private canContinueProbe(generation: number): boolean {
        return this.probeGeneration === generation ||
            getSyncCircuitBreaker(this.circuitBreakerKey).canRetry();
    }

    private pull(request: PullRequest): Promise<PullResponse> {
        return this.provider.pull(request, { signal: this.requestController.signal });
    }

    private getWindow(): Window | null {
        if (typeof globalThis === 'undefined') return null;
        const globalWithWindow = globalThis as { window?: Window & typeof globalThis };
        return globalWithWindow.window ?? null;
    }

    private isCurrentGeneration(generation: number): boolean {
        return generation === this.lifecycleGeneration && this.status !== 'disconnected';
    }
}

export { getScopeKey, getSubscriptionManager, cleanupSubscriptionManager, cleanupSubscriptionManagersByWorkspace, _resetSubscriptionManagers } from './subscription-registry';

/** Create or replace the manager owned by a sync scope. */
export function createSubscriptionManager(
    db: Or3DB,
    provider: SyncProvider,
    scope: SyncScope,
    config?: SubscriptionManagerConfig
): SubscriptionManager {
    const key = getScopeKey(scope);

    // Clean up existing instance if any
    const existing = subscriptionManagerInstances.get(key);
    if (existing) {
        existing.stop().catch((error) => {
            console.error('[SubscriptionManager] Failed to stop existing instance:', error);
        });
    }

    const manager = new SubscriptionManager(db, provider, scope, config);
    subscriptionManagerInstances.set(key, manager);
    return manager;
}
