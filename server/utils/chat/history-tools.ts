import type { ToolExecutionContext } from '~/utils/chat/types';
import { historyToolDefinitions } from '~~/shared/chat/history-tools';
import { createHistoryRetrievalService, type GetHistoryMessageArgs, type SearchParentArgs } from '~~/shared/chat/history-retrieval';
import { canonicalHistoryContext } from './canonical-history-context';
import { getJobProvider } from '../background-jobs/store';
import { getChatJobExecution } from '../background-jobs/types';
import { registerServerTool } from './tool-registry';

/** Job storage identifies execution; only the selected sync adapter supplies history. */
async function executionContext(execution: ToolExecutionContext) {
    const { subject, workspaceId, threadId, messageId, requestId, abortSignal } = execution;
    if (!subject || !workspaceId || !threadId || !messageId || !requestId) throw new Error('Trusted history execution context is required.');
    const jobs = await getJobProvider();
    const job = await jobs.getJob(requestId, subject);
    const checkpoint = job && getChatJobExecution(job);
    if (!job || job.kind === 'workflow' || job.userId !== subject || job.threadId !== threadId || job.messageId !== messageId
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Verify durable checkpoint version at the runtime authorization boundary.
        || !checkpoint || !('version' in checkpoint) || checkpoint.version !== 1 || checkpoint.workspaceId !== workspaceId
        || !job.syncProviderId) throw new Error('The original history execution is unavailable.');
    return canonicalHistoryContext({ subject, workspaceId, threadId, syncProviderId: job.syncProviderId, signal: abortSignal });
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
