import {
    activityErr,
    activityOk,
    type ActivityActionInput,
    type ActivityEvent,
    type ActivityResult,
    type ActivityRunAction,
    type ActivityRunDetail,
    type ActivityRunStatus,
    type ActivitySource,
    type ActivitySubscriptionInput,
} from '../contract';
import {
    isWorkflowMessageData,
    type HitlAction,
    type WorkflowMessageData,
} from '~/utils/chat/workflow-types';

export const WORKFLOW_ACTIVITY_SOURCE_ID = 'or3.workflow';

export interface WorkflowActivityMessage {
    readonly id: string;
    readonly threadId: string;
    readonly createdAt: number;
    readonly updatedAt: number;
    readonly data: WorkflowMessageData;
}

export interface WorkflowActivityStore {
    list(): Promise<readonly WorkflowActivityMessage[]>;
    get(messageId: string): Promise<WorkflowActivityMessage | undefined>;
}

export interface WorkflowActivityUpdates {
    subscribe(
        listener: (messageId: string, state: WorkflowMessageData) => void
    ): () => void;
}

export interface WorkflowActivityActions {
    cancel?(messageId: string): Promise<boolean> | boolean;
    retry?(messageId: string): Promise<boolean> | boolean;
    respond?(
        messageId: string,
        requestId: string,
        action: HitlAction,
        jobId?: string
    ): Promise<boolean> | boolean;
    openSource?(message: WorkflowActivityMessage): Promise<boolean> | boolean;
}

export interface CreateWorkflowActivitySourceOptions {
    readonly store: WorkflowActivityStore;
    readonly updates?: WorkflowActivityUpdates;
    readonly actions?: WorkflowActivityActions;
    readonly now?: () => Date;
}

function isoFromSeconds(value: number): string {
    return new Date(value * 1000).toISOString();
}

function pendingApprovals(data: WorkflowMessageData) {
    return Object.values(data.hitlRequests ?? {}).filter(
        (request) => !request.response
    );
}

export function workflowActivityStatus(
    data: WorkflowMessageData
): ActivityRunStatus {
    if (pendingApprovals(data).length > 0) return 'waiting_approval';
    switch (data.executionState) {
        case 'idle':
            return 'queued';
        case 'running':
            return 'running';
        case 'completed':
            return 'succeeded';
        case 'error':
            return 'failed';
        case 'stopped':
        case 'interrupted':
            return 'cancelled';
    }
}

function availableActions(
    message: WorkflowActivityMessage,
    actions: WorkflowActivityActions
): ActivityRunAction[] {
    const status = workflowActivityStatus(message.data);
    const available: ActivityRunAction[] = [];
    if (status === 'running' && actions.cancel) available.push('cancel');
    if (
        (status === 'failed' || status === 'cancelled') &&
        actions.retry
    ) {
        available.push('retry');
    }
    if (status === 'waiting_approval' && actions.respond) {
        available.push('approve', 'deny');
    }
    if (actions.openSource) available.push('open-source');
    return available;
}

function statusEvent(
    message: WorkflowActivityMessage,
    data: WorkflowMessageData,
    occurredAt: string
): ActivityEvent {
    const status = workflowActivityStatus(data);
    return {
        id: `status:${data.version ?? message.updatedAt}:${status}`,
        sourceId: WORKFLOW_ACTIVITY_SOURCE_ID,
        runId: message.id,
        type: 'status',
        occurredAt,
        sequence: data.version,
        payload: {
            status,
            workflowState: data.executionState,
            currentNodeId: data.currentNodeId,
        },
    };
}

function workflowEvents(
    message: WorkflowActivityMessage,
    data = message.data,
    occurredAt = isoFromSeconds(message.updatedAt)
): ActivityEvent[] {
    const events: ActivityEvent[] = [
        statusEvent(message, data, occurredAt),
    ];
    for (const [nodeId, node] of Object.entries(data.nodeStates ?? {})) {
        events.push({
            id: `node:${nodeId}:${node.status}`,
            sourceId: WORKFLOW_ACTIVITY_SOURCE_ID,
            runId: message.id,
            type: node.error ? 'error' : 'message',
            occurredAt:
                typeof node.finishedAt === 'number'
                    ? new Date(node.finishedAt).toISOString()
                    : typeof node.startedAt === 'number'
                      ? new Date(node.startedAt).toISOString()
                      : occurredAt,
            payload: {
                nodeId,
                label: node.label,
                nodeType: node.type,
                status: node.status,
                output: node.output,
                error: node.error,
            },
        });
        for (const tool of node.toolCalls ?? []) {
            events.push({
                id: `node:${nodeId}:tool:${tool.id}:${tool.status}`,
                sourceId: WORKFLOW_ACTIVITY_SOURCE_ID,
                runId: message.id,
                type: tool.error ? 'error' : 'tool',
                occurredAt:
                    typeof tool.finishedAt === 'number'
                        ? new Date(tool.finishedAt).toISOString()
                        : typeof tool.startedAt === 'number'
                          ? new Date(tool.startedAt).toISOString()
                          : occurredAt,
                payload: {
                    nodeId,
                    toolId: tool.id,
                    name: tool.name,
                    status: tool.status,
                    error: tool.error,
                },
            });
        }
    }
    for (const request of Object.values(data.hitlRequests ?? {})) {
        events.push({
            id: `approval:${request.id}:${request.response?.action ?? 'pending'}`,
            sourceId: WORKFLOW_ACTIVITY_SOURCE_ID,
            runId: message.id,
            type: 'approval',
            occurredAt: request.response?.respondedAt ?? request.createdAt,
            payload: {
                approvalId: request.id,
                nodeId: request.nodeId,
                title: request.nodeLabel,
                prompt: request.prompt,
                mode: request.mode,
                status: request.response
                    ? request.response.action === 'reject'
                        ? 'denied'
                        : 'approved'
                    : 'pending',
                jobId: request.jobId,
            },
        });
    }
    return events.sort(
        (left, right) =>
            Date.parse(left.occurredAt) - Date.parse(right.occurredAt) ||
            left.id.localeCompare(right.id)
    );
}

function toSummary(
    message: WorkflowActivityMessage,
    actions: WorkflowActivityActions
) {
    const status = workflowActivityStatus(message.data);
    return {
        id: message.id,
        sourceId: WORKFLOW_ACTIVITY_SOURCE_ID,
        title: message.data.workflowName || 'Workflow execution',
        kind: 'workflow' as const,
        status,
        startedAt: isoFromSeconds(message.createdAt),
        updatedAt: isoFromSeconds(message.updatedAt),
        completedAt:
            status === 'succeeded' ||
            status === 'failed' ||
            status === 'cancelled'
                ? isoFromSeconds(message.updatedAt)
                : undefined,
        summary: message.data.prompt,
        actions: availableActions(message, actions),
    };
}

function toDetail(
    message: WorkflowActivityMessage,
    actions: WorkflowActivityActions
): ActivityRunDetail {
    const summary = toSummary(message, actions);
    const approvals = pendingApprovals(message.data).map((request) => ({
        id: request.id,
        title: request.nodeLabel,
        description: request.prompt,
        status: 'pending' as const,
        metadata: {
            mode: request.mode,
            nodeId: request.nodeId,
            jobId: request.jobId,
        },
    }));
    const error =
        message.data.result?.error ||
        Object.values(message.data.nodeStates ?? {}).find((node) => node.error)
            ?.error;
    return Object.freeze({
        ...summary,
        events: Object.freeze(workflowEvents(message)),
        output: message.data.finalOutput || undefined,
        approvals: Object.freeze(approvals),
        error,
    });
}

async function actionFailure(
    input: ActivityActionInput,
    message: string
): Promise<ActivityResult<void>> {
    return activityErr({
        code: 'source_failure',
        message,
        sourceId: WORKFLOW_ACTIVITY_SOURCE_ID,
        runId: input.runId,
    });
}

export function createWorkflowActivitySource(
    options: CreateWorkflowActivitySourceOptions
): ActivitySource {
    const actions = options.actions ?? {};
    const supportedActions: ActivityRunAction[] = [
        ...(actions.cancel ? (['cancel'] as const) : []),
        ...(actions.retry ? (['retry'] as const) : []),
        ...(actions.respond ? (['approve', 'deny'] as const) : []),
        ...(actions.openSource ? (['open-source'] as const) : []),
    ];
    return {
        id: WORKFLOW_ACTIVITY_SOURCE_ID,
        label: 'Workflows',
        actions: supportedActions,
        async listRuns(input) {
            const messages = await options.store.list();
            const statuses = input.statuses
                ? new Set(input.statuses)
                : undefined;
            const runs = messages
                .filter((message) => isWorkflowMessageData(message.data))
                .map((message) => toSummary(message, actions))
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
            const message = await options.store.get(runId);
            if (!message || !isWorkflowMessageData(message.data)) {
                return activityErr({
                    code: 'run_not_found',
                    message: `Workflow activity "${runId}" was not found`,
                    sourceId: WORKFLOW_ACTIVITY_SOURCE_ID,
                    runId,
                });
            }
            return activityOk(toDetail(message, actions));
        },
        subscribe(input: ActivitySubscriptionInput) {
            if (!options.updates) return;
            return options.updates.subscribe((messageId, state) => {
                if (input.runId && input.runId !== messageId) return;
                void (async () => {
                    try {
                        const stored = await options.store.get(messageId);
                        const now = options.now?.() ?? new Date();
                        const message: WorkflowActivityMessage =
                            stored ?? {
                                id: messageId,
                                threadId: '',
                                createdAt: Math.floor(
                                    now.getTime() / 1000
                                ),
                                updatedAt: Math.floor(
                                    now.getTime() / 1000
                                ),
                                data: state,
                            };
                        for (const normalized of workflowEvents(
                            { ...message, data: state },
                            state,
                            now.toISOString()
                        )) {
                            input.onEvent(normalized);
                        }
                    } catch (cause) {
                        input.onError?.({
                            code: 'source_failure',
                            message:
                                cause instanceof Error
                                    ? cause.message
                                    : 'Workflow Activity update failed',
                            sourceId: WORKFLOW_ACTIVITY_SOURCE_ID,
                            runId: messageId,
                            cause,
                        });
                    }
                })();
            });
        },
        async executeAction(input) {
            const message = await options.store.get(input.runId);
            if (!message) {
                return activityErr({
                    code: 'run_not_found',
                    message: `Workflow activity "${input.runId}" was not found`,
                    sourceId: WORKFLOW_ACTIVITY_SOURCE_ID,
                    runId: input.runId,
                });
            }
            let succeeded = false;
            if (input.action === 'cancel' && actions.cancel) {
                succeeded = await actions.cancel(input.runId);
            } else if (input.action === 'retry' && actions.retry) {
                succeeded = await actions.retry(input.runId);
            } else if (
                (input.action === 'approve' || input.action === 'deny') &&
                actions.respond
            ) {
                const requestId = input.payload?.approvalId;
                const jobId = input.payload?.jobId;
                if (typeof requestId !== 'string') {
                    return activityErr({
                        code: 'invalid_input',
                        message: 'A workflow approval ID is required',
                        sourceId: WORKFLOW_ACTIVITY_SOURCE_ID,
                        runId: input.runId,
                    });
                }
                succeeded = await actions.respond(
                    input.runId,
                    requestId,
                    input.action === 'approve' ? 'approve' : 'reject',
                    typeof jobId === 'string' ? jobId : undefined
                );
            } else if (
                input.action === 'open-source' &&
                actions.openSource
            ) {
                succeeded = await actions.openSource(message);
            }
            return succeeded
                ? activityOk(undefined)
                : actionFailure(
                      input,
                      `Workflow action "${input.action}" was not accepted`
                  );
        },
    };
}
