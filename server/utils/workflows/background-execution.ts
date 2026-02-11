/**
 * @module server/utils/workflows/background-execution
 *
 * Purpose:
 * Execute workflows in background jobs with server-side streaming updates.
 */

import type { BackgroundJobProvider } from '../background-jobs/types';
import { getJobProvider } from '../background-jobs/store';
import { emitJobDelta, emitJobStatus, hasJobViewers, initJobLiveState } from '../background-jobs/viewers';
import { executeServerTool, listServerTools } from '../chat/tool-registry';
import { getNotificationEmitter } from '../notifications/registry';
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
import { OpenRouter } from '@openrouter/sdk';
import { registerHitlRequest, clearHitlRequestsForJob } from './hitl-store';

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
    args: unknown
): Promise<string> {
    const serialized = typeof args === 'string' ? args : JSON.stringify(args ?? {});
    const execution = await executeServerTool(name, serialized);
    if (execution.error) {
        throw new Error(execution.error);
    }
    return execution.result ?? '';
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

    runWorkflowInBackground(jobId, params, provider).catch((err) => {
        console.error('[background-workflow] Job failed:', jobId, err);
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

    const client = new OpenRouter({ apiKey: params.apiKey });

    let chunks = 0;
    let lastStateEmitAt = 0;
    const workflowTools = listServerTools().map((tool) => ({
        type: 'function' as const,
        function: tool.definition.function,
        handler: (args: unknown) =>
            executeWorkflowToolCall(tool.definition.function.name, args),
    }));

    const adapter = new OpenRouterExecutionAdapter(client, {
        defaultModel: 'openai/gpt-4o-mini',
        preflight: true,
        tools: workflowTools,
        onToolCall: executeWorkflowToolCall,
        onHITLRequest: async (request: HITLRequest): Promise<HITLResponse> => {
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
            await updateWorkflowJob(provider, jobId, workflowState);
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
        await updateWorkflowJob(provider, jobId, workflowState);

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
                void updateWorkflowJob(provider, jobId, workflowState);
            },
            onNodeFinish: (nodeId, output) => {
                const nodeState = workflowState.nodeStates[nodeId];
                if (nodeState) {
                    nodeState.status = 'completed';
                    nodeState.output = output;
                    nodeState.streamingText = '';
                }
                workflowState.currentNodeId = null;
                workflowState.version = (workflowState.version ?? 0) + 1;
                emitWorkflowStreamingState(true);
                void updateWorkflowJob(provider, jobId, workflowState);
            },
            onNodeError: (nodeId, error) => {
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
                void updateWorkflowJob(provider, jobId, workflowState);
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
                void updateWorkflowJob(provider, jobId, workflowState, token, chunks);
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
        await updateWorkflowJob(provider, jobId, workflowState);

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
        emitJobStatus(jobId, 'complete', {
            content: workflowState.finalOutput,
            contentLength: workflowState.finalOutput.length,
            chunksReceived: chunks,
            completedAt: Date.now(),
            workflow_state: workflowState,
        });

        if (shouldNotify()) {
            await notificationEmitter?.emitBackgroundJobComplete(
                params.workspaceId,
                params.userId,
                params.threadId,
                jobId
            );
        }
    } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
            workflowState.executionState = 'stopped';
            workflowState.version = (workflowState.version ?? 0) + 1;
            await updateWorkflowJob(provider, jobId, workflowState);
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
        await updateWorkflowJob(provider, jobId, workflowState);
        emitJobStatus(jobId, 'error', {
            content: workflowState.finalOutput,
            contentLength: workflowState.finalOutput.length,
            chunksReceived: chunks,
            completedAt: Date.now(),
            error: error instanceof Error ? error.message : String(error),
            workflow_state: workflowState,
        });
        if (shouldNotify()) {
            await notificationEmitter?.emitBackgroundJobError(
                params.workspaceId,
                params.userId,
                params.threadId,
                jobId,
                error instanceof Error ? error.message : String(error)
            );
        }
        throw error;
    } finally {
        clearHitlRequestsForJob(jobId);
    }
}
