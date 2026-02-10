/**
 * @module app/utils/chat/backgroundWorkflow
 *
 * Purpose:
 * Client helpers for background workflow execution and HITL responses.
 */

import type { BackgroundStreamResult } from './openrouterStream';
import type { Attachment } from 'or3-workflow-core';

export async function startBackgroundWorkflow(params: {
    workflow: unknown;
    workflowId: string;
    workflowName: string;
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
            workflow: params.workflow,
            workflowId: params.workflowId,
            workflowName: params.workflowName,
            prompt: params.prompt,
            threadId: params.threadId,
            messageId: params.messageId,
            conversationHistory: params.conversationHistory,
            attachments: params.attachments,
        }),
    });

    if (!resp.ok) {
        const data = (await resp.json().catch(() => null)) as { error?: string } | null;
        const message = data?.error || `Background workflow failed: ${resp.status}`;
        throw new Error(message);
    }

    return await resp.json() as BackgroundStreamResult;
}

export async function respondHitlRequest(params: {
    requestId: string;
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
            action: params.action,
            data: params.data,
        }),
    });

    if (!resp.ok) {
        const data = (await resp.json().catch(() => null)) as { error?: string } | null;
        const message = data?.error || `HITL response failed: ${resp.status}`;
        throw new Error(message);
    }
}
