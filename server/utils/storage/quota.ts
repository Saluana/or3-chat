import type { H3Event } from 'h3';
import { createError } from 'h3';
import { getActiveSyncGatewayAdapter } from '../../sync/gateway/registry';
import { normalizeStorageHash } from './normalize-hash';

export interface WorkspaceStorageUsageSnapshot {
    usedBytes: number;
    reservedBytes: number;
    filesByHash: Map<string, number>;
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
    const reservations = new Map<string, { hash: string; size: number }>();
    const now = Math.floor(Date.now() / 1000);
    const invalidPage = () => createError({
        statusCode: 502,
        statusMessage: 'Canonical storage provider returned an invalid page',
    });
    const hashKey = (hash: unknown): string => {
        if (typeof hash !== 'string' || !/^(?:(?:sha256:)?[a-f0-9]{64}|(?:md5:)?[a-f0-9]{32})$/i.test(hash.trim())) {
            throw invalidPage();
        }
        return normalizeStorageHash(hash.trim(), ['sha256', 'md5']);
    };
    const addBytes = (total: number, size: unknown): number => {
        if (typeof size !== 'number' || !Number.isSafeInteger(size) || size < 0 || !Number.isSafeInteger(total + size)) {
            throw invalidPage();
        }
        return total + size;
    };

    for (const kind of ['live_metadata', 'active_reservations'] as const) {
        let cursor: string | undefined;
        const seenCursors = new Set<string>();
        for (let page = 0; ; page++) {
            // A broken provider must not cause unbounded traversal.
            if (page >= 1000) throw invalidPage();
            const response: unknown = await syncAdapter.queryCanonicalStorage(event, {
                scope: { workspaceId },
                kind,
                cursor,
                limit: 500,
                now,
            });
            if (!response || typeof response !== 'object') throw invalidPage();
            const result = response as Record<string, unknown>;
            if (!Array.isArray(result.items) || result.items.length > 500 || typeof result.hasMore !== 'boolean') {
                throw invalidPage();
            }
            for (const rawItem of result.items as unknown[]) {
                if (!rawItem || typeof rawItem !== 'object') throw invalidPage();
                const item = rawItem as Record<string, unknown>;
                if (kind === 'live_metadata' && item.kind === 'metadata') {
                    const key = hashKey(item.hash);
                    const size = addBytes(0, item.sizeBytes);
                    const previous = filesByHash.get(key);
                    if (previous !== undefined) {
                        if (previous !== size) throw invalidPage();
                        continue;
                    }
                    filesByHash.set(key, size);
                    usedBytes = addBytes(usedBytes, size);
                } else if (kind === 'active_reservations' && item.kind === 'reservation') {
                    const hash = hashKey(item.hash);
                    const size = addBytes(0, item.sizeBytes);
                    if (typeof item.reservationId !== 'string' || !item.reservationId.trim()) throw invalidPage();
                    const previous = reservations.get(item.reservationId);
                    if (previous !== undefined) {
                        if (previous.size !== size || previous.hash !== hash) throw invalidPage();
                        continue;
                    }
                    reservations.set(item.reservationId, { hash, size });
                    reservedBytes = addBytes(reservedBytes, size);
                } else throw invalidPage();
            }
            if (!result.hasMore) break;
            if (typeof result.nextCursor !== 'string' || !result.nextCursor || seenCursors.has(result.nextCursor)) {
                throw invalidPage();
            }
            seenCursors.add(result.nextCursor);
            cursor = result.nextCursor;
        }
    }
    // The caller adds these totals for admission. Do not return an unsafe sum.
    addBytes(usedBytes, reservedBytes);
    return { usedBytes, reservedBytes, filesByHash };
}
