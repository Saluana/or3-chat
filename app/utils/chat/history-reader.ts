import Dexie from 'dexie';
import { getActiveWorkspaceId, getDb, getWorkspaceGeneration, type Or3DB } from '~/db/client';
import type { ToolExecutionContext } from './types';
import type { CanonicalHistoryRecord } from '~~/shared/chat/background-history';
import { validateCanonicalChatQuery, type CanonicalChatQuery, type CanonicalChatReadResult } from '~~/shared/chat/history-reader';
import type { HistoryRetrievalContext } from '~~/shared/chat/history-retrieval';

type Position = [number, string, string];
function decodePosition(cursor: string, threadId: string): Position {
    const value: unknown = JSON.parse(cursor);
    if (!Array.isArray(value) || value.length !== 4 || value[0] !== threadId
        || typeof value[1] !== 'number' || !Number.isSafeInteger(value[1])
        || typeof value[2] !== 'string' || typeof value[3] !== 'string') throw new Error('Invalid canonical page cursor.');
    return [value[1], value[2], value[3]];
}

/** Every read remains on this exact DB; a workspace change never retargets it. */
export function capturedHistoryContext(execution: ToolExecutionContext, revision: (threadIds?: readonly string[]) => string): HistoryRetrievalContext {
    const db = getDb(); const generation = getWorkspaceGeneration();
    const workspaceId = getActiveWorkspaceId() ?? 'local';
    const authorize = () => {
        if (execution.abortSignal.aborted) throw new DOMException('History retrieval canceled.', 'AbortError');
        if (!execution.threadId || execution.workspaceId !== workspaceId
            || (getActiveWorkspaceId() ?? 'local') !== workspaceId || getDb() !== db
            || getWorkspaceGeneration() !== generation) throw new Error('The captured chat workspace is unavailable.');
    };
    authorize();
    return { subject: execution.subject ?? 'local-browser', workspaceId, threadId: execution.threadId!,
        signal: execution.abortSignal, authorize, revision,
        read: async (query) => {
            authorize(); const result = await readCapturedHistory(db, query); authorize(); return result;
        } };
}

export async function readCapturedHistory(db: Or3DB, query: CanonicalChatQuery): Promise<CanonicalChatReadResult> {
    validateCanonicalChatQuery(query);
    if (query.kind === 'thread') return { status: 'ok', thread: await db.threads.get(query.thread_id) as CanonicalHistoryRecord | undefined };
    if (query.kind === 'messages') return { status: 'ok', messages: (await db.messages.bulkGet(query.message_ids))
        .filter((row): row is NonNullable<typeof row> => Boolean(row)) as CanonicalHistoryRecord[] };
    const lower = query.cursor ? [query.thread_id, ...decodePosition(query.cursor, query.thread_id)]
        : [query.thread_id, Dexie.minKey, Dexie.minKey, Dexie.minKey];
    const page = await db.messages.where('[thread_id+index+order_key+id]')
        .between(lower, [query.thread_id, Dexie.maxKey, Dexie.maxKey, Dexie.maxKey], !query.cursor, true)
        .limit(query.limit).toArray();
    const messages = page.slice(0, query.limit); const last = messages.at(-1);
    return { status: 'ok', messages: messages as CanonicalHistoryRecord[], next_cursor: page.length === query.limit && last
        ? JSON.stringify([query.thread_id, last.index, last.order_key, last.id]) : undefined };
}
