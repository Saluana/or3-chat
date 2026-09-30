import type { Transaction } from 'dexie';
import type { Or3DB, SnapshotStageRow } from '~/db/client';
import type { PendingOp, SnapshotItem, SnapshotResponse, SyncScope } from '~~/shared/sync/types';
import { compareSyncRevision } from '~~/shared/sync/revision';
import { getHookBridge, getLocalOnlyKvNames } from './hook-bridge';
import { normalizeSyncPayload } from './sync-payload-normalizer';

const STAGE_BATCH_SIZE = 300;
const ACTIVE_PENDING_STATUSES = [
    'pending', 'in_flight', 'retry_wait', 'failed_retryable', 'syncing',
] as const;

function abortSnapshotApply(): never {
    const error = new Error('Snapshot apply was cancelled');
    error.name = 'AbortError';
    throw error;
}

function syncStateId(scope: SyncScope): string {
    return `sync_state:${scope.workspaceId}:${scope.projectId ?? 'default'}`;
}

function revisionOf(value: unknown): { clock: number; hlc: string; opId: string } | null {
    if (!value || typeof value !== 'object') return null;
    const row = value as { clock?: number; hlc?: string; op_id?: string; opId?: string };
    return {
        clock: row.clock ?? 0,
        hlc: row.hlc ?? '',
        opId: row.op_id ?? row.opId ?? '',
    };
}

function isLocalOnlyKv(item: SnapshotItem, names: Set<string>): boolean {
    if (item.tableName !== 'kv') return false;
    const payload = item.kind === 'row' && item.payload && typeof item.payload === 'object'
        ? item.payload as { name?: unknown }
        : null;
    const name = typeof payload?.name === 'string' ? payload.name : item.pk.replace(/^kv:/, '');
    return names.has(name);
}

export async function applyPendingOp(
    tx: Transaction,
    op: PendingOp,
    preservedFileRefCount?: number
): Promise<void> {
    const table = tx.table(op.tableName);
    const tombstoneTable = tx.table('tombstones');
    const tombstoneId = `${op.tableName}:${op.pk}`;
    const [local, tombstone] = await Promise.all([
        table.get(op.pk) as Promise<unknown>,
        tombstoneTable.get(tombstoneId) as Promise<unknown>,
    ]);
    const localRevision = revisionOf(local);
    const tombstoneRevision = revisionOf(tombstone);
    if (localRevision && compareSyncRevision(op.stamp, localRevision) <= 0) return;
    // Legacy equal-clock tombstones have no deterministic tie break.
    if (
        tombstoneRevision?.clock === op.stamp.clock &&
        (!tombstoneRevision.hlc || !tombstoneRevision.opId)
    ) return;
    if (tombstoneRevision && compareSyncRevision(op.stamp, tombstoneRevision) <= 0) return;

    if (op.operation === 'put') {
        if (!op.payload || typeof op.payload !== 'object' || Array.isArray(op.payload)) {
            throw new Error(`Pending payload is invalid for ${op.tableName}:${op.pk}`);
        }
        const normalized = normalizeSyncPayload(op.tableName, op.pk, op.payload, op.stamp);
        if (!normalized.isValid) {
            throw new Error(`Pending payload failed validation for ${op.tableName}:${op.pk}: ${normalized.errors?.join('; ')}`);
        }
        const localRefCount = (local as { ref_count?: unknown } | null)?.ref_count;
        const localPayload = op.tableName === 'file_meta'
            ? {
                ...normalized.payload,
                ref_count: typeof preservedFileRefCount === 'number'
                    ? preservedFileRefCount
                    : typeof localRefCount === 'number' && Number.isSafeInteger(localRefCount) && localRefCount >= 0
                        ? localRefCount : 0,
            }
            : normalized.payload;
        await table.put(localPayload);
        if (tombstone) await tombstoneTable.delete(tombstoneId);
        return;
    }

    await table.delete(op.pk);
    const payload = op.payload && typeof op.payload === 'object' && !Array.isArray(op.payload)
        ? op.payload as { deleted_at?: unknown }
        : null;
    const deletedAt = typeof payload?.deleted_at === 'number' ? payload.deleted_at : Math.floor(Date.now() / 1000);
    await tombstoneTable.put({
        id: tombstoneId,
        tableName: op.tableName,
        pk: op.pk,
        deletedAt,
        clock: op.stamp.clock,
        hlc: op.stamp.hlc,
        opId: op.stamp.opId,
    });
}

/** Persists bounded pages before an atomic install. No target row changes during staging. */
export class SnapshotStager {
    private readonly generation = crypto.randomUUID();
    private readonly tableNames = new Set<string>();
    private readonly localOnlyKv = getLocalOnlyKvNames();
    private snapshotId: string | null = null;
    private highWatermark = 0;
    private previousKey: string | null = null;
    private previousLogicalKey: string | null = null;
    private sequence = 0;
    private complete = false;

    constructor(
        private readonly db: Or3DB,
        private readonly scope: SyncScope,
        private readonly requestedTables: string[] = []
    ) {}

    async start(): Promise<void> {
        // An interrupted attempt leaves only expendable staging rows. A workspace
        // database has one active snapshot generation. The sentinel prevents an
        // invalidated older lifecycle from clearing a newer attempt on dispose.
        await this.db.transaction('rw', this.db.snapshot_staging, async () => {
            await this.db.snapshot_staging.clear();
            await this.db.snapshot_staging.put({
                id: '__active__',
                generation: this.generation,
                sequence: -1,
                item: null,
            });
        });
    }

    async appendPage(page: SnapshotResponse): Promise<void> {
        if (this.complete) throw new Error('Snapshot chain ended before the supplied final page');
        if (page.workspaceId !== this.scope.workspaceId) {
            throw new Error('Snapshot workspace does not match the requested scope');
        }
        if (this.snapshotId === null) {
            this.snapshotId = page.snapshotId;
            this.highWatermark = page.highWatermark;
        } else if (page.snapshotId !== this.snapshotId || page.highWatermark !== this.highWatermark) {
            throw new Error('Snapshot page identity or high-watermark changed');
        }

        const rows: SnapshotStageRow[] = [];
        for (const item of page.items) {
            const logicalKey = `${item.tableName}\0${item.pk}`;
            const key = `${logicalKey}\0${item.kind}`;
            if (logicalKey === this.previousLogicalKey) {
                throw new Error('Snapshot contains duplicate or contradictory entries for one record');
            }
            if (this.previousKey !== null && key <= this.previousKey) {
                throw new Error('Snapshot items are duplicated or out of order');
            }
            this.previousKey = key;
            this.previousLogicalKey = logicalKey;
            this.tableNames.add(item.tableName);
            if (isLocalOnlyKv(item, this.localOnlyKv)) continue;
            rows.push({
                id: `${this.generation}:${this.sequence}`,
                generation: this.generation,
                sequence: this.sequence++,
                item,
            });
        }
        if (rows.length) await this.db.snapshot_staging.bulkPut(rows);
        this.complete = page.nextPageToken === null;
    }

    async apply(
        deviceId: string,
        shouldContinue: () => boolean = () => true,
        replacementTables: string[] = []
    ): Promise<number> {
        if (!this.complete || this.snapshotId === null) {
            throw new Error('Snapshot chain is incomplete');
        }
        const tableNames = [...new Set([
            ...this.requestedTables,
            ...this.tableNames,
            ...replacementTables,
        ])];
        const transactionTables = [
            ...tableNames.map((name) => this.db.table(name)),
            this.db.tombstones,
            this.db.sync_state,
            this.db.pending_ops,
            this.db.snapshot_staging,
        ];
        const localOnlyKv = getLocalOnlyKvNames();

        await this.db.transaction('rw', transactionTables, async (tx) => {
            getHookBridge(this.db).markSyncTransaction(tx);
            if (!shouldContinue()) abortSnapshotApply();
            const active: SnapshotStageRow | undefined =
                await tx.table('snapshot_staging').get('__active__') as SnapshotStageRow | undefined;
            if (active?.generation !== this.generation) abortSnapshotApply();

            // Read the outbox inside this transaction. Writes made while pages
            // were fetched are included, and the cursor cannot commit before
            // the matching local intent is restored.
            const pendingOps: PendingOp[] = [];
            for (const status of ACTIVE_PENDING_STATUSES) {
                pendingOps.push(...await tx.table('pending_ops').where('status').equals(status).toArray());
            }
            pendingOps.sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
            const fileRefCounts = new Map<string, number>();
            for (const op of pendingOps) {
                if (
                    op.tableName !== 'file_meta' ||
                    !tableNames.includes('file_meta') ||
                    fileRefCounts.has(op.pk)
                ) continue;
                const local: unknown = await tx.table('file_meta').get(op.pk);
                const count = (local as { ref_count?: unknown } | undefined)?.ref_count;
                if (typeof count === 'number' && Number.isSafeInteger(count) && count >= 0) {
                    fileRefCounts.set(op.pk, count);
                }
            }

            for (const tableName of replacementTables) {
                if (!shouldContinue()) abortSnapshotApply();
                if (tableName === 'kv') {
                    await tx.table('kv').toCollection()
                        .filter((row: { name?: string }) => !localOnlyKv.has(row.name ?? ''))
                        .delete();
                } else {
                    await tx.table(tableName).clear();
                }
            }
            if (replacementTables.length) {
                const replaced = new Set(replacementTables);
                await tx.table('tombstones').toCollection()
                    .filter((row: { tableName?: string; pk?: string }) =>
                        replaced.has(row.tableName ?? '') &&
                        !(row.tableName === 'kv' && localOnlyKv.has((row.pk ?? '').replace(/^kv:/, '')))
                    )
                    .delete();
            }

            let nextSequence = 0;
            while (nextSequence < this.sequence) {
                if (!shouldContinue()) abortSnapshotApply();
                const batch = await tx.table('snapshot_staging')
                    .where('[generation+sequence]')
                    .between([this.generation, nextSequence], [this.generation, Number.MAX_SAFE_INTEGER])
                    .limit(STAGE_BATCH_SIZE)
                    .toArray() as SnapshotStageRow[];
                if (!batch.length) throw new Error('Snapshot staging rows are incomplete');
                const rowsByTable = new Map<string, Record<string, unknown>[]>();
                const deletesByTable = new Map<string, string[]>();
                const tombstones: Record<string, unknown>[] = [];
                for (const row of batch) {
                    if (!shouldContinue()) abortSnapshotApply();
                    if (row.sequence !== nextSequence) {
                        throw new Error('Snapshot staging rows are incomplete');
                    }
                    const item = row.item;
                    if (!item) throw new Error('Snapshot staging row is invalid');
                    nextSequence = row.sequence + 1;
                    if (isLocalOnlyKv(item, localOnlyKv)) continue;
                    if (item.kind === 'row') {
                        if (!item.payload || typeof item.payload !== 'object' || Array.isArray(item.payload)) {
                            throw new Error(`Snapshot row payload is invalid for ${item.tableName}:${item.pk}`);
                        }
                        const normalized = normalizeSyncPayload(item.tableName, item.pk, item.payload, item.revision);
                        if (!normalized.isValid) {
                            throw new Error(`Snapshot row payload failed validation for ${item.tableName}:${item.pk}: ${normalized.errors?.join('; ') ?? 'unknown validation error'}`);
                        }
                        const rows = rowsByTable.get(item.tableName) ?? [];
                        rows.push(item.tableName === 'file_meta'
                            ? { ...normalized.payload, ref_count: 0 }
                            : normalized.payload);
                        rowsByTable.set(item.tableName, rows);
                    } else {
                        const keys = deletesByTable.get(item.tableName) ?? [];
                        keys.push(item.pk);
                        deletesByTable.set(item.tableName, keys);
                        tombstones.push({
                            id: `${item.tableName}:${item.pk}`,
                            tableName: item.tableName,
                            pk: item.pk,
                            deletedAt: item.serverDeletedAt,
                            clock: item.revision.clock,
                            hlc: item.revision.hlc,
                            opId: item.revision.opId,
                            serverDeletedAt: item.serverDeletedAt,
                            syncedAt: item.serverDeletedAt,
                        });
                    }
                }
                for (const [tableName, rows] of rowsByTable) {
                    await tx.table(tableName).bulkPut(rows);
                }
                for (const [tableName, keys] of deletesByTable) {
                    await tx.table(tableName).bulkDelete(keys);
                }
                if (tombstones.length) await tx.table('tombstones').bulkPut(tombstones);
            }

            for (const op of pendingOps) {
                if (!shouldContinue()) abortSnapshotApply();
                if (tableNames.includes(op.tableName)) {
                    await applyPendingOp(tx, op, fileRefCounts.get(op.pk));
                }
            }
            if (!shouldContinue()) abortSnapshotApply();
            await tx.table('sync_state').put({
                id: syncStateId(this.scope),
                cursor: this.highWatermark,
                lastSyncAt: Date.now(),
                deviceId,
            });
        });

        return this.highWatermark;
    }

    async dispose(): Promise<void> {
        try {
            await this.db.transaction('rw', this.db.snapshot_staging, async () => {
                const active = await this.db.snapshot_staging.get('__active__');
                if (active?.generation === this.generation) {
                    await this.db.snapshot_staging.clear();
                }
            });
        } catch (error) {
            // The cursor and materialized rows have already committed. Stale
            // stage rows are discarded on the next attempt.
            console.warn('[SnapshotStager] Failed to clean temporary rows:', error);
        }
    }
}

/** Compatibility entry point for callers with an already collected chain. */
export async function applySnapshotChain(
    db: Or3DB,
    pages: SnapshotResponse[],
    scope: SyncScope,
    deviceId: string,
    shouldContinue: () => boolean = () => true,
    replacementTables: string[] = []
): Promise<number> {
    const stager = new SnapshotStager(db, scope);
    await stager.start();
    try {
        for (const page of pages) await stager.appendPage(page);
        return await stager.apply(deviceId, shouldContinue, replacementTables);
    } finally {
        await stager.dispose();
    }
}
