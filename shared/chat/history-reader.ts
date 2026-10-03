import type { CanonicalHistoryActor, CanonicalHistoryRecord } from './background-history';

export type CanonicalChatQuery =
    | { kind: 'thread'; thread_id: string }
    | { kind: 'messages'; message_ids: string[] }
    | { kind: 'thread_page'; thread_id: string; cursor?: string; limit: number };
export type CanonicalChatReadResult = {
    status: 'ok' | 'scope_incomplete';
    thread?: CanonicalHistoryRecord;
    messages?: CanonicalHistoryRecord[];
    next_cursor?: string;
    /** Materialized workspace revision; any history write invalidates continuation. */
    revision?: string;
};
export interface CanonicalChatReader {
    readChatHistory(actor: CanonicalHistoryActor, query: CanonicalChatQuery, signal?: AbortSignal): Promise<CanonicalChatReadResult>;
}
/** Provider reads are bounded transport, never an application conversation cap. */
export function validateCanonicalChatQuery(query: CanonicalChatQuery): void {
    const validId = (id: unknown) => typeof id === 'string' && id.length > 0 && new TextEncoder().encode(id).length <= 200;
    if (query.kind === 'messages') {
        if (!Array.isArray(query.message_ids) || query.message_ids.length > 100
            || query.message_ids.some((id) => !validId(id))) throw new Error('Invalid bounded message query.');
    } else if (!['thread', 'thread_page'].includes(query.kind) || !validId(query.thread_id) || query.kind === 'thread_page' && (!Number.isSafeInteger(query.limit)
        || query.limit < 1 || query.limit > 100 || query.cursor !== undefined && new TextEncoder().encode(query.cursor).length > 2048)) {
        throw new Error('Invalid bounded thread query.');
    }
}
