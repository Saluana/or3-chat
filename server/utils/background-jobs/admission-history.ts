import { parseChatGenerationAdmissionEnvelope, type CanonicalHistoryRecord } from '~~/shared/chat/background-history';
import { sanitizePayloadForSync } from '~~/shared/sync/sanitize';

/** Validate and sanitize a canonical admission against its server-owned scope. */
export function prepareBackgroundHistory(value: unknown, scope: {
    admissionId: string; workspaceId: string; threadId: string; messageId: string; syncProviderId: string;
}) {
    const parsed = parseChatGenerationAdmissionEnvelope(value);
    const sanitize = (table: 'threads' | 'messages', row: CanonicalHistoryRecord): CanonicalHistoryRecord => {
        const clean = sanitizePayloadForSync(table, row, 'put');
        if (!clean) throw new Error('Invalid background history payload');
        return { ...clean, id: row.id, clock: row.clock, ...(row.hlc ? { hlc: row.hlc } : {}) };
    };
    const history = { ...parsed, thread: parsed.thread ? sanitize('threads', parsed.thread) : undefined,
        userMessage: parsed.userMessage ? sanitize('messages', parsed.userMessage) : undefined,
        assistantMessage: sanitize('messages', parsed.assistantMessage) };
    if (!scope.syncProviderId || history.admissionId !== scope.admissionId ||
        history.workspaceId !== scope.workspaceId || history.threadId !== scope.threadId || history.messageId !== scope.messageId)
        throw new Error('Invalid background history scope');
    return history;
}
