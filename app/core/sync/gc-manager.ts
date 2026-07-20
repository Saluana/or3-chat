/**
 * @module app/core/sync/gc-manager
 *
 * Purpose:
 * Retains the browser sync-GC lifecycle API while collection remains a
 * privileged server operation.
 *
 * Behavior:
 * - `start()` is a no-op; browser sessions never initiate administrative GC
 * - Never deletes local tombstones or invokes provider GC capabilities
 *
 * Constraints:
 * - Server adapters independently declare and enforce the snapshot-v1 contract
 *
 * @see core/sync/hook-bridge for tombstone creation
 */
import type { Or3DB } from '~/db/client';
import type { SyncProvider, SyncScope } from '~~/shared/sync/types';
import { canRunSyncHistoryGc } from '~~/shared/sync/history-gc-policy';

/**
 * Purpose:
 * Compatibility configuration retained for existing callers.
 *
 * Constraints:
 * - Values are ignored while the snapshot safety gate is closed
 */
export interface GcManagerConfig {
    retentionSeconds?: number;
    intervalMs?: number;
    idleTimeoutMs?: number;
}

/**
 * Compatibility shell for the former periodic collector.
 */
export class GcManager {
    constructor(
        _db: Or3DB,
        _provider: SyncProvider,
        _scope: SyncScope,
        _config: GcManagerConfig = {}
    ) {}

    start(): void {
        // Browsers do not own retention policy. Server admin routes and internal
        // schedulers enforce the explicit adapter capability before deletion.
        if (!canRunSyncHistoryGc()) return;
    }

    stop(): void {}
}
