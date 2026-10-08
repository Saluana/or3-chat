import { useRuntimeConfig } from '#imports';
import { canonicalHistoryContext } from './canonical-history-context';
import { getSyncGatewayAdapter } from '../../sync/gateway/registry';
import type { ToolExecutionContext } from '~/utils/chat/types';

const warnedProviders = new Set<string>();

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
    if (result.thread.project_id)
        throw new Error(
            'Project tools and workflows require the browser project execution boundary. Server-owned execution is unavailable.',
        );
    if (result.project_ownership === 'resolved') return;
    // Providers declaring the contract must resolve ownership. Older providers
    // cannot see legacy folder membership: ordinary chats keep working and the
    // gap is reported once until the provider is upgraded.
    if (result.project_ownership === 'conflict'
        || getSyncGatewayAdapter(providerId)?.capabilities?.projectOwnership === 'v1')
        throw new Error(
            'Canonical project ownership is unresolved. Update the sync provider or choose the chat’s owning project before server execution.',
        );
    if (!warnedProviders.has(providerId)) {
        warnedProviders.add(providerId);
        console.warn(`[projects] Sync provider "${providerId}" does not declare projectOwnership; legacy project folder membership is not enforced for server-owned execution until it is upgraded.`);
    }
}
