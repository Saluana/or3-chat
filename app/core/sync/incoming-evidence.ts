import type { Transaction } from 'dexie';
import type { SyncQuarantineRow } from '~/db/client';
import { isSyncTable } from '~~/shared/sync/incoming-records';

/** Incoming evidence never removes, re-stamps or reconstructs pending work. */
export async function retainIncomingEvidenceInTx(tx: Transaction, input: {
    tableName: string;
    pk: string;
    source: 'incoming_pull' | 'incoming_snapshot';
    reference: string | number;
    evidenceRef?: string;
    reason: string;
    record: unknown;
}): Promise<SyncQuarantineRow> {
    const id = JSON.stringify(['incoming', input.source, input.reference, input.tableName, input.pk]);
    const entries = tx.table('sync_quarantine');
    const existing = await entries.get(id) as SyncQuarantineRow | undefined;
    if (existing) return existing;
    const known = isSyncTable(input.tableName);
    const localRow: unknown = known ? await tx.table(input.tableName).get(input.pk) : undefined;
    const localTombstone: unknown = known ? await tx.table('tombstones').get(`${input.tableName}:${input.pk}`) : undefined;
    const pendingIntent = input.source === 'incoming_snapshot' && known
        ? await tx.table('pending_ops').where('[tableName+pk]').equals([input.tableName, input.pk]).toArray()
        : undefined;
    const entry: SyncQuarantineRow = {
        id, variant: 'incoming', tableName: input.tableName, pk: input.pk,
        source: input.source, status: 'quarantined', evidenceRef: input.evidenceRef,
        op: input.record, diagnostics: [input.reason.slice(0, 256)],
        localRow, localTombstone, pendingIntent, quarantinedAt: Date.now(),
    };
    await entries.put(entry);
    return entry;
}

export function isStorageQuotaError(error: unknown): boolean {
    if (!error || typeof error !== 'object') return false;
    const value = error as { name?: string; inner?: unknown; cause?: unknown; failures?: unknown[] };
    return value.name === 'QuotaExceededError' ||
        (value.name === 'BulkError' && Array.isArray(value.failures) && value.failures.some(isStorageQuotaError)) ||
        (!!value.inner && value.inner !== error && isStorageQuotaError(value.inner)) ||
        (!!value.cause && value.cause !== error && isStorageQuotaError(value.cause));
}
