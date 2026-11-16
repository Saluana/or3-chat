import { inspectLegacyStore } from '~/db/client';
import { getCachedSessionContext } from '~/composables/auth/useSessionContext';
import { parseHash, computeHashHex } from '~/utils/hash';
/**
 * @module app/core/sync/sync-quarantine
 *
 * Purpose:
 * Sets aside outbox operations that can no longer be pushed or replayed,
 * instead of deleting them, and rebuilds the sync intent from local content
 * whenever that can be done unambiguously.
 *
 * Behavior:
 * - `diagnoseOp` mirrors the replay path: an op is corrupt when it cannot be
 *   normalized into a local row (or has no usable identity/revision).
 * - `quarantineOpInTx` stores the original op, its diagnostics and the local
 *   row/tombstone it targets, then removes it from the queue. Everything
 *   happens in the caller's transaction, so a crash leaves either the original
 *   op or its quarantine entry plus any replacement, never neither.
 * - A replacement op is created only from a validated local row whose
 *   revision is exactly the corrupt op's revision (or from the matching
 *   tombstone for deletes). Rebuilt puts get a new `op_id`/HLC, because their
 *   content differs from whatever the corrupt op carried; the local row is
 *   re-stamped with the same tuple so row and outbox stay consistent.
 * - Everything else stays `quarantined` until the user explicitly discards it.
 *
 * Constraints:
 * - Local-only. `sync_quarantine` is never captured or synchronized.
 * - Callers must run inside a `rw` transaction that includes `pending_ops`,
 *   `sync_quarantine`, `tombstones` and the op's table, marked with
 *   `HookBridge.markSyncTransaction` so the re-stamp is not captured again.
 */
import type { Transaction } from 'dexie';
import { createRuntimeUuid } from '~~/shared/runtime-id';
import type { Or3DB, SyncQuarantineRow } from '~/db/client';
import type { PendingOp } from '~~/shared/sync/types';
import { compareSyncRevision, type SyncRevision } from '~~/shared/sync/revision';
import { ChangeStampSchema } from '~~/shared/sync/schemas';
import { sanitizePayloadForSync } from '~~/shared/sync/sanitize';
import { getPkField } from '~~/shared/sync/table-metadata';
import { generateHLC } from './hlc';
import { SYNCED_TABLES, getHookBridge, getLocalOnlyKvNames } from './hook-bridge';
import { markRecentOpId } from './recent-op-cache';
import { normalizeSyncPayload } from './sync-payload-normalizer';

/** Resolved entries are kept briefly for audit, then pruned. Unresolved entries are never pruned. */
export const QUARANTINE_RESOLVED_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
export const QUARANTINE_RESOLVED_MAX = 200;

/** Unsynced intent that is not owned by a running push. */
const SCAN_STATUSES = ['pending', 'retry_wait', 'failed_retryable', 'failed_permanent', 'failed'] as const;
/** Replay also covers ops a running push owns: its result is lost with the replaced state. */
const REPLAY_STATUSES = [...SCAN_STATUSES, 'in_flight', 'syncing'] as const;
const LIVE_STATUSES = new Set<string>(['pending', 'in_flight', 'retry_wait', 'failed_retryable', 'syncing']);

/** Tables a transaction must include for `quarantineOpInTx` to read/repair `tableName`. */
export const QUARANTINE_SUPPORT_TABLES = ['pending_ops', 'sync_quarantine', 'tombstones'] as const;

export interface QuarantineSummary {
    quarantined: number;
    repaired: number;
}

type SyncedTable = (typeof SYNCED_TABLES)[number];

function isSyncedTable(name: unknown): name is SyncedTable {
    return typeof name === 'string' && (SYNCED_TABLES as readonly string[]).includes(name);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function validStamp(value: unknown): SyncRevision | null {
    if (!isRecord(value)) return null;
    const { clock, hlc, opId } = value;
    if (typeof clock !== 'number' || !Number.isFinite(clock)) return null;
    if (typeof hlc !== 'string' || !hlc || typeof opId !== 'string' || !opId) return null;
    return { clock, hlc, opId };
}

function rowRevision(row: Record<string, unknown>): SyncRevision | null {
    const { clock, hlc, op_id: opId } = row;
    if (typeof clock !== 'number' || !Number.isFinite(clock)) return null;
    if (typeof hlc !== 'string' || !hlc || typeof opId !== 'string' || !opId) return null;
    return { clock, hlc, opId };
}

/**
 * Empty when the op has usable identity/revision and a valid payload. Push
 * diagnosis also checks wire size; local replay can preserve larger content.
 */
export function diagnoseOp(op: unknown, enforceWireLimit = true): string[] {
    if (!isRecord(op)) return ['operation is not an object'];
    const problems: string[] = [];
    if (typeof op.id !== 'string' || !op.id) problems.push('missing outbox id');
    if (!isSyncedTable(op.tableName)) problems.push(`unknown table ${String(op.tableName)}`);
    if (typeof op.pk !== 'string' || !op.pk) problems.push('missing primary key');
    if (op.operation !== 'put' && op.operation !== 'delete') problems.push(`unknown operation ${String(op.operation)}`);
    // The push schema rejects these stamps (non-UUID op_id, no device), so an
    // operation carrying one can never sync and must not be treated as healthy.
    const parsedStamp = ChangeStampSchema.safeParse(op.stamp);
    if (!parsedStamp.success) problems.push(`malformed revision stamp: ${parsedStamp.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ')}`);
    if (problems.length || op.operation !== 'put' || !parsedStamp.success) return problems;

    if (!isRecord(op.payload)) return ['put has no payload object'];
    const tableName = op.tableName as string;
    if (tableName === 'messages') {
        const missing = ['thread_id', 'role', 'index'].filter(
            (field) => op.payload && (op.payload as Record<string, unknown>)[field] == null
        );
        if (missing.length) problems.push(`message payload missing ${missing.join(', ')}`);
    }
    try {
        if (enforceWireLimit) sanitizePayloadForSync(tableName, op.payload, 'put');
        const normalized = normalizeSyncPayload(tableName, op.pk as string, op.payload, parsedStamp.data);
        if (!normalized.isValid) problems.push(`payload failed validation: ${normalized.errors?.join('; ') ?? 'unknown'}`);
    } catch (error) {
        // A throw here would abort the snapshot transaction that is classifying the op.
        problems.push(`payload could not be validated: ${error instanceof Error ? error.message : String(error)}`);
    }
    return problems;
}

type RepairOutcome =
    | { kind: 'repaired'; op: PendingOp; note: string }
    | { kind: 'superseded'; note: string }
    | { kind: 'ambiguous'; note: string };

async function coveredByLiveOp(
    tx: Transaction,
    tableName: string,
    pk: string,
    excludeId: string,
    atLeast: SyncRevision
): Promise<boolean> {
    const siblings = await tx.table('pending_ops')
        .where('[tableName+pk]').equals([tableName, pk]).toArray() as PendingOp[];
    return siblings.some((sibling) => {
        if (sibling.id === excludeId || !LIVE_STATUSES.has(sibling.status)) return false;
        const stamp = validStamp(sibling.stamp);
        return !!stamp && diagnoseOp(sibling).length === 0 && compareSyncRevision(stamp, atLeast) >= 0;
    });
}

async function reconstruct(
    tx: Transaction,
    op: Omit<PendingOp, 'operation'> & { operation: unknown },
    local: unknown,
    tombstone: unknown,
    deviceId: string
): Promise<RepairOutcome> {
    const { tableName, pk } = op;
    if (!isSyncedTable(tableName) || typeof pk !== 'string' || !pk) {
        return { kind: 'ambiguous', note: 'operation target is unknown' };
    }
    const stamp = validStamp(op.stamp);
    const tomb = isRecord(tombstone) ? tombstone : null;
    const tombRevision = tomb && typeof tomb.hlc === 'string' && tomb.hlc && typeof tomb.opId === 'string' && tomb.opId
        && typeof tomb.clock === 'number' && Number.isFinite(tomb.clock)
        ? { clock: tomb.clock, hlc: tomb.hlc, opId: tomb.opId }
        : null;

    if (op.operation === 'delete') {
        if (!tomb || !tombRevision) return { kind: 'ambiguous', note: 'no complete tombstone for the delete' };
        if (stamp && compareSyncRevision(stamp, tombRevision) !== 0) {
            return { kind: 'ambiguous', note: 'tombstone revision differs from the delete' };
        }
        // The rebuilt payload and device need not match what was queued, and a
        // server that already processed the original rejects the same op_id with
        // different content. So the deletion gets a new revision, and the
        // tombstone is re-stamped to match, exactly as for a rebuilt put.
        const deletedAt = typeof tomb.deletedAt === 'number' ? tomb.deletedAt : Math.floor(Date.now() / 1000);
        let payload: Record<string, unknown> | undefined;
        try {
            payload = sanitizePayloadForSync(tableName, { [getPkField(tableName)]: pk, deleted: true, deleted_at: deletedAt }, 'delete');
        } catch (error) {
            return { kind: 'ambiguous', note: `delete could not be rebuilt: ${error instanceof Error ? error.message : String(error)}` };
        }
        const fresh: SyncRevision = { clock: tombRevision.clock, hlc: generateHLC(), opId: createRuntimeUuid() };
        await tx.table('tombstones').update(`${tableName}:${pk}`, { hlc: fresh.hlc, opId: fresh.opId });
        markRecentOpId(fresh.opId, { dbName: tx.db.name, historyIncarnation: (tx.db as Or3DB).syncHistoryAtOpen });
        return {
            kind: 'repaired',
            note: 'rebuilt from tombstone with a new op_id',
            op: {
                id: createRuntimeUuid(), tableName, operation: 'delete', pk, payload,
                stamp: { deviceId, ...fresh },
                createdAt: Date.now(), attempts: 0, status: 'pending',
            },
        };
    }
    if (op.operation !== 'put') return { kind: 'ambiguous', note: 'unknown operation' };
    if (!stamp) return { kind: 'ambiguous', note: 'operation has no usable revision to match against' };

    if (!isRecord(local)) {
        if (tombRevision && compareSyncRevision(tombRevision, stamp) >= 0
            && (await coveredByLiveOp(tx, tableName, pk, op.id, tombRevision) || typeof tomb?.syncedAt === 'number')) {
            return { kind: 'superseded', note: 'a newer delete already covers this record' };
        }
        return { kind: 'ambiguous', note: 'no local row to rebuild from' };
    }
    const revision = rowRevision(local);
    if (!revision) return { kind: 'ambiguous', note: 'local row has no complete revision' };
    if (local[getPkField(tableName)] !== pk) return { kind: 'ambiguous', note: 'local row identity does not match the operation' };
    if (tableName === 'messages' && local.pending === true) return { kind: 'ambiguous', note: 'local message is still streaming' };

    const order = compareSyncRevision(stamp, revision);
    if (order < 0) {
        return await coveredByLiveOp(tx, tableName, pk, op.id, revision)
            ? { kind: 'superseded', note: 'a newer queued operation already covers this record' }
            : { kind: 'ambiguous', note: 'local row is newer than the operation and nothing queued covers it' };
    }
    if (order > 0) return { kind: 'ambiguous', note: 'local row is older than the operation' };

    const fresh: SyncRevision = { clock: revision.clock, hlc: generateHLC(), opId: createRuntimeUuid() };
    let payload: Record<string, unknown> | undefined;
    let errors: string[] | undefined;
    try {
        // Oversized content throws here. That must leave the op quarantined, not abort the caller's transaction.
        payload = sanitizePayloadForSync(tableName, { ...local, clock: fresh.clock, op_id: fresh.opId }, 'put');
        const normalized = payload ? normalizeSyncPayload(tableName, pk, payload, fresh) : null;
        if (!normalized?.isValid) errors = normalized?.errors ?? ['empty'];
    } catch (error) {
        errors = [error instanceof Error ? error.message : String(error)];
    }
    if (!payload || errors) {
        return { kind: 'ambiguous', note: `local row is not valid for sync: ${errors?.join('; ') ?? 'empty'}` };
    }
    // Row and outbox must carry the same tuple, exactly as live capture does.
    await tx.table(tableName).update(pk, { hlc: fresh.hlc, op_id: fresh.opId });
    markRecentOpId(fresh.opId, { dbName: tx.db.name, historyIncarnation: (tx.db as Or3DB).syncHistoryAtOpen });
    return {
        kind: 'repaired',
        note: 'rebuilt from local row with a new op_id',
        op: {
            id: createRuntimeUuid(), tableName, operation: 'put', pk, payload,
            stamp: { deviceId, ...fresh },
            createdAt: Date.now(), attempts: 0, status: 'pending',
        },
    };
}

/**
 * Preserves `op` and removes it from the queue. Returns the replacement op when
 * the intent was rebuilt, otherwise null. Re-running for an already handled op
 * never creates a second replacement.
 */
export async function quarantineOpInTx(
    tx: Transaction,
    op: PendingOp,
    diagnostics: string[],
    source: 'snapshot_apply' | 'manual',
    deviceId: string
): Promise<PendingOp | null> {
    // Stored queue entries may predate or violate the current declared shape.
    const rawOp = op as Partial<PendingOp> | null | undefined;
    const id = typeof rawOp?.id === 'string' && op.id ? op.id : createRuntimeUuid();
    const entries = tx.table('sync_quarantine');
    const existing = await entries.get(id) as SyncQuarantineRow | undefined;
    if (existing && existing.status !== 'quarantined') {
        // Already resolved; a racing writer put the row back. Drop the stale copy only.
        if (typeof rawOp?.id === 'string') await tx.table('pending_ops').delete(op.id);
        return null;
    }

    const tableName = typeof rawOp?.tableName === 'string' ? op.tableName : '';
    const pk = typeof rawOp?.pk === 'string' ? op.pk : '';
    const synced = isSyncedTable(tableName) && !!pk;
    const local: unknown = synced ? await tx.table(tableName).get(pk) : undefined;
    const tombstone: unknown = synced ? await tx.table('tombstones').get(`${tableName}:${pk}`) : undefined;
    const outcome = await reconstruct(tx, op, local, tombstone, deviceId);

    const now = Date.now();
    const row: SyncQuarantineRow = {
        id, tableName, pk, source, op, diagnostics,
        localRow: local, localTombstone: tombstone,
        status: outcome.kind === 'ambiguous' ? 'quarantined' : 'repaired',
        quarantinedAt: existing?.quarantinedAt ?? now,
        resolution: outcome.note,
        ...(outcome.kind === 'ambiguous' ? {} : { resolvedAt: now }),
        ...(outcome.kind === 'repaired' ? { repairedOpId: outcome.op.id } : {}),
    };
    await entries.put(row);
    if (typeof rawOp?.id === 'string') await tx.table('pending_ops').delete(op.id);
    if (outcome.kind !== 'repaired') return null;
    await tx.table('pending_ops').add(outcome.op);
    return outcome.op;
}

async function readOps(tx: Transaction, statuses: readonly string[]): Promise<PendingOp[]> {
    const ops: PendingOp[] = [];
    for (const status of statuses) {
        ops.push(...await tx.table('pending_ops').where('status').equals(status).toArray() as PendingOp[]);
    }
    return ops.sort((a: Partial<PendingOp>, b: Partial<PendingOp>) => (a.createdAt ?? 0) - (b.createdAt ?? 0) || String(a.id).localeCompare(String(b.id)));
}

/**
 * Operations whose local content must be restored once remote state has been
 * installed: everything unsynced, including permanently failed work, since the
 * payload may be the only copy once the table is replaced. Corrupt ones are
 * quarantined (and rebuilt where possible) first, while local rows still exist.
 * Discarded and applied operations are intentionally excluded.
 */
export async function collectReplayableOps(
    tx: Transaction,
    includesTable: (tableName: string, pk: string) => boolean,
    deviceId: string
): Promise<PendingOp[]> {
    const replayable: PendingOp[] = [];
    for (const op of await readOps(tx, REPLAY_STATUSES)) {
        if (!includesTable(op.tableName, op.pk)) continue;
        // Wire size is not a local-storage validity rule. A valid oversized
        // edit must survive table replacement with its full durable intent.
        const diagnostics = diagnoseOp(op, false);
        if (!diagnostics.length) {
            replayable.push(op);
            continue;
        }
        const repaired = await quarantineOpInTx(tx, op, diagnostics, 'snapshot_apply', deviceId);
        if (repaired) replayable.push(repaired);
    }
    return replayable;
}

/** Quarantine and rebuild every corrupt queued op. Each op is its own atomic unit. */
export async function quarantineCorruptOps(
    db: Or3DB,
    source: 'snapshot_apply' | 'manual' = 'manual',
    selected?: PendingOp[]
): Promise<QuarantineSummary> {
    const bridge = getHookBridge(db);
    const scopeTables = [...QUARANTINE_SUPPORT_TABLES, ...SYNCED_TABLES, 'sync_state'].map((name) => db.table(name));
    const candidates = selected ?? await db.transaction('r', db.pending_ops, (tx) => readOps(tx, SCAN_STATUSES));
    const summary: QuarantineSummary = { quarantined: 0, repaired: 0 };
    for (const candidate of candidates) {
        await db.transaction('rw', scopeTables, async (tx) => {
            const guard = await tx.table('sync_state').get('sync_history') as { phase?: string } | undefined;
            if (guard && guard.phase !== 'ready') return;
            bridge.markSyncTransaction(tx);
            // Re-read: the row may have been resolved or completed since the scan.
            const current = await tx.table('pending_ops').get(candidate.id) as PendingOp | undefined;
            if (!current || !SCAN_STATUSES.includes(current.status as (typeof SCAN_STATUSES)[number])) return;
            const diagnostics = diagnoseOp(current);
            if (!diagnostics.length) return;
            const repaired = await quarantineOpInTx(tx, current, diagnostics, source, bridge.getDeviceId());
            summary.quarantined += 1;
            if (repaired) summary.repaired += 1;
        });
    }
    await pruneResolvedQuarantineBestEffort(db);
    return summary;
}

/** Bounds the audit trail. Unresolved entries are the only copy of user intent and stay. */
export async function pruneResolvedQuarantine(db: Or3DB, now = Date.now()): Promise<void> {
    const resolved = (await db.sync_quarantine.where('status').anyOf('repaired', 'discarded').toArray())
        .sort((a, b) => (b.resolvedAt ?? 0) - (a.resolvedAt ?? 0));
    const stale = resolved.filter(
        (entry, index) => index >= QUARANTINE_RESOLVED_MAX
            || (entry.resolvedAt ?? 0) < now - QUARANTINE_RESOLVED_RETENTION_MS
    );
    if (stale.length) await db.sync_quarantine.bulkDelete(stale.map((entry) => entry.id));
}

/** Retention must never fail a recovery or discard that already committed. */
export async function pruneResolvedQuarantineBestEffort(db: Or3DB): Promise<void> {
    // Hand-built database stubs in tests have no quarantine table to prune.
    if (!(db as Partial<Or3DB>).sync_quarantine) return;
    try {
        await pruneResolvedQuarantine(db);
    } catch (error) {
        console.warn('[sync-quarantine] Retention pruning failed', error);
    }
}

export function listQuarantined(db: Or3DB, principalId?: string): Promise<SyncQuarantineRow[]> {
    return db.sync_quarantine.orderBy('quarantinedAt').filter(entry => !['history_reset', 'stored_record'].includes(entry.variant ?? '') || !entry.accountId || entry.accountId === principalId).toArray();
}

/** Self-contained JSON for support or manual recovery. */
export async function exportQuarantined(db: Or3DB, principalId?: string): Promise<string> {
    return JSON.stringify({ exportedAt: Date.now(), entries: await listQuarantined(db, principalId) }, null, 2);
}

/** Explicit user decision to give up on an entry; the audit row stays until pruned. */
export async function discardQuarantined(db: Or3DB, id: string, principalId?: string): Promise<boolean> {
    const discarded = await db.transaction('rw', db.sync_quarantine, async () => {
        const entry = await db.sync_quarantine.get(id);
        if (entry?.status !== 'quarantined' || ['history_reset', 'stored_record'].includes(entry.variant ?? '') && entry.accountId && entry.accountId !== principalId) return false;
        await db.sync_quarantine.put({
            ...entry, status: 'discarded', resolvedAt: Date.now(), resolution: 'discarded by user',
        });
        return true;
    });
    if (discarded) await pruneResolvedQuarantineBestEffort(db);
    return discarded;
}

/** Atomic archive, bounded reads, immutable originals. Never reconstruct old intent. */
export async function holdHistoryInTx(tx: Transaction, scope: import('~~/shared/sync/types').SyncScope, sourceIncarnation: string): Promise<void> {
    const localOnly = getLocalOnlyKvNames();
    const archive = async (kind: string, tableName: string, key: string, record: Record<string, unknown>) => {
        const id = JSON.stringify(['history_reset', sourceIncarnation, kind, tableName, key]);
        if (await tx.table('sync_quarantine').get(id)) return;
        await tx.table('sync_quarantine').put({ id, variant: 'history_reset', sourceIncarnation, scope,
            accountId: tableName === 'notifications' ? String(record.user_id ?? (record.payload as { user_id?: string } | undefined)?.user_id ?? 'unknown') : scope.principalId,
            tableName, pk: typeof record.pk === 'string' ? record.pk : key,
            source: 'snapshot_apply', status: 'quarantined', op: record,
            ...(kind === 'row' ? { localRow: record } : kind === 'tombstone' ? { localTombstone: record } : {}),
            diagnostics: [sourceIncarnation === 'unknown' ? 'Changes from an outdated client; origin unknown' : 'Saved changes from before server recovery; commit unknown in discarded history'], quarantinedAt: Date.now() });
    };
    for (const tableName of [...SYNCED_TABLES, 'tombstones', 'pending_ops', 'file_transfers']) {
        let after: string | undefined;
        for (;;) {
            const table = tx.table(tableName);
            const rows = await (after === undefined ? table.orderBy(':id') : table.where(':id').above(after)).limit(200).toArray() as Record<string, unknown>[];
            if (!rows.length) break;
            for (const row of rows) {
                const key = String(tableName === 'file_meta' ? row.hash : row.id);
                after = key;
                const target = typeof row.tableName === 'string' ? row.tableName : tableName;
                const pk = typeof row.pk === 'string' ? row.pk : key;
                if (target === 'kv' && localOnly.has(typeof row.name === 'string' ? row.name : typeof (row.payload as { name?: unknown } | undefined)?.name === 'string' ? (row.payload as { name: string }).name : pk.replace(/^kv:/, ''))) continue;
                await archive(tableName === 'pending_ops' ? 'op' : tableName === 'tombstones' ? 'tombstone' : 'row', target, key, row);
            }
        }
    }
    await tx.table('pending_ops').clear();
    await tx.table('file_transfers').clear();
}

/** Deliberate recovery of a reviewed put. Deletes and complex entities stay held for export/manual review. */
export async function recoverHistoryPut(db: Or3DB, provider: import('~~/shared/sync/types').SyncProvider,
    scope: import('~~/shared/sync/types').SyncScope, id: string, reviewedHistory: string): Promise<boolean> {
    const { readHistory, assertHistory } = await import('./history-incarnation');
    const { getSyncStateId } = await import('./cursor-manager');
    const guard = await readHistory(db);
    if (guard.phase !== 'ready' || guard.historyIncarnation !== reviewedHistory) throw new Error('Server history changed; review this change again.');
    const cursor = (await db.sync_state.get(getSyncStateId(scope)))?.cursor ?? 0;
    const page = await provider.pull({ scope, cursor, limit: 1, historyIncarnation: reviewedHistory, historyIncarnationCapability: 'incarnation-v1' });
    if (page.historyIncarnation !== reviewedHistory || page.requiresSnapshot || page.nextCursor !== cursor || page.hasMore) throw new Error('Wait for current sync, then review this change again.');
    const entry = await db.sync_quarantine.get(id);
    if (entry?.variant !== 'history_reset' || entry.status !== 'quarantined' ||
        entry.accountId && entry.accountId !== scope.principalId) return false;
    if (!['threads', 'messages', 'kv'].includes(entry.tableName)) throw new Error('Export this item for manual recovery.');
    const op = entry.op as Partial<PendingOp>;
    if (op.operation === 'delete' || entry.localTombstone) throw new Error('Review the current record and make a new delete explicitly.');
    const payload = (entry.localRow ?? op.payload) as Record<string, unknown> | undefined;
    if (!payload || payload.deleted === true || entry.tableName === 'kv' && getLocalOnlyKvNames().has(String(payload.name ?? ''))) throw new Error('This item requires manual recovery.');
    return db.transaction('rw', [...SYNCED_TABLES, ...QUARANTINE_SUPPORT_TABLES, 'sync_state'], async tx => {
        await assertHistory(tx, guard);
        const currentEvidence = await db.sync_quarantine.get(id);
        if (currentEvidence?.status !== 'quarantined') return false;
        if (entry.tableName === 'messages') {
            const parent = await db.threads.get(String(payload.thread_id ?? ''));
            if (!parent || parent.deleted || await db.tombstones.get(`threads:${parent.id}`)) throw new Error('Recover or select the parent conversation first.');
        }
        const current = await db.table(entry.tableName).get(entry.pk) as Record<string, unknown> | undefined;
        const tombstone = await db.tombstones.get(`${entry.tableName}:${entry.pk}`);
        const clock = Math.max(Number(current?.clock ?? 0), tombstone?.clock ?? 0) + 1;
        if (!Number.isSafeInteger(clock)) throw new Error('Record revision cannot advance.');
        const freshId = createRuntimeUuid();
        const stamp = { clock, hlc: generateHLC(), deviceId: getHookBridge(db).getDeviceId(), opId: freshId };
        const normalized = normalizeSyncPayload(entry.tableName, entry.pk, { ...payload, clock, hlc: stamp.hlc, op_id: freshId, pending: false }, stamp);
        if (!normalized.isValid) throw new Error('Saved content needs manual schema recovery.');
        // The regular local hook captures this new explicit action with a fresh UUID.
        await db.table(entry.tableName).put(normalized.payload);
        const captured = await db.pending_ops.where('[tableName+pk]').equals([entry.tableName, entry.pk]).toArray();
        const action = captured.find(candidate => candidate.stamp.opId !== (op.stamp?.opId ?? '') && candidate.stamp.clock === clock);
        if (!action) throw new Error('Local capture unavailable; saved evidence remains held.');
        await db.sync_quarantine.put({ ...currentEvidence, status: 'repaired', repairedOpId: action.id,
            resolvedAt: Date.now(), resolution: `Explicit put reviewed in ${reviewedHistory}` });
        return true;
    });
}

/** Bounded, explicit evidence only. Never used by capture, replay or snapshot install. */
export const LEGACY_EVIDENCE_STORES = [...SYNCED_TABLES, 'tombstones', 'pending_ops',
    'workspace_tab_drafts', 'workspace_draft_versions', 'file_transfers', 'sync_quarantine'];

function legacyAuthorization(db: Or3DB, scope: import('~~/shared/sync/types').SyncScope) {
    const session = getCachedSessionContext();
    const role = session?.role;
    const revision = session?.authorizationRevision;
    const assert = () => {
        const current = getCachedSessionContext();
        if (!scope.principalId || db.name !== `or3-db-${scope.workspaceId}` || !current?.authenticated ||
            current.user?.id !== scope.principalId || current.workspace?.id !== scope.workspaceId ||
            !['owner', 'admin', 'editor', 'viewer'].includes(current.role ?? '') || current.role !== role ||
            current.authorizationRevision !== revision || current.expiresAt && Date.parse(current.expiresAt) <= Date.now()) {
            throw new Error('Current workspace access is required to inspect legacy evidence.');
        }
    };
    assert(); return assert;
}

function visibleLegacyEvidence(store: string, row: Record<string, unknown>, principalId: string): boolean {
    if (typeof row.accountId === 'string' && row.accountId !== principalId) return false;
    if (store === 'workspace_tab_drafts' || store === 'workspace_draft_versions') return row.account_key === principalId;
    if (store === 'sync_quarantine' && row.accountId !== principalId) return false;
    const target = ['pending_ops', 'tombstones', 'sync_quarantine'].includes(store) ? row.tableName : store;
    if (typeof target !== 'string' || ![...SYNCED_TABLES, 'file_transfers'].includes(target as typeof SYNCED_TABLES[number])) return false;
    const payload = row.payload && typeof row.payload === 'object' ? row.payload as Record<string, unknown> : row;
    if (target === 'notifications') return payload.user_id === principalId;
    if (target === 'kv') {
        const name = typeof payload.name === 'string' ? payload.name
            : typeof row.pk === 'string' ? row.pk.replace(/^kv:/, '') : undefined;
        if (!name || getLocalOnlyKvNames().has(name)) return false;
    }
    return true;
}

/** Each result is a partial live read, not a stable snapshot of an older open tab. */
export async function inspectLegacyEvidence(db: Or3DB, scope: import('~~/shared/sync/types').SyncScope,
    store: string, after?: IDBValidKey) {
    if (!LEGACY_EVIDENCE_STORES.includes(store)) throw new Error('Unsupported legacy evidence store.');
    const assert = legacyAuthorization(db, scope);
    const page = await inspectLegacyStore(db, store, { after });
    assert();
    const rows = page.rows.filter(row => visibleLegacyEvidence(store, row.value, scope.principalId!)).map(row => {
        if (store !== 'file_transfers') return row;
        const { lease_token: _lease, last_error: _error, last_error_details: _details, ...value } = row.value;
        return { ...row, value };
    });
    return { ...page, rows, excluded: page.rows.length - rows.length, origin: 'unknown' as const,
        workspaceId: scope.workspaceId, accountId: scope.principalId, inspectedAt: Date.now(),
        limitation: 'Partial live evidence. Close older tabs before exporting. Private or unknown-account entries remain in place; no automatic merge or recovery.' };
}

/** Attachment evidence requires a fresh authorized source read, never a caller-provided hash list. */
export async function exportLegacyAttachment(db: Or3DB, scope: import('~~/shared/sync/types').SyncScope,
    store: string, key: IDBValidKey, hash: string) {
    if (!LEGACY_EVIDENCE_STORES.includes(store)) throw new Error('Unsupported legacy evidence store.');
    const assert = legacyAuthorization(db, scope);
    const source = await inspectLegacyStore(db, store, { key });
    assert();
    const entry = source.rows[0]?.value;
    if (!entry || !visibleLegacyEvidence(store, entry, scope.principalId!) || !JSON.stringify(entry).includes(hash)) throw new Error('Authorized attachment reference is required.');
    const parsed = parseHash(hash);
    if (!parsed) throw new Error('Invalid attachment hash.');
    const file = await inspectLegacyStore(db, 'file_blobs', { key: hash });
    assert();
    const blob = file.rows[0]?.value.blob;
    if (!(blob instanceof Blob)) throw new Error('Attachment bytes are unavailable; evidence remains saved.');
    if (await computeHashHex(blob, parsed.algorithm) !== parsed.hex) throw new Error('Attachment checksum failed; original bytes remain saved.');
    assert();
    return { blob, hash, verified: true, source: { database: source.database, schemaVersion: source.schemaVersion, store, key, origin: 'unknown' } };
}
