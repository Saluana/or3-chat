/**
 * Runtime safety policy for sync-history retention.
 *
 * Change-log and tombstone GC must remain impossible until a fresh client can
 * bootstrap from a consistent materialized snapshot and replay changes after
 * that snapshot's high-watermark.
 */
export const SYNC_HISTORY_GC_POLICY = Object.freeze({
    enabled: true,
    snapshotBootstrapVerified: true,
    reason:
        'Sync history GC requires an adapter declaring the verified snapshot-v1 retention contract.',
});

/** Operator-supplied windows are bounded even while GC is disabled. */
export const MIN_SYNC_RETENTION_SECONDS = 60 * 60;
export const MAX_SYNC_RETENTION_SECONDS = 365 * 24 * 60 * 60;
export const MAX_SYNC_GC_BATCH_SIZE = 1000;
export const MAX_SYNC_GC_CONTINUATIONS = 1000;

export function canRunSyncHistoryGc(): boolean {
    return (
        SYNC_HISTORY_GC_POLICY.enabled &&
        SYNC_HISTORY_GC_POLICY.snapshotBootstrapVerified
    );
}

export type SyncHistoryGcCapabilities = {
    snapshotBootstrap?: 'snapshot-v1';
    historyRetention?: 'snapshot-v1';
};

/** Retention is unavailable unless both halves of the verified contract are explicit. */
export function supportsSyncHistoryRetention(
    capabilities: SyncHistoryGcCapabilities | undefined
): boolean {
    return capabilities?.snapshotBootstrap === 'snapshot-v1' &&
        capabilities.historyRetention === 'snapshot-v1';
}
