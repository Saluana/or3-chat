import 'fake-indexeddb/auto';
import { Or3DB } from '~/db/client';
import { OutboxManager } from '../outbox-manager';
import {
    assertBudgets,
    maxBudget,
    minBudget,
    positiveNumber,
    writePerformanceReport,
} from '~~/scripts/performance/report';
import type {
    PendingOp,
    PullRequest,
    PullResponse,
    PushBatch,
    PushResult,
    SyncChange,
    SyncProvider,
    SyncScope,
    SyncSubscribeOptions,
} from '~~/shared/sync/types';

const scope: SyncScope = { workspaceId: 'outbox-benchmark' };

function positiveInteger(value: string | undefined, fallback: number): number {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function installHookHarness(): void {
    (
        globalThis as typeof globalThis & {
            useNuxtApp?: () => { $hooks: { doAction: () => Promise<void> } };
        }
    ).useNuxtApp = () => ({
        $hooks: { doAction: async () => undefined },
    });
}

class BenchmarkProvider implements SyncProvider {
    id = 'outbox-benchmark';
    mode = 'direct' as const;
    pushes = 0;
    maxBatch = 0;
    pushedOpIds = new Set<string>();

    async push(batch: PushBatch): Promise<PushResult> {
        this.pushes += 1;
        this.maxBatch = Math.max(this.maxBatch, batch.ops.length);
        for (const op of batch.ops) this.pushedOpIds.add(op.stamp.opId);
        return {
            results: batch.ops.map((op, index) => ({
                opId: op.stamp.opId,
                success: true,
                serverVersion: this.pushes * 100 + index,
            })),
            serverVersion: this.pushes * 100 + batch.ops.length,
        };
    }

    async pull(_request: PullRequest): Promise<PullResponse> {
        return { changes: [], nextCursor: 0, hasMore: false };
    }

    async subscribe(
        _scope: SyncScope,
        _tables: string[],
        _onChanges: (changes: SyncChange[]) => void | Promise<void>,
        _options?: SyncSubscribeOptions
    ): Promise<() => void> {
        return () => undefined;
    }

    async updateCursor(): Promise<void> {}
    async dispose(): Promise<void> {}
}

function makePendingOp(
    record: number,
    revision: number,
    supersededWrites: number
): PendingOp {
    const sequence = record * supersededWrites + revision;
    const id = `pending-${sequence.toString().padStart(8, '0')}`;
    const opId = `op-${sequence.toString().padStart(8, '0')}`;
    return {
        id,
        tableName: 'messages',
        operation: revision === supersededWrites - 1 && record % 7 === 0
            ? 'delete'
            : 'put',
        pk: `message-${record.toString().padStart(6, '0')}`,
        payload: {
            id: `message-${record.toString().padStart(6, '0')}`,
            content: `revision-${revision}`,
        },
        stamp: {
            deviceId: 'benchmark-device',
            opId,
            hlc: `${sequence.toString().padStart(13, '0')}:0000:benchmark`,
            clock: revision + 1,
        },
        createdAt: sequence,
        attempts: 0,
        status: 'pending',
    };
}

async function main(): Promise<void> {
    installHookHarness();
    const records = positiveInteger(process.env.OR3_BENCH_OUTBOX_RECORDS, 1_000);
    const supersededWrites = positiveInteger(
        process.env.OR3_BENCH_OUTBOX_REVISIONS,
        10
    );
    const totalOps = records * supersededWrites;
    const db = new Or3DB(`outbox-benchmark-${crypto.randomUUID()}`);
    const provider = new BenchmarkProvider();

    try {
        await db.open();
        const seedStarted = performance.now();
        for (let start = 0; start < records; start += 500) {
            const ops: PendingOp[] = [];
            const end = Math.min(records, start + 500);
            for (let record = start; record < end; record += 1) {
                for (let revision = 0; revision < supersededWrites; revision += 1) {
                    ops.push(makePendingOp(record, revision, supersededWrites));
                }
            }
            await db.pending_ops.bulkPut(ops);
        }
        const seedMs = performance.now() - seedStarted;

        const manager = new OutboxManager(db, provider, scope, {
            maxBatchSize: 50,
        });
        const drainStarted = performance.now();
        let flushes = 0;
        while (await manager.flush()) {
            flushes += 1;
            if (flushes > records + 10) {
                throw new Error('Outbox benchmark exceeded its flush guard');
            }
        }
        const drainMs = performance.now() - drainStarted;
        const remaining = await db.pending_ops.count();
        const pushedOpsPerSecond = provider.pushedOpIds.size / (drainMs / 1000);

        if (remaining !== 0) {
            throw new Error(`Outbox benchmark left ${remaining} pending operations`);
        }
        if (provider.pushedOpIds.size !== records) {
            throw new Error(
                `Expected ${records} coalesced operations, pushed ${provider.pushedOpIds.size}`
            );
        }
        if (provider.maxBatch > 50) {
            throw new Error(`Outbox batch exceeded configured limit: ${provider.maxBatch}`);
        }

        const budgets = {
            drainMs: maxBudget(
                Number(drainMs.toFixed(2)),
                positiveNumber(
                    process.env.OR3_BENCH_OUTBOX_MAX_DRAIN_MS,
                    20_000
                )
            ),
            pushedOpsPerSecond: minBudget(
                Number(pushedOpsPerSecond.toFixed(2)),
                positiveNumber(
                    process.env.OR3_BENCH_OUTBOX_MIN_OPS_PER_SECOND,
                    50
                )
            ),
        };
        const report = {
            benchmark: 'sync-outbox-draining',
            records,
            supersededWrites,
            totalOps,
            seedMs: Number(seedMs.toFixed(2)),
            drainMs: Number(drainMs.toFixed(2)),
            flushes,
            providerPushes: provider.pushes,
            maxBatch: provider.maxBatch,
            pushedOps: provider.pushedOpIds.size,
            pushedOpsPerSecond: Number(pushedOpsPerSecond.toFixed(2)),
            remaining,
            budgets,
        };
        const outputPath = writePerformanceReport('sync-outbox-draining', report);
        console.log(JSON.stringify({ ...report, outputPath }, null, 2));
        assertBudgets('sync-outbox-draining', budgets);
    } finally {
        db.close();
        await db.delete();
    }
}

void main();
