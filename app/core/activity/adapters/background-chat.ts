import {
    activityErr,
    activityOk,
    type ActivityActionInput,
    type ActivityEvent,
    type ActivityRunAction,
    type ActivityRunDetail,
    type ActivityRunStatus,
    type ActivitySource,
} from '../contract';
import type { BackgroundJobStatus } from '~/utils/chat/openrouterStream';

export const BACKGROUND_CHAT_ACTIVITY_SOURCE_ID = 'or3.background-chat';

export interface BackgroundChatActivityRecord {
    readonly jobId: string;
    readonly threadId: string;
    readonly messageId: string;
    readonly status: BackgroundJobStatus['status'];
    readonly startedAt: number;
    readonly updatedAt: number;
    readonly completedAt?: number;
    readonly model?: string;
    readonly content?: string;
    readonly error?: string;
    readonly toolCalls?: BackgroundJobStatus['tool_calls'];
}

export interface BackgroundChatActivityStore {
    list(): Promise<readonly BackgroundChatActivityRecord[]>;
    get(jobId: string): Promise<BackgroundChatActivityRecord | undefined>;
}

export interface BackgroundChatActivityUpdate {
    readonly record: BackgroundChatActivityRecord;
    readonly delta?: string;
}

export interface BackgroundChatActivityUpdates {
    subscribe(
        listener: (update: BackgroundChatActivityUpdate) => void
    ): () => void;
}

export interface BackgroundChatActivityActions {
    cancel?(jobId: string): Promise<boolean> | boolean;
    openSource?(
        record: BackgroundChatActivityRecord
    ): Promise<boolean> | boolean;
}

export interface CreateBackgroundChatActivitySourceOptions {
    readonly store: BackgroundChatActivityStore;
    readonly updates?: BackgroundChatActivityUpdates;
    readonly actions?: BackgroundChatActivityActions;
}

export function backgroundChatActivityStatus(
    status: BackgroundJobStatus['status']
): ActivityRunStatus {
    switch (status) {
        case 'streaming':
            return 'running';
        case 'complete':
            return 'succeeded';
        case 'error':
            return 'failed';
        case 'aborted':
            return 'cancelled';
    }
}

function iso(value: number): string {
    return new Date(
        value < 10_000_000_000 ? value * 1000 : value
    ).toISOString();
}

function actionsFor(
    record: BackgroundChatActivityRecord,
    actions: BackgroundChatActivityActions
): ActivityRunAction[] {
    const available: ActivityRunAction[] = [];
    if (record.status === 'streaming' && actions.cancel) {
        available.push('cancel');
    }
    if (actions.openSource) available.push('open-source');
    return available;
}

function toSummary(
    record: BackgroundChatActivityRecord,
    actions: BackgroundChatActivityActions
) {
    const status = backgroundChatActivityStatus(record.status);
    return {
        id: record.jobId,
        sourceId: BACKGROUND_CHAT_ACTIVITY_SOURCE_ID,
        title: record.model
            ? `Background chat · ${record.model}`
            : 'Background chat generation',
        kind: 'background-chat' as const,
        status,
        startedAt: iso(record.startedAt),
        updatedAt: iso(record.updatedAt),
        completedAt:
            record.completedAt !== undefined
                ? iso(record.completedAt)
                : status === 'succeeded' ||
                    status === 'failed' ||
                    status === 'cancelled'
                  ? iso(record.updatedAt)
                  : undefined,
        summary: record.content?.slice(0, 240),
        actions: actionsFor(record, actions),
    };
}

function eventsFor(
    record: BackgroundChatActivityRecord,
    delta?: string
): ActivityEvent[] {
    const occurredAt = iso(record.updatedAt);
    const events: ActivityEvent[] = [
        {
            id: `status:${record.status}:${record.updatedAt}`,
            sourceId: BACKGROUND_CHAT_ACTIVITY_SOURCE_ID,
            runId: record.jobId,
            type: 'status',
            occurredAt,
            payload: {
                status: backgroundChatActivityStatus(record.status),
                backgroundStatus: record.status,
            },
        },
    ];
    const text = delta ?? record.content;
    if (text) {
        events.push({
            id: `content:${record.updatedAt}:${record.content?.length ?? text.length}`,
            sourceId: BACKGROUND_CHAT_ACTIVITY_SOURCE_ID,
            runId: record.jobId,
            type: 'message',
            occurredAt,
            coalesceKey: `assistant:${record.jobId}`,
            payload: {
                text,
                append: delta !== undefined,
            },
        });
    }
    for (const [index, tool] of (record.toolCalls ?? []).entries()) {
        events.push({
            id: `tool:${tool.id ?? index}:${tool.status}`,
            sourceId: BACKGROUND_CHAT_ACTIVITY_SOURCE_ID,
            runId: record.jobId,
            type: tool.error ? 'error' : 'tool',
            occurredAt,
            payload: {
                toolId: tool.id,
                name: tool.name,
                status: tool.status,
                args: tool.args,
                result: tool.result,
                error: tool.error,
            },
        });
    }
    if (record.error) {
        events.push({
            id: `error:${record.updatedAt}`,
            sourceId: BACKGROUND_CHAT_ACTIVITY_SOURCE_ID,
            runId: record.jobId,
            type: 'error',
            occurredAt,
            payload: { message: record.error },
        });
    }
    return events;
}

function toDetail(
    record: BackgroundChatActivityRecord,
    actions: BackgroundChatActivityActions
): ActivityRunDetail {
    return Object.freeze({
        ...toSummary(record, actions),
        events: Object.freeze(eventsFor(record)),
        output: record.content,
        error: record.error,
    });
}

function rejectedAction(input: ActivityActionInput) {
    return activityErr({
        code: 'source_failure',
        message: `Background chat action "${input.action}" was not accepted`,
        sourceId: BACKGROUND_CHAT_ACTIVITY_SOURCE_ID,
        runId: input.runId,
    });
}

export function createBackgroundChatActivitySource(
    options: CreateBackgroundChatActivitySourceOptions
): ActivitySource {
    const actions = options.actions ?? {};
    return {
        id: BACKGROUND_CHAT_ACTIVITY_SOURCE_ID,
        label: 'Background chat',
        actions: [
            ...(actions.cancel ? (['cancel'] as const) : []),
            ...(actions.openSource ? (['open-source'] as const) : []),
        ],
        async listRuns(input) {
            const statuses = input.statuses
                ? new Set(input.statuses)
                : undefined;
            const runs = (await options.store.list())
                .map((record) => toSummary(record, actions))
                .filter((run) => !statuses || statuses.has(run.status))
                .sort(
                    (left, right) =>
                        Date.parse(right.updatedAt) -
                        Date.parse(left.updatedAt)
                );
            return activityOk(
                input.limit === undefined
                    ? runs
                    : runs.slice(0, Math.max(0, input.limit))
            );
        },
        async getRun(runId) {
            const record = await options.store.get(runId);
            return record
                ? activityOk(toDetail(record, actions))
                : activityErr({
                      code: 'run_not_found',
                      message: `Background chat activity "${runId}" was not found`,
                      sourceId: BACKGROUND_CHAT_ACTIVITY_SOURCE_ID,
                      runId,
                  });
        },
        subscribe(input) {
            return options.updates?.subscribe((update) => {
                if (input.runId && input.runId !== update.record.jobId) {
                    return;
                }
                for (const event of eventsFor(
                    update.record,
                    update.delta
                )) {
                    input.onEvent(event);
                }
            });
        },
        async executeAction(input) {
            const record = await options.store.get(input.runId);
            if (!record) {
                return activityErr({
                    code: 'run_not_found',
                    message: `Background chat activity "${input.runId}" was not found`,
                    sourceId: BACKGROUND_CHAT_ACTIVITY_SOURCE_ID,
                    runId: input.runId,
                });
            }
            if (input.action === 'cancel' && actions.cancel) {
                return (await actions.cancel(input.runId))
                    ? activityOk(undefined)
                    : rejectedAction(input);
            }
            if (
                input.action === 'open-source' &&
                actions.openSource
            ) {
                return (await actions.openSource(record))
                    ? activityOk(undefined)
                    : rejectedAction(input);
            }
            return activityErr({
                code: 'capability_unavailable',
                message: `Background chat does not support "${input.action}"`,
                sourceId: BACKGROUND_CHAT_ACTIVITY_SOURCE_ID,
                runId: input.runId,
            });
        },
    };
}
