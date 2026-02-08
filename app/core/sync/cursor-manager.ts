/**
 * @module app/core/sync/cursor-manager
 *
 * Purpose:
 * Manages the per-workspace sync cursor that tracks the highest
 * `server_version` received from the backend. Used to drive incremental
 * pull and to detect when a bootstrap or rescan is needed.
 *
 * Responsibilities:
 * - Persist cursor in the `sync_state` Dexie table
 * - Detect cold start (cursor = 0) for bootstrap pull
 * - Track last sync timestamp for expiry detection
 * - Provide device ID via the HLC generator
 *
 * Constraints:
 * - One cursor per workspace+project scope (singleton per scope)
 * - Cursor is a single monotonically increasing number (no per-table cursors)
 * - Expiry detection uses wall-clock age, not server-version gaps
 *
 * @see core/sync/subscription-manager for bootstrap/rescan logic
 * @see core/sync/hlc for device ID generation
 */
import type { Or3DB } from '~/db/client';
// ... imports
import type { SyncScope, SyncState } from '~~/shared/sync/types';
import { getDeviceId } from './hlc';

/**
 * Purpose:
 * Manage the persisted server cursor (`server_version`) for a workspace scope.
 *
 * Behavior:
 * - Reads and writes `sync_state` rows keyed by workspace/project scope
 * - Tracks `lastSyncAt` for staleness detection
 * - Stores `deviceId` for backend cursor retention accounting
 *
 * Constraints:
 * - Cursor is global per scope (not per table)
 */
export class CursorManager {
    private db: Or3DB;
    private scope: SyncScope;
    private deviceId: string;
    private syncStateId: string;

    constructor(db: Or3DB, scope: SyncScope) {
        this.db = db;
        this.scope = scope;
        this.deviceId = getDeviceId();
        this.syncStateId = this.getSyncStateId(scope);
    }

    private getSyncStateId(scope: SyncScope): string {
        return `sync_state:${scope.workspaceId}:${scope.projectId ?? 'default'}`;
    }

    /**
     * Get current server version cursor
     * Returns 0 if no cursor exists (needs bootstrap)
     */
    async getCursor(): Promise<number> {
        const state = await this.getState();
        return state?.cursor ?? 0;
    }

    /**
     * Set the cursor after successful pull
     */
    async setCursor(version: number): Promise<void> {
        const existing = await this.getState();
        const state: SyncState = {
            id: this.syncStateId,
            cursor: version,
            lastSyncAt: existing?.lastSyncAt ?? Date.now(),
            deviceId: this.deviceId,
        };

        await this.db.table('sync_state').put(state);
    }

    /**
     * Get last sync timestamp
     */
    async getLastSyncAt(): Promise<number> {
        const state = await this.getState();
        return state?.lastSyncAt ?? 0;
    }

    /**
     * Check if bootstrap pull is needed (no prior sync)
     */
    async isBootstrapNeeded(): Promise<boolean> {
        const cursor = await this.getCursor();
        return cursor === 0;
    }

    /**
     * Mark sync cycle complete - updates lastSyncAt
     */
    async markSyncComplete(): Promise<void> {
        const existing = await this.getState();
        const state: SyncState = {
            id: this.syncStateId,
            cursor: existing?.cursor ?? 0,
            lastSyncAt: Date.now(),
            deviceId: this.deviceId,
        };

        await this.db.table('sync_state').put(state);
    }

    /**
     * Check if cursor might be expired (stale for too long)
     * @param maxAgeMs - Maximum age before considering cursor potentially expired
     */
    async isCursorPotentiallyExpired(maxAgeMs: number = 24 * 60 * 60 * 1000): Promise<boolean> {
        const lastSync = await this.getLastSyncAt();
        if (lastSync === 0) return false; // Never synced, not expired - needs bootstrap

        const age = Date.now() - lastSync;
        return age > maxAgeMs;
    }

    /**
     * Reset cursor (for testing or recovery scenarios)
     */
    async reset(): Promise<void> {
        await this.db.table('sync_state').delete(this.syncStateId);
    }

    /**
     * Get the device ID
     */
    getDeviceId(): string {
        return this.deviceId;
    }

    /**
     * Invalidate cache (useful after external changes)
     */
    invalidateCache(): void {
        // No-op as cache is removed
    }

    /**
     * Get current sync state from DB
     */
    private async getState(): Promise<SyncState | undefined> {
        return this.db.table('sync_state').get(this.syncStateId) as Promise<SyncState | undefined>;
    }
}

// Singleton instances per DB + Scope
const cursorManagerInstances = new Map<string, CursorManager>();

function getInstanceKey(dbName: string, scope: SyncScope): string {
    return `${dbName}:${scope.workspaceId}:${scope.projectId ?? 'default'}`;
}

/**
 * Purpose:
 * Get or create a CursorManager singleton for a specific DB + scope.
 *
 * Constraints:
 * - Singleton is held in module state; use cleanup/reset in tests and HMR
 */
export function getCursorManager(db: Or3DB, scope: SyncScope): CursorManager {
    const key = getInstanceKey(db.name, scope);
    const existing = cursorManagerInstances.get(key);
    if (existing) return existing;

    const created = new CursorManager(db, scope);
    cursorManagerInstances.set(key, created);
    return created;
}

/**
 * Internal API.
 *
 * Purpose:
 * Clear all CursorManager singletons. Intended for tests.
 */
export function _resetCursorManagers(): void {
    cursorManagerInstances.clear();
}

/**
 * Purpose:
 * Dispose CursorManager singleton references for a given DB.
 *
 * Behavior:
 * - If `scope` is provided, removes only that scope instance
 * - Otherwise removes all scope instances for the DB
 */
export function cleanupCursorManager(dbName: string, scope?: SyncScope): void {
    if (scope) {
        const key = getInstanceKey(dbName, scope);
        cursorManagerInstances.delete(key);
    } else {
        // Cleanup all managers for this DB
        const prefix = `${dbName}:`;
        for (const key of cursorManagerInstances.keys()) {
            if (key.startsWith(prefix)) {
                cursorManagerInstances.delete(key);
            }
        }
    }
}
