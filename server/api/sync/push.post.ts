/**
 * POST /api/sync/push
 * Gateway endpoint for sync push.
 */
import { defineEventHandler, readBody, createError, setResponseHeader } from 'h3';
import { PushBatchSchema, TABLE_PAYLOAD_SCHEMAS } from '~~/shared/sync/schemas';
import { toClientFormat } from '~~/shared/sync/field-mappings';
import { resolveSessionContext } from '../../auth/session';
import { requireCan } from '../../auth/can';
import { isSsrAuthEnabled } from '../../utils/auth/is-ssr-auth-enabled';
import { isSyncEnabled } from '../../utils/sync/is-sync-enabled';
import { api } from '~~/convex/_generated/api';
import type { Id } from '~~/convex/_generated/dataModel';
import { getClerkProviderToken, getConvexGatewayClient } from '../../utils/sync/convex-gateway';
import {
    checkSyncRateLimit,
    recordSyncRequest,
    getSyncRateLimitStats,
} from '../../utils/sync/rate-limiter';

export default defineEventHandler(async (event) => {
    if (!isSsrAuthEnabled(event) || !isSyncEnabled(event)) {
        throw createError({ statusCode: 404, statusMessage: 'Not Found' });
    }

    const body: unknown = await readBody(event);
    const parsed = PushBatchSchema.safeParse(body);
    if (!parsed.success) {
        throw createError({ statusCode: 400, statusMessage: 'Invalid push request' });
    }

    // Validate each op payload
    for (const op of parsed.data.ops) {
        if (op.payload) {
            const schema = TABLE_PAYLOAD_SCHEMAS[op.tableName];
            if (schema) {
                // Convert to client format for validation against shared schema (which expects camelCase)
                const normalizedPayload = toClientFormat(op.tableName, op.payload as Record<string, unknown>);
                const result = schema.safeParse(normalizedPayload);
                if (!result.success) {
                    throw createError({
                        statusCode: 400,
                        statusMessage: `Invalid payload for ${op.tableName}: ${result.error.message}`
                    });
                }
            }
        }
    }

    const session = await resolveSessionContext(event);
    if (!session.authenticated || !session.user || !session.workspace) {
        throw createError({ statusCode: 401, statusMessage: 'Unauthorized' });
    }

    requireCan(session, 'workspace.write', {
        kind: 'workspace',
        id: parsed.data.scope.workspaceId,
    });

    // Rate limiting (per-user)
    const retryAfterDefaultMs = 1000;
    const rateLimitResult = checkSyncRateLimit(session.user.id, 'sync:push');
    if (!rateLimitResult.allowed) {
        const retryAfterSec = Math.ceil(rateLimitResult.retryAfterMs / 1000);
        setResponseHeader(event, 'Retry-After', retryAfterSec);
        throw createError({
            statusCode: 429,
            statusMessage: `Rate limit exceeded. Retry after ${retryAfterSec}s`,
        });
    }

    // Add rate limit headers
    const stats = getSyncRateLimitStats(session.user.id, 'sync:push');
    setResponseHeader(event, 'X-RateLimit-Limit', String(stats.limit));
    setResponseHeader(event, 'X-RateLimit-Remaining', String(stats.remaining));

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
    recordSyncRequest(session.user.id, 'sync:push');

    return result;
});
