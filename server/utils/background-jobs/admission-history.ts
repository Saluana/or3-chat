import { parseChatGenerationAdmissionEnvelope, type CanonicalHistoryRecord } from '~~/shared/chat/background-history';
import { sanitizePayloadForSync } from '~~/shared/sync/sanitize';
import { normalizeWirePayloadForTable } from '~~/shared/sync/schemas';

/** Validate and sanitize a canonical admission against its server-owned scope. */
export function prepareBackgroundHistory(value: unknown, scope: {
    admissionId: string; workspaceId: string; threadId: string; messageId: string; syncProviderId: string;
}) {
    const parsed = parseChatGenerationAdmissionEnvelope(value);
    const sanitize = (table: 'threads' | 'messages', row: CanonicalHistoryRecord): CanonicalHistoryRecord => {
        // New jobs normalize before sanitizer defaults, while parsing existing
        // durable envelopes leaves their receipt fingerprint unchanged.
        const clean = sanitizePayloadForSync(table, normalizeWirePayloadForTable(table, row), 'put');
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
