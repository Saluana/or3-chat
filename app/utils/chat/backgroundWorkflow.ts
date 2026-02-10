/**
 * @module app/utils/chat/backgroundWorkflow
 *
 * Purpose:
 * Client helpers for background workflow execution and HITL responses.
 */

import type { BackgroundStreamResult } from './openrouterStream';
import type { Attachment } from 'or3-workflow-core';

async function readWorkflowErrorMessage(
    response: Response,
    fallback: string
): Promise<string> {
    const data = (await response.json().catch(() => null)) as unknown;
    if (data && typeof data === 'object') {
        const error = data as Record<string, unknown>;
        if (typeof error.error === 'string' && error.error.trim().length > 0) {
            return error.error;
        }
        if (
            typeof error.statusMessage === 'string' &&
            error.statusMessage.trim().length > 0
        ) {
            return error.statusMessage;
        }
        if (
            typeof error.message === 'string' &&
            error.message.trim().length > 0
        ) {
            return error.message;
        }
    }
    return fallback;
}

export async function startBackgroundWorkflow(params: {
    workflowId: string;
    workflowName?: string;
    workflowUpdatedAt?: number;
    workflowVersion?: string;
    prompt: string;
    threadId: string;
    messageId: string;
    conversationHistory: Array<{ role: string; content: string }>;
    apiKey?: string | null;
    attachments?: Attachment[];
}): Promise<BackgroundStreamResult> {
    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
    };
    if (params.apiKey) {
        headers['x-or3-openrouter-key'] = params.apiKey;
    }

    const resp = await fetch('/api/workflows/background', {
        method: 'POST',
        headers,
        credentials: 'include',
        body: JSON.stringify({
            workflowId: params.workflowId,
            workflowName: params.workflowName,
            workflowUpdatedAt: params.workflowUpdatedAt,
            workflowVersion: params.workflowVersion,
            prompt: params.prompt,
            threadId: params.threadId,
            messageId: params.messageId,
            conversationHistory: params.conversationHistory,
            attachments: params.attachments,
        }),
    });

    if (!resp.ok) {
        const message = await readWorkflowErrorMessage(
            resp,
            `Background workflow failed: ${resp.status}`
        );
        throw new Error(message);
    }

    return await resp.json() as BackgroundStreamResult;
}

export async function respondHitlRequest(params: {
    requestId: string;
    jobId: string;
    action: string;
    data?: unknown;
}): Promise<void> {
    const resp = await fetch('/api/workflows/hitl', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({
            requestId: params.requestId,
            jobId: params.jobId,
            action: params.action,
            data: params.data,
        }),
    });

    if (!resp.ok) {
        const message = await readWorkflowErrorMessage(
            resp,
            `HITL response failed: ${resp.status}`
        );
        throw new Error(message);
    }
}
