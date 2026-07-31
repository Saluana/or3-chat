/**
 * @module server/api/jobs/[id]/abort.post
 *
 * Purpose:
 * Cancels a running background streaming job.
 */
import { getJobProvider } from '../../../utils/background-jobs/store';
import { resolveSessionContext } from '../../../auth/session';
import { isSsrAuthEnabled } from '../../../utils/auth/is-ssr-auth-enabled';

/**
 * POST /api/jobs/:id/abort
 *
 * Purpose:
 * Stop a background generation.
 *
 * Behavior:
 * - Identifies user.
 * - Tells the Job Provider to signal abortion.
 *
 * Security:
 * - Only the job owner can abort their job.
 */
export default defineEventHandler(async (event) => {
    const jobId = getRouterParam(event, 'id');

    if (!jobId) {
        setResponseStatus(event, 400);
        return { error: 'Missing job ID', aborted: false };
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
        return { error: 'Authentication required', aborted: false };
    }

    const provider = await getJobProvider();
    const aborted = await provider.abortJob(jobId, userId);

    if (!aborted) {
        // Could be: job not found, not authorized, or already complete
        return { aborted: false, message: 'Job not found, unauthorized, or already complete' };
    }

    return { aborted: true };
});
