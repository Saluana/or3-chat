/**
 * @module server/api/jobs/admission/[admissionId].get
 *
 * Purpose:
 * Recover-before-resubmit for background admissions. When a start request's
 * outcome is uncertain (dropped response, transport failure after commit),
 * the client probes this route with its stable admission ID before submitting
 * another potentially duplicate action. If a job was already committed for
 * the admission, its ID and status are returned so the caller can attach
 * instead of launching a duplicate execution.
 *
 * Security:
 * - Only the authenticated owner can look up their own admissions.
 */
import { getJobProvider } from '../../../utils/background-jobs/store';
import { resolveSessionContext } from '../../../auth/session';
import { isSsrAuthEnabled } from '../../../utils/auth/is-ssr-auth-enabled';

export default defineEventHandler(async (event) => {
    setHeader(event, 'Cache-Control', 'no-store, private');
    const raw = getRouterParam(event, 'admissionId');
    const admissionId = typeof raw === 'string' ? raw.trim() : '';

    if (!admissionId || admissionId.length > 128) {
        setResponseStatus(event, 400);
        return { error: 'Missing admission ID' };
    }

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
    if (!provider.findJobByIdempotencyKey) {
        setResponseStatus(event, 501);
        return { error: 'Admission lookup unavailable' };
    }
    const job = await provider
        .findJobByIdempotencyKey(admissionId, userId)
        .catch(() => null);
    if (!job) {
        setResponseStatus(event, 404);
        return { error: 'No job for this admission' };
    }
    return {
        jobId: job.id,
        status: job.status,
        threadId: job.threadId,
        messageId: job.messageId,
    };
});
