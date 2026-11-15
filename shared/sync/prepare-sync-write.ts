import { z } from 'zod';
import { ChangeStampSchema, isLosslessSyncIdentifier, TABLE_PAYLOAD_SCHEMAS, normalizeWirePayloadForTable, syncJsonByteLength } from './schemas';
import { MAX_SYNC_PAYLOAD_BYTES } from './sanitize';
import { getPkField } from './table-metadata';
import { isLocalOnlyKvChange } from './local-only-kv';
import type { ChangeStamp } from './types';

export class SyncWriteError extends Error {
    constructor(message: string, public readonly code: 'VALIDATION_ERROR' | 'OVERSIZED' = 'VALIDATION_ERROR') {
        super(message);
        this.name = 'SyncWriteError';
    }
}

export function nextSyncClock(clock: number): number {
    if (!Number.isSafeInteger(clock) || clock < 0 || clock >= Number.MAX_SAFE_INTEGER) {
        throw new SyncWriteError('Sync clock exhausted or invalid');
    }
    return clock + 1;
}

export interface SyncWriteInput {
    tableName: string;
    pk: string;
    operation: 'put' | 'delete';
    payload?: unknown;
    stamp: ChangeStamp;
}

/** Pure preparation shared by admission and final transactional writer sinks. */
export function prepareSyncWrite(input: SyncWriteInput): SyncWriteInput {
    const { tableName, pk, operation } = input;
    if (!Object.hasOwn(TABLE_PAYLOAD_SCHEMAS, tableName)) throw new SyncWriteError('Unknown sync table');
    if (typeof pk !== 'string' || !pk.length || pk.length > 1024 || !isLosslessSyncIdentifier(pk)) {
        throw new SyncWriteError('Invalid sync primary key');
    }
    if (operation !== 'put' && operation !== 'delete') throw new SyncWriteError('Invalid sync operation');
    const parsedStamp = ChangeStampSchema.safeParse(input.stamp);
    if (!parsedStamp.success || !Number.isSafeInteger(parsedStamp.data.clock) || !isLosslessSyncIdentifier(parsedStamp.data.deviceId)) {
        throw new SyncWriteError('Invalid sync stamp');
    }
    const stamp = parsedStamp.data;
    let payload = normalizeWirePayloadForTable(tableName, input.payload);
    if (operation === 'put') {
        const parsed = TABLE_PAYLOAD_SCHEMAS[tableName]!.safeParse(payload);
        if (!parsed.success) throw new SyncWriteError(`Invalid payload for ${tableName}`);
        payload = parsed.data;
        const row = payload as Record<string, unknown>;
        for (const key of ['id', 'hash', 'thread_id', 'project_id', 'user_id', 'document_id', 'root_thread_id', 'summary_message_id']) {
            if (typeof row[key] === 'string' && !isLosslessSyncIdentifier(row[key])) throw new SyncWriteError('Invalid payload identifier');
        }
        if (row[getPkField(tableName)] !== pk || row.clock !== stamp.clock ||
            (row.hlc !== undefined && row.hlc !== stamp.hlc) ||
            (row.op_id !== undefined && row.op_id !== stamp.opId)) {
            throw new SyncWriteError('Sync payload identity or revision mismatch');
        }
    } else if (payload !== undefined && !z.record(z.string(), z.unknown()).safeParse(payload).success) {
        throw new SyncWriteError('Invalid delete payload');
    }
    if (payload !== undefined && syncJsonByteLength(payload) > MAX_SYNC_PAYLOAD_BYTES) {
        throw new SyncWriteError('Sync payload exceeds byte ceiling', 'OVERSIZED');
    }
    if (isLocalOnlyKvChange(tableName, pk, payload)) throw new SyncWriteError('Device-only KV names cannot be synced');
    return { tableName, pk, operation, ...(payload !== undefined ? { payload } : {}), stamp };
}

export { isLosslessSyncIdentifier } from './schemas';
