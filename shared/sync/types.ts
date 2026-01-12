/**
 * Shared Sync Types
 *
 * Type definitions used by both client and server for sync operations.
 * These types define the contract between client sync engine and SyncProviders.
 */

// ============================================================
// CORE TYPES
// ============================================================

/**
 * Scope for sync operations - defines the data partition
 */
export interface SyncScope {
    workspaceId: string;
    projectId?: string;
}

/**
 * Stamp attached to each change for ordering and idempotency
 */
export interface ChangeStamp {
    deviceId: string;
    opId: string; // UUID for idempotency
    hlc: string; // Hybrid logical clock
    clock: number; // Monotonic per-record revision
}

/**
 * Pending operation in the outbox waiting to be pushed
 */
export interface PendingOp {
    id: string;
    tableName: string;
    operation: 'put' | 'delete';
    pk: string; // Primary key
    payload?: unknown; // Full record for put
    stamp: ChangeStamp;
    createdAt: number;
    attempts: number;
    nextAttemptAt?: number;
    status: 'pending' | 'syncing' | 'failed';
}

/**
 * A change received from the server
 */
export interface SyncChange {
    serverVersion: number;
    tableName: string;
    pk: string;
    op: 'put' | 'delete';
    payload?: unknown;
    stamp: ChangeStamp;
}

// ============================================================
// REQUEST/RESPONSE TYPES
// ============================================================

/**
 * Request to pull changes from server
 */
export interface PullRequest {
    scope: SyncScope;
    cursor: number; // Server version cursor
    limit: number;
    tables?: string[];
}

/**
 * Response from pull request
 */
export interface PullResponse {
    changes: SyncChange[];
    nextCursor: number;
    hasMore: boolean;
}

/**
 * Batch of operations to push to server
 */
export interface PushBatch {
    scope: SyncScope;
    ops: PendingOp[];
}

/**
 * Result of a push operation
 */
export interface PushResult {
    results: Array<{
        opId: string;
        success: boolean;
        serverVersion?: number;
        error?: string;
    }>;
    serverVersion: number;
}

// ============================================================
// PROVIDER INTERFACE
// ============================================================

/**
 * Sync provider mode
 * - direct: Client talks directly to backend with provider token
 * - gateway: Client uses SSR endpoints that forward to backend
 */
export type SyncProviderMode = 'direct' | 'gateway';

/**
 * Auth configuration for direct providers
 */
export interface SyncProviderAuth {
    providerId: string;
    template?: string; // JWT template name (e.g., 'convex' for Clerk)
}

/**
 * SyncProvider interface - implemented by each backend adapter
 */
export interface SyncProvider {
    id: string;
    mode: SyncProviderMode;
    auth?: SyncProviderAuth;

    /**
     * Subscribe to real-time changes
     * Returns unsubscribe function
     */
    subscribe(
        scope: SyncScope,
        tables: string[],
        onChanges: (changes: SyncChange[]) => void
    ): Promise<() => void>;

    /**
     * Pull changes since cursor (for bootstrap/recovery)
     */
    pull(request: PullRequest): Promise<PullResponse>;

    /**
     * Push batch of changes
     */
    push(batch: PushBatch): Promise<PushResult>;

    /**
     * Update device cursor for retention tracking
     */
    updateCursor(scope: SyncScope, deviceId: string, version: number): Promise<void>;

    /**
     * GC tombstones with a retention window
     */
    gcTombstones?(scope: SyncScope, retentionSeconds: number): Promise<void>;

    /**
     * GC change log entries with a retention window
     */
    gcChangeLog?(scope: SyncScope, retentionSeconds: number): Promise<void>;

    /**
     * Cleanup resources
     */
    dispose(): Promise<void>;
}

// ============================================================
// LOCAL SYNC STATE TYPES
// ============================================================

/**
 * Tombstone record - tracks deleted records to prevent resurrection
 */
export interface Tombstone {
    id: string;
    tableName: string;
    pk: string;
    deletedAt: number;
    clock: number;
    syncedAt?: number;
}

/**
 * Sync state - persisted sync metadata
 */
export interface SyncState {
    id: string; // 'default' for main state
    cursor: number;
    lastSyncAt: number;
    deviceId: string;
}

/**
 * Sync run - telemetry for each sync cycle
 */
export interface SyncRun {
    id: string;
    startedAt: number;
    completedAt?: number;
    pushedCount: number;
    pulledCount: number;
    conflictCount: number;
    errorCount: number;
    status: 'running' | 'completed' | 'failed';
    error?: string;
}

// ============================================================
// SYNC ENGINE TYPES
// ============================================================

/**
 * Sync engine configuration
 */
export interface SyncEngineConfig {
    workspaceId: string;
    provider: SyncProvider;
    deviceId: string;
    pushIntervalMs?: number;
    maxBatchSize?: number;
    retryDelays?: number[];
}

/**
 * Sync engine status
 */
export interface SyncEngineStatus {
    state: 'idle' | 'syncing' | 'error' | 'offline';
    pendingCount: number;
    cursor: number;
    lastSyncAt: number;
    error?: string;
}
