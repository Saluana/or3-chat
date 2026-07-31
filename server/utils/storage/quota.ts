import type { H3Event } from 'h3';
import { createError } from 'h3';
import { getActiveSyncGatewayAdapter } from '../../sync/gateway/registry';

export interface WorkspaceStorageUsageSnapshot {
    usedBytes: number;
    reservedBytes: number;
    filesByHash: Map<string, number>;
}

function normalizeHash(value: string): string {
    return value.replace(/^sha256:/i, '').replace(/^md5:/i, '').trim().toLowerCase();
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

    if (!syncAdapter.queryCanonicalStorage) {
        throw createError({
            statusCode: 503,
            statusMessage:
                'Storage quota enforcement requires canonical materialized storage queries',
        });
    }

    const filesByHash = new Map<string, number>();
    let usedBytes = 0;
    let reservedBytes = 0;

    for (const kind of ['live_metadata', 'active_reservations'] as const) {
        let cursor: string | undefined;
        do {
            const result = await syncAdapter.queryCanonicalStorage(event, {
                scope: { workspaceId },
                kind,
                cursor,
                limit: 500,
                now: Math.floor(Date.now() / 1000),
            });

            for (const item of result.items) {
                if (item.kind === 'metadata') {
                    const key = normalizeHash(item.hash);
                    filesByHash.set(key, item.sizeBytes);
                    usedBytes += item.sizeBytes;
                } else if (item.kind === 'reservation') {
                    reservedBytes += item.sizeBytes;
                }
            }

            if (result.hasMore && !result.nextCursor) {
                throw createError({
                    statusCode: 502,
                    statusMessage: 'Canonical storage provider returned an invalid page',
                });
            }
            cursor = result.nextCursor;
        } while (cursor);
    }

    return { usedBytes, reservedBytes, filesByHash };
}
