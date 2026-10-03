import { getSyncGatewayAdapter } from '../../sync/gateway/registry';
import { getAuthWorkspaceStore } from '../../auth/store/registry';
import { requireCan } from '../../auth/can';
import type { CanonicalChatQuery } from '~~/shared/chat/history-reader';
import type { HistoryRetrievalContext } from '~~/shared/chat/history-retrieval';

/** Inputs must come from an authenticated session or a verified persisted job, never request-supplied actor fields. */
export function canonicalHistoryContext(input: { subject: string; workspaceId: string; threadId: string; syncProviderId: string; signal: AbortSignal }): HistoryRetrievalContext {
    const adapter = getSyncGatewayAdapter(input.syncProviderId); const store = getAuthWorkspaceStore(input.syncProviderId);
    if (!input.subject || !input.workspaceId || !input.threadId || adapter?.capabilities?.canonicalChatHistory !== 'v1'
        || !adapter.readChatHistory || !store) throw new Error('Canonical history reader is unavailable.');
    const authorize = async () => {
        input.signal.throwIfAborted();
        const membership = (await store.listUserWorkspaces(input.subject)).find((row) => row.id === input.workspaceId);
        if (!membership) throw new Error('Workspace access is unavailable.');
        requireCan({ authenticated: true, user: { id: input.subject }, workspace: { id: input.workspaceId, name: membership.name }, role: membership.role },
            'workspace.read', { kind: 'workspace', id: input.workspaceId });
        input.signal.throwIfAborted();
    };
    const actor = { userId: input.subject, workspaceId: input.workspaceId };
    return { ...input, authorize,
        read: (query: CanonicalChatQuery) => adapter.readChatHistory!(actor, query, input.signal),
        revision: async (threadIds) => {
            await authorize(); const revisions: Array<[string, string]> = [];
            for (const id of threadIds ?? [input.threadId]) {
                const result = await adapter.readChatHistory!(actor, { kind: 'thread', thread_id: id }, input.signal);
                if (result.status !== 'ok' || result.revision === undefined) throw new Error('Canonical revision is unavailable.');
                revisions.push([id, result.revision]);
            }
            await authorize(); return JSON.stringify(revisions);
        } };
}
