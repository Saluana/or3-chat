/**
 * @module app/core/sync/conflict-resolver
 *
 * Purpose:
 * Applies incoming remote changes to the local Dexie database using
 * Last-Write-Wins (LWW) conflict resolution with HLC tie-breaking.
 *
 * Behavior:
 * - Higher `clock` value wins unconditionally
 * - Equal clocks are tie-broken by lexicographic HLC comparison
 * - Delete and put operations each have dedicated resolution logic
 * - Tombstones are maintained for deleted records
 * - Conflict hooks are emitted after the transaction completes
 *   (avoids Dexie PrematureCommitError from async hooks inside tx)
 *
 * Constraints:
 * - All changes in a batch are applied in a single Dexie transaction for atomicity
 * - Payloads are normalized via `sync-payload-normalizer` before storage
 * - Invalid payloads (failing Zod validation) are skipped, not thrown
 *
 * @see core/sync/hlc for HLC comparison
 * @see core/sync/sync-payload-normalizer for payload normalization
 * @see core/sync/hook-bridge for sync transaction suppression
 */
import type { Or3DB } from '~/db/client';
import type { ChangeStamp, SyncChange, Tombstone } from '~~/shared/sync/types';
import type { Transaction } from 'dexie';
import { compareSyncRevision } from '~~/shared/sync/revision';
import { getHookBridge } from './hook-bridge';
import { useHooks } from '~/core/hooks/useHooks';
import { nowSec } from '~/db/util';
import { normalizeSyncPayload } from './sync-payload-normalizer';

/** Local record with clock and optional HLC */
interface LocalRecord {
    clock?: number;
    hlc?: string;
    op_id?: string;
    deleted?: boolean;
    [key: string]: unknown;
}

function rowRevision(record: LocalRecord) {
    return {
        clock: record.clock ?? 0,
        hlc: record.hlc ?? '',
        opId: record.op_id ?? '',
    };
}

function tombstoneBlocks(stamp: ChangeStamp, tombstone: Tombstone): boolean {
    if (tombstone.clock !== stamp.clock) return tombstone.clock > stamp.clock;
    // A legacy equal-clock tombstone has an ambiguous order. Fail closed until
    // the repair command can prove its originating delete from change_log.
    if (!tombstone.hlc || !tombstone.opId) return true;
    return compareSyncRevision(
        { clock: tombstone.clock, hlc: tombstone.hlc, opId: tombstone.opId },
        stamp
    ) >= 0;
}

/**
 * Purpose:
 * Apply remote SyncChange batches to the local Dexie database using LWW + HLC tie-breaking.
 *
 * Behavior:
 * - Applies changes in a single Dexie transaction for atomicity
 * - Uses `clock` as the primary ordering, then compares `hlc` on ties
 * - Maintains tombstones for deletes to prevent resurrection
 * - Emits conflict hooks after the transaction completes
 *
 * Constraints:
 * - Invalid payloads (schema failures) are skipped, not thrown
 * - Callers should ensure HookBridge suppression is active for the tx
 */
export class ConflictResolver {
    private db: Or3DB;

    constructor(db: Or3DB) {
        this.db = db;
    }

    /**
     * Apply a batch of remote changes
     */
    async applyChanges(changes: SyncChange[]): Promise<ApplyResult> {
        const result: ApplyResult = {
            applied: 0,
            skipped: 0,
            conflicts: 0,
        };

        if (changes.length === 0) return result;

        // Collect unique table names for the transaction
        const tableNames = Array.from(new Set(changes.map((c) => c.tableName)));
        const tables = [...tableNames, 'tombstones'];

        // Collect conflicts to emit hooks AFTER transaction completes
        // (calling async hooks inside transaction causes PrematureCommitError)
        const conflicts: Array<{
            tableName: string;
            pk: string;
            local: LocalRecord | undefined;
            remote: unknown;
            winner: 'local' | 'remote';
        }> = [];

        // Apply in a single transaction for atomicity and performance
        await this.db.transaction('rw', tables, async (tx) => {
            // Mark this specific transaction as a sync transaction
            getHookBridge(this.db).markSyncTransaction(tx);

            // Batch-fetch existing records by table
            const existingByTable = new Map<string, Map<string, LocalRecord>>();
            for (const tableName of tableNames) {
                const table = tx.table(tableName);
                const pks = changes.filter(c => c.tableName === tableName).map(c => c.pk);
                const records = await table.bulkGet(pks);
                const map = new Map<string, LocalRecord>();
                records.forEach((rec, idx) => {
                    if (rec) map.set(pks[idx]!, rec as LocalRecord);
                });
                existingByTable.set(tableName, map);
            }

            // Batch-fetch tombstones
            const tombstoneIds = changes.map(c => `${c.tableName}:${c.pk}`);
            const tombstoneRecords = await tx.table('tombstones').bulkGet(tombstoneIds);
            const tombstonesMap = new Map<string, Tombstone>();
            tombstoneRecords.forEach((rec, idx) => {
                if (rec) tombstonesMap.set(tombstoneIds[idx]!, rec as Tombstone);
            });

            for (const change of changes) {
                const tableState = existingByTable.get(change.tableName)!;
                const tombstoneId = `${change.tableName}:${change.pk}`;
                const local = tableState.get(change.pk);
                const tombstone = tombstonesMap.get(tombstoneId);

                const changeResult = change.op === 'delete'
                    ? await this.applyDeleteWithLocal(tx, change, local, tombstone, conflicts)
                    : await this.applyPutWithLocal(tx, change, local, tombstone, conflicts);

                result.applied += changeResult.applied ? 1 : 0;
                result.skipped += changeResult.skipped ? 1 : 0;
                result.conflicts += changeResult.isConflict ? 1 : 0;

                // A page may contain multiple revisions of one logical key.
                // Resolve the next operation against the state produced by this
                // operation, not the single pre-transaction bulkGet snapshot.
                const nextLocal: unknown = await tx.table(change.tableName).get(change.pk);
                if (nextLocal) {
                    tableState.set(change.pk, nextLocal as LocalRecord);
                } else {
                    tableState.delete(change.pk);
                }
                const nextTombstone: unknown = await tx.table('tombstones').get(tombstoneId);
                if (nextTombstone) {
                    tombstonesMap.set(tombstoneId, nextTombstone as Tombstone);
                } else {
                    tombstonesMap.delete(tombstoneId);
                }
            }
        });

        // Emit conflict hooks AFTER transaction completes
        for (const conflict of conflicts) {
            await useHooks().doAction('sync.conflict:action:detected', conflict);
        }

        return result;
    }

    /**
     * Apply a delete operation with pre-fetched local state
     */
    private async applyDeleteWithLocal(
        tx: Transaction,
        change: SyncChange,
        local: LocalRecord | undefined,
        existingTombstone: Tombstone | undefined,
        conflicts: Array<{ tableName: string; pk: string; local: LocalRecord | undefined; remote: unknown; winner: 'local' | 'remote' }>
    ): Promise<ChangeResult> {
        const { tableName, pk, stamp } = change;
        const table = tx.table(tableName);
        const hookBridge = getHookBridge(this.db);
        hookBridge.markSyncTransaction(tx);

        if (!local) {
            await this.writeTombstone(tx, tableName, pk, stamp, change.serverVersion, existingTombstone);
            // Already gone or never existed
            return { applied: false, skipped: true, isConflict: false };
        }

        if (local.deleted) {
            await this.writeTombstone(tx, tableName, pk, stamp, change.serverVersion, existingTombstone);
            // Already deleted
            return { applied: false, skipped: true, isConflict: false };
        }

        // Check if remote delete wins
        const localClock = local.clock ?? 0;
        const comparison = compareSyncRevision(stamp, rowRevision(local));

        if (stamp.clock > localClock) {
            // Remote wins
            const remotePayload = change.payload as { deleted_at?: number } | undefined;
            const deletedAt = remotePayload?.deleted_at ?? nowSec();

            await table.update(pk, {
                deleted: true,
                deleted_at: deletedAt,
                clock: stamp.clock,
                hlc: stamp.hlc,
                op_id: stamp.opId,
            });
            await this.writeTombstone(tx, tableName, pk, stamp, change.serverVersion, existingTombstone);
            return { applied: true, skipped: false, isConflict: false };
        } else if (stamp.clock === localClock) {
            if (comparison > 0) {
                const remotePayload = change.payload as { deleted_at?: number } | undefined;
                const deletedAt = remotePayload?.deleted_at ?? nowSec();

                await table.update(pk, {
                    deleted: true,
                    deleted_at: deletedAt,
                    clock: stamp.clock,
                    hlc: stamp.hlc,
                    op_id: stamp.opId,
                });
                await this.writeTombstone(tx, tableName, pk, stamp, change.serverVersion, existingTombstone);
                if (import.meta.dev) {
                    console.debug('[sync] conflict delete tie -> remote', {
                        tableName,
                        pk,
                        localClock,
                        remoteClock: stamp.clock,
                        localHlc: local.hlc ?? '',
                        remoteHlc: stamp.hlc,
                    });
                }
                // Queue conflict for hook emission after transaction
                conflicts.push({ tableName, pk, local, remote: { deleted: true }, winner: 'remote' });
                return { applied: true, skipped: false, isConflict: true, winner: 'remote' };
            }
            if (comparison === 0) {
                // Exact duplicate delivery, not a conflict.
                return { applied: false, skipped: true, isConflict: false };
            }
            // Queue conflict for hook emission after transaction
            if (import.meta.dev) {
                console.debug('[sync] conflict delete tie -> local', {
                    tableName,
                    pk,
                    localClock,
                    remoteClock: stamp.clock,
                    localHlc: local.hlc ?? '',
                    remoteHlc: stamp.hlc,
                });
            }
            conflicts.push({ tableName, pk, local, remote: { deleted: true }, winner: 'local' });
            return { applied: false, skipped: true, isConflict: true, winner: 'local' };
        }

        // Local wins (local clock higher)
        return { applied: false, skipped: true, isConflict: false };
    }

    /**
     * Apply a put (insert/update) operation with pre-fetched local state
     */
    private async applyPutWithLocal(
        tx: Transaction,
        change: SyncChange,
        local: LocalRecord | undefined,
        tombstone: Tombstone | undefined,
        conflicts: Array<{ tableName: string; pk: string; local: LocalRecord | undefined; remote: unknown; winner: 'local' | 'remote' }>
    ): Promise<ChangeResult> {
        const { tableName, pk, payload, stamp } = change;
        const table = tx.table(tableName);
        const remoteClock = stamp.clock;
        const hookBridge = getHookBridge(this.db);
        hookBridge.markSyncTransaction(tx);

        // Use shared normalizer for consistent snake_case/camelCase mapping and validation
        const normalized = normalizeSyncPayload(tableName, pk, payload, stamp);
        if (!normalized.isValid) {
            console.error('[ConflictResolver] Invalid payload for', tableName, normalized.errors);
            return { applied: false, skipped: true, isConflict: false };
        }

        // ref_count is a local derived cache. It is deliberately omitted from
        // outbound sync and must never be accepted as authority from a remote
        // provider (including a malicious/custom provider). Preserve a valid
        // local value on updates and seed new remote rows at zero. Canonical
        // server GC uses materialized reference edges instead of this cache.
        const remotePayload = tableName === 'file_meta'
            ? {
                  ...normalized.payload,
                  ref_count:
                      typeof local?.ref_count === 'number' &&
                      Number.isSafeInteger(local.ref_count) &&
                      local.ref_count >= 0
                          ? local.ref_count
                          : 0,
              }
            : normalized.payload;
        
        if (tombstone && tombstoneBlocks(stamp, tombstone)) {
            return { applied: false, skipped: true, isConflict: false };
        }

        // The normalizer already includes pkField, clock, and hlc in remotePayload

        if (!local) {
            // New record - just insert
            await table.put(remotePayload);
            if (tombstone) {
                await this.clearTombstone(tx, tableName, pk);
            }
            return { applied: true, skipped: false, isConflict: false };
        }

        const localClock = local.clock ?? 0;
        const comparison = compareSyncRevision(stamp, rowRevision(local));

        if (remoteClock > localClock) {
            // Remote wins - update
            await table.put(remotePayload);
            if (tombstone) {
                await this.clearTombstone(tx, tableName, pk);
            }
            return { applied: true, skipped: false, isConflict: false };
        } else if (remoteClock === localClock) {
            // Tie-break with HLC
            const localHlc = local.hlc ?? '';
            if (comparison > 0) {
                await table.put(remotePayload);
                if (tombstone) {
                    await this.clearTombstone(tx, tableName, pk);
                }
                if (import.meta.dev) {
                    console.debug('[sync] conflict put tie -> remote', {
                        tableName,
                        pk,
                        localClock,
                        remoteClock,
                        localHlc,
                        remoteHlc: stamp.hlc,
                    });
                }
                // Queue conflict for hook emission after transaction
                conflicts.push({ tableName, pk, local, remote: payload, winner: 'remote' });
                return { applied: true, skipped: false, isConflict: true, winner: 'remote' };
            }
            if (comparison === 0) {
                // Exact duplicate delivery, not a conflict.
                return { applied: false, skipped: true, isConflict: false };
            }
            // Queue conflict for hook emission after transaction
            if (import.meta.dev) {
                console.debug('[sync] conflict put tie -> local', {
                    tableName,
                    pk,
                    localClock,
                    remoteClock,
                    localHlc,
                    remoteHlc: stamp.hlc,
                });
            }
            conflicts.push({ tableName, pk, local, remote: payload, winner: 'local' });
            return { applied: false, skipped: true, isConflict: true, winner: 'local' };
        }

        // Local wins (local clock higher)
        return { applied: false, skipped: true, isConflict: false };
    }

    private async writeTombstone(
        tx: Transaction,
        tableName: string,
        pk: string,
        stamp: ChangeStamp,
        serverVersion: number,
        existing: Tombstone | undefined
    ): Promise<void> {
        const id = `${tableName}:${pk}`;

        if (existing && tombstoneBlocks(stamp, existing)) {
            return;
        }

        const tombstone: Tombstone = {
            id,
            tableName,
            pk,
            deletedAt: nowSec(),
            clock: stamp.clock,
            hlc: stamp.hlc,
            opId: stamp.opId,
            serverVersion,
            syncedAt: nowSec(),
        };
        await tx.table('tombstones').put(tombstone);
    }

    private async clearTombstone(tx: Transaction, tableName: string, pk: string): Promise<void> {
        const id = `${tableName}:${pk}`;
        await tx.table('tombstones').delete(id);
    }
}

/**
 * Purpose:
 * Summary of a batch apply operation.
 */
export interface ApplyResult {
    applied: number;
    skipped: number;
    conflicts: number;
}

/**
 * Purpose:
 * Per-change apply result used internally and for diagnostics.
 */
export interface ChangeResult {
    applied: boolean;
    skipped: boolean;
    isConflict: boolean;
    winner?: 'local' | 'remote';
}
