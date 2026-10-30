import { createError, defineEventHandler, getRouterParam, setHeader } from 'h3';
import { requireSession } from '../../../../auth/can';
import { resolveSessionContext } from '../../../../auth/session';
import { requireJobWorkspaceAccess } from '../../../../utils/background-jobs/access';
import { getJobProvider } from '../../../../utils/background-jobs/store';
import { getChatJobExecution } from '../../../../utils/background-jobs/types';
import { backgroundJobClientToolIdentity } from '../../../../utils/background-jobs/client-tool-identity';
import { backgroundClientToolDigest, backgroundClientToolTokenDigest } from '~~/shared/chat/background-client-tool-claim';
import { requireSameOriginMutation } from '../../../../utils/security/mutation-guard';
import { readLimitedJsonBody } from '../../../../utils/security/limited-json-body';
import { checkSyncRateLimit, recordSyncRequest } from '../../../../utils/sync/rate-limiter';
import { enforceRateLimit } from '../../../../utils/rate-limit/enforce';
import { DELEGATE_CHAT_TOOL } from '~~/shared/chat/delegation';

/** Revalidate browser execution outside Dexie transactions; delegation also refreshes its parked job. */
export default defineEventHandler(async (event) => {
    setHeader(event, 'Cache-Control', 'no-store, private');
    requireSameOriginMutation(event, { intentHeader: 'x-or3-tool-intent', intentValue: 'validate', requireJson: true });
    const session = await resolveSessionContext(event);
    requireSession(session);
    const userId = session.user?.id;
    if (!userId) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' });
    const jobId = getRouterParam(event, 'id');
    const body = await readLimitedJsonBody<{ callId?: unknown; claimToken?: unknown }>(event, 4096);
    const callId = typeof body.callId === 'string' ? body.callId : '';
    const claimToken = typeof body.claimToken === 'string' ? body.claimToken : '';
    if (!jobId || !callId || callId.length > 256 || !backgroundClientToolTokenDigest(claimToken))
        throw createError({ statusCode: 400, statusMessage: 'Invalid tool claim' });
    enforceRateLimit(event, checkSyncRateLimit(userId, 'chat-tool:validate'));
    recordSyncRequest(userId, 'chat-tool:validate');
    const provider = await getJobProvider();
    const current = await provider.getJob(jobId, userId);
    if (!current) throw createError({ statusCode: 404, statusMessage: 'Job not found' });
    await requireJobWorkspaceAccess(event, session, current.execution?.workspaceId, 'workspace.write');
    // Authorization may await I/O: reread the claim before affirming liveness.
    const job = await provider.getJob(jobId, userId);
    const pending = job ? getChatJobExecution(job)?.clientToolCall : undefined;
    const identity = job ? backgroundJobClientToolIdentity(job) : null;
    if (!job || job.status !== 'streaming' || !pending || pending.callId !== callId ||
        pending.claimToken !== claimToken || (pending.claimExpiresAt ?? 0) <= Date.now() ||
        !identity || identity.workspaceId !== current.execution?.workspaceId ||
        backgroundClientToolDigest(identity) !== backgroundClientToolTokenDigest(claimToken)) {
        throw createError({ statusCode: 409, statusMessage: 'Tool approval expired or its reviewed payload changed' });
    }
    // A live, authorized delegation is still active while the browser awaits its
    // child. Refresh the parked job's existing inactivity clock, without changing
    // its content or claim; stopped or worker-owned jobs cannot be updated.
    if (pending.name === DELEGATE_CHAT_TOOL) {
        await provider.updateJob(jobId, {});
        const fresh = await provider.getJob(jobId, userId);
        const live = fresh ? getChatJobExecution(fresh)?.clientToolCall : undefined;
        const freshIdentity = fresh ? backgroundJobClientToolIdentity(fresh) : null;
        if (!fresh || fresh.status !== 'streaming' || live?.callId !== callId || live.claimToken !== claimToken ||
            !freshIdentity || freshIdentity.workspaceId !== current.execution.workspaceId ||
            backgroundClientToolDigest(freshIdentity) !== backgroundClientToolTokenDigest(claimToken) ||
            (live.claimExpiresAt ?? 0) <= Date.now()) {
            throw createError({ statusCode: 409, statusMessage: 'Tool approval is no longer active' });
        }
    }
    return { valid: true };
});
