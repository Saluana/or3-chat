/**
 * POST /api/jobs/[id]/abort
 *
 * Abort a running background streaming job.
 * Requires authentication.
 */

import { getJobProvider } from '../../../utils/background-jobs/store';
import { resolveSessionContext } from '../../../auth/session';
import { isSsrAuthEnabled } from '../../../utils/auth/is-ssr-auth-enabled';

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

    const provider = getJobProvider();
    const aborted = await provider.abortJob(jobId, userId);

    if (!aborted) {
        // Could be: job not found, not authorized, or already complete
        return { aborted: false, message: 'Job not found, unauthorized, or already complete' };
    }

    return { aborted: true };
});
