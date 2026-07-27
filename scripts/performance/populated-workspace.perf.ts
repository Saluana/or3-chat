import 'fake-indexeddb/auto';
import { performance } from 'node:perf_hooks';
import { relative } from 'node:path';
import { Or3DB } from '../../app/db/client';
import type { Message, Thread } from '../../app/db/schema';
import {
    assertBudgets,
    maxBudget,
    positiveNumber,
    writePerformanceReport,
} from './report';

function fixtureCount(name: string, fallback: number): number {
    return Math.max(1, Math.floor(positiveNumber(process.env[name], fallback)));
}

async function measure<T>(
    operation: () => Promise<T>
): Promise<{ durationMs: number; value: T }> {
    const started = performance.now();
    const value = await operation();
    return {
        durationMs: Number((performance.now() - started).toFixed(2)),
        value,
    };
}

const threadCount = fixtureCount('OR3_BENCH_WORKSPACE_THREADS', 1_200);
const messagesPerThread = fixtureCount(
    'OR3_BENCH_WORKSPACE_MESSAGES_PER_THREAD',
    12
);
const now = 1_800_000_000;
const db = new Or3DB(`populated-workspace-${crypto.randomUUID()}`);

try {
    await db.open();
    const threads: Thread[] = Array.from(
        { length: threadCount },
        (_, index) => ({
            id: `thread-${index.toString().padStart(5, '0')}`,
            title:
                index % 20 === 0
                    ? `Quarterly planning ${index}`
                    : `Workspace conversation ${index}`,
            created_at: now - threadCount + index,
            updated_at: now - threadCount + index,
            last_message_at: now - threadCount + index,
            parent_thread_id: null,
            anchor_message_id: null,
            anchor_index: null,
            branch_mode: null,
            status: 'ready',
            deleted: index % 97 === 0,
            pinned: index % 100 === 0,
            clock: 1,
            hlc: `${now - threadCount + index}:0000:benchmark`,
            forked: false,
            project_id: index % 3 === 0 ? `project-${index % 12}` : null,
            system_prompt_id: null,
        })
    );
    const messages: Message[] = threads.flatMap((thread, threadIndex) =>
        Array.from({ length: messagesPerThread }, (_, messageIndex) => ({
            id: `${thread.id}-message-${messageIndex}`,
            data: {
                content: `Deterministic workspace message ${threadIndex}/${messageIndex}`,
            },
            role: messageIndex % 2 === 0 ? 'user' : 'assistant',
            pending: false,
            created_at: thread.created_at + messageIndex,
            updated_at: thread.updated_at + messageIndex,
            error: null,
            deleted: false,
            thread_id: thread.id,
            index: messageIndex,
            order_key: `${messageIndex.toString().padStart(6, '0')}:benchmark`,
            clock: 1,
            hlc: `${thread.created_at + messageIndex}:0000:benchmark`,
            stream_id: null,
            file_hashes: null,
        }))
    );

    const heapBefore = process.memoryUsage().heapUsed;
    const seed = await measure(async () => {
        await db.transaction('rw', db.threads, db.messages, async () => {
            await db.threads.bulkPut(threads);
            await db.messages.bulkPut(messages);
        });
    });
    const heapDeltaBytes = Math.max(
        0,
        process.memoryUsage().heapUsed - heapBefore
    );

    const recent = await measure(() =>
        db.threads
            .orderBy('updated_at')
            .reverse()
            .filter((thread) => !thread.deleted)
            .limit(51)
            .toArray()
    );
    const search = await measure(() =>
        db.threads
            .filter(
                (thread) =>
                    !thread.deleted &&
                    (thread.title ?? '')
                        .toLowerCase()
                        .includes('quarterly planning')
            )
            .toArray()
    );
    const transcriptThread = threads[Math.floor(threads.length / 2)]!;
    const transcript = await measure(() =>
        db.messages
            .where('thread_id')
            .equals(transcriptThread.id)
            .sortBy('index')
    );

    if (
        recent.value.length !==
        Math.min(51, threads.filter((t) => !t.deleted).length)
    ) {
        throw new Error(
            `Recent-thread query returned ${recent.value.length} rows`
        );
    }
    if (search.value.length === 0) {
        throw new Error(
            'Search query did not return its deterministic fixtures'
        );
    }
    if (transcript.value.length !== messagesPerThread) {
        throw new Error(
            `Transcript query returned ${transcript.value.length}/${messagesPerThread} rows`
        );
    }

    const limits = {
        seedMs: positiveNumber(
            process.env.OR3_BENCH_WORKSPACE_MAX_SEED_MS,
            6_000
        ),
        recentThreadsMs: positiveNumber(
            process.env.OR3_BENCH_WORKSPACE_MAX_RECENT_MS,
            150
        ),
        searchMs: positiveNumber(
            process.env.OR3_BENCH_WORKSPACE_MAX_SEARCH_MS,
            250
        ),
        transcriptMs: positiveNumber(
            process.env.OR3_BENCH_WORKSPACE_MAX_TRANSCRIPT_MS,
            100
        ),
        heapDeltaBytes: positiveNumber(
            process.env.OR3_BENCH_WORKSPACE_MAX_HEAP_BYTES,
            256 * 1024 * 1024
        ),
    };
    const metrics = {
        seedMs: seed.durationMs,
        recentThreadsMs: recent.durationMs,
        searchMs: search.durationMs,
        transcriptMs: transcript.durationMs,
        heapDeltaBytes,
    };
    const budgets = {
        seedMs: maxBudget(metrics.seedMs, limits.seedMs),
        recentThreadsMs: maxBudget(
            metrics.recentThreadsMs,
            limits.recentThreadsMs
        ),
        searchMs: maxBudget(metrics.searchMs, limits.searchMs),
        transcriptMs: maxBudget(metrics.transcriptMs, limits.transcriptMs),
        heapDeltaBytes: maxBudget(
            metrics.heapDeltaBytes,
            limits.heapDeltaBytes
        ),
    };
    const reportPath = writePerformanceReport('populated-workspace', {
        benchmark: 'populated-workspace',
        fixture: {
            threads: threadCount,
            messagesPerThread,
            messages: messages.length,
        },
        metrics,
        budgets,
    });
    assertBudgets('populated-workspace', budgets);
    console.log(
        `[populated-workspace] ${threadCount} threads/${messages.length} messages are within budget; recent=${metrics.recentThreadsMs}ms search=${metrics.searchMs}ms transcript=${metrics.transcriptMs}ms report=${relative(process.cwd(), reportPath)}`
    );
} finally {
    db.close();
    await db.delete();
}
