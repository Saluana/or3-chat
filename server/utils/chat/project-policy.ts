import { useRuntimeConfig } from '#imports';
import { canonicalHistoryContext } from './canonical-history-context';
import type { ToolExecutionContext } from '~/utils/chat/types';

/** Server-owned tools/jobs cannot substitute a caller-supplied project policy for canonical ownership. */
export async function assertServerProjectExecutionSupported(
    context: Pick<
        ToolExecutionContext,
        'subject' | 'workspaceId' | 'threadId' | 'abortSignal'
    >,
    permission: 'workspace.read' | 'workspace.write' = 'workspace.read',
) {
    if (!context.subject || !context.workspaceId || !context.threadId) return;
    const providerId = (useRuntimeConfig() as { public?: { sync?: { provider?: string } } }).public?.sync?.provider;
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
        permission,
    });
    await history.authorize();
    const result = await history.read({
        kind: 'thread',
        thread_id: context.threadId,
    });
    // Ownership reads can await storage. Recheck current execution access before
    // dispatching a model request or tool after that asynchronous boundary.
    await history.authorize();
    if (result.status !== 'ok' || !result.thread || result.thread.deleted)
        throw new Error(
            'Canonical chat ownership unavailable. Sync this chat before execution.',
        );
    if (result.thread.project_id)
        throw new Error(
            'Project tools and workflows require the browser project execution boundary. Server-owned execution is unavailable.',
        );
    if (result.project_ownership === 'resolved') return;
    // Missing proof cannot distinguish an ordinary chat from a legacy folder
    // member. Both older and current providers must resolve canonical ownership.
    throw new Error(
        'Canonical project ownership is unresolved. Update the sync provider or choose the chat’s owning project before server execution.',
    );
}
