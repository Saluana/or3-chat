/**
 * ConflictResolver - Applies remote changes with LWW conflict resolution
 *
 * Implements Last-Write-Wins (LWW) conflict resolution:
 * - Higher clock value wins
 * - If clocks are equal, HLC breaks the tie
 * - Emits conflict hooks for observability
 */
import type { Or3DB } from '~/db/client';
import type { SyncChange, Tombstone } from '~~/shared/sync/types';
import type { Table } from 'dexie';
import { compareHLC } from './hlc';
import { getHookBridge } from './hook-bridge';
import { useHooks } from '~/core/hooks/useHooks';
import { nowSec } from '~/db/util';

/** Local record with clock and optional HLC */
interface LocalRecord {
    clock?: number;
    hlc?: string;
    deleted?: boolean;
    [key: string]: unknown;
}

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

        // Apply in a single transaction for atomicity and performance
        await this.db.transaction('rw', tables, async (tx) => {
            // Mark this specific transaction as a sync transaction
            getHookBridge(this.db).markSyncTransaction(tx);

            for (const change of changes) {
                const changeResult = await this.applyChange(change);
                result.applied += changeResult.applied ? 1 : 0;
                result.skipped += changeResult.skipped ? 1 : 0;
                result.conflicts += changeResult.isConflict ? 1 : 0;
            }
        });

        return result;
    }

    /**
     * Apply a single remote change
     */
    async applyChange(change: SyncChange): Promise<ChangeResult> {
        const { tableName, pk, op, payload, stamp } = change;

        // Get the table
        const table = this.db.table(tableName);
        if (!table) {
            console.warn('[ConflictResolver] Unknown table:', tableName);
            return { applied: false, skipped: true, isConflict: false };
        }

        // Get local record
        const local = (await table.get(pk)) as LocalRecord | undefined;

        if (op === 'delete') {
            return this.applyDelete(table, tableName, pk, local, stamp);
        } else {
            return this.applyPut(table, tableName, pk, local, payload, stamp);
        }
    }

    /**
     * Apply a delete operation
     */
    private async applyDelete(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        table: Table<any, any>,
        tableName: string,
        pk: string,
        local: LocalRecord | undefined,
        stamp: { clock: number; hlc: string }
    ): Promise<ChangeResult> {
        if (!local) {
            await this.writeTombstone(tableName, pk, stamp.clock);
            // Already gone or never existed
            return { applied: false, skipped: true, isConflict: false };
        }

        if (local.deleted) {
            await this.writeTombstone(tableName, pk, stamp.clock);
            // Already deleted
            return { applied: false, skipped: true, isConflict: false };
        }

        // Check if remote delete wins
        const localClock = local.clock ?? 0;

        if (stamp.clock > localClock) {
            // Remote wins
            await table.update(pk, {
                deleted: true,
                deleted_at: nowSec(),
                clock: stamp.clock,
                hlc: stamp.hlc,
            });
            await this.writeTombstone(tableName, pk, stamp.clock);
            return { applied: true, skipped: false, isConflict: false };
        } else if (stamp.clock === localClock) {
            // Tie-break with HLC
            const localHlc = local.hlc ?? '';
            if (compareHLC(stamp.hlc, localHlc) > 0) {
                await table.update(pk, {
                    deleted: true,
                    deleted_at: nowSec(),
                    clock: stamp.clock,
                    hlc: stamp.hlc,
                });
                await this.writeTombstone(tableName, pk, stamp.clock);
                await useHooks().doAction('sync.conflict:action:detected', {
                    tableName,
                    pk,
                    local,
                    remote: { deleted: true },
                    winner: 'remote',
                });
                return { applied: true, skipped: false, isConflict: true, winner: 'remote' };
            }
            await useHooks().doAction('sync.conflict:action:detected', {
                tableName,
                pk,
                local,
                remote: { deleted: true },
                winner: 'local',
            });
            return { applied: false, skipped: true, isConflict: true, winner: 'local' };
        }

        // Local wins (local clock higher)
        return { applied: false, skipped: true, isConflict: false };
    }

    /**
     * Apply a put (insert/update) operation
     */
    private async applyPut(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        table: Table<any, any>,
        tableName: string,
        pk: string,
        local: LocalRecord | undefined,
        payload: unknown,
        stamp: { clock: number; hlc: string }
    ): Promise<ChangeResult> {
        const remoteClock = stamp.clock;
        const remotePayload = (payload ?? {}) as Record<string, unknown>;
        const tombstone = await this.getTombstone(tableName, pk);
        if (tombstone && tombstone.clock >= remoteClock) {
            return { applied: false, skipped: true, isConflict: false };
        }

        if (!local) {
            // New record - just insert
            await table.put({ ...remotePayload, id: pk, clock: stamp.clock, hlc: stamp.hlc });
            if (tombstone && tombstone.clock < remoteClock) {
                await this.clearTombstone(tableName, pk);
            }
            return { applied: true, skipped: false, isConflict: false };
        }

        const localClock = local.clock ?? 0;

        if (remoteClock > localClock) {
            // Remote wins - update
            await table.put({ ...remotePayload, id: pk, clock: stamp.clock, hlc: stamp.hlc });
            if (tombstone && tombstone.clock < remoteClock) {
                await this.clearTombstone(tableName, pk);
            }
            return { applied: true, skipped: false, isConflict: false };
        } else if (remoteClock === localClock) {
            // Tie-break with HLC
            const localHlc = local.hlc ?? '';
            if (compareHLC(stamp.hlc, localHlc) > 0) {
                await table.put({ ...remotePayload, id: pk, clock: stamp.clock, hlc: stamp.hlc });
                if (tombstone && tombstone.clock < remoteClock) {
                    await this.clearTombstone(tableName, pk);
                }
                await useHooks().doAction('sync.conflict:action:detected', {
                    tableName,
                    pk,
                    local,
                    remote: payload,
                    winner: 'remote',
                });
                return { applied: true, skipped: false, isConflict: true, winner: 'remote' };
            }
            // Local wins on tie-break
            await useHooks().doAction('sync.conflict:action:detected', {
                tableName,
                pk,
                local,
                remote: payload,
                winner: 'local',
            });
            return { applied: false, skipped: true, isConflict: true, winner: 'local' };
        }

        // Local wins (local clock higher)
        return { applied: false, skipped: true, isConflict: false };
    }

    private async getTombstone(
        tableName: string,
        pk: string
    ): Promise<Tombstone | undefined> {
        const id = `${tableName}:${pk}`;
        const row = await this.db.table('tombstones').get(id);
        return row as Tombstone | undefined;
    }

    private async writeTombstone(
        tableName: string,
        pk: string,
        clock: number
    ): Promise<void> {
        const id = `${tableName}:${pk}`;
        const existing = (await this.db.table('tombstones').get(id)) as
            | Tombstone
            | undefined;
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

export interface ApplyResult {
    applied: number;
    skipped: number;
    conflicts: number;
}

export interface ChangeResult {
    applied: boolean;
    skipped: boolean;
    isConflict: boolean;
    winner?: 'local' | 'remote';
}
