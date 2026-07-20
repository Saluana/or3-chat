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
    OpenRouterExecutionAdapter,
    type Attachment,
    type ExecutionCallbacks,
    type ExecutionInput,
    type HITLRequest,
    type HITLResponse,
    type WorkflowData,
} from 'or3-workflow-core';
import { registerHitlRequest, clearHitlRequestsForJob } from './hitl-store';
import { createWorkflowOpenRouterClient } from '~~/shared/openrouter';
import { normalizeOpenRouterBaseUrl } from '~~/shared/openrouter/url';

function logBgStream(
    _stage: string,
    _details?: Record<string, unknown>
): void {}

function warnBgStream(
    _stage: string,
    _details?: Record<string, unknown>
): void {}

const MAX_WORKFLOW_STATE_BYTES = 64 * 1024;
type ConversationHistoryMessage = { role: string; content: string };
type ExecutionInputWithHistory = ExecutionInput & {
    conversationHistory?: ConversationHistoryMessage[];
};
type WorkflowDataWithHistory = WorkflowData & {
    conversationHistory?: ConversationHistoryMessage[];
};

export interface BackgroundWorkflowParams {
    workflow: WorkflowData;
    workflowId: string;
    workflowName: string;
    prompt: string;
    conversationHistory: ConversationHistoryMessage[];
    attachments?: Attachment[];
    apiKey: string;
    userId: string;
    workspaceId: string;
    threadId: string;
    messageId: string;
}

export interface BackgroundWorkflowResult {
    jobId: string;
    status: 'streaming';
}

function createWorkflowState(params: {
    workflowId: string;
    workflowName: string;
    prompt: string;
    attachments?: Attachment[];
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
        version: 0,
    };
}

async function updateWorkflowJob(
    provider: BackgroundJobProvider,
    jobId: string,
    state: WorkflowMessageData,
    contentChunk?: string,
    chunksReceived?: number
): Promise<void> {
    const serializedState = JSON.stringify(state);
    if (serializedState.length > MAX_WORKFLOW_STATE_BYTES) {
        throw new Error(
            `Workflow state exceeded ${MAX_WORKFLOW_STATE_BYTES} bytes`
        );
    }

    await provider.updateJob(jobId, {
        workflow_state: state,
        ...(contentChunk ? { contentChunk } : {}),
        ...(typeof chunksReceived === 'number' ? { chunksReceived } : {}),
    });
}

async function executeWorkflowToolCall(
    name: string,
    args: unknown,
    context?: { jobId: string; workflowId: string }
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
            callId: `${context?.workflowId ?? 'workflow'}:${name}`,
            requestId: context?.jobId ?? crypto.randomUUID(),
            abortSignal: new AbortController().signal,
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

    runWorkflowInBackground(jobId, params, provider).catch((err) => {
        logBackgroundEvent('error', 'background.workflow.failed', {
            jobId,
            userId: params.userId,
            workspaceId: params.workspaceId,
            threadId: params.threadId,
            messageId: params.messageId,
            workflowId: params.workflowId,
            workflowName: params.workflowName,
            error: err instanceof Error ? err.message : String(err),
        });
        void provider.failJob(jobId, err instanceof Error ? err.message : String(err));
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
    });

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
    const client = createWorkflowOpenRouterClient({
        apiKey: params.apiKey,
        serverURL: normalizeOpenRouterBaseUrl(runtimeConfig.openrouterBaseUrl),
    });

    let chunks = 0;
    let lastStateEmitAt = 0;
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
    const workflowTools = listServerTools().map((tool) => ({
        type: 'function' as const,
        function: tool.definition.function,
        handler: (args: unknown) =>
            executeWorkflowToolCall(tool.definition.function.name, args, {
                jobId,
                workflowId: params.workflowId,
            }),
    }));

    // workflow-core is typed against @openrouter/sdk@0.3; runtime shim handles v1.
    const adapter = new OpenRouterExecutionAdapter(client as never, {
        defaultModel: 'openai/gpt-4o-mini',
        preflight: true,
        tools: workflowTools,
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

        const workflowForExecution: WorkflowDataWithHistory = {
            ...params.workflow,
            conversationHistory: params.conversationHistory,
        };
        const executionInput: ExecutionInputWithHistory = {
            text: params.prompt,
            conversationHistory: params.conversationHistory,
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
                emitWorkflowStreamingState(true);
                queueWorkflowWriteBackground();
            },
            onToken: (nodeId, token) => {
                if (!token) return;
                const nodeState = workflowState.nodeStates[nodeId];
                if (nodeState) {
                    nodeState.streamingText = (nodeState.streamingText || '') + token;
                    workflowState.version = (workflowState.version ?? 0) + 1;
                    emitWorkflowStreamingState();
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
            workflowForExecution,
            executionInput,
            executionCallbacks
        );

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
        if (error instanceof Error && error.name === 'AbortError') {
            logBackgroundEvent('warn', 'background.workflow.aborted', {
                jobId,
                workflowId: params.workflowId,
                chunksReceived: chunks,
            });
            workflowState.executionState = 'stopped';
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
