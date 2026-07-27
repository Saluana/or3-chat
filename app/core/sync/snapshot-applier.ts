import type { Or3DB } from '~/db/client';
import type { SnapshotItem, SnapshotResponse, SyncScope } from '~~/shared/sync/types';
import { getHookBridge } from './hook-bridge';
import { normalizeSyncPayload } from './sync-payload-normalizer';

function snapshotItemKey(item: SnapshotItem): string {
    return `${item.tableName}\0${item.pk}\0${item.kind}`;
}

function validateSnapshotChain(pages: SnapshotResponse[], scope: SyncScope): {
    highWatermark: number;
    items: SnapshotItem[];
} {
    const first = pages[0];
    if (!first || pages.at(-1)?.nextPageToken !== null) {
        throw new Error('Snapshot chain is incomplete');
    }
    if (first.workspaceId !== scope.workspaceId) {
        throw new Error('Snapshot workspace does not match the requested scope');
    }

    const items: SnapshotItem[] = [];
    let previousKey: string | null = null;
    const logicalKeys = new Set<string>();
    for (const [index, page] of pages.entries()) {
        if (
            page.workspaceId !== first.workspaceId ||
            page.snapshotId !== first.snapshotId ||
            page.highWatermark !== first.highWatermark
        ) {
            throw new Error('Snapshot page identity or high-watermark changed');
        }
        if (index < pages.length - 1 && page.nextPageToken === null) {
            throw new Error('Snapshot chain ended before the supplied final page');
        }
        for (const item of page.items) {
            const logicalKey = `${item.tableName}\0${item.pk}`;
            if (logicalKeys.has(logicalKey)) {
                throw new Error(
                    'Snapshot contains duplicate or contradictory entries for one record'
                );
            }
            const key = snapshotItemKey(item);
            if (previousKey !== null && key <= previousKey) {
                throw new Error('Snapshot items are duplicated or out of order');
            }
            previousKey = key;
            logicalKeys.add(logicalKey);
            items.push(item);
        }
    }
    return { highWatermark: first.highWatermark, items };
}

function abortSnapshotApply(): never {
    const error = new Error('Snapshot apply was cancelled');
    error.name = 'AbortError';
    throw error;
}

function syncStateId(scope: SyncScope): string {
    return `sync_state:${scope.workspaceId}:${scope.projectId ?? 'default'}`;
}

/**
 * Atomically installs a complete snapshot and its replay boundary. Callers
 * collect the bounded page chain first; a failed write leaves the target DB and
 * cursor unchanged.
 */
export async function applySnapshotChain(
    db: Or3DB,
    pages: SnapshotResponse[],
    scope: SyncScope,
    deviceId: string,
    shouldContinue: () => boolean = () => true,
    replacementTables: string[] = []
): Promise<number> {
    const { highWatermark, items } = validateSnapshotChain(pages, scope);
    const tableNames = [
        ...new Set([
            ...items.map((item) => item.tableName),
            ...replacementTables,
        ]),
    ];
    const transactionTables = [
        ...tableNames.map((name) => db.table(name)),
        db.tombstones,
        db.sync_state,
    ];

    await db.transaction('rw', transactionTables, async (tx) => {
        getHookBridge(db).markSyncTransaction(tx);
        for (const tableName of replacementTables) {
            if (!shouldContinue()) abortSnapshotApply();
            await tx.table(tableName).clear();
        }
        if (replacementTables.length) {
            const replacementSet = new Set(replacementTables);
            const staleTombstones = await tx.table('tombstones').toArray();
            await tx.table('tombstones').bulkDelete(
                staleTombstones
                    .filter((row) =>
                        replacementSet.has(
                            (row as { tableName?: string }).tableName ?? ''
                        )
                    )
                    .map((row) => (row as { id: string }).id)
            );
        }

        for (const item of items) {
            if (!shouldContinue()) abortSnapshotApply();
            if (item.kind === 'row') {
                if (
                    !item.payload ||
                    typeof item.payload !== 'object' ||
                    Array.isArray(item.payload)
                ) {
                    throw new Error(
                        `Snapshot row payload is invalid for ${item.tableName}:${item.pk}`
                    );
                }
                const normalized = normalizeSyncPayload(
                    item.tableName,
                    item.pk,
                    item.payload,
                    item.revision
                );
                if (!normalized.isValid) {
                    throw new Error(
                        `Snapshot row payload failed validation for ${item.tableName}:${item.pk}: ${normalized.errors?.join('; ') ?? 'unknown validation error'}`
                    );
                }

                // Keep snapshot installation consistent with incremental apply:
                // wire-only fields (for example posts.post_type) must be mapped
                // to the Dexie record shape before indexed fields are populated.
                const localPayload =
                    item.tableName === 'file_meta'
                        ? { ...normalized.payload, ref_count: 0 }
                        : normalized.payload;
                await tx.table(item.tableName).put(localPayload);
                continue;
            }
            await tx.table(item.tableName).delete(item.pk);
            await tx.table('tombstones').put({
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

        if (!shouldContinue()) abortSnapshotApply();
        await tx.table('sync_state').put({
            id: syncStateId(scope),
            cursor: highWatermark,
            lastSyncAt: Date.now(),
            deviceId,
        });
    });

    return highWatermark;
}
