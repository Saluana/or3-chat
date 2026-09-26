import { createError, defineEventHandler, setHeader } from 'h3';
import { requireCan, requireSession } from '../../../../auth/can';
import { resolveSessionContext } from '../../../../auth/session';
import {
    getBackgroundJobEncryptionKey,
    getJobProvider,
} from '../../../../utils/background-jobs/store';
import { claimAndRunBackgroundJob } from '../../../../utils/background-jobs/lifecycle';
import { executeBackgroundJob } from '../../../../utils/background-jobs/stream-handler';
import { emitJobStatus } from '../../../../utils/background-jobs/viewers';
import { readLimitedJsonBody } from '../../../../utils/security/limited-json-body';
import { requireSameOriginMutation } from '../../../../utils/security/mutation-guard';
import {
    MAX_TOOL_DURABLE_RESULT_BYTES,
    isOutputLimitExceededError,
    projectToolResult,
} from '~~/shared/chat/tool-limits';
import { settleNormalizedTool } from '~~/shared/chat/normalized-stream-reducer';
import { canonicalToolResult } from '~~/shared/chat/canonical-tool-transcript';
import {
    checkSyncRateLimit,
    recordSyncRequest,
} from '../../../../utils/sync/rate-limiter';
import { enforceRateLimit } from '../../../../utils/rate-limit/enforce';

type ResultBody = {
    callId?: unknown;
    claimToken?: unknown;
    result?: unknown;
    error?: unknown;
};

export default defineEventHandler(async (event) => {
    setHeader(event, 'Cache-Control', 'no-store, private');
    requireSameOriginMutation(event, {
        intentHeader: 'x-or3-tool-intent',
        intentValue: 'result',
        requireJson: true,
    });
    const session = await resolveSessionContext(event);
    requireSession(session);
    const userId = session.user?.id;
    if (!userId) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' });
    enforceRateLimit(event, checkSyncRateLimit(userId, 'chat-tool:result'));
    const jobId = getRouterParam(event, 'id');
    // JSON escaping can expand a valid 256 KiB result by up to six bytes per
    // character (for example, control characters encoded as \u00xx).
    const body = await readLimitedJsonBody<ResultBody>(
        event,
        MAX_TOOL_DURABLE_RESULT_BYTES * 6 + 16 * 1024
    );
    const callId = typeof body.callId === 'string' ? body.callId : '';
    const claimToken = typeof body.claimToken === 'string' ? body.claimToken : '';
    const result = typeof body.result === 'string' ? body.result : '';
    const error = typeof body.error === 'string' ? body.error : undefined;
    if (!jobId || !callId || !claimToken || (!error && typeof body.result !== 'string')) {
        throw createError({ statusCode: 400, statusMessage: 'Invalid tool result' });
    }

    const provider = await getJobProvider();
    if (!provider.settleClientToolCall) {
        throw createError({ statusCode: 501, statusMessage: 'Client tool bridge unavailable' });
    }
    const job = await provider.getJob(jobId, userId);
    const execution = job?.execution;
    const pending = execution?.clientToolCall;
    if (!job || !execution || !pending || pending.callId !== callId) {
        throw createError({ statusCode: 409, statusMessage: 'Tool call is no longer pending' });
    }
    requireCan(session, 'workspace.write', {
        kind: 'workspace',
        id: execution.workspaceId,
    });

    let resolvedError = error;
    const rawModelResult = error
        ? `Error executing tool "${pending.name}": ${error}`
        : result;
    let projected = projectToolResult(rawModelResult);
    let normalizedToolState = execution.normalizedToolState;
    if (normalizedToolState) {
        if (!normalizedToolState.tools[callId]) {
            throw createError({ statusCode: 409, statusMessage: 'Tool checkpoint is incomplete' });
        }
        try {
            normalizedToolState = settleNormalizedTool(
                normalizedToolState,
                callId,
                resolvedError
                    ? { status: 'error', error: resolvedError }
                    : { status: 'complete', result: projected.durable }
            );
        } catch (cause) {
            if (isOutputLimitExceededError(cause)) {
                resolvedError = 'Tool result omitted because the conversation output limit was reached.';
                projected = projectToolResult(resolvedError);
                normalizedToolState = settleNormalizedTool(
                    execution.normalizedToolState!,
                    callId,
                    { status: 'error' }
                );
            } else {
                throw cause;
            }
        }
    }
    const messages = Array.isArray(execution.body.messages)
        ? execution.body.messages.slice()
        : [];
    messages.push({
        role: 'tool',
        tool_call_id: callId,
        name: pending.name,
        content: [{ type: 'text', text: projected.model }],
    });
    const remaining = (execution.pendingToolCalls ?? []).filter(
        (call) => call.id !== callId
    );
    const nextExecution = {
        ...execution,
        body: { ...execution.body, messages },
        pendingToolCalls: remaining.length > 0 ? remaining : undefined,
        clientToolCall: undefined,
        normalizedToolState,
        checkpointedToolCallIds: Array.from(
            new Set([...(execution.checkpointedToolCallIds ?? []), callId])
        ),
    };
    const nextToolCalls = (job.tool_calls ?? []).map((call) =>
        call.id === callId
            ? {
                  ...call,
                  status: resolvedError ? ('error' as const) : ('complete' as const),
                  result: resolvedError ? undefined : projected.durable,
                  error: resolvedError,
                  transcript: canonicalToolResult({
                      turnId: job.messageId,
                      parentAssistantId: job.messageId,
                      callId,
                      toolName: pending.name,
                      fingerprint: pending.argumentFingerprint,
                      status: resolvedError ? 'error' : 'complete',
                      result: projected.durable,
                      error: resolvedError,
                  }),
              }
            : call
    );
    const accepted = await provider.settleClientToolCall(
        jobId,
        userId,
        callId,
        claimToken,
        nextExecution,
        nextToolCalls
    );
    if (!accepted) {
        throw createError({ statusCode: 409, statusMessage: 'Tool claim expired or was replaced' });
    }
    recordSyncRequest(userId, 'chat-tool:result');
    emitJobStatus(jobId, 'streaming', {
        content: job.content,
        contentLength: job.content.length,
        chunksReceived: job.chunksReceived,
        tool_calls: nextToolCalls,
        attempt: job.attempts ?? 0,
    });
    await claimAndRunBackgroundJob(jobId, {
        provider,
        encryptionKey: getBackgroundJobEncryptionKey(),
        execute: executeBackgroundJob,
    });
    return { accepted: true };
});
