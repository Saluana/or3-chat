import { getDb, type Or3DB } from '~/db/client';
import { appendMessageToDb } from '~/db/messages';
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
    /** Captured workspace DB from request admission. Defaults to the active DB. */
    db?: Or3DB;
}) {
    const targetDb = params.db ?? getDb();
    // Validate ownership in the captured workspace before inserting. A missing
    // thread/parent means the conversation no longer exists there; writing
    // anyway would create an orphan (possibly in the wrong workspace if the
    // caller resolved the active DB after a workspace switch).
    const [thread, parent] = await Promise.all([
        targetDb.threads.get(params.threadId),
        targetDb.messages.get(params.parentAssistantId),
    ]);
    if (!thread) {
        throw new Error(
            `Cannot persist tool result: thread ${params.threadId} not found in workspace database ${targetDb.name}`
        );
    }
    if (!parent) {
        throw new Error(
            `Cannot persist tool result: parent assistant ${params.parentAssistantId} not found in workspace database ${targetDb.name}`
        );
    }
    if (parent.thread_id !== params.threadId) {
        throw new Error(
            `Cannot persist tool result: parent assistant ${params.parentAssistantId} does not belong to thread ${params.threadId}`
        );
    }
    return await appendMessageToDb(targetDb, {
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
