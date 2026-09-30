import 'fake-indexeddb/auto';
import { Or3DB } from '~/db/client';
import { SnapshotStager } from '../snapshot-applier';
import {
    assertBudgets,
    maxBudget,
    minBudget,
    positiveNumber,
    writePerformanceReport,
} from '~~/scripts/performance/report';
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

function* makePages(rowCount: number, pageSize: number): Generator<SnapshotResponse> {
    const snapshotId = `snapshot-${rowCount}`;
    for (let start = 0; start < rowCount; start += pageSize) {
        const end = Math.min(rowCount, start + pageSize);
        const items: SnapshotItem[] = [];
        for (let index = start; index < end; index += 1) {
            items.push(messageItem(index));
        }
        yield {
            workspaceId: scope.workspaceId,
            snapshotId,
            highWatermark: rowCount + 100,
            items,
            nextPageToken: end < rowCount ? `page-${end}` : null,
        };
    }
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
    let pageCount = 0;
    const db = new Or3DB(`snapshot-benchmark-${crypto.randomUUID()}`);

    try {
        await db.open();
        const applyStarted = performance.now();
        const stager = new SnapshotStager(db, scope, ['messages']);
        await stager.start();
        let stagingMs = 0;
        let installMs = 0;
        let cleanupMs = 0;
        let watermark: number;
        try {
            const stagingStarted = performance.now();
            for (const page of makePages(rowCount, pageSize)) {
                pageCount++;
                await stager.appendPage(page);
            }
            stagingMs = performance.now() - stagingStarted;
            const installStarted = performance.now();
            watermark = await stager.apply('benchmark-device', () => true, ['messages']);
            installMs = performance.now() - installStarted;
        } finally {
            const cleanupStarted = performance.now();
            await stager.dispose();
            cleanupMs = performance.now() - cleanupStarted;
        }
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

        const rowsPerSecond = rowCount / (applyMs / 1000);
        const budgets = {
            applyMs: maxBudget(
                Number(applyMs.toFixed(2)),
                positiveNumber(
                    process.env.OR3_BENCH_SNAPSHOT_MAX_APPLY_MS,
                    90_000
                )
            ),
            rowsPerSecond: minBudget(
                Number(rowsPerSecond.toFixed(2)),
                positiveNumber(
                    process.env.OR3_BENCH_SNAPSHOT_MIN_ROWS_PER_SECOND,
                    500
                )
            ),
        };
        const report = {
            benchmark: 'sync-snapshot-bootstrap',
            rows: rowCount,
            pageSize,
            pages: pageCount,
            stagingMs: Number(stagingMs.toFixed(2)),
            installMs: Number(installMs.toFixed(2)),
            cleanupMs: Number(cleanupMs.toFixed(2)),
            applyMs: Number(applyMs.toFixed(2)),
            rowsPerSecond: Number(rowsPerSecond.toFixed(2)),
            watermark,
            storedRows,
            budgets,
        };
        const outputPath = writePerformanceReport(
            'sync-snapshot-bootstrap',
            report
        );
        console.log(JSON.stringify({ ...report, outputPath }, null, 2));
        assertBudgets('sync-snapshot-bootstrap', budgets);
    } finally {
        db.close();
        await db.delete();
    }
}

void main();
