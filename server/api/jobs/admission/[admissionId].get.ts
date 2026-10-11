/** Recover a canonical admission without changing its owner or workspace. */
import { getJobProvider } from '../../../utils/background-jobs/store';
import { getScopedAdmissionKey } from '../../../utils/background-jobs/admission-cancels';
import { requireJobWorkspaceAccess } from '../../../utils/background-jobs/access';
import { getChatJobExecution } from '../../../utils/background-jobs/types';
import { resolveSessionContext } from '../../../auth/session';
import { isSsrAuthEnabled } from '../../../utils/auth/is-ssr-auth-enabled';

export default defineEventHandler(async (event) => {
    setHeader(event, 'Cache-Control', 'no-store, private');
    const raw = getRouterParam(event, 'admissionId');
    const admissionId = typeof raw === 'string' ? raw.trim() : '';
    const query = getQuery(event);
    const workspaceId = typeof query.workspaceId === 'string' ? query.workspaceId : '';
    if (!admissionId || admissionId.length > 128 || !workspaceId || workspaceId.length > 256) {
        setResponseStatus(event, 400);
        return { error: 'Admission ID and workspace ID are required' };
    }
    const session = isSsrAuthEnabled(event) ? await resolveSessionContext(event) : null;
    const userId = session?.authenticated ? session.user?.id : undefined;
    if (!userId) {
        setResponseStatus(event, 401);
        return { error: 'Authentication required' };
    }
    await requireJobWorkspaceAccess(event, session, workspaceId, 'workspace.read');
    const provider = await getJobProvider();
    if (!provider.findJobByIdempotencyKey) {
        setResponseStatus(event, 501);
        return { error: 'Admission lookup unavailable' };
    }
    // Never translate a provider outage into a definitive "not committed".
    const job = await provider.findJobByIdempotencyKey(
        getScopedAdmissionKey(userId, workspaceId, admissionId), userId);
    if (!job) {
        setResponseStatus(event, 404);
        return { error: 'No job for this admission' };
    }
    const execution = getChatJobExecution(job);
    if (execution?.workspaceId !== workspaceId || execution.history?.version !== 1) {
        setResponseStatus(event, 409);
        return { error: 'Admission cannot be recovered as canonical chat history' };
    }
    return {
        jobId: job.id,
        status: job.status,
        threadId: job.threadId,
        messageId: job.messageId,
        historyVersion: 1,
    };
});
