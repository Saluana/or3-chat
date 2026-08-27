import Dexie from 'dexie';
import type { Or3DB, SnapshotStagingRow } from '~/db/client';
import type {
    SnapshotItem,
    SnapshotResponse,
    SyncScope,
} from '~~/shared/sync/types';
import { getHookBridge } from './hook-bridge';
import { normalizeSyncPayload } from './sync-payload-normalizer';

function snapshotItemKey(item: SnapshotItem): string {
    return `${item.tableName}\0${item.pk}\0${item.kind}`;
}

function logicalItemKey(item: SnapshotItem): string {
    return `${item.tableName}\0${item.pk}`;
}

function abortSnapshotApply(): never {
    const error = new Error('Snapshot apply was cancelled');
    error.name = 'AbortError';
    throw error;
}

function syncStateId(scope: SyncScope): string {
    return `sync_state:${scope.workspaceId}:${scope.projectId ?? 'default'}`;
}

function localSnapshotPayload(item: Extract<SnapshotItem, { kind: 'row' }>) {
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
    return item.tableName === 'file_meta'
        ? { ...normalized.payload, ref_count: 0 }
        : normalized.payload;
}

/**
 * Incrementally validates and stages one provider snapshot. Only a single page
 * is retained in JavaScript at a time; user-visible tables remain untouched
 * until the final atomic apply.
 */
export class SnapshotChainStager {
    private snapshotKey: string | null = null;
    private snapshotId: string | null = null;
    private highWatermark: number | null = null;
    private previousItemKey: string | null = null;
    private nextOrder = 0;
    private complete = false;
    private readonly tableNames = new Set<string>();

    constructor(
        private readonly db: Or3DB,
        private readonly scope: SyncScope,
        private readonly deviceId: string,
        private readonly replacementTables: readonly string[] = []
    ) {
        for (const tableName of replacementTables) {
            this.tableNames.add(tableName);
        }
    }

    async addPage(page: SnapshotResponse): Promise<void> {
        if (this.complete) {
            throw new Error(
                'Snapshot chain contains pages after its final page'
            );
        }
        if (page.workspaceId !== this.scope.workspaceId) {
            throw new Error(
                'Snapshot workspace does not match the requested scope'
            );
        }

        if (!this.snapshotKey) {
            await this.db.snapshot_staging
                .where('createdAt')
                .below(Date.now() - 24 * 60 * 60 * 1000)
                .delete();
            this.snapshotId = page.snapshotId;
            this.highWatermark = page.highWatermark;
            this.snapshotKey = [
                this.scope.workspaceId,
                page.snapshotId,
                crypto.randomUUID(),
            ].join('\0');
        } else if (
            page.snapshotId !== this.snapshotId ||
            page.highWatermark !== this.highWatermark
        ) {
            throw new Error(
                'Snapshot page identity or high-watermark changed'
            );
        }

        const createdAt = Date.now();
        const rows: SnapshotStagingRow[] = [];
        for (const item of page.items) {
            const itemKey = snapshotItemKey(item);
            if (
                this.previousItemKey !== null &&
                itemKey <= this.previousItemKey
            ) {
                throw new Error(
                    'Snapshot items are duplicated or out of order'
                );
            }
            this.previousItemKey = itemKey;
            this.tableNames.add(item.tableName);
            rows.push({
                id: `${this.snapshotKey}\0${logicalItemKey(item)}`,
                snapshotKey: this.snapshotKey,
                order: this.nextOrder,
                createdAt,
                item,
            });
            this.nextOrder += 1;
        }

        try {
            if (rows.length) {
                await this.db.snapshot_staging.bulkAdd(rows);
            }
        } catch (error) {
            if (
                error instanceof Dexie.BulkError ||
                (error instanceof Error &&
                    error.name === 'ConstraintError')
            ) {
                throw new Error(
                    'Snapshot contains duplicate or contradictory entries for one record'
                );
            }
            throw error;
        }
        this.complete = page.nextPageToken === null;
    }

    async apply(
        shouldContinue: () => boolean = () => true
    ): Promise<number> {
        if (
            !this.complete ||
            !this.snapshotKey ||
            this.highWatermark === null
        ) {
            throw new Error('Snapshot chain is incomplete');
        }

        const snapshotKey = this.snapshotKey;
        const highWatermark = this.highWatermark;
        const tableNames = [...this.tableNames];
        const transactionTables = [
            ...tableNames.map((name) => this.db.table(name)),
            this.db.tombstones,
            this.db.sync_state,
            this.db.snapshot_staging,
        ];

        await this.db.transaction('rw', transactionTables, async (tx) => {
            getHookBridge(this.db).markSyncTransaction(tx);
            for (const tableName of this.replacementTables) {
                if (!shouldContinue()) abortSnapshotApply();
                await tx.table(tableName).clear();
                await tx
                    .table('tombstones')
                    .where('[tableName+pk]')
                    .between(
                        [tableName, Dexie.minKey],
                        [tableName, Dexie.maxKey]
                    )
                    .delete();
            }

            await tx
                .table<SnapshotStagingRow>('snapshot_staging')
                .where('[snapshotKey+order]')
                .between(
                    [snapshotKey, Dexie.minKey],
                    [snapshotKey, Dexie.maxKey]
                )
                .each(async (row) => {
                    if (!shouldContinue()) abortSnapshotApply();
                    const item = row.item;
                    if (item.kind === 'row') {
                        await tx
                            .table(item.tableName)
                            .put(localSnapshotPayload(item));
                        return;
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
                });

            if (!shouldContinue()) abortSnapshotApply();
            await tx.table('sync_state').put({
                id: syncStateId(this.scope),
                cursor: highWatermark,
                lastSyncAt: Date.now(),
                deviceId: this.deviceId,
            });
            await tx
                .table('snapshot_staging')
                .where('snapshotKey')
                .equals(snapshotKey)
                .delete();
        });

        return highWatermark;
    }

    async dispose(): Promise<void> {
        if (!this.snapshotKey) return;
        await this.db.snapshot_staging
            .where('snapshotKey')
            .equals(this.snapshotKey)
            .delete();
    }
}

/**
 * Compatibility helper for callers that already hold a bounded page chain.
 * New network bootstrap code should feed pages to SnapshotChainStager as they
 * arrive instead of accumulating them first.
 */
export async function applySnapshotChain(
    db: Or3DB,
    pages: SnapshotResponse[],
    scope: SyncScope,
    deviceId: string,
    shouldContinue: () => boolean = () => true,
    replacementTables: string[] = []
): Promise<number> {
    const stager = new SnapshotChainStager(
        db,
        scope,
        deviceId,
        replacementTables
    );
    try {
        for (const page of pages) {
            if (!shouldContinue()) abortSnapshotApply();
            await stager.addPage(page);
        }
        return await stager.apply(shouldContinue);
    } finally {
        await stager.dispose();
    }
}
