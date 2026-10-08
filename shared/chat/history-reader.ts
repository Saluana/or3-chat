import type { CanonicalHistoryActor, CanonicalHistoryRecord } from './background-history';

export type CanonicalChatQuery =
    | { kind: 'thread'; thread_id: string }
    | { kind: 'messages'; message_ids: string[] }
    | { kind: 'thread_page'; thread_id: string; cursor?: string; limit: number };
export type CanonicalChatReadResult = {
    status: 'ok' | 'scope_incomplete';
    thread?: CanonicalHistoryRecord;
    /** Provider resolves explicit and legacy project ownership in its authorized
     * snapshot. Absence means that project execution cannot be admitted safely. */
    project_ownership?: 'resolved' | 'conflict';
    messages?: CanonicalHistoryRecord[];
    next_cursor?: string;
    /** Physical content rows read, including rows excluded at a legacy tie
     * boundary. Callers use this to preserve their transport work budget. */
    examined_rows?: number;
    /** Thread queries return a materialized per-thread revision. Page readers
     * may return a workspace revision; scope cursors bind ancestor thread revisions. */
    revision?: string;
};
export interface CanonicalChatReader {
    readChatHistory(actor: CanonicalHistoryActor, query: CanonicalChatQuery, signal?: AbortSignal): Promise<CanonicalChatReadResult>;
}
const SEEK_PREFIX = 'chat-seek-v1:';
export type CanonicalChatSeek = { thread_id: string; backward: boolean; key?: [number, string, string] };
/** Host-only canonical seek; model cursors remain separately signed and scope-bound. */
export function encodeCanonicalChatSeek(value: CanonicalChatSeek): string {
    const cursor = SEEK_PREFIX + JSON.stringify(value);
    parseCanonicalChatSeek(cursor, value.thread_id);
    return cursor;
}
export function parseCanonicalChatSeek(cursor: string | undefined, threadId: string): CanonicalChatSeek | undefined {
    if (!cursor?.startsWith(SEEK_PREFIX)) return undefined;
    if (new TextEncoder().encode(cursor).length > 2048) throw new Error('Canonical seek exceeds its cursor bound.');
    const value: unknown = JSON.parse(cursor.slice(SEEK_PREFIX.length));
    if (!value || typeof value !== 'object') throw new Error('Invalid canonical seek.');
    const seek = value as CanonicalChatSeek;
    if (seek.thread_id !== threadId || typeof seek.backward !== 'boolean' || seek.key !== undefined
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- JSON cursor input can violate the declared tuple shape.
        && (!Array.isArray(seek.key) || seek.key.length !== 3 || !Number.isSafeInteger(seek.key[0])
            || typeof seek.key[1] !== 'string' || typeof seek.key[2] !== 'string')) throw new Error('Invalid canonical seek.');
    return seek;
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
