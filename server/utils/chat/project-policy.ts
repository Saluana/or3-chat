import { useRuntimeConfig } from '#imports';
import { canonicalHistoryContext } from './canonical-history-context';
import type { ToolExecutionContext } from '~/utils/chat/types';

/** Server-owned tools/jobs cannot substitute a caller-supplied project policy for canonical ownership. */
export async function assertServerProjectExecutionSupported(
    context: Pick<
        ToolExecutionContext,
        'subject' | 'workspaceId' | 'threadId' | 'abortSignal'
    >,
) {
    if (!context.subject || !context.workspaceId || !context.threadId) return;
    const providerId = useRuntimeConfig().public?.sync?.provider;
    if (!providerId)
        throw new Error(
            'Canonical project ownership is unavailable without a sync provider.',
        );
    const history = canonicalHistoryContext({
        subject: context.subject,
        workspaceId: context.workspaceId,
        threadId: context.threadId,
        syncProviderId: providerId,
        signal: context.abortSignal,
    });
    await history.authorize();
    const result = await history.read({
        kind: 'thread',
        thread_id: context.threadId,
    });
    if (result.status !== 'ok' || !result.thread || result.thread.deleted)
        throw new Error(
            'Canonical chat ownership unavailable. Sync this chat before execution.',
        );
    if (result.project_ownership !== 'resolved')
        throw new Error(
            'Canonical project ownership is unresolved. Update the sync provider or choose the chat’s owning project before server execution.',
        );
    if (result.thread.project_id)
        throw new Error(
            'Project tools and workflows require the browser project execution boundary. Server-owned execution is unavailable.',
        );
}
