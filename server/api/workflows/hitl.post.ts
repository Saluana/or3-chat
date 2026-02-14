/**
 * @module server/api/workflows/hitl.post
 *
 * Purpose:
 * Resolve a HITL request for a background workflow job.
 */

import { defineEventHandler, readBody, createError, setResponseHeader } from 'h3';
import { resolveSessionContext } from '../../auth/session';
import { requireCan } from '../../auth/can';
import { isSsrAuthEnabled } from '../../utils/auth/is-ssr-auth-enabled';
import { resolveHitlRequest } from '../../utils/workflows/hitl-store';
import type { HITLResponse } from 'or3-workflow-core';
import {
    checkSyncRateLimit,
    recordSyncRequest,
} from '../../utils/sync/rate-limiter';

export default defineEventHandler(async (event) => {
    if (!isSsrAuthEnabled(event)) {
        throw createError({ statusCode: 404, statusMessage: 'Not Found' });
    }
    setResponseHeader(event, 'Cache-Control', 'no-store');

    const body = (await readBody(event).catch(() => null)) as
        | Record<string, unknown>
        | null;
    if (!body) {
        throw createError({ statusCode: 400, statusMessage: 'Invalid request body' });
    }

    const requestId = body.requestId;
    const jobId = body.jobId;
    const action = body.action;
    const data = body.data;

    if (typeof requestId !== 'string' || !requestId) {
        throw createError({ statusCode: 400, statusMessage: 'Missing requestId' });
    }
    if (typeof jobId !== 'string' || !jobId) {
        throw createError({ statusCode: 400, statusMessage: 'Missing jobId' });
    }
    if (typeof action !== 'string' || !action) {
        throw createError({ statusCode: 400, statusMessage: 'Missing action' });
    }

    const session = await resolveSessionContext(event);
    if (!session.authenticated || !session.user || !session.workspace) {
        throw createError({ statusCode: 401, statusMessage: 'Unauthorized' });
    }

    requireCan(session, 'workspace.write', {
        kind: 'workspace',
        id: session.workspace.id,
    });

    const rateLimitResult = checkSyncRateLimit(session.user.id, 'workflow:hitl');
    if (!rateLimitResult.allowed) {
        const retryAfterSec = Math.ceil((rateLimitResult.retryAfterMs ?? 1000) / 1000);
        setResponseHeader(event, 'Retry-After', retryAfterSec);
        throw createError({
            statusCode: 429,
            statusMessage: `Rate limit exceeded. Retry after ${retryAfterSec}s`,
        });
    }

    const response: HITLResponse = {
        requestId,
        action: action as HITLResponse['action'],
        data: data as HITLResponse['data'],
        respondedAt: new Date().toISOString(),
    };

    const resolved = await resolveHitlRequest(
        requestId,
        response,
        session.user.id,
        session.workspace.id,
        jobId
    );

    if (!resolved) {
        throw createError({ statusCode: 404, statusMessage: 'HITL request not found' });
    }

    recordSyncRequest(session.user.id, 'workflow:hitl');
    return { ok: true };
});
