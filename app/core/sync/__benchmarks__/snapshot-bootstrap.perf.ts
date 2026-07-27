import 'fake-indexeddb/auto';
import { Or3DB } from '~/db/client';
import { applySnapshotChain } from '../snapshot-applier';
import type {
    SnapshotItem,
    SnapshotResponse,
    SyncScope,
} from '~~/shared/sync/types';

const scope: SyncScope = { workspaceId: 'snapshot-benchmark' };

function positiveInteger(value: string | undefined, fallback: number): number {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function messageItem(index: number): SnapshotItem {
    const id = `message-${index.toString().padStart(8, '0')}`;
    return {
        kind: 'row',
        tableName: 'messages',
        pk: id,
        payload: {
            id,
            thread_id: `thread-${Math.floor(index / 100)}`,
            role: index % 2 === 0 ? 'user' : 'assistant',
            index,
            order_key: `${index.toString().padStart(13, '0')}:0000:benchmark`,
            data: { content: `snapshot benchmark message ${index}` },
            pending: false,
            error: null,
            file_hashes: null,
            deleted: false,
            created_at: index,
            updated_at: index,
            clock: index + 1,
            hlc: `${index.toString().padStart(13, '0')}:0000:benchmark`,
            op_id: `snapshot-op-${index}`,
        },
        revision: {
            clock: index + 1,
            hlc: `${index.toString().padStart(13, '0')}:0000:benchmark`,
            opId: `snapshot-op-${index}`,
        },
    };
}

function makePages(rowCount: number, pageSize: number): SnapshotResponse[] {
    const pages: SnapshotResponse[] = [];
    const snapshotId = `snapshot-${rowCount}`;
    for (let start = 0; start < rowCount; start += pageSize) {
        const end = Math.min(rowCount, start + pageSize);
        const items: SnapshotItem[] = [];
        for (let index = start; index < end; index += 1) {
            items.push(messageItem(index));
        }
        pages.push({
            workspaceId: scope.workspaceId,
            snapshotId,
            highWatermark: rowCount + 100,
            items,
            nextPageToken: end < rowCount ? `page-${end}` : null,
        });
    }
    return pages;
}

async function main(): Promise<void> {
    const rowCount = positiveInteger(
        process.env.OR3_BENCH_SNAPSHOT_ROWS,
        50_000
    );
    const pageSize = positiveInteger(
        process.env.OR3_BENCH_SNAPSHOT_PAGE_SIZE,
        300
    );
    const pagesStarted = performance.now();
    const pages = makePages(rowCount, pageSize);
    const fixtureMs = performance.now() - pagesStarted;
    const db = new Or3DB(`snapshot-benchmark-${crypto.randomUUID()}`);

    try {
        await db.open();
        const applyStarted = performance.now();
        const watermark = await applySnapshotChain(
            db,
            pages,
            scope,
            'benchmark-device',
            () => true,
            ['messages']
        );
        const applyMs = performance.now() - applyStarted;
        const storedRows = await db.messages.count();
        const state = await db.sync_state.get(
            `sync_state:${scope.workspaceId}:default`
        );

        if (storedRows !== rowCount) {
            throw new Error(`Expected ${rowCount} snapshot rows, stored ${storedRows}`);
        }
        if (state?.cursor !== watermark || watermark !== rowCount + 100) {
            throw new Error('Snapshot watermark was not installed atomically');
        }

        console.log(JSON.stringify({
            rows: rowCount,
            pageSize,
            pages: pages.length,
            fixtureMs: Number(fixtureMs.toFixed(2)),
            applyMs: Number(applyMs.toFixed(2)),
            rowsPerSecond: Number((rowCount / (applyMs / 1000)).toFixed(2)),
            watermark,
            storedRows,
        }, null, 2));
    } finally {
        db.close();
        await db.delete();
    }
}

void main();
