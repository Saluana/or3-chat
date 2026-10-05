import { getDb, type Or3DB } from '~/db/client';
import { appendMessageToDb } from '~/db/messages';
import { getWriteTxTableNames } from '~/db/util';
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
    generationId?: string;
    error?: string;
    /** Captured workspace DB from request admission. Defaults to the active DB. */
    db?: Or3DB;
}) {
    const targetDb = params.db ?? getDb();
    const data = toolResultTranscriptData({
        turnId: params.turnId,
        parentAssistantId: params.parentAssistantId,
        callId: params.call.id,
        toolName: params.call.function.name,
        fingerprint: params.fingerprint,
        status: params.status,
        result: params.durableResult,
        error: params.error,
    });
    return targetDb.transaction(
        'rw',
        getWriteTxTableNames(targetDb, 'messages', { include: ['threads'] }),
        async () => {
            // Hard deletion and insertion serialize over these tables. No pre-read
            // authorizes a later append; ownership is checked under the write lock.
            const [thread, parent] = await Promise.all([
                targetDb.threads.get(params.threadId),
                targetDb.messages.get(params.parentAssistantId),
            ]);
            if (!thread || thread.deleted) {
                throw new Error(
                    `Cannot persist tool result: thread ${params.threadId} not found in workspace database ${targetDb.name}`
                );
            }
            if (!parent || parent.deleted || parent.role !== 'assistant') {
                throw new Error(
                    `Cannot persist tool result: parent assistant ${params.parentAssistantId} not found in workspace database ${targetDb.name}`
                );
            }
            if (parent.thread_id !== params.threadId) {
                throw new Error(
                    `Cannot persist tool result: parent assistant ${params.parentAssistantId} does not belong to thread ${params.threadId}`
                );
            }
            const parentData =
                parent.data && typeof parent.data === 'object'
                    ? (parent.data as Record<string, unknown>)
                    : undefined;
            if (
                params.generationId &&
                (parentData?.generation_id ?? parent.stream_id) !==
                    params.generationId
            ) {
                throw new Error(
                    'Cannot persist tool result: parent generation was superseded'
                );
            }
            return await appendMessageToDb(targetDb, {
                thread_id: params.threadId,
                role: 'tool',
                data,
            });
        }
    );
}
