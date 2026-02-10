/**
 * @module server/utils/workflows/background-execution
 *
 * Purpose:
 * Execute workflows in background jobs with server-side streaming updates.
 */

import type { BackgroundJobProvider } from '../background-jobs/types';
import { getJobProvider } from '../background-jobs/store';
import { emitJobDelta, emitJobStatus, hasJobViewers, initJobLiveState } from '../background-jobs/viewers';
import { executeServerTool } from '../chat/tool-registry';
import { getNotificationEmitter } from '../notifications/registry';
import type { WorkflowMessageData } from '~/utils/chat/workflow-types';
import type { HITLRequest, HITLResponse, WorkflowData, Attachment } from 'or3-workflow-core';
import { registerHitlRequest, clearHitlRequestsForJob } from './hitl-store';

export interface BackgroundWorkflowParams {
    workflow: WorkflowData;
    workflowId: string;
    workflowName: string;
    prompt: string;
    conversationHistory: Array<{ role: string; content: string }>; // minimal shape
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
    await provider.updateJob(jobId, {
        workflow_state: state as Record<string, unknown>,
        ...(contentChunk ? { contentChunk } : {}),
        ...(typeof chunksReceived === 'number' ? { chunksReceived } : {}),
    });
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

    const { OpenRouterExecutionAdapter } = await import('or3-workflow-core');
    const { OpenRouter } = await import('@openrouter/sdk');

    const client = new OpenRouter({ apiKey: params.apiKey });

    let chunks = 0;

    const adapter = new OpenRouterExecutionAdapter(client as any, {
        defaultModel: 'openai/gpt-4o-mini',
        preflight: true,
        tools: [],
        onToolCall: async (name: string, args: unknown) => {
            const serialized = typeof args === 'string' ? args : JSON.stringify(args ?? {});
            const execution = await executeServerTool(name, serialized);
            if (execution.error) {
                throw new Error(execution.error);
            }
            return execution.result ?? '';
        },
        onHITLRequest: async (request: HITLRequest): Promise<HITLResponse> => {
            const requestState = {
                id: request.id,
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
            workflowState.executionState = 'pending';
            workflowState.version = (workflowState.version ?? 0) + 1;
            await updateWorkflowJob(provider, jobId, workflowState);
            emitJobStatus(jobId, 'streaming', {
                content: workflowState.finalOutput ?? '',
                contentLength: (workflowState.finalOutput ?? '').length,
                chunksReceived: chunks,
                workflow_state: workflowState,
            });
            return registerHitlRequest(request.id, {
                userId: params.userId,
                workspaceId: params.workspaceId,
                jobId,
                resolve: () => {},
            });
        },
    });

    try {
        await updateWorkflowJob(provider, jobId, workflowState);

        await adapter.execute(
            {
                ...params.workflow,
                conversationHistory: params.conversationHistory,
            } as any,
            {
                text: params.prompt,
                conversationHistory: params.conversationHistory,
                attachments: params.attachments,
            } as any,
            {
                onNodeStart: (nodeId: string, info?: { label?: string; type?: string }) => {
                    workflowState.nodeStates[nodeId] = {
                        status: 'running',
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
                    void updateWorkflowJob(provider, jobId, workflowState);
                },
                onNodeFinish: (nodeId: string, output: string) => {
                    const nodeState = workflowState.nodeStates[nodeId];
                    if (nodeState) {
                        nodeState.status = 'complete';
                        nodeState.output = output;
                        nodeState.streamingText = '';
                    }
                    workflowState.currentNodeId = null;
                    workflowState.version = (workflowState.version ?? 0) + 1;
                    void updateWorkflowJob(provider, jobId, workflowState);
                },
                onNodeError: (nodeId: string, error: Error) => {
                    const nodeState = workflowState.nodeStates[nodeId];
                    if (nodeState) {
                        nodeState.status = 'error';
                        nodeState.error = error.message;
                    }
                    workflowState.executionState = 'error';
                    workflowState.failedNodeId = nodeId;
                    workflowState.currentNodeId = null;
                    workflowState.version = (workflowState.version ?? 0) + 1;
                    void updateWorkflowJob(provider, jobId, workflowState);
                },
                onWorkflowToken: (token: string) => {
                    workflowState.finalOutput = (workflowState.finalOutput || '') + token;
                    workflowState.executionState = 'running';
                    workflowState.version = (workflowState.version ?? 0) + 1;
                    chunks += 1;
                    emitJobDelta(jobId, token, {
                        contentLength: workflowState.finalOutput.length,
                        chunksReceived: chunks,
                    });
                    void updateWorkflowJob(provider, jobId, workflowState, token, chunks);
                },
            } as any
        );

        workflowState.executionState = 'completed';
        workflowState.currentNodeId = null;
        workflowState.version = (workflowState.version ?? 0) + 1;
        await updateWorkflowJob(provider, jobId, workflowState);
        await provider.completeJob(jobId, workflowState.finalOutput ?? '');
        emitJobStatus(jobId, 'complete', {
            content: workflowState.finalOutput ?? '',
            contentLength: (workflowState.finalOutput ?? '').length,
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
        workflowState.executionState = 'error';
        workflowState.version = (workflowState.version ?? 0) + 1;
        await updateWorkflowJob(provider, jobId, workflowState);
        emitJobStatus(jobId, 'error', {
            content: workflowState.finalOutput ?? '',
            contentLength: (workflowState.finalOutput ?? '').length,
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
