import { createError } from 'h3';
import type { H3Event } from 'h3';
import type { SyncGatewayAdapter } from '../../sync/gateway/types';
import type { PullRequest, PullResponse, SnapshotRequest, SnapshotResponse } from '~~/shared/sync/types';
import { compareSyncTuple, UNAVAILABLE_RECORD_CAPABILITY, PullUnavailableRecordSchema, SnapshotUnavailableRecordSchema } from '~~/shared/sync/schemas';
import { assertIncomingIdentity, incomingRecordDefect } from '~~/shared/sync/incoming-records';

export function requireUnavailableCapability(value: unknown): void {
    if (value === UNAVAILABLE_RECORD_CAPABILITY) return;
    throw createError({ statusCode: 426, statusMessage: 'Update OR3 Chat to recover unavailable sync records',
        data: { code: 'OR3_SYNC_UPDATE_REQUIRED', requiredCapability: UNAVAILABLE_RECORD_CAPABILITY } });
}

function coverageFailure(): never {
    throw createError({ statusCode: 502, statusMessage: 'Invalid sync coverage' });
}

function assertOrderedKeys(entries: { tableName: string; pk: string; kind?: string; originalKind?: string }[]): void {
    let previous: string[] | null = null;
    for (const entry of entries) {
        try { assertIncomingIdentity(entry); } catch { coverageFailure(); }
        const key = [entry.tableName, entry.pk, entry.kind ?? entry.originalKind ?? ''];
        if (previous && compareSyncTuple(key, previous) <= 0) coverageFailure();
        previous = key;
    }
}

/** Classify before final structural parsing; only providers can certify durable evidence. */
export async function classifyPullPage(event: H3Event, adapter: SyncGatewayAdapter, request: PullRequest, page: PullResponse): Promise<PullResponse> {
    if (!page || !Array.isArray(page.changes)) coverageFailure();
    let previousVersion = request.cursor;
    const seen = new Set<number>();
    for (const lane of [page.changes, page.unavailable ?? []]) {
        previousVersion = request.cursor;
        for (const entry of lane) {
            if (!entry || !Number.isSafeInteger(entry.serverVersion) || entry.serverVersion <= previousVersion ||
                entry.serverVersion > page.nextCursor || seen.has(entry.serverVersion)) coverageFailure();
            previousVersion = entry.serverVersion;
            seen.add(entry.serverVersion);
        }
    }
    const unavailable = [...(page.unavailable ?? [])];
    const changes = [];
    for (const entry of page.changes) {
        const reason = incomingRecordDefect('pull', entry);
        if (!reason) { changes.push(entry); continue; }
        try { assertIncomingIdentity(entry); } catch { coverageFailure(); }
        const marker = PullUnavailableRecordSchema.omit({ evidenceRef: true }).safeParse({
            tableName: entry.tableName, pk: entry.pk, originalKind: entry.op, serverVersion: entry.serverVersion, reason,
        });
        if (!marker.success) coverageFailure();
        requireUnavailableCapability(request.unavailableRecordCapability);
        if (adapter.capabilities?.unavailableRecords !== 'v1' || !adapter.retainUnavailableRecord) coverageFailure();
        const evidence = await adapter.retainUnavailableRecord(event, { scope: request.scope, source: 'pull', record: entry, marker: marker.data });
        unavailable.push({ ...marker.data, evidenceRef: evidence.evidenceRef });
    }
    if (unavailable.length) {
        requireUnavailableCapability(request.unavailableRecordCapability);
        if (adapter.capabilities?.unavailableRecords !== 'v1') coverageFailure();
    }
    // Arrays are separate wire lanes, each ordered; final assertion rejects
    // duplicate versions across both. Never reorder the provider's healthy lane.
    unavailable.sort((a, b) => a.serverVersion - b.serverVersion);
    return { ...page, changes, ...(unavailable.length ? { unavailable } : {}) };
}

export async function classifySnapshotPage(event: H3Event, adapter: SyncGatewayAdapter, request: SnapshotRequest, page: SnapshotResponse): Promise<SnapshotResponse> {
    if (!page || !Array.isArray(page.items)) coverageFailure();
    assertOrderedKeys(page.items);
    assertOrderedKeys(page.unavailable ?? []);
    // New tuple ordering is part of this negotiated contract, including pages
    // whose records happen to be healthy.
    if (adapter.capabilities?.unavailableRecords === 'v1') requireUnavailableCapability(request.unavailableRecordCapability);
    const unavailable = [...(page.unavailable ?? [])];
    const items = [];
    for (const entry of page.items) {
        const reason = incomingRecordDefect('snapshot', entry);
        if (!reason) { items.push(entry); continue; }
        try { assertIncomingIdentity(entry); } catch { coverageFailure(); }
        const marker = SnapshotUnavailableRecordSchema.omit({ evidenceRef: true }).safeParse({
            tableName: entry.tableName, pk: entry.pk, originalKind: entry.kind, snapshotId: page.snapshotId,
            highWatermark: page.highWatermark, reason,
        });
        if (!marker.success) coverageFailure();
        requireUnavailableCapability(request.unavailableRecordCapability);
        if (adapter.capabilities?.unavailableRecords !== 'v1' || !adapter.retainUnavailableRecord) coverageFailure();
        const evidence = await adapter.retainUnavailableRecord(event, { scope: request.scope, source: 'snapshot', record: entry, marker: marker.data });
        unavailable.push({ ...marker.data, evidenceRef: evidence.evidenceRef });
    }
    if (unavailable.length) {
        requireUnavailableCapability(request.unavailableRecordCapability);
        if (adapter.capabilities?.unavailableRecords !== 'v1') coverageFailure();
    }
    unavailable.sort((a, b) => compareSyncTuple([a.tableName, a.pk, a.originalKind], [b.tableName, b.pk, b.originalKind]));
    return { ...page, items, ...(unavailable.length ? { unavailable } : {}) };
}
