/**
 * @module server/utils/workflows/background-execution
 *
 * Purpose:
 * Execute workflows in background jobs with server-side streaming updates.
 */

import { useRuntimeConfig } from '#imports';
import type { BackgroundJobProvider } from '../background-jobs/types';
import { getJobProvider } from '../background-jobs/store';
import { emitJobDelta, emitJobStatus, hasJobViewers, initJobLiveState } from '../background-jobs/viewers';
import { logBackgroundEvent } from '../background-jobs/logging';
import { executeServerTool, listServerTools } from '../chat/tool-registry';
import { getNotificationEmitter } from '../notifications/registry';
import { emitBackgroundJobWebhookEvent } from '../webhooks/hook-emissions';
import type { WorkflowMessageData } from '~/utils/chat/workflow-types';
import {
    DEFAULT_WORKFLOW_MODEL,
    OpenRouterExecutionAdapter,
    type Attachment,
    type ExecutionCallbacks,
    type ExecutionInput,
    type ExecutionResult,
    type HITLRequest,
    type HITLResponse,
    type ToolExecutionContext as WorkflowToolExecutionContext,
    type WorkflowTool,
    type WorkflowData,
    type ResumeFromOptions,
} from 'or3-workflow-core';
import { registerHitlRequest, clearHitlRequestsForJob } from './hitl-store';
import { createWorkflowModelGateway } from '~~/shared/openrouter';
import { normalizeOpenRouterBaseUrl } from '~~/shared/openrouter/url';
import {
    BackgroundJobRunStore,
    type WorkflowStateWithJournal,
} from './background-run-store';
import { DEFAULT_WORKFLOW_TOOL_POLICY } from '~~/shared/chat/workflow-tool-policy';

function logBgStream(
    _stage: string,
    _details?: Record<string, unknown>
): void {}

function warnBgStream(
    _stage: string,
    _details?: Record<string, unknown>
): void {}

const WORKFLOW_ACTIVITY_PERSIST_INTERVAL_MS = 1_000;
export interface BackgroundWorkflowParams {
    workflow: WorkflowData;
    workflowId: string;
    workflowName: string;
    prompt: string;
    attachments?: Attachment[];
    apiKey: string;
    userId: string;
    workspaceId: string;
    threadId: string;
    messageId: string;
    /** Checkpoint supplied by a user-initiated resume. */
    resumeFrom?: ResumeFromOptions;
    /** Prior UI state version, used to keep resumed updates monotonic. */
    resumeStateVersion?: number;
}

export interface BackgroundWorkflowResult {
    jobId: string;
    status: 'streaming';
}

/**
 * Background jobs must reflect the adapter's terminal result. Node failures are
 * returned as `success: false` rather than thrown, so ignoring this flag marks
 * failed workflows completed and discards the useful provider error.
 */
export function assertBackgroundWorkflowSucceeded(
    result: ExecutionResult
): asserts result is ExecutionResult & { success: true } {
    if (result.success) return;
    throw (
        result.error ??
        new Error('Workflow execution failed without an error')
    );
}

function createWorkflowState(params: {
    workflowId: string;
    workflowName: string;
    prompt: string;
    attachments?: Attachment[];
    initialVersion?: number;
}): WorkflowMessageData {
    return {
        type: 'workflow-execution',
        workflowId: params.workflowId,
        workflowName: params.workflowName,
        prompt: params.prompt,
        attachments: params.attachments,
        executionState: 'running',
        nodeStates: {},
        executionOrder: [],
        currentNodeId: null,
        finalOutput: '',
        version: params.initialVersion ?? 0,
    };
}

/**
 * Seed a resumed background run with the completed checkpoint projection.
 * The executor already receives these outputs, but the chat card also needs
 * them so a new node does not replace all history from the earlier attempt.
 */
export function hydrateWorkflowStateFromResume(
    state: WorkflowMessageData,
    workflow: WorkflowData,
    resumeFrom?: ResumeFromOptions
): void {
    if (!resumeFrom) return;

    const nodesById = new Map(workflow.nodes.map((node) => [node.id, node]));
    const pending = new Set([
        resumeFrom.startNodeId,
        ...(resumeFrom.pendingNodes ?? []),
    ]);
    const orderedNodeIds = [
        ...(resumeFrom.executionOrder ?? []),
        ...Object.keys(resumeFrom.nodeOutputs),
    ].filter((nodeId, index, all) => all.indexOf(nodeId) === index);

    for (const nodeId of orderedNodeIds) {
        if (pending.has(nodeId)) continue;
        const node = nodesById.get(nodeId);
        const output = resumeFrom.nodeOutputs[nodeId];
        if (!node || typeof output !== 'string') continue;
        const rawLabel = (node.data as { label?: unknown }).label;
        state.nodeStates[nodeId] = {
            status: 'completed',
            label:
                typeof rawLabel === 'string' && rawLabel.trim()
                    ? rawLabel.trim()
                    : nodeId,
            type: node.type,
            output,
        };
        state.executionOrder.push(nodeId);
    }

    state.nodeOutputs = Object.fromEntries(
        state.executionOrder.map((nodeId) => [
            nodeId,
            state.nodeStates[nodeId]?.output ?? '',
        ])
    );
    state.lastActiveNodeId = resumeFrom.lastActiveNodeId ?? null;
    state.finalNodeId = resumeFrom.finalNodeId ?? null;
    state.sessionMessages = resumeFrom.sessionMessages?.flatMap(
        (message) => {
            if (message.role === 'tool') return [];
            return [
                {
                    role: message.role as 'user' | 'assistant' | 'system',
                    content:
                        typeof message.content === 'string'
                            ? message.content
                            : JSON.stringify(message.content),
                },
            ];
        }
    );
}

function collectNodeOutputs(
    state: WorkflowMessageData
): Record<string, string> {
    return Object.fromEntries(
        Object.entries(state.nodeStates)
            .filter(([, node]) => typeof node.output === 'string')
            .map(([nodeId, node]) => [nodeId, node.output])
    );
}

function updateWorkflowResumeState(state: WorkflowStateWithJournal): void {
    const snapshot = state.runJournal?.snapshot as
        | { pendingNodes?: unknown }
        | undefined;
    const pendingNodes = Array.isArray(snapshot?.pendingNodes)
        ? snapshot.pendingNodes.filter(
              (nodeId): nodeId is string => typeof nodeId === 'string'
          )
        : undefined;
    const nodeOutputs = {
        ...collectNodeOutputs(state),
        ...(state.nodeOutputs ?? {}),
    };
    state.nodeOutputs = nodeOutputs;
    const startNodeId =
        state.failedNodeId ??
        state.currentNodeId ??
        pendingNodes?.[0] ??
        state.lastActiveNodeId ??
        undefined;
    if (!startNodeId) return;
    state.resumeState = {
        startNodeId,
        nodeOutputs,
        executionOrder: [...state.executionOrder],
        lastActiveNodeId: state.lastActiveNodeId,
        sessionMessages: state.sessionMessages,
        resumeInput: state.lastActiveNodeId
            ? nodeOutputs[state.lastActiveNodeId]
            : undefined,
        pendingNodes,
    };
}

function applyExecutionResult(
    state: WorkflowStateWithJournal,
    result: ExecutionResult
): void {
    state.nodeOutputs = { ...result.nodeOutputs };
    state.executionOrder = [...result.executionOrder];
    state.lastActiveNodeId = result.lastActiveNodeId ?? null;
    state.finalNodeId = result.finalNodeId ?? null;
    state.sessionMessages = result.sessionMessages?.flatMap((message) => {
        if (message.role === 'tool') return [];
        return [{
            role: message.role as 'user' | 'assistant' | 'system',
            content:
                typeof message.content === 'string'
                    ? message.content
                    : JSON.stringify(message.content),
        }];
    });
    state.result = {
        success: result.success,
        duration: result.duration,
        totalTokens: result.usage?.totalTokens,
        usage: result.usage,
        tokenUsageDetails: result.tokenUsageDetails,
        error: result.error?.message,
    };
    if (!result.success) {
        state.failedNodeId ??= result.lastActiveNodeId ?? null;
        updateWorkflowResumeState(state);
    }
}

async function updateWorkflowJob(
    provider: BackgroundJobProvider,
    jobId: string,
    state: WorkflowMessageData,
    contentChunk?: string,
    chunksReceived?: number
): Promise<void> {
    await provider.updateJob(jobId, {
        workflow_state: state,
        ...(contentChunk ? { contentChunk } : {}),
        ...(typeof chunksReceived === 'number' ? { chunksReceived } : {}),
    });
}

async function executeWorkflowToolCall(
    name: string,
    args: unknown,
    context?: {
        jobId: string;
        workflowId: string;
        tool?: WorkflowToolExecutionContext;
    }
): Promise<string> {
    const serialized = typeof args === 'string' ? args : JSON.stringify(args ?? {});
    logBackgroundEvent('info', 'background.workflow.tool.started', {
        jobId: context?.jobId,
        workflowId: context?.workflowId,
        toolName: name,
        args,
    });
    try {
        const execution = await executeServerTool(name, serialized, {
            subject: null,
            workspaceId: null,
            threadId: null,
            messageId: null,
            callId:
                context?.tool?.callId ??
                `${context?.workflowId ?? 'workflow'}:${name}`,
            requestId:
                context?.tool?.runId ??
                context?.jobId ??
                crypto.randomUUID(),
            abortSignal:
                context?.tool?.signal ??
                new AbortController().signal,
        });
        if (execution.error) {
            logBackgroundEvent('warn', 'background.workflow.tool.failed', {
                jobId: context?.jobId,
                workflowId: context?.workflowId,
                toolName: name,
                error: execution.error,
                args,
            });
            throw new Error(execution.error);
        }
        logBackgroundEvent('info', 'background.workflow.tool.completed', {
            jobId: context?.jobId,
            workflowId: context?.workflowId,
            toolName: name,
            resultPreview:
                typeof execution.result === 'string'
                    ? execution.result.slice(0, 200)
                    : undefined,
        });
        return execution.result ?? '';
    } catch (error) {
        logBackgroundEvent('error', 'background.workflow.tool.error', {
            jobId: context?.jobId,
            workflowId: context?.workflowId,
            toolName: name,
            error: error instanceof Error ? error.message : String(error),
            args,
        });
        throw error;
    }
}

export async function startBackgroundWorkflow(
    params: BackgroundWorkflowParams
): Promise<BackgroundWorkflowResult> {
    const provider = await getJobProvider();
    const jobId = await provider.createJob({
        userId: params.userId,
        threadId: params.threadId,
        messageId: params.messageId,
        model: 'workflow',
        kind: 'workflow',
    });
    logBackgroundEvent('info', 'background.workflow.started', {
        jobId,
        userId: params.userId,
        workspaceId: params.workspaceId,
        threadId: params.threadId,
        messageId: params.messageId,
        workflowId: params.workflowId,
        workflowName: params.workflowName,
    });

    void runWorkflowInBackground(jobId, params, provider)
        .catch(async (err) => {
            const error = err instanceof Error ? err : new Error(String(err));
            logBackgroundEvent('error', 'background.workflow.failed', {
                jobId,
                userId: params.userId,
                workspaceId: params.workspaceId,
                threadId: params.threadId,
                messageId: params.messageId,
                workflowId: params.workflowId,
                workflowName: params.workflowName,
                error: error.message,
            });
            await provider.failJob(jobId, error.message);
            const failedJob = await provider
                .getJob(jobId, params.userId)
                .catch(() => null);
            emitJobStatus(jobId, 'error', {
                content: failedJob?.content ?? '',
                contentLength: failedJob?.content.length ?? 0,
                chunksReceived: failedJob?.chunksReceived ?? 0,
                completedAt: Date.now(),
                error: error.message,
                workflow_state: failedJob?.workflow_state,
            });
        })
        .catch((err) => {
            logBackgroundEvent('error', 'background.workflow.failure_handler', {
                jobId,
                error: err instanceof Error ? err.message : String(err),
            });
        });

    return { jobId, status: 'streaming' };
}

async function runWorkflowInBackground(
    jobId: string,
    params: BackgroundWorkflowParams,
    provider: BackgroundJobProvider
): Promise<void> {
    const notificationEmitter = getNotificationEmitter(provider.name);
    const shouldNotify = () => !hasJobViewers(jobId);
    const workflowState = createWorkflowState({
        workflowId: params.workflowId,
        workflowName: params.workflowName,
        prompt: params.prompt,
        attachments: params.attachments,
        initialVersion: params.resumeStateVersion,
    }) as WorkflowStateWithJournal;
    hydrateWorkflowStateFromResume(
        workflowState,
        params.workflow,
        params.resumeFrom
    );

    // Durable run journal for wave/tool restart safety (R7.AC1, R7.AC7).
    // Hydrate from any prior journal on the job so SSR process restarts resume
    // without duplicating receipt-backed tool calls.
    const existingJob = await provider
        .getJob(jobId, params.userId)
        .catch(() => null);
    const priorState = (existingJob?.workflow_state ??
        null) as WorkflowStateWithJournal | null;
    if (priorState?.runJournal) {
        workflowState.runJournal = priorState.runJournal;
    }
    initJobLiveState(jobId);
    logBgStream('workflow-background-start', {
        jobId,
        userId: params.userId,
        workspaceId: params.workspaceId,
        threadId: params.threadId,
        messageId: params.messageId,
        workflowId: params.workflowId,
    });

    const runtimeConfig = useRuntimeConfig();
    // Provider-neutral gateway over the unpatched public SDK v1 transport.
    const gateway = createWorkflowModelGateway({
        apiKey: params.apiKey,
        serverURL: normalizeOpenRouterBaseUrl(runtimeConfig.openrouterBaseUrl),
    });

    let chunks = 0;
    let lastStateEmitAt = 0;
    let lastActivityPersistAt = 0;
    let writeQueue = Promise.resolve();
    const queueWorkflowWrite = (
        contentChunk?: string,
        chunksReceived?: number
    ): Promise<void> => {
        const runWrite = () =>
            updateWorkflowJob(
                provider,
                jobId,
                workflowState,
                contentChunk,
                chunksReceived
            );
        const queuedWrite = writeQueue.then(runWrite, runWrite);
        writeQueue = queuedWrite.catch(() => undefined);
        return queuedWrite;
    };
    const queueWorkflowWriteBackground = (
        contentChunk?: string,
        chunksReceived?: number
    ): void => {
        void queueWorkflowWrite(contentChunk, chunksReceived).catch(() => {
            // Intentionally ignored here; queued write failures are surfaced by awaited writes.
        });
    };
    const persistWorkflowActivity = (): void => {
        const now = Date.now();
        if (now - lastActivityPersistAt < WORKFLOW_ACTIVITY_PERSIST_INTERVAL_MS) {
            return;
        }
        lastActivityPersistAt = now;
        queueWorkflowWriteBackground();
    };
    const runStore = new BackgroundJobRunStore(
        jobId,
        provider,
        workflowState,
        async (journal) => {
            workflowState.runJournal = journal;
            await queueWorkflowWrite();
        }
    );
    const registeredTools = listServerTools();
    const workflowTools: WorkflowTool[] = registeredTools.map((tool) => {
        const idempotencyKey = tool.workflowPolicy?.idempotencyKey;
        const policy = {
            ...DEFAULT_WORKFLOW_TOOL_POLICY,
            ...tool.workflowPolicy,
        };
        return {
            descriptor: {
                name: tool.definition.function.name,
                description: tool.definition.function.description,
                inputSchema: tool.definition.function.parameters,
                authority: 'host-server',
                sideEffect: policy.sideEffect,
                approval: policy.approval,
                parallelSafe: policy.parallelSafe,
                permissions: tool.workflowPolicy?.permissions,
            },
            execute: (args, toolContext) =>
                executeWorkflowToolCall(
                    tool.definition.function.name,
                    args,
                    {
                        jobId,
                        workflowId: params.workflowId,
                        tool: toolContext,
                    }
                ),
            idempotencyKey: idempotencyKey
                ? (input) => idempotencyKey(input)
                : undefined,
        };
    });
    const legacyWorkflowTools = registeredTools.map((tool) => ({
        type: 'function' as const,
        function: tool.definition.function,
    }));

    const adapter = new OpenRouterExecutionAdapter(gateway, {
        defaultModel: DEFAULT_WORKFLOW_MODEL,
        preflight: true,
        tools: legacyWorkflowTools,
        workflowTools,
        toolExecutionPolicy: {
            mode: 'parallel',
            defaultApproval: 'auto',
        },
        runStore,
        runId: jobId,
        sessionId: `workflow:${params.workflowId}:${params.messageId}`,
        persistWaveSnapshots: true,
        resumeFrom: params.resumeFrom,
        _parentSignal: provider.getAbortController?.(jobId)?.signal,
        onToolCall: (name, args) =>
            executeWorkflowToolCall(name, args, {
                jobId,
                workflowId: params.workflowId,
            }),
        onHITLRequest: async (request: HITLRequest): Promise<HITLResponse> => {
            logBackgroundEvent('info', 'background.workflow.hitl.requested', {
                jobId,
                workflowId: params.workflowId,
                requestId: request.id,
                nodeId: request.nodeId,
                mode: request.mode,
                prompt: request.prompt,
            });
            const requestState = {
                id: request.id,
                jobId,
                workspaceId: params.workspaceId,
                nodeId: request.nodeId,
                nodeLabel: request.nodeLabel,
                mode: request.mode,
                prompt: request.prompt,
                options: request.options?.map((option) => ({ ...option })),
                inputSchema: request.inputSchema,
                createdAt: request.createdAt,
                expiresAt: request.expiresAt,
                context: request.context,
            };
            workflowState.hitlRequests = {
                ...(workflowState.hitlRequests ?? {}),
                [request.id]: requestState,
            };
            const hitlNodeState = workflowState.nodeStates[request.nodeId];
            if (hitlNodeState) {
                hitlNodeState.status = 'waiting';
            } else {
                workflowState.nodeStates[request.nodeId] = {
                    status: 'waiting',
                    label: request.nodeLabel || request.nodeId,
                    type: 'hitl',
                    output: '',
                };
            }
            workflowState.currentNodeId = request.nodeId;
            workflowState.executionState = 'running';
            workflowState.version = (workflowState.version ?? 0) + 1;
            await queueWorkflowWrite();
            emitJobStatus(jobId, 'streaming', {
                content: workflowState.finalOutput,
                contentLength: workflowState.finalOutput.length,
                chunksReceived: chunks,
                workflow_state: workflowState,
            });
            return registerHitlRequest(request.id, {
                userId: params.userId,
                workspaceId: params.workspaceId,
                jobId,
            });
        },
    });

    const emitWorkflowStreamingState = (force = false) => {
        const now = Date.now();
        if (!force && now - lastStateEmitAt < 120) {
            return;
        }
        lastStateEmitAt = now;
        emitJobStatus(jobId, 'streaming', {
            content: workflowState.finalOutput,
            contentLength: workflowState.finalOutput.length,
            chunksReceived: chunks,
            workflow_state: workflowState,
        });
    };

    try {
        await queueWorkflowWrite();

        const executionInput: ExecutionInput = {
            text: params.prompt,
            attachments: params.attachments,
        };
        const executionCallbacks: ExecutionCallbacks = {
            onNodeStart: (nodeId, info) => {
                logBackgroundEvent('info', 'background.workflow.node.started', {
                    jobId,
                    workflowId: params.workflowId,
                    nodeId,
                    nodeType: info?.type || 'unknown',
                    nodeLabel: info?.label || nodeId,
                });
                workflowState.nodeStates[nodeId] = {
                    status: 'active',
                    label: info?.label || nodeId,
                    type: info?.type || 'unknown',
                    output: '',
                };
                if (!workflowState.executionOrder.includes(nodeId)) {
                    workflowState.executionOrder.push(nodeId);
                }
                workflowState.currentNodeId = nodeId;
                workflowState.executionState = 'running';
                workflowState.version = (workflowState.version ?? 0) + 1;
                emitWorkflowStreamingState(true);
                queueWorkflowWriteBackground();
            },
            onNodeFinish: (nodeId, output) => {
                logBackgroundEvent('info', 'background.workflow.node.completed', {
                    jobId,
                    workflowId: params.workflowId,
                    nodeId,
                    outputPreview:
                        typeof output === 'string'
                            ? output.slice(0, 220)
                            : String(output).slice(0, 220),
                });
                const nodeState = workflowState.nodeStates[nodeId];
                if (nodeState) {
                    nodeState.status = 'completed';
                    nodeState.output = output;
                    nodeState.streamingText = '';
                }
                workflowState.nodeOutputs = {
                    ...(workflowState.nodeOutputs ?? {}),
                    [nodeId]: output,
                };
                workflowState.lastActiveNodeId = nodeId;
                workflowState.finalNodeId = nodeId;
                workflowState.currentNodeId = null;
                workflowState.version = (workflowState.version ?? 0) + 1;
                emitWorkflowStreamingState(true);
                queueWorkflowWriteBackground();
            },
            onNodeError: (nodeId, error) => {
                logBackgroundEvent('warn', 'background.workflow.node.error', {
                    jobId,
                    workflowId: params.workflowId,
                    nodeId,
                    error: error.message,
                });
                const nodeState = workflowState.nodeStates[nodeId];
                if (nodeState) {
                    nodeState.status = 'error';
                    nodeState.error = error.message;
                }
                workflowState.executionState = 'error';
                workflowState.failedNodeId = nodeId;
                workflowState.currentNodeId = null;
                workflowState.version = (workflowState.version ?? 0) + 1;
                updateWorkflowResumeState(workflowState);
                emitWorkflowStreamingState(true);
                queueWorkflowWriteBackground();
            },
            onToken: (nodeId, token) => {
                if (!token) return;
                const nodeState = workflowState.nodeStates[nodeId];
                if (nodeState) {
                    nodeState.streamingText = (nodeState.streamingText || '') + token;
                    nodeState.activity = undefined;
                    workflowState.version = (workflowState.version ?? 0) + 1;
                    emitWorkflowStreamingState();
                    persistWorkflowActivity();
                }
            },
            onReasoning: (nodeId, token) => {
                if (!token) return;
                const nodeState = workflowState.nodeStates[nodeId];
                if (nodeState && !nodeState.streamingText) {
                    nodeState.activity = 'thinking';
                    workflowState.version = (workflowState.version ?? 0) + 1;
                    emitWorkflowStreamingState();
                    persistWorkflowActivity();
                }
            },
            onWorkflowToken: (token) => {
                workflowState.finalOutput += token;
                workflowState.executionState = 'running';
                workflowState.version = (workflowState.version ?? 0) + 1;
                chunks += 1;
                emitJobDelta(jobId, token, {
                    contentLength: workflowState.finalOutput.length,
                    chunksReceived: chunks,
                    workflow_state: workflowState,
                });
                queueWorkflowWriteBackground(token, chunks);
            },
        };

        const executionResult = await adapter.execute(
            params.workflow,
            executionInput,
            executionCallbacks
        );
        applyExecutionResult(workflowState, executionResult);
        assertBackgroundWorkflowSucceeded(executionResult);

        const resultFinalOutput =
            executionResult.finalOutput.length > 0
                ? executionResult.finalOutput
                : executionResult.output.length > 0
                  ? executionResult.output
                  : '';
        if (
            resultFinalOutput &&
            resultFinalOutput !== workflowState.finalOutput
        ) {
            workflowState.finalOutput = resultFinalOutput;
        }

        workflowState.executionState = 'completed';
        workflowState.currentNodeId = null;
        workflowState.version = (workflowState.version ?? 0) + 1;
        await queueWorkflowWrite();

        const latestJob = await provider.getJob(jobId, params.userId);
        if (!latestJob) {
            throw new Error('Background workflow job disappeared before completion');
        }
        if (latestJob.status !== 'streaming') {
            if (latestJob.status === 'aborted') {
                const abortErr = new Error('Workflow job aborted by user');
                abortErr.name = 'AbortError';
                throw abortErr;
            }
            throw new Error(
                `Background workflow job is no longer streaming (status: ${latestJob.status})`
            );
        }

        await provider.completeJob(jobId, workflowState.finalOutput);
        logBackgroundEvent('info', 'background.workflow.completed', {
            jobId,
            workflowId: params.workflowId,
            chunksReceived: chunks,
            contentLength: workflowState.finalOutput.length,
            executionState: workflowState.executionState,
        });
        emitJobStatus(jobId, 'complete', {
            content: workflowState.finalOutput,
            contentLength: workflowState.finalOutput.length,
            chunksReceived: chunks,
            completedAt: Date.now(),
            workflow_state: workflowState,
        });
        await emitBackgroundJobWebhookEvent({
            status: 'completed',
            jobId,
            workspaceId: params.workspaceId,
            userId: params.userId,
            threadId: params.threadId,
            messageId: params.messageId,
        });

        const notifyOnComplete = shouldNotify();
        logBgStream('workflow-notify-decision-complete', {
            jobId,
            workflowId: params.workflowId,
            notifyOnComplete,
            hasViewers: hasJobViewers(jobId),
        });
        if (notifyOnComplete) {
            try {
                await notificationEmitter?.emitBackgroundJobComplete(
                    params.workspaceId,
                    params.userId,
                    params.threadId,
                    jobId,
                    params.messageId
                );
                logBgStream('workflow-notify-complete-sent', {
                    jobId,
                    workflowId: params.workflowId,
                    userId: params.userId,
                    workspaceId: params.workspaceId,
                    threadId: params.threadId,
                });
            } catch (notifyError) {
                logBackgroundEvent(
                    'warn',
                    'background.workflow.notification.complete_failed',
                    {
                        jobId,
                        workflowId: params.workflowId,
                        error:
                            notifyError instanceof Error
                                ? notifyError.message
                                : String(notifyError),
                    }
                );
                warnBgStream('workflow-notify-complete-failed', {
                    jobId,
                    workflowId: params.workflowId,
                    error:
                        notifyError instanceof Error
                            ? notifyError.message
                            : String(notifyError),
                });
            }
        }
    } catch (error) {
        if (
            provider.getAbortController?.(jobId)?.signal.aborted ||
            (error instanceof Error && error.name === 'AbortError')
        ) {
            logBackgroundEvent('warn', 'background.workflow.aborted', {
                jobId,
                workflowId: params.workflowId,
                chunksReceived: chunks,
            });
            workflowState.executionState = 'stopped';
            workflowState.currentNodeId = null;
            updateWorkflowResumeState(workflowState);
            workflowState.version = (workflowState.version ?? 0) + 1;
            await queueWorkflowWrite();
            emitJobStatus(jobId, 'aborted', {
                content: workflowState.finalOutput,
                contentLength: workflowState.finalOutput.length,
                chunksReceived: chunks,
                completedAt: Date.now(),
                workflow_state: workflowState,
            });
            return;
        }

        workflowState.executionState = 'error';
        workflowState.currentNodeId = null;
        workflowState.failedNodeId ??=
            workflowState.lastActiveNodeId ?? null;
        workflowState.result = {
            success: false,
            duration: 0,
            error: error instanceof Error ? error.message : String(error),
        };
        updateWorkflowResumeState(workflowState);
        workflowState.version = (workflowState.version ?? 0) + 1;
        await queueWorkflowWrite();
        logBackgroundEvent('error', 'background.workflow.error', {
            jobId,
            workflowId: params.workflowId,
            chunksReceived: chunks,
            error: error instanceof Error ? error.message : String(error),
            executionState: workflowState.executionState,
        });
        emitJobStatus(jobId, 'error', {
            content: workflowState.finalOutput,
            contentLength: workflowState.finalOutput.length,
            chunksReceived: chunks,
            completedAt: Date.now(),
            error: error instanceof Error ? error.message : String(error),
            workflow_state: workflowState,
        });
        await emitBackgroundJobWebhookEvent({
            status: 'failed',
            jobId,
            workspaceId: params.workspaceId,
            userId: params.userId,
            threadId: params.threadId,
            messageId: params.messageId,
            error: error instanceof Error ? error.message : String(error),
        });
        const notifyOnError = shouldNotify();
        logBgStream('workflow-notify-decision-error', {
            jobId,
            workflowId: params.workflowId,
            notifyOnError,
            hasViewers: hasJobViewers(jobId),
        });
        if (notifyOnError) {
            try {
                await notificationEmitter?.emitBackgroundJobError(
                    params.workspaceId,
                    params.userId,
                    params.threadId,
                    jobId,
                    error instanceof Error ? error.message : String(error)
                );
                logBgStream('workflow-notify-error-sent', {
                    jobId,
                    workflowId: params.workflowId,
                    userId: params.userId,
                    workspaceId: params.workspaceId,
                    threadId: params.threadId,
                });
            } catch (notifyError) {
                logBackgroundEvent(
                    'warn',
                    'background.workflow.notification.error_failed',
                    {
                        jobId,
                        workflowId: params.workflowId,
                        error:
                            notifyError instanceof Error
                                ? notifyError.message
                                : String(notifyError),
                    }
                );
                warnBgStream('workflow-notify-error-failed', {
                    jobId,
                    workflowId: params.workflowId,
                    error:
                        notifyError instanceof Error
                            ? notifyError.message
                            : String(notifyError),
                });
            }
        }
        throw error;
    } finally {
        clearHitlRequestsForJob(jobId);
    }
}
