import { randomUUID } from 'node:crypto';
import { getChatJobExecution } from '../../../../utils/background-jobs/types';
import { createError, defineEventHandler, setHeader } from 'h3';
import { requireSession } from '../../../../auth/can';
import { requireJobWorkspaceAccess } from '../../../../utils/background-jobs/access';
import { resolveSessionContext } from '../../../../auth/session';
import { getJobProvider } from '../../../../utils/background-jobs/store';
import { readLimitedJsonBody } from '../../../../utils/security/limited-json-body';
import { requireSameOriginMutation } from '../../../../utils/security/mutation-guard';
import {
    checkSyncRateLimit,
    recordSyncRequest,
} from '../../../../utils/sync/rate-limiter';
import { enforceRateLimit } from '../../../../utils/rate-limit/enforce';

const CLAIM_TTL_MS = 30_000;

export default defineEventHandler(async (event) => {
    setHeader(event, 'Cache-Control', 'no-store, private');
    requireSameOriginMutation(event, {
        intentHeader: 'x-or3-tool-intent',
        intentValue: 'claim',
        requireJson: true,
    });
    const session = await resolveSessionContext(event);
    requireSession(session);
    const userId = session.user?.id;
    if (!userId) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' });
    const jobId = getRouterParam(event, 'id');
    const body = await readLimitedJsonBody<{
        callId?: unknown;
        deviceId?: unknown;
    }>(event, 4 * 1024);
    const callId = typeof body.callId === 'string' ? body.callId : '';
    const deviceId = typeof body.deviceId === 'string' ? body.deviceId : '';
    if (
        !jobId ||
        !callId ||
        callId.length > 256 ||
        !deviceId ||
        deviceId.length > 256
    ) {
        throw createError({ statusCode: 400, statusMessage: 'Invalid tool claim' });
    }

    // Reserve the request after validation but before provider work so
    // concurrent calls cannot share one slot and invalid requests are free.
    enforceRateLimit(event, checkSyncRateLimit(userId, 'chat-tool:claim'));
    recordSyncRequest(userId, 'chat-tool:claim');
    const provider = await getJobProvider();
    if (!provider.claimClientToolCall) {
        throw createError({ statusCode: 501, statusMessage: 'Client tool bridge unavailable' });
    }
    const current = await provider.getJob(jobId, userId);
    const execution = current ? getChatJobExecution(current) : undefined;
    const workspaceId = execution?.workspaceId;
    if (!current || !workspaceId) {
        throw createError({ statusCode: 404, statusMessage: 'Job not found' });
    }
    if (execution.body._clientDeviceId !== deviceId) {
        throw createError({
            statusCode: 409,
            statusMessage: 'Tool call belongs to another browser device',
        });
    }
    await requireJobWorkspaceAccess(event, session, workspaceId, 'workspace.write');

    const claimToken = randomUUID();
    const claimed = await provider.claimClientToolCall(
        jobId,
        userId,
        callId,
        claimToken,
        Date.now() + CLAIM_TTL_MS
    );
    const pending = claimed ? getChatJobExecution(claimed)?.clientToolCall : undefined;
    if (!claimed || !pending || pending.callId !== callId) {
        throw createError({ statusCode: 409, statusMessage: 'Tool call already claimed' });
    }
    return {
        claimToken,
        call: {
            id: pending.callId,
            name: pending.name,
            arguments: pending.arguments,
            definition: pending.definition,
        },
        context: {
            workspaceId,
            threadId: claimed.threadId,
            messageId: claimed.messageId,
        },
    };
});
