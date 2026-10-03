import type { ToolExecutionContext } from '~/utils/chat/types';
import { historyToolDefinitions } from '~~/shared/chat/history-tools';
import { createHistoryRetrievalService, type GetHistoryMessageArgs, type SearchParentArgs } from '~~/shared/chat/history-retrieval';
import { getSyncGatewayAdapter } from '../../sync/gateway/registry';
import { getAuthWorkspaceStore } from '../../auth/store/registry';
import { requireCan } from '../../auth/can';
import { getJobProvider } from '../background-jobs/store';
import { registerServerTool } from './tool-registry';

/** Job storage identifies execution; only the selected sync adapter supplies history. */
async function executionContext(execution: ToolExecutionContext) {
    const { subject, workspaceId, threadId, messageId, requestId, abortSignal } = execution;
    if (!subject || !workspaceId || !threadId || !messageId || !requestId) throw new Error('Trusted history execution context is required.');
    const jobs = await getJobProvider();
    const job = await jobs.getJob(requestId, subject);
    const checkpoint = job?.execution;
    if (!job || job.kind === 'workflow' || job.userId !== subject || job.threadId !== threadId || job.messageId !== messageId
        || !checkpoint || !('version' in checkpoint) || checkpoint.version !== 1 || checkpoint.workspaceId !== workspaceId
        || !job.syncProviderId) throw new Error('The original history execution is unavailable.');
    const adapter = getSyncGatewayAdapter(job.syncProviderId);
    const store = getAuthWorkspaceStore(job.syncProviderId);
    if (adapter?.capabilities?.canonicalChatHistory !== 'v1' || !adapter.readChatHistory || !store) throw new Error('Canonical history reader is unavailable.');
    const authorize = async () => {
        abortSignal.throwIfAborted();
        const membership = (await store.listUserWorkspaces(subject)).find((row) => row.id === workspaceId);
        if (!membership) throw new Error('Workspace access is unavailable.');
        requireCan({ authenticated: true, user: { id: subject }, workspace: { id: workspaceId, name: membership.name }, role: membership.role },
            'workspace.read', { kind: 'workspace', id: workspaceId });
        abortSignal.throwIfAborted();
    };
    const actor = { userId: subject, workspaceId };
    return { subject, workspaceId, threadId, signal: abortSignal, authorize,
        read: (query: Parameters<NonNullable<typeof adapter.readChatHistory>>[1]) => adapter.readChatHistory!(actor, query, abortSignal),
        revision: async (threadIds?: readonly string[]) => {
            await authorize();
            const revisions: Array<[string, string]> = [];
            for (const id of threadIds ?? [threadId]) {
                const result = await adapter.readChatHistory!(actor, { kind: 'thread', thread_id: id }, abortSignal);
                if (result.status !== 'ok' || result.revision === undefined) throw new Error('Canonical revision is unavailable.');
                revisions.push([id, result.revision]);
            }
            await authorize(); return JSON.stringify(revisions);
        } };
}

export function registerServerHistoryTools(): () => void {
    const service = createHistoryRetrievalService(); const disposers: Array<() => boolean> = [];
    try {
        for (const definition of historyToolDefinitions) disposers.push(registerServerTool({ ...definition, runtime: 'hybrid' }, async (args, execution) => {
            try {
                const context = await executionContext(execution);
                return JSON.stringify(definition.function.name === 'get_message'
                    ? await service.getMessage(context, args as unknown as GetHistoryMessageArgs)
                    : await service.searchParent(context, args as unknown as SearchParentArgs));
            } catch (error) {
                if (execution.abortSignal.aborted) throw error;
                return JSON.stringify({ status: 'scope_incomplete', reason: 'Authorized canonical history is unavailable. Sync the lineage or use foreground retrieval.' });
            }
        }, { runtime: 'hybrid' }));
    } catch (error) { disposers.forEach((dispose) => dispose()); throw error; }
    return () => disposers.forEach((dispose) => dispose());
}
