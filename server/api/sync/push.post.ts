/**
 * POST /api/sync/push
 * Gateway endpoint for sync push.
 */
import { defineEventHandler, readBody, createError, setResponseHeader } from 'h3';
import { PushBatchSchema } from '~~/shared/sync/schemas';
import { resolveSessionContext } from '../../auth/session';
import { requireCan } from '../../auth/can';
import { isSsrAuthEnabled } from '../../utils/auth/is-ssr-auth-enabled';
import { api } from '~~/convex/_generated/api';
import type { Id } from '~~/convex/_generated/dataModel';
import { getClerkProviderToken, getConvexGatewayClient } from '../../utils/sync/convex-gateway';
import {
    checkSyncRateLimit,
    recordSyncRequest,
    getSyncRateLimitStats,
} from '../../utils/sync/rate-limiter';

export default defineEventHandler(async (event) => {
    if (!isSsrAuthEnabled(event)) {
        throw createError({ statusCode: 404, statusMessage: 'Not Found' });
    }

    const body = await readBody(event);
    const parsed = PushBatchSchema.safeParse(body);
    if (!parsed.success) {
        throw createError({ statusCode: 400, statusMessage: 'Invalid push request' });
    }

    const session = await resolveSessionContext(event);
    requireCan(session, 'workspace.write', {
        kind: 'workspace',
        id: parsed.data.scope.workspaceId,
    });

    // Rate limiting (per-user)
    const rateLimitResult = checkSyncRateLimit(session.userId, 'sync:push');
    if (!rateLimitResult.allowed) {
        const retryAfterSec = Math.ceil((rateLimitResult.retryAfterMs ?? 1000) / 1000);
        setResponseHeader(event, 'Retry-After', String(retryAfterSec));
        throw createError({
            statusCode: 429,
            statusMessage: `Rate limit exceeded. Retry after ${retryAfterSec}s`,
        });
    }

    // Add rate limit headers
    const stats = getSyncRateLimitStats(session.userId, 'sync:push');
    if (stats) {
        setResponseHeader(event, 'X-RateLimit-Limit', String(stats.limit));
        setResponseHeader(event, 'X-RateLimit-Remaining', String(stats.remaining));
    }

    const token = await getClerkProviderToken(event, 'convex');
    if (!token) {
        throw createError({ statusCode: 401, statusMessage: 'Missing provider token' });
    }

    const client = getConvexGatewayClient(event, token);
    const result = await client.mutation(api.sync.push, {
        workspace_id: parsed.data.scope.workspaceId as Id<'workspaces'>,
        ops: parsed.data.ops.map((op) => ({
            op_id: op.stamp.opId,
            table_name: op.tableName,
            operation: op.operation,
            pk: op.pk,
            payload: op.payload,
            clock: op.stamp.clock,
            hlc: op.stamp.hlc,
            device_id: op.stamp.deviceId,
        })),
    });

    // Record successful request for rate limiting
    recordSyncRequest(session.userId, 'sync:push');

    return result;
});
