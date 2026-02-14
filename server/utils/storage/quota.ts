import type { H3Event } from 'h3';
import { createError } from 'h3';
import { getActiveSyncGatewayAdapter } from '../../sync/gateway/registry';

export interface WorkspaceStorageUsageSnapshot {
    usedBytes: number;
    filesByHash: Map<string, number>;
}

function normalizeHash(value: string): string {
    return value.replace(/^sha256:/i, '').trim().toLowerCase();
}

function isDeletedPayload(payload: unknown): boolean {
    if (!payload || typeof payload !== 'object') return false;
    const deleted = (payload as Record<string, unknown>).deleted;
    return deleted === true || deleted === 1 || deleted === '1';
}

function readSizeBytes(payload: unknown): number | null {
    if (!payload || typeof payload !== 'object') return null;
    const row = payload as Record<string, unknown>;
    const raw = row.size_bytes ?? row.sizeBytes;
    if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0) {
        return null;
    }
    return Math.floor(raw);
}

export async function getWorkspaceStorageUsageSnapshot(
    event: H3Event,
    workspaceId: string
): Promise<WorkspaceStorageUsageSnapshot> {
    const syncAdapter = getActiveSyncGatewayAdapter();
    if (!syncAdapter) {
        throw createError({
            statusCode: 500,
            statusMessage:
                'Storage quota enforcement requires a configured sync adapter',
        });
    }

    const filesByHash = new Map<string, number>();
    let cursor = 0;
    let hasMore = true;

    while (hasMore) {
        const result = await syncAdapter.pull(event, {
            scope: { workspaceId },
            cursor,
            limit: 1000,
            tables: ['file_meta'],
        });

        for (const change of result.changes) {
            if (change.tableName !== 'file_meta') continue;
            if (typeof change.pk !== 'string' || !change.pk.trim()) continue;

            const key = normalizeHash(change.pk);
            if (change.op === 'delete' || isDeletedPayload(change.payload)) {
                filesByHash.delete(key);
                continue;
            }

            const sizeBytes = readSizeBytes(change.payload);
            if (sizeBytes === null) {
                continue;
            }
            filesByHash.set(key, sizeBytes);
        }

        cursor = result.nextCursor;
        hasMore = result.hasMore;
    }

    let usedBytes = 0;
    for (const sizeBytes of filesByHash.values()) {
        usedBytes += sizeBytes;
    }

    return { usedBytes, filesByHash };
}

