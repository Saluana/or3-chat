import { SnapshotItemSchema, SyncChangeSchema, TABLE_PAYLOAD_SCHEMAS, SyncRecordIdentifierSchema, syncJsonByteLength } from './schemas';
import { MAX_SYNC_PAYLOAD_BYTES } from './sanitize';
import { getPkField } from './table-metadata';

export function isSyncTable(tableName: string): boolean {
    return Object.hasOwn(TABLE_PAYLOAD_SCHEMAS, tableName);
}

/** A usable key is required even for evidence. Unknown tables never become DB scopes. */
export function assertIncomingIdentity(entry: { tableName: string; pk: string }): void {
    SyncRecordIdentifierSchema.parse(entry.tableName);
    SyncRecordIdentifierSchema.parse(entry.pk);
}

/** Content faults only; callers still assert whole-page coverage independently. */
export function incomingRecordDefect(source: 'pull' | 'snapshot', record: unknown): string | null {
    const parsed = source === 'pull' ? SyncChangeSchema.safeParse(record) : SnapshotItemSchema.safeParse(record);
    if (!parsed.success) return 'invalid_record_envelope';
    const entry = parsed.data;
    if (!isSyncTable(entry.tableName)) return 'unknown_table';
    const live = 'op' in entry ? entry.op === 'put' : entry.kind === 'row';
    if (live) {
        const payload = 'payload' in entry ? entry.payload : undefined;
        if (syncJsonByteLength(payload) > MAX_SYNC_PAYLOAD_BYTES) return 'oversized_payload';
        const result = TABLE_PAYLOAD_SCHEMAS[entry.tableName]!.safeParse(payload);
        if (!result.success) return 'invalid_payload';
        if ((result.data as Record<string, unknown>)[getPkField(entry.tableName)] !== entry.pk) return 'payload_identity_mismatch';
    }
    return null;
}
