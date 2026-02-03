/**
 * @module server/api/jobs/[id]/status.get
 *
 * Purpose:
 * Polls the current state and content of a background job.
 */
import { getJobProvider } from '../../../utils/background-jobs/store';
import { resolveSessionContext } from '../../../auth/session';
import { isSsrAuthEnabled } from '../../../utils/auth/is-ssr-auth-enabled';

/**
 * GET /api/jobs/:id/status
 *
 * Purpose:
 * Retrieve job progress suitable for polling clients.
 *
 * Behavior:
 * - Checks auth/ownership.
 * - Supports `offset` parameter to retrieve only new content (delta).
 *
 * Use Case:
 * - Client reconnection.
 * - Legacy polling fallback if SSE fails.
 */
export default defineEventHandler(async (event) => {
    const jobId = getRouterParam(event, 'id');

    if (!jobId) {
        setResponseStatus(event, 400);
        return { error: 'Missing job ID' };
    }

    // Resolve user ID for authorization
    let userId: string | null = null;
    if (isSsrAuthEnabled(event)) {
        const session = await resolveSessionContext(event);
        if (session.authenticated && session.user?.id) {
            userId = session.user.id;
        }
    }

    if (!userId) {
        setResponseStatus(event, 401);
        return { error: 'Authentication required' };
    }

    const provider = await getJobProvider();
    const job = await provider.getJob(jobId, userId);

    if (!job) {
        setResponseStatus(event, 404);
        return { error: 'Job not found or unauthorized' };
    }

    const query = getQuery(event);
    const offsetParam = typeof query.offset === 'string' ? query.offset : null;
    const offset = offsetParam ? Number(offsetParam) : null;

    if (
        typeof offset === 'number' &&
        Number.isFinite(offset) &&
        offset >= 0 &&
        typeof job.content === 'string'
    ) {
        const contentLength = job.content.length;
        const safeOffset = Math.min(offset, contentLength);
        const contentDelta = job.content.slice(safeOffset);
        return {
            id: job.id,
            status: job.status,
            threadId: job.threadId,
            messageId: job.messageId,
            model: job.model,
            chunksReceived: job.chunksReceived,
            startedAt: job.startedAt,
            completedAt: job.completedAt,
            error: job.error,
            content_delta: contentDelta,
            content_length: contentLength,
            content: safeOffset < offset ? job.content : undefined,
        };
    }

    return {
        id: job.id,
        status: job.status,
        threadId: job.threadId,
        messageId: job.messageId,
        model: job.model,
        chunksReceived: job.chunksReceived,
        startedAt: job.startedAt,
        completedAt: job.completedAt,
        error: job.error,
        content: job.content,
    };
});
