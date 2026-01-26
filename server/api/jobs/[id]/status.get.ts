/**
 * GET /api/jobs/[id]/status
 *
 * Get the status of a background streaming job.
 * Requires authentication.
 */

import { getJobProvider } from '../../../utils/background-jobs/store';
import { resolveSessionContext } from '../../../auth/session';
import { isSsrAuthEnabled } from '../../../utils/auth/is-ssr-auth-enabled';

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
