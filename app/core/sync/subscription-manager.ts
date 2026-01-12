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

/** Default tables to sync */
const DEFAULT_TABLES = ['threads', 'messages', 'projects', 'posts', 'kv', 'file_meta'];

/** Bootstrap pull page size */
const BOOTSTRAP_PAGE_SIZE = 100;

/** Reconnect delays (exponential backoff) */
const RECONNECT_DELAYS = [1000, 2000, 5000, 10000, 30000];

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

    private cursorManager: CursorManager;
    private conflictResolver: ConflictResolver;

    private unsubscribe: (() => void) | null = null;
    private status: SubscriptionStatus = 'disconnected';
    private reconnectAttempts = 0;
    private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
    private isBootstrapping = false;

    constructor(
        db: Or3DB,
        provider: SyncProvider,
        scope: SyncScope,
        config: SubscriptionManagerConfig = {}
    ) {
        this.db = db;
        this.provider = provider;
        this.scope = scope;
        this.config = {
            tables: config.tables ?? DEFAULT_TABLES,
            bootstrapPageSize: config.bootstrapPageSize ?? BOOTSTRAP_PAGE_SIZE,
            reconnectDelays: config.reconnectDelays ?? RECONNECT_DELAYS,
        };

        this.cursorManager = getCursorManager(db);
        this.conflictResolver = new ConflictResolver(db);
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
        this.isBootstrapping = true;

        try {
            let cursor = 0;
            let hasMore = true;
            let totalPulled = 0;

            await useHooks().doAction('sync.bootstrap:action:start', {
                scope: this.scope,
            });

            while (hasMore) {
                const response = await this.provider.pull({
                    scope: this.scope,
                    cursor,
                    limit: this.config.bootstrapPageSize,
                    tables: this.config.tables,
                });

                if (response.changes.length > 0) {
                    await this.applyChanges(response.changes);
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
            }

            // Update cursor after bootstrap
            await this.cursorManager.setCursor(cursor);
            await this.cursorManager.markSyncComplete();

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
     * Subscribe to real-time changes
     */
    private async subscribe(): Promise<void> {
        this.unsubscribe = await this.provider.subscribe(
            this.scope,
            this.config.tables,
            (changes) => this.handleChanges(changes)
        );
    }

    /**
     * Handle incoming changes from subscription
     */
    private async handleChanges(changes: SyncChange[]): Promise<void> {
        if (changes.length === 0) return;

        try {
            await useHooks().doAction('sync.pull:action:received', {
                scope: this.scope,
                changeCount: changes.length,
            });

            const result = await this.applyChanges(changes);

            // Update cursor to highest server version
            const maxVersion = Math.max(...changes.map((c) => c.serverVersion));
            const currentCursor = await this.cursorManager.getCursor();

            if (maxVersion > currentCursor) {
                await this.cursorManager.setCursor(maxVersion);
            }

            await this.cursorManager.markSyncComplete();

            await useHooks().doAction('sync.pull:action:applied', {
                scope: this.scope,
                applied: result.applied,
                skipped: result.skipped,
                conflicts: result.conflicts,
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
            void useHooks().doAction('sync.subscription:action:statusChange', {
                scope: this.scope,
                previousStatus,
                status,
            });
        }
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
        void existing.stop();
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
