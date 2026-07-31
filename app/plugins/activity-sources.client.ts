import { defineNuxtPlugin } from '#app';
import { getActivityRegistry } from '~/core/activity/registry';
import {
    createBackgroundChatActivitySource,
    type BackgroundChatActivityRecord,
    type BackgroundChatActivityUpdate,
} from '~/core/activity/adapters/background-chat';
import { getDb } from '~/db/client';
import type { Message } from '~/db';
import {
    abortBackgroundJob,
    type BackgroundJobStatus,
} from '~/utils/chat/openrouterStream';
import {
    backgroundJobTrackers,
    subscribeBackgroundJob,
    subscribeBackgroundJobTrackerLifecycle,
} from '~/utils/chat/useAi-internal/backgroundJobs';
import type {
    BackgroundJobTracker,
    BackgroundJobUpdate,
} from '~/utils/chat/useAi-internal/types';

const MAX_RECENT_BACKGROUND_MESSAGES = 250;

function dataRecord(message: Message): Record<string, unknown> | undefined {
    return message.data &&
        typeof message.data === 'object' &&
        !Array.isArray(message.data)
        ? (message.data as Record<string, unknown>)
        : undefined;
}

function isBackgroundStatus(
    value: unknown
): value is BackgroundJobStatus['status'] {
    return (
        value === 'streaming' ||
        value === 'complete' ||
        value === 'error' ||
        value === 'aborted'
    );
}

function recordFromMessage(
    message: Message
): BackgroundChatActivityRecord | undefined {
    const data = dataRecord(message);
    if (!data) return undefined;
    const jobId = data?.background_job_id;
    const status = data?.background_job_status;
    if (typeof jobId !== 'string' || !isBackgroundStatus(status)) {
        return undefined;
    }
    return {
        jobId,
        threadId: message.thread_id,
        messageId: message.id,
        status,
        startedAt: message.created_at,
        updatedAt: message.updated_at,
        completedAt: status === 'streaming' ? undefined : message.updated_at,
        model: typeof data.model === 'string' ? data.model : undefined,
        content: typeof data.content === 'string' ? data.content : undefined,
        error:
            typeof data.background_job_error === 'string'
                ? data.background_job_error
                : typeof message.error === 'string'
                  ? message.error
                  : undefined,
        toolCalls: Array.isArray(data.tool_calls)
            ? (data.tool_calls as BackgroundJobStatus['tool_calls'])
            : undefined,
    };
}

function recordFromTracker(
    tracker: BackgroundJobTracker,
    fallback?: BackgroundChatActivityRecord
): BackgroundChatActivityRecord {
    const now = Date.now();
    return {
        jobId: tracker.jobId,
        threadId: tracker.threadId || fallback?.threadId || '',
        messageId: tracker.messageId || fallback?.messageId || '',
        status: tracker.status,
        startedAt: fallback?.startedAt ?? now,
        updatedAt: Math.max(fallback?.updatedAt ?? 0, now),
        completedAt:
            tracker.status === 'streaming'
                ? undefined
                : fallback?.completedAt ?? now,
        model: fallback?.model,
        content: tracker.lastContent || fallback?.content,
        error: fallback?.error,
        toolCalls: fallback?.toolCalls,
    };
}

function recordFromUpdate(
    tracker: BackgroundJobTracker,
    update: BackgroundJobUpdate
): BackgroundChatActivityRecord {
    const status = update.status;
    return {
        jobId: tracker.jobId,
        threadId: status.threadId || tracker.threadId,
        messageId: status.messageId || tracker.messageId,
        status: status.status,
        startedAt: status.startedAt,
        updatedAt: status.completedAt ?? Date.now(),
        completedAt: status.completedAt,
        model: status.model,
        content: update.content,
        error: status.error,
        toolCalls: status.tool_calls,
    };
}

async function recentBackgroundRecords(): Promise<
    BackgroundChatActivityRecord[]
> {
    const db = getDb();
    const rows = await db.messages
        .orderBy('updated_at')
        .reverse()
        .limit(MAX_RECENT_BACKGROUND_MESSAGES)
        .toArray();
    const records = new Map<string, BackgroundChatActivityRecord>();
    for (const row of rows) {
        const record = recordFromMessage(row);
        if (record) records.set(record.jobId, record);
    }
    for (const tracker of backgroundJobTrackers.values()) {
        if (tracker.originDbName && tracker.originDbName !== db.name) continue;
        records.set(
            tracker.jobId,
            recordFromTracker(tracker, records.get(tracker.jobId))
        );
    }
    return [...records.values()];
}

function subscribeToBackgroundActivity(
    listener: (update: BackgroundChatActivityUpdate) => void
): () => void {
    const subscriptions = new Map<string, () => void>();
    const attach = (tracker: BackgroundJobTracker) => {
        if (subscriptions.has(tracker.jobId)) return;
        if (
            tracker.originDbName &&
            tracker.originDbName !== getDb().name
        ) {
            return;
        }
        subscriptions.set(
            tracker.jobId,
            subscribeBackgroundJob(tracker, {
                onUpdate(update) {
                    listener({
                        record: recordFromUpdate(tracker, update),
                        delta: update.delta || undefined,
                    });
                },
                onComplete(update) {
                    listener({
                        record: recordFromUpdate(tracker, update),
                        delta: update.delta || undefined,
                    });
                },
                onError(update) {
                    listener({
                        record: recordFromUpdate(tracker, update),
                        delta: update.delta || undefined,
                    });
                },
                onAbort(update) {
                    listener({
                        record: recordFromUpdate(tracker, update),
                        delta: update.delta || undefined,
                    });
                },
            })
        );
    };
    for (const tracker of backgroundJobTrackers.values()) attach(tracker);
    const disposeLifecycle = subscribeBackgroundJobTrackerLifecycle(
        ({ type, tracker }) => {
            if (type === 'created') {
                attach(tracker);
                return;
            }
            subscriptions.get(tracker.jobId)?.();
            subscriptions.delete(tracker.jobId);
        }
    );
    return () => {
        disposeLifecycle();
        for (const dispose of subscriptions.values()) dispose();
        subscriptions.clear();
    };
}

export default defineNuxtPlugin(() => {
    const source = createBackgroundChatActivitySource({
        store: {
            list: recentBackgroundRecords,
            async get(jobId) {
                return (await recentBackgroundRecords()).find(
                    (record) => record.jobId === jobId
                );
            },
        },
        updates: {
            subscribe: subscribeToBackgroundActivity,
        },
        actions: {
            cancel: abortBackgroundJob,
        },
    });
    const handle = getActivityRegistry().register(source);
    if (import.meta.hot) {
        import.meta.hot.dispose(() => {
            handle.dispose();
        });
    }
});
