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
import { SYNCED_TABLES, getHookBridge } from './hook-bridge';
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
 * Empty when the op can be pushed and replayed. This is the same predicate the
 * snapshot/rescan replay applies, so "intact" means "will not abort a replay".
 */
export function diagnoseOp(op: unknown): string[] {
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
    op: PendingOp,
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
        markRecentOpId(fresh.opId);
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
    markRecentOpId(fresh.opId);
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
    source: SyncQuarantineRow['source'],
    deviceId: string
): Promise<PendingOp | null> {
    const id = typeof op?.id === 'string' && op.id ? op.id : createRuntimeUuid();
    const entries = tx.table('sync_quarantine');
    const existing = await entries.get(id) as SyncQuarantineRow | undefined;
    if (existing && existing.status !== 'quarantined') {
        // Already resolved; a racing writer put the row back. Drop the stale copy only.
        if (typeof op?.id === 'string') await tx.table('pending_ops').delete(op.id);
        return null;
    }

    const tableName = typeof op?.tableName === 'string' ? op.tableName : '';
    const pk = typeof op?.pk === 'string' ? op.pk : '';
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
    if (typeof op?.id === 'string') await tx.table('pending_ops').delete(op.id);
    if (outcome.kind !== 'repaired') return null;
    await tx.table('pending_ops').add(outcome.op);
    return outcome.op;
}

async function readOps(tx: Transaction, statuses: readonly string[]): Promise<PendingOp[]> {
    const ops: PendingOp[] = [];
    for (const status of statuses) {
        ops.push(...await tx.table('pending_ops').where('status').equals(status).toArray() as PendingOp[]);
    }
    return ops.sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0) || String(a.id).localeCompare(String(b.id)));
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
    includesTable: (tableName: string) => boolean,
    deviceId: string
): Promise<PendingOp[]> {
    const replayable: PendingOp[] = [];
    for (const op of await readOps(tx, REPLAY_STATUSES)) {
        if (!includesTable(op.tableName)) continue;
        const diagnostics = diagnoseOp(op);
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
    source: SyncQuarantineRow['source'] = 'manual'
): Promise<QuarantineSummary> {
    const bridge = getHookBridge(db);
    const scopeTables = [...QUARANTINE_SUPPORT_TABLES, ...SYNCED_TABLES].map((name) => db.table(name));
    const candidates = await db.transaction('r', db.pending_ops, (tx) => readOps(tx, SCAN_STATUSES));
    const summary: QuarantineSummary = { quarantined: 0, repaired: 0 };
    for (const candidate of candidates) {
        await db.transaction('rw', scopeTables, async (tx) => {
            bridge.markSyncTransaction(tx);
            // Re-read: the row may have been resolved or completed since the scan.
            const current = await tx.table('pending_ops').get(candidate.id) as PendingOp | undefined;
            if (!current) return;
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
    if (!db.sync_quarantine) return;
    try {
        await pruneResolvedQuarantine(db);
    } catch (error) {
        console.warn('[sync-quarantine] Retention pruning failed', error);
    }
}

export function listQuarantined(db: Or3DB): Promise<SyncQuarantineRow[]> {
    return db.sync_quarantine.orderBy('quarantinedAt').toArray();
}

/** Self-contained JSON for support or manual recovery. */
export async function exportQuarantined(db: Or3DB): Promise<string> {
    return JSON.stringify({ exportedAt: Date.now(), entries: await listQuarantined(db) }, null, 2);
}

/** Explicit user decision to give up on an entry; the audit row stays until pruned. */
export async function discardQuarantined(db: Or3DB, id: string): Promise<boolean> {
    const discarded = await db.transaction('rw', db.sync_quarantine, async () => {
        const entry = await db.sync_quarantine.get(id);
        if (entry?.status !== 'quarantined') return false;
        await db.sync_quarantine.put({
            ...entry, status: 'discarded', resolvedAt: Date.now(), resolution: 'discarded by user',
        });
        return true;
    });
    if (discarded) await pruneResolvedQuarantineBestEffort(db);
    return discarded;
}
