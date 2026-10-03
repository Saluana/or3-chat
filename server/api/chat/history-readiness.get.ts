import { getQuery, createError, defineEventHandler } from 'h3';
import { useRuntimeConfig } from '#imports';
import { isSsrAuthEnabled } from '../../utils/auth/is-ssr-auth-enabled';
import { resolveSessionContext } from '../../auth/session';
import { requireCan } from '../../auth/can';
import { setNoCacheHeaders } from '../../utils/headers';
import { canonicalHistoryContext } from '../../utils/chat/canonical-history-context';
import { createHistoryRetrievalService } from '~~/shared/chat/history-retrieval';

/** Readiness only: no content, job creation, inference or client-authoritative actor. */
export default defineEventHandler(async (event) => {
    if (!isSsrAuthEnabled(event)) throw createError({ statusCode: 404, statusMessage: 'Not Found' });
    setNoCacheHeaders(event);
    const session = await resolveSessionContext(event);
    if (!session.authenticated || !session.user?.id || !session.workspace?.id) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' });
    requireCan(session, 'workspace.read', { kind: 'workspace', id: session.workspace.id });
    const threadId = getQuery(event).thread_id;
    if (typeof threadId !== 'string' || !threadId || new TextEncoder().encode(threadId).length > 200) throw createError({ statusCode: 400, statusMessage: 'Invalid thread' });
    const config = useRuntimeConfig(event) as { sync?: { provider?: string }; public?: { sync?: { provider?: string } } };
    const syncProviderId = String(config.sync?.provider ?? config.public?.sync?.provider ?? '');
    try {
        const context = canonicalHistoryContext({ subject: session.user.id, workspaceId: session.workspace.id,
            threadId, syncProviderId, signal: AbortSignal.timeout(10_000) });
        const result = await createHistoryRetrievalService().inspect(context);
        return { ready: result.status === 'ok' };
    } catch { return { ready: false }; }
});
