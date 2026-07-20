import type { SnapshotRevision } from './types';

export type SyncRevision = SnapshotRevision;

/**
 * Total ordering for every sync put, delete, materialized row, and tombstone.
 * Positive means `left` wins, negative means `right` wins, and zero means the
 * revisions are identical. Strings use code-point order so all runtimes agree.
 */
export function compareSyncRevision(
    left: SyncRevision,
    right: SyncRevision
): number {
    if (left.clock !== right.clock) {
        return left.clock > right.clock ? 1 : -1;
    }
    if (left.hlc !== right.hlc) {
        return left.hlc > right.hlc ? 1 : -1;
    }
    if (left.opId !== right.opId) {
        return left.opId > right.opId ? 1 : -1;
    }
    return 0;
}

export function incomingRevisionWins(
    incoming: SyncRevision,
    current: SyncRevision
): boolean {
    return compareSyncRevision(incoming, current) > 0;
}
