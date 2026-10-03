import Dexie from 'dexie';
import { getActiveWorkspaceId, getDb, getWorkspaceGeneration, type Or3DB } from '~/db/client';
import type { ToolExecutionContext } from './types';
import type { CanonicalHistoryRecord } from '~~/shared/chat/background-history';
import { validateCanonicalChatQuery, encodeCanonicalChatSeek, parseCanonicalChatSeek, type CanonicalChatQuery, type CanonicalChatReadResult } from '~~/shared/chat/history-reader';
import type { HistoryRetrievalContext } from '~~/shared/chat/history-retrieval';
import { compareMessageOrder } from '~/db/messages';

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
    const seek = parseCanonicalChatSeek(query.cursor, query.thread_id);
    const backward = seek?.backward ?? false;
    const key = seek?.key ?? (query.cursor && !seek ? decodePosition(query.cursor, query.thread_id) : undefined);
    // Legacy rows may have no order_key. The index-only range includes them;
    // canonical comparison resolves ties without silently losing old evidence.
    const indexed = db.messages.where('[thread_id+index]').between([query.thread_id, Dexie.minKey], [query.thread_id, Dexie.maxKey], true, true);
    const [total, indexedTotal] = await Promise.all([db.messages.where('thread_id').equals(query.thread_id).count(), indexed.count()]);
    if (total !== indexedTotal) return { status: 'scope_incomplete' };
    const keyBucketCount = key ? await db.messages.where('[thread_id+index]').equals([query.thread_id, key[0]]).count() : 0;
    const range = db.messages.where('[thread_id+index]').between(
        [query.thread_id, !backward && key ? key[0] : Dexie.minKey],
        [query.thread_id, backward && key ? key[0] : Dexie.maxKey],
        !(key && !backward && keyBucketCount === 1), !(key && backward && keyBucketCount === 1));
    const candidates = await (backward ? range.reverse() : range).limit(query.limit).toArray();
    const boundary = candidates.at(-1)?.index;
    // A pathologically large tie group is an explicit incomplete page, not
    // a false absence or an unbounded content read.
    const bounded = candidates.length === query.limit;
    const boundaryCount = bounded && boundary !== undefined
        ? await db.messages.where('[thread_id+index]').equals([query.thread_id, boundary]).count() : 0;
    const incompleteBoundary = bounded && candidates.filter((row) => row.index === boundary).length < boundaryCount;
    const complete = incompleteBoundary ? candidates.filter((row) => row.index !== boundary) : candidates;
    const ordered = complete.sort(compareMessageOrder); if (backward) ordered.reverse();
    const eligible = key ? ordered.filter((row) => {
        const order = compareMessageOrder(row, { index: key[0], order_key: key[1], id: key[2] });
        return backward ? order < 0 : order > 0;
    }) : ordered;
    const messages = eligible.slice(0, query.limit); const last = messages.at(-1);
    if (!messages.length && bounded) return { status: 'scope_incomplete' };
    return { status: 'ok', messages: messages as CanonicalHistoryRecord[], examined_rows: candidates.length, next_cursor: last
        && (eligible.length > messages.length || bounded)
        ? encodeCanonicalChatSeek({ thread_id: query.thread_id, backward, key: [last.index, last.order_key ?? '', last.id] }) : undefined };
}
