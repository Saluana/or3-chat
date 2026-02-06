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
import type { SyncChange, Tombstone } from '~~/shared/sync/types';
import type { Table } from 'dexie';
import { compareHLC } from './hlc';
import { getHookBridge } from './hook-bridge';
import { useHooks } from '~/core/hooks/useHooks';
import { nowSec } from '~/db/util';
import { normalizeSyncPayload } from './sync-payload-normalizer';

/** Local record with clock and optional HLC */
interface LocalRecord {
    clock?: number;
    hlc?: string;
    deleted?: boolean;
    [key: string]: unknown;
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
                const table = this.db.table(tableName);
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
            const tombstoneRecords = await this.db.tombstones.bulkGet(tombstoneIds);
            const tombstonesMap = new Map<string, Tombstone>();
            tombstoneRecords.forEach((rec, idx) => {
                if (rec) tombstonesMap.set(tombstoneIds[idx]!, rec as Tombstone);
            });

            for (const change of changes) {
                const local = existingByTable.get(change.tableName)?.get(change.pk);
                const tombstone = tombstonesMap.get(`${change.tableName}:${change.pk}`);

                const changeResult = change.op === 'delete'
                    ? await this.applyDeleteWithLocal(change, local, tombstone, conflicts)
                    : await this.applyPutWithLocal(change, local, tombstone, conflicts);

                result.applied += changeResult.applied ? 1 : 0;
                result.skipped += changeResult.skipped ? 1 : 0;
                result.conflicts += changeResult.isConflict ? 1 : 0;
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
        change: SyncChange,
        local: LocalRecord | undefined,
        existingTombstone: Tombstone | undefined,
        conflicts: Array<{ tableName: string; pk: string; local: LocalRecord | undefined; remote: unknown; winner: 'local' | 'remote' }>
    ): Promise<ChangeResult> {
        const { tableName, pk, stamp } = change;
        const table = this.db.table(tableName);

        if (!local) {
            await this.writeTombstone(tableName, pk, stamp.clock, existingTombstone);
            // Already gone or never existed
            return { applied: false, skipped: true, isConflict: false };
        }

        if (local.deleted) {
            await this.writeTombstone(tableName, pk, stamp.clock, existingTombstone);
            // Already deleted
            return { applied: false, skipped: true, isConflict: false };
        }

        // Check if remote delete wins
        const localClock = local.clock ?? 0;

        if (stamp.clock > localClock) {
            // Remote wins
            const remotePayload = change.payload as { deleted_at?: number } | undefined;
            const deletedAt = remotePayload?.deleted_at ?? nowSec();

            await table.update(pk, {
                deleted: true,
                deleted_at: deletedAt,
                clock: stamp.clock,
                hlc: stamp.hlc,
            });
            await this.writeTombstone(tableName, pk, stamp.clock, existingTombstone);
            return { applied: true, skipped: false, isConflict: false };
        } else if (stamp.clock === localClock) {
            // Tie-break with HLC
            const localHlc = local.hlc ?? '';
            const cmp = compareHLC(stamp.hlc, localHlc);
            if (cmp > 0) {
                const remotePayload = change.payload as { deleted_at?: number } | undefined;
                const deletedAt = remotePayload?.deleted_at ?? nowSec();

                await table.update(pk, {
                    deleted: true,
                    deleted_at: deletedAt,
                    clock: stamp.clock,
                    hlc: stamp.hlc,
                });
                await this.writeTombstone(tableName, pk, stamp.clock, existingTombstone);
                if (import.meta.dev) {
                    console.debug('[sync] conflict delete tie -> remote', {
                        tableName,
                        pk,
                        localClock,
                        remoteClock: stamp.clock,
                        localHlc,
                        remoteHlc: stamp.hlc,
                    });
                }
                // Queue conflict for hook emission after transaction
                conflicts.push({ tableName, pk, local, remote: { deleted: true }, winner: 'remote' });
                return { applied: true, skipped: false, isConflict: true, winner: 'remote' };
            }
            if (cmp === 0) {
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
                    localHlc,
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
        change: SyncChange,
        local: LocalRecord | undefined,
        tombstone: Tombstone | undefined,
        conflicts: Array<{ tableName: string; pk: string; local: LocalRecord | undefined; remote: unknown; winner: 'local' | 'remote' }>
    ): Promise<ChangeResult> {
        const { tableName, pk, payload, stamp } = change;
        const table = this.db.table(tableName);
        const remoteClock = stamp.clock;

        // Use shared normalizer for consistent snake_case/camelCase mapping and validation
        const normalized = normalizeSyncPayload(tableName, pk, payload, stamp);
        if (!normalized.isValid) {
            console.error('[ConflictResolver] Invalid payload for', tableName, normalized.errors);
            return { applied: false, skipped: true, isConflict: false };
        }

        const remotePayload = normalized.payload;
        
        if (tombstone && tombstone.clock >= remoteClock) {
            return { applied: false, skipped: true, isConflict: false };
        }

        // The normalizer already includes pkField, clock, and hlc in remotePayload

        if (!local) {
            // New record - just insert
            await table.put(remotePayload);
            if (tombstone && tombstone.clock < remoteClock) {
                await this.clearTombstone(tableName, pk);
            }
            return { applied: true, skipped: false, isConflict: false };
        }

        const localClock = local.clock ?? 0;

        if (remoteClock > localClock) {
            // Remote wins - update
            await table.put(remotePayload);
            if (tombstone && tombstone.clock < remoteClock) {
                await this.clearTombstone(tableName, pk);
            }
            return { applied: true, skipped: false, isConflict: false };
        } else if (remoteClock === localClock) {
            // Tie-break with HLC
            const localHlc = local.hlc ?? '';
            const cmp = compareHLC(stamp.hlc, localHlc);
            if (cmp > 0) {
                await table.put(remotePayload);
                if (tombstone && tombstone.clock < remoteClock) {
                    await this.clearTombstone(tableName, pk);
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
            if (cmp === 0) {
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
        tableName: string,
        pk: string,
        clock: number,
        existing: Tombstone | undefined
    ): Promise<void> {
        const id = `${tableName}:${pk}`;

        if (existing && existing.clock >= clock) {
            return;
        }

        const tombstone: Tombstone = {
            id,
            tableName,
            pk,
            deletedAt: nowSec(),
            clock,
            syncedAt: nowSec(),
        };
        await this.db.table('tombstones').put(tombstone);
    }

    private async clearTombstone(tableName: string, pk: string): Promise<void> {
        const id = `${tableName}:${pk}`;
        await this.db.table('tombstones').delete(id);
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
