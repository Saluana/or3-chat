import { readHistory, assertHistory, type HistoryGuard } from './history-incarnation';
import { holdHistoryInTx } from './sync-quarantine';
import { clearRecentOpIds } from './recent-op-cache';
import { MAX_SYNC_PAYLOAD_BYTES } from '~~/shared/sync/sanitize';
import { assertIncomingIdentity, isSyncTable } from '~~/shared/sync/incoming-records';
import { retainIncomingEvidenceInTx } from './incoming-evidence';
import { compareSyncTuple, syncJsonByteLength, SnapshotItemSchema, SnapshotResponseSchema, SnapshotUnavailableRecordSchema } from '~~/shared/sync/schemas';
import { getSyncStateId } from './cursor-manager';
import { createRuntimeUuid } from '~~/shared/runtime-id';
import type { Transaction } from 'dexie';
import type { Or3DB, SnapshotStageRow, StagedUnavailableRecord } from '~/db/client';
import type { Message } from '~/db/schema';
import type { PendingOp, SnapshotItem, SnapshotResponse, SyncScope } from '~~/shared/sync/types';
import { compareSyncRevision } from '~~/shared/sync/revision';
import { SYNCED_TABLES, getHookBridge, getLocalOnlyKvNames } from './hook-bridge';
import { normalizeSyncPayload } from './sync-payload-normalizer';
import { QUARANTINE_SUPPORT_TABLES, collectReplayableOps, pruneResolvedQuarantineBestEffort } from './sync-quarantine';

const STAGE_BATCH_SIZE = 300;

function abortSnapshotApply(): never {
    const error = new Error('Snapshot apply was cancelled');
    error.name = 'AbortError';
    throw error;
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

function isLocalOnlyKv(item: SnapshotItem | StagedUnavailableRecord, names: Set<string>): boolean {
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
    private readonly generation = createRuntimeUuid();
    private readonly tableNames = new Set<string>();
    private readonly localOnlyKv = getLocalOnlyKvNames();
    private snapshotId: string | null = null;
    private highWatermark = 0;
    private previousKey: string[] | null = null;
    private previousLogicalKey: string | null = null;
    private sequence = 0;
    private readonly unavailableKeys = new Set<string>();
    private complete = false;
    private historyIncarnation: string | undefined;
    private expectedHistory: HistoryGuard | undefined;

    constructor(
        private readonly db: Or3DB,
        private readonly scope: SyncScope,
        private readonly requestedTables: string[] = []
    ) {}

    async start(): Promise<void> {
        // An interrupted attempt leaves only expendable staging rows. A workspace
        // database has one active snapshot generation. The sentinel prevents an
        // invalidated older lifecycle from clearing a newer attempt on dispose.
        await this.db.transaction('rw', [this.db.snapshot_staging, this.db.sync_state], async () => {
            this.expectedHistory = await readHistory(this.db);
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
            this.historyIncarnation = page.historyIncarnation;
        } else if (page.historyIncarnation !== this.historyIncarnation) {
            throw new Error('Snapshot history incarnation changed');
        }
        if (this.snapshotId === null) {
            this.snapshotId = page.snapshotId;
            this.highWatermark = page.highWatermark;
        } else if (page.snapshotId !== this.snapshotId || page.highWatermark !== this.highWatermark) {
            throw new Error('Snapshot page identity or high-watermark changed');
        }

        // Validate provider lanes before merging; sorting must not hide a broken seek.
        for (const lane of [page.items, page.unavailable ?? []]) {
            let previous: string[] | null = null;
            for (const entry of lane) {
                assertIncomingIdentity(entry);
                const key = [entry.tableName, entry.pk, 'kind' in entry ? entry.kind : entry.originalKind];
                if (previous && compareSyncTuple(key, previous) <= 0) throw new Error('Snapshot items are duplicated or out of order');
                previous = key;
            }
        }
        const entries: (SnapshotItem | StagedUnavailableRecord)[] = page.items.map(item => {
            let reason = !SnapshotItemSchema.safeParse(item).success ? 'invalid_record_envelope' : !isSyncTable(item.tableName) ? 'unknown_table' : null;
            if (!reason && item.kind === 'row' && syncJsonByteLength(item.payload) > MAX_SYNC_PAYLOAD_BYTES) reason = 'oversized_payload';
            if (!reason && item.kind === 'row' && !normalizeSyncPayload(item.tableName, item.pk, item.payload, item.revision).isValid) reason = 'invalid_local_payload';
            if (!reason) return item;
            const marker = SnapshotUnavailableRecordSchema.parse({ tableName: item.tableName, pk: item.pk,
                originalKind: item.kind, snapshotId: page.snapshotId, highWatermark: page.highWatermark,
                evidenceRef: 'client-discovered', reason });
            return { ...marker, kind: 'unavailable' as const, record: item };
        });
        for (const raw of page.unavailable ?? []) {
            const marker = SnapshotUnavailableRecordSchema.parse(raw);
            if (marker.snapshotId !== page.snapshotId || marker.highWatermark !== page.highWatermark) throw new Error('Unavailable snapshot identity changed');
            entries.push({ ...marker, kind: 'unavailable' });
        }
        const keyOf = (item: SnapshotItem | StagedUnavailableRecord) => [item.tableName, item.pk, item.kind === 'unavailable' ? item.originalKind : item.kind];
        entries.sort((a, b) => compareSyncTuple(keyOf(a), keyOf(b)));
        SnapshotResponseSchema.parse({ ...page, items: entries.filter(item => item.kind !== 'unavailable'),
            unavailable: entries.filter(item => item.kind === 'unavailable') });

        const rows: SnapshotStageRow[] = [];
        let previousKey = this.previousKey;
        let previousLogicalKey = this.previousLogicalKey;
        let sequence = this.sequence;
        for (const item of entries) {
            const logicalKey = JSON.stringify([item.tableName, item.pk]);
            const key = keyOf(item);
            if (logicalKey === previousLogicalKey) throw new Error('Snapshot contains duplicate or contradictory entries for one record');
            if (previousKey !== null && compareSyncTuple(key, previousKey) <= 0) throw new Error('Snapshot items are duplicated or out of order');
            previousKey = key;
            previousLogicalKey = logicalKey;
            if (isLocalOnlyKv(item, this.localOnlyKv)) continue;
            rows.push({ id: `${this.generation}:${sequence}`, generation: this.generation, sequence: sequence++, item });
        }
        if (rows.length) await this.db.snapshot_staging.bulkPut(rows);
        // Commit in-memory continuation only after the page is durable (quota can retry it).
        this.previousKey = previousKey;
        this.previousLogicalKey = previousLogicalKey;
        this.sequence = sequence;
        for (const item of entries) {
            if (isSyncTable(item.tableName)) this.tableNames.add(item.tableName);
            if (item.kind === 'unavailable') this.unavailableKeys.add(JSON.stringify([item.tableName, item.pk]));
        }
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
        const crossHistory = this.historyIncarnation !== undefined &&
            (this.expectedHistory?.phase !== 'ready' || this.expectedHistory.historyIncarnation !== this.historyIncarnation);
        if (crossHistory) replacementTables = [...SYNCED_TABLES];
        replacementTables = replacementTables.filter(isSyncTable);
        const tableNames = [...new Set([
            ...this.requestedTables,
            ...this.tableNames,
            ...replacementTables,
        ].filter(isSyncTable))];
        const transactionTables = [
            ...tableNames.map((name) => this.db.table(name)),
            // Foreground rows need a live parent check when restored below.
            ...(tableNames.includes('messages') ? [this.db.threads] : []),
            this.db.sync_state,
            ...(crossHistory ? [this.db.file_transfers] : []),
            this.db.snapshot_staging,
            ...QUARANTINE_SUPPORT_TABLES.map((name) => this.db.table(name)),
        ];
        const localOnlyKv = getLocalOnlyKvNames();

        await this.db.transaction('rw', transactionTables, async (tx) => {
            getHookBridge(this.db).markSyncTransaction(tx);
            if (!shouldContinue()) abortSnapshotApply();
            const active: SnapshotStageRow | undefined =
                await tx.table('snapshot_staging').get('__active__') as SnapshotStageRow | undefined;
            if (active?.generation !== this.generation) abortSnapshotApply();

            if (this.historyIncarnation !== undefined) {
                if (!this.expectedHistory) abortSnapshotApply();
                await assertHistory(tx, this.expectedHistory);
                if (this.expectedHistory.resetTarget && this.expectedHistory.resetTarget !== this.historyIncarnation) abortSnapshotApply();
                if (crossHistory) await holdHistoryInTx(tx, this.scope, this.expectedHistory.historyIncarnation ?? 'unknown');
            }
            const preserved: { tableName: string; pk: string; row: unknown; tombstone: unknown }[] = [];
            let evidenceSequence = 0;
            while (evidenceSequence < this.sequence) {
                const batch = await tx.table('snapshot_staging').where('[generation+sequence]')
                    .between([this.generation, evidenceSequence], [this.generation, Number.MAX_SAFE_INTEGER])
                    .limit(STAGE_BATCH_SIZE).toArray() as SnapshotStageRow[];
                if (!batch.length) throw new Error('Snapshot staging rows are incomplete');
                for (const row of batch) {
                    evidenceSequence = row.sequence + 1;
                    const item = row.item;
                    if (item?.kind !== 'unavailable') continue;
                    await retainIncomingEvidenceInTx(tx, { ...item, source: 'incoming_snapshot',
                        historyIncarnation: this.historyIncarnation, reference: item.snapshotId, record: item.record ?? item });
                    // Evidence is deduplicated across retries. Its archived local
                    // copy may predate edits/deletes made before this installation.
                    if (!crossHistory && isSyncTable(item.tableName)) preserved.push({ tableName: item.tableName, pk: item.pk,
                        row: await tx.table(item.tableName).get(item.pk),
                        tombstone: await tx.table('tombstones').get(`${item.tableName}:${item.pk}`) });
                }
            }

            // Read the outbox inside this transaction. Writes made while pages
            // were fetched are included, and the cursor cannot commit before
            // the matching local intent is restored. Permanently failed work is
            // restored too: replacing the table would otherwise erase the only
            // copy of that content. Corrupt operations are quarantined and
            // rebuilt from the still-present local rows before anything is cleared.
            const pendingOps = crossHistory ? [] : await collectReplayableOps(
                tx,
                (tableName, pk) => tableNames.includes(tableName) && !this.unavailableKeys.has(JSON.stringify([tableName, pk])),
                deviceId
            );
            // Streaming assistants intentionally have no sync operation. Their
            // local progress and lease must survive the same atomic replacement
            // as the outbox, including expired leases recoverable after reload.
            const foregroundRows: Message[] = !crossHistory && tableNames.includes('messages')
                ? await this.db.messages.filter((row: Message) => {
                    const data = row.data as Record<string, unknown> | null;
                    return row.role === 'assistant' && row.pending === true && !row.deleted
                        && typeof data?.generation_lease_id === 'string'
                        && typeof data.background_job_id !== 'string'
                        && typeof data.superseded_by !== 'string'
                        && data.generation_state !== 'superseded';
                }).toArray()
                : [];
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
                } else if (!crossHistory && tableName === 'notifications' && this.scope.principalId) {
                    await tx.table(tableName).filter(row => row.user_id === this.scope.principalId).delete();
                } else {
                    await tx.table(tableName).clear();
                }
            }
            if (replacementTables.length) {
                const replaced = new Set(replacementTables);
                await tx.table('tombstones').toCollection()
                    .filter((row: { tableName?: string; pk?: string }) =>
                        replaced.has(row.tableName ?? '') &&
                        // Other accounts may still need their notification deletion watermarks.
                        !(!crossHistory && row.tableName === 'notifications' && this.scope.principalId) &&
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
                    if (item.kind === 'unavailable' || isLocalOnlyKv(item, localOnlyKv)) continue;
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
                // Consumption and replacement roll back together on quota/abort.
                await tx.table('snapshot_staging').bulkDelete(batch.map(row => row.id));
            }

            for (const entry of preserved) {
                if (entry.row) await tx.table(entry.tableName).put(entry.row);
                if (entry.tombstone) await tx.table('tombstones').put(entry.tombstone);
            }
            for (const op of pendingOps) {
                if (!shouldContinue()) abortSnapshotApply();
                await applyPendingOp(tx, op, fileRefCounts.get(op.pk));
            }
            for (const row of foregroundRows) {
                if (!shouldContinue()) abortSnapshotApply();
                if (this.unavailableKeys.has(JSON.stringify(['messages', row.id]))) continue;
                const parent = await this.db.threads.get(row.thread_id);
                if (!parent || parent.deleted || await this.db.tombstones.get(`threads:${row.thread_id}`)) continue;
                const canonical = await this.db.messages.get(row.id);
                const tombstone = await this.db.tombstones.get(`messages:${row.id}`);
                const localRevision = revisionOf(row)!;
                // Preserve the existing clock/HLC LWW contract; a newer
                // canonical reply or deletion still supersedes local work.
                if (canonical && compareSyncRevision(localRevision, revisionOf(canonical)!) <= 0) continue;
                if (tombstone && compareSyncRevision(localRevision, revisionOf(tombstone)!) <= 0) continue;
                await tx.table('messages').put(row);
                if (tombstone) await tx.table('tombstones').delete(`messages:${row.id}`);
            }
            if (!shouldContinue()) abortSnapshotApply();
            await tx.table('snapshot_staging').delete('__active__');
            if (crossHistory) await tx.table('sync_state').clear();
            if (this.historyIncarnation !== undefined) await tx.table('sync_state').put({
                id: 'sync_history', historyIncarnation: this.historyIncarnation, phase: 'ready', resetTarget: null,
                cursor: 0, deviceId, lastSyncAt: Date.now(),
            });
            await tx.table('sync_state').put({
                historyIncarnation: this.historyIncarnation,
                id: getSyncStateId(this.scope),
                cursor: this.highWatermark,
                lastSyncAt: Date.now(),
                deviceId,
            });
        });

        if (crossHistory) clearRecentOpIds();
        // Recovery itself resolves quarantine entries, so retention runs here too.
        await pruneResolvedQuarantineBestEffort(this.db);
        return this.highWatermark;
    }

    getHistoryIncarnation(): string | undefined { return this.historyIncarnation; }

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
