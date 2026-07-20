import { tx } from '~/db';
import type { ToolCall } from './types';
import { toolResultTranscriptData } from './transcript';

export async function appendForegroundToolResult(params: {
    threadId: string;
    turnId: string;
    parentAssistantId: string;
    call: ToolCall;
    fingerprint?: string;
    status: 'complete' | 'error';
    durableResult: string;
    error?: string;
}) {
    return await tx.appendMessage({
        thread_id: params.threadId,
        role: 'tool',
        data: toolResultTranscriptData({
            turnId: params.turnId,
            parentAssistantId: params.parentAssistantId,
            callId: params.call.id,
            toolName: params.call.function.name,
            fingerprint: params.fingerprint,
            status: params.status,
            result: params.durableResult,
            error: params.error,
        }),
    });
}
