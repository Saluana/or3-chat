/**
 * SubscriptionManager - Manages real-time sync subscriptions
 *
 * Responsibilities:
 * - Subscribe to provider's real-time changes
 * - Route incoming changes to ConflictResolver
 * - Perform bootstrap pull on cold start
 * - Handle subscription errors with reconnect
 * - Update cursor after each batch
 */
import type { Or3DB } from '~/db/client';
import type { SyncProvider, SyncScope, SyncChange } from '~~/shared/sync/types';
import { ConflictResolver } from './conflict-resolver';
import { getCursorManager, type CursorManager } from './cursor-manager';
import { useHooks } from '~/core/hooks/useHooks';
import { getHookBridge } from './hook-bridge';
import { isRecentOpId } from './recent-op-cache';
import { getSyncCircuitBreaker } from '~~/shared/sync/circuit-breaker';

/** Default tables to sync */
const DEFAULT_TABLES = ['threads', 'messages', 'projects', 'posts', 'kv', 'file_meta', 'notifications'];

/** Bootstrap pull page size */
const BOOTSTRAP_PAGE_SIZE = 100;

/** Reconnect delays (exponential backoff) */
const RECONNECT_DELAYS = [1000, 2000, 5000, 10000, 30000];

/** Max reconnect attempts before giving up (about 10 minutes of trying) */
const MAX_RECONNECT_ATTEMPTS = 20;

export type SubscriptionStatus = 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'error';

export interface SubscriptionManagerConfig {
    tables?: string[];
    bootstrapPageSize?: number;
    reconnectDelays?: number[];
}

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
    private changeQueue: Promise<void> = Promise.resolve();

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

        this.setStatus('connecting');

        try {
            // Check if bootstrap is needed
            const needsBootstrap = await this.cursorManager.isBootstrapNeeded();
            const cursorExpired =
                !needsBootstrap &&
                (await this.cursorManager.isCursorPotentiallyExpired());

            if (cursorExpired) {
                await this.rescan();
            }

            if (needsBootstrap) {
                await this.bootstrap();
            }

            // Subscribe to real-time changes
            await this.subscribe();

            this.reconnectAttempts = 0;
            this.setStatus('connected');
        } catch (error) {
            console.error('[SubscriptionManager] Failed to start:', error);
            this.setStatus('error');
            this.scheduleReconnect();
        }
    }

    /**
     * Stop the subscription
     */
    async stop(): Promise<void> {
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
     */
    private async bootstrap(): Promise<void> {
        // Check circuit breaker to prevent retry storm during outages
        const circuitBreaker = getSyncCircuitBreaker(this.circuitBreakerKey);
        if (!circuitBreaker.canRetry()) {
            console.warn('[SubscriptionManager] Circuit breaker open, skipping bootstrap');
            return;
        }

        this.isBootstrapping = true;

        try {
            let cursor = 0;
            let hasMore = true;
            let totalPulled = 0;

            await useHooks().doAction('sync.bootstrap:action:start', {
                scope: this.scope,
            });

            while (hasMore) {
                if (this.status === 'disconnected') break;

                // Check circuit breaker each iteration
                if (!circuitBreaker.canRetry()) {
                    console.warn('[SubscriptionManager] Circuit breaker opened during bootstrap');
                    break;
                }

                const response = await this.provider.pull({
                    scope: this.scope,
                    cursor,
                    limit: this.config.bootstrapPageSize,
                    tables: this.config.tables,
                });

                if (response.changes.length > 0) {
                    const filtered = this.filterRecentOps(response.changes);
                    if (filtered.length) {
                        await this.applyChanges(filtered);
                    }
                    totalPulled += response.changes.length;
                }

                // Loop guard: If cursor doesn't advance but hasMore is true, we are stuck
                // Note: hasMore is guaranteed true by while loop condition
                if (response.nextCursor <= cursor) {
                    console.error('[SubscriptionManager] Infinite loop detected during bootstrap: cursor not advancing', {
                        cursor,
                        nextCursor: response.nextCursor,
                    });
                     await useHooks().doAction('sync.bootstrap:action:error', {
                        scope: this.scope,
                        error: 'Infinite loop detected: cursor not advancing',
                    });
                    break;
                }

                cursor = response.nextCursor;
                hasMore = response.hasMore;

                await useHooks().doAction('sync.bootstrap:action:progress', {
                    scope: this.scope,
                    cursor,
                    pulledCount: totalPulled,
                    hasMore,
                });
            }

            // Update cursor after bootstrap
            await this.cursorManager.setCursor(cursor);
            await this.cursorManager.markSyncComplete();
            await this.provider.updateCursor(
                this.scope,
                this.cursorManager.getDeviceId(),
                cursor
            );

            await useHooks().doAction('sync.bootstrap:action:complete', {
                scope: this.scope,
                cursor,
                totalPulled,
            });
        } finally {
            this.isBootstrapping = false;
        }
    }

    /**
     * Perform a full rescan when cursor is expired
     */
    private async rescan(): Promise<void> {
        // Check circuit breaker to prevent retry storm during outages
        const circuitBreaker = getSyncCircuitBreaker(this.circuitBreakerKey);
        if (!circuitBreaker.canRetry()) {
            console.warn('[SubscriptionManager] Circuit breaker open, skipping rescan');
            return;
        }

        this.isBootstrapping = true;

        try {
            await useHooks().doAction('sync.rescan:action:starting', {
                scope: this.scope,
            });

            await this.cursorManager.reset();

            let cursor = 0;
            let hasMore = true;

            while (hasMore) {
                if (this.status === 'disconnected') break;

                // Check circuit breaker each iteration
                if (!circuitBreaker.canRetry()) {
                    console.warn('[SubscriptionManager] Circuit breaker opened during rescan');
                    break;
                }

                const response = await this.provider.pull({
                    scope: this.scope,
                    cursor,
                    limit: this.config.bootstrapPageSize,
                    tables: this.config.tables,
                });

                if (response.changes.length) {
                    const filtered = this.filterRecentOps(response.changes);
                    if (filtered.length) {
                        await this.conflictResolver.applyChanges(filtered);
                    }
                }

                // Loop guard
                if (response.hasMore && response.nextCursor <= cursor) {
                    console.error('[SubscriptionManager] Infinite loop detected during rescan', {
                        cursor,
                        nextCursor: response.nextCursor,
                    });
                    break;
                }

                cursor = response.nextCursor;
                hasMore = response.hasMore;
            }

            await this.cursorManager.setCursor(cursor);
            await this.cursorManager.markSyncComplete();
            await this.provider.updateCursor(
                this.scope,
                this.cursorManager.getDeviceId(),
                cursor
            );

            await this.reapplyPendingOps();

            await useHooks().doAction('sync.rescan:action:completed', {
                scope: this.scope,
            });
        } finally {
            this.isBootstrapping = false;
        }
    }

    private async reapplyPendingOps(): Promise<void> {
        const pendingOps = await this.db.pending_ops
            .where('status')
            .equals('pending')
            .toArray();
        if (!pendingOps.length) return;

        // IMPORTANT: Sort by createdAt to ensure deterministic replay order
        // This prevents LWW inversions when multiple ops have different clocks
        pendingOps.sort((a, b) => a.createdAt - b.createdAt);

        const hookBridge = getHookBridge(this.db);
        const tableNames = Array.from(new Set(pendingOps.map((op) => op.tableName)));

        await this.db.transaction('rw', tableNames, async (tx) => {
            hookBridge.markSyncTransaction(tx);
            for (const op of pendingOps) {
                const table = this.db.table(op.tableName);
                if (op.operation === 'put' && op.payload) {
                    await table.put(op.payload as Record<string, unknown>);
                } else if (op.operation === 'delete') {
                    await table.delete(op.pk);
                }
            }
        });
    }

    /**
     * Subscribe to real-time changes
     */
    private async subscribe(): Promise<void> {
        const cursor = await this.cursorManager.getCursor();

        if (this.lastSubscriptionCursor === cursor && this.unsubscribe) {
            return;
        }

        if (this.unsubscribe) {
            this.unsubscribe();
            this.unsubscribe = null;
        }

        this.lastSubscriptionCursor = cursor;
        this.unsubscribe = await this.provider.subscribe(
            this.scope,
            this.config.tables,
            (changes) => this.enqueueChanges(changes),
            { cursor, limit: this.config.bootstrapPageSize }
        );
    }

    private enqueueChanges(changes: SyncChange[]): Promise<void> {
        // Providers can emit change batches back-to-back (especially gateway polling).
        // Serialize apply cycles to keep cursor accounting correct and avoid races.
        this.changeQueue = this.changeQueue
            .then(() => this.handleChanges(changes))
            .catch((err) => {
                console.error('[SubscriptionManager] handleChanges error:', err);
                this.handleError(err);
            });

        return this.changeQueue;
    }

    /**
     * Handle incoming changes from subscription
     */
    private async handleChanges(changes: SyncChange[]): Promise<void> {
        if (changes.length === 0) return;

        // Filter out changes we've already seen to avoid reprocessing
        const currentCursor = await this.cursorManager.getCursor();
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

            const result = filteredChanges.length
                ? await this.applyChanges(filteredChanges)
                : { applied: 0, skipped: 0, conflicts: 0 };

            // Update cursor to highest server version
            let maxVersion = Math.max(...newChanges.map((c) => c.serverVersion));

            if (import.meta.dev) {
                console.debug('[sync] subscription apply', {
                    applied: result.applied,
                    skipped: result.skipped,
                    conflicts: result.conflicts,
                    maxVersion,
                });
            }

            if (maxVersion > currentCursor) {
                await this.cursorManager.setCursor(maxVersion);
            }

            const drainResult = await this.drainBacklog(currentCursor);
            if (drainResult.cursor > maxVersion) {
                maxVersion = drainResult.cursor;
                await this.cursorManager.setCursor(maxVersion);
            }

            await this.cursorManager.markSyncComplete();
            await this.provider.updateCursor(
                this.scope,
                this.cursorManager.getDeviceId(),
                maxVersion
            );

            await this.subscribe();

            await useHooks().doAction('sync.pull:action:applied', {
                scope: this.scope,
                applied: result.applied + drainResult.applied,
                skipped: result.skipped + drainResult.skipped,
                conflicts: result.conflicts + drainResult.conflicts,
            });
        } catch (error) {
            console.error('[SubscriptionManager] Failed to apply changes:', error);
            await useHooks().doAction('sync.pull:action:error', {
                scope: this.scope,
                error: error instanceof Error ? error.message : String(error),
            });
            this.handleError(error);
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

    private async drainBacklog(startCursor: number) {
        let cursor = startCursor;
        let hasMore = true;
        const totals = { applied: 0, skipped: 0, conflicts: 0, cursor };
        const circuitBreaker = getSyncCircuitBreaker(this.circuitBreakerKey);

        while (hasMore) {
            if (this.status === 'disconnected') break;
            if (!circuitBreaker.canRetry()) break;

            const response = await this.provider.pull({
                scope: this.scope,
                cursor,
                limit: this.config.bootstrapPageSize,
                tables: this.config.tables,
            });

            if (response.changes.length) {
                const filtered = this.filterRecentOps(response.changes);
                const result = filtered.length
                    ? await this.applyChanges(filtered)
                    : { applied: 0, skipped: 0, conflicts: 0 };
                totals.applied += result.applied;
                totals.skipped += result.skipped;
                totals.conflicts += result.conflicts;
            }

            cursor = response.nextCursor;
            totals.cursor = cursor;
            hasMore = response.hasMore;
        }

        return totals;
    }

    /**
     * Handle subscription error
     */
    private handleError(error: unknown): void {
        console.error('[SubscriptionManager] Subscription error:', error);
        if (this.unsubscribe) {
            this.unsubscribe();
            this.unsubscribe = null;
        }
        this.setStatus('error');
        this.scheduleReconnect();
    }

    /**
     * Schedule reconnection attempt
     */
    private scheduleReconnect(): void {
        this.clearReconnectTimeout();

        // Give up after max attempts to prevent infinite reconnection loop
        if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
            console.error('[SubscriptionManager] Max reconnect attempts reached, giving up');
            this.setStatus('error');
            useHooks().doAction('sync.subscription:action:maxRetriesExceeded', {
                scope: this.scope,
                attempts: this.reconnectAttempts,
            }).catch(() => {});
            return;
        }

        const delayIndex = Math.min(
            this.reconnectAttempts,
            this.config.reconnectDelays.length - 1
        );
        const delay = this.config.reconnectDelays[delayIndex] ?? 30000;

        this.setStatus('reconnecting');
        this.reconnectAttempts++;

        this.reconnectTimeout = setTimeout(async () => {
            try {
                await this.start();
            } catch (error) {
                console.error('[SubscriptionManager] Reconnect failed:', error);
                this.scheduleReconnect();
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

    private getWindow(): Window | null {
        if (typeof globalThis === 'undefined') return null;
        const globalWithWindow = globalThis as { window?: Window & typeof globalThis };
        return globalWithWindow.window ?? null;
    }
}

// Singleton instances per scope
const subscriptionManagerInstances = new Map<string, SubscriptionManager>();

/**
 * Get scope key for instance lookup
 */
function getScopeKey(scope: SyncScope): string {
    return `${scope.workspaceId}:${scope.projectId ?? 'default'}`;
}

/**
 * Create a subscription manager for a scope
 */
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

/**
 * Get existing subscription manager for a scope
 */
export function getSubscriptionManager(scope: SyncScope): SubscriptionManager | null {
    return subscriptionManagerInstances.get(getScopeKey(scope)) ?? null;
}

/**
 * Reset all subscription managers (for testing)
 */
export async function _resetSubscriptionManagers(): Promise<void> {
    for (const manager of subscriptionManagerInstances.values()) {
        await manager.stop();
    }
    subscriptionManagerInstances.clear();
}

/**
 * Cleanup SubscriptionManager instance for a scope
 */
export function cleanupSubscriptionManager(scopeKey: string): void {
    const manager = subscriptionManagerInstances.get(scopeKey);
    if (manager) {
        manager.stop().catch((error) => {
            console.error('[SubscriptionManager] Failed to stop instance:', error);
        });
    }
    subscriptionManagerInstances.delete(scopeKey);
}
