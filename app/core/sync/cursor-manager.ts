/**
 * CursorManager - Manages sync cursor persistence
 *
 * Responsibilities:
 * - Persist cursor in sync_state table
 * - Drive bootstrap pull on cold start (cursor = 0)
 * - Track last sync timestamp
 * - Detect cursor expiry scenarios
 */
import type { Or3DB } from '~/db/client';
import type { SyncState } from '~~/shared/sync/types';
import { getDeviceId } from './hlc';

/** Default sync state ID */
const SYNC_STATE_ID = 'default';

export class CursorManager {
    private db: Or3DB;
    private deviceId: string;

    constructor(db: Or3DB) {
        this.db = db;
        this.deviceId = getDeviceId();
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
            id: SYNC_STATE_ID,
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
            id: SYNC_STATE_ID,
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
        await this.db.table('sync_state').delete(SYNC_STATE_ID);
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
        return this.db.table('sync_state').get(SYNC_STATE_ID) as Promise<SyncState | undefined>;
    }
}

// Singleton instances per DB
const cursorManagerInstances = new Map<string, CursorManager>();

/**
 * Get or create CursorManager for a database
 */
export function getCursorManager(db: Or3DB): CursorManager {
    const key = db.name;
    const existing = cursorManagerInstances.get(key);
    if (existing) return existing;

    const created = new CursorManager(db);
    cursorManagerInstances.set(key, created);
    return created;
}

/**
 * Reset all cursor managers (for testing)
 */
export function _resetCursorManagers(): void {
    cursorManagerInstances.clear();
}

/**
 * Cleanup CursorManager instance for a database
 */
export function cleanupCursorManager(dbName: string): void {
    cursorManagerInstances.delete(dbName);
}
