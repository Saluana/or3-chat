/**
 * @module server/api/sync/update-cursor.post
 *
 * Purpose:
 * Updates the "last seen" version for a specific device.
 * Used for calculating change log retention (don't GC data a device hasn't seen yet).
 */
import { defineEventHandler, readBody, createError, setResponseHeader } from 'h3';
import { z } from 'zod';
import { SyncScopeSchema } from '~~/shared/sync/schemas';
import { resolveSessionContext } from '../../auth/session';
import { requireCan } from '../../auth/can';
import { isSsrAuthEnabled } from '../../utils/auth/is-ssr-auth-enabled';
import { isSyncEnabled } from '../../utils/sync/is-sync-enabled';
import { api } from '~~/convex/_generated/api';
import type { Id } from '~~/convex/_generated/dataModel';
import { getClerkProviderToken, getConvexGatewayClient } from '../../utils/sync/convex-gateway';
import { CONVEX_JWT_TEMPLATE } from '~~/shared/cloud/provider-ids';
import {
    checkSyncRateLimit,
    recordSyncRequest,
    getSyncRateLimitStats,
} from '../../utils/sync/rate-limiter';

const UpdateCursorSchema = z.object({
    scope: SyncScopeSchema,
    deviceId: z.string(),
    version: z.number().int().nonnegative(),
});

/**
 * POST /api/sync/update-cursor
 *
 * Purpose:
 * Heartbeat/Checkpoint mechanism.
 *
 * Behavior:
 * - Updates `device_cursors` table in backend.
 * - Allows backend to safely trim oplog.
 */
export default defineEventHandler(async (event) => {
    if (!isSsrAuthEnabled(event) || !isSyncEnabled(event)) {
        throw createError({ statusCode: 404, statusMessage: 'Not Found' });
    }

    const body: unknown = await readBody(event);
    const parsed = UpdateCursorSchema.safeParse(body);
    if (!parsed.success) {
        throw createError({ statusCode: 400, statusMessage: 'Invalid cursor request' });
    }

    const session = await resolveSessionContext(event);
    if (!session.authenticated || !session.user || !session.workspace) {
        throw createError({ statusCode: 401, statusMessage: 'Unauthorized' });
    }

    requireCan(session, 'workspace.read', {
        kind: 'workspace',
        id: parsed.data.scope.workspaceId,
    });

    // Rate limiting (per-user)
    const retryAfterDefaultMs = 1000;
    const rateLimitResult = checkSyncRateLimit(session.user.id, 'sync:cursor');
    if (!rateLimitResult.allowed) {
        const retryAfterSec = Math.ceil((rateLimitResult.retryAfterMs ?? 1000) / 1000);
        setResponseHeader(event, 'Retry-After', retryAfterSec);
        throw createError({
            statusCode: 429,
            statusMessage: `Rate limit exceeded. Retry after ${retryAfterSec}s`,
        });
    }

    // Add rate limit headers
    const stats = getSyncRateLimitStats(session.user.id, 'sync:cursor');
    if (stats) {
        setResponseHeader(event, 'X-RateLimit-Limit', String(stats.limit));
        setResponseHeader(event, 'X-RateLimit-Remaining', String(stats.remaining));
    }

    const token = await getClerkProviderToken(event, CONVEX_JWT_TEMPLATE);
    if (!token) {
        throw createError({ statusCode: 401, statusMessage: 'Missing provider token' });
    }

    const client = getConvexGatewayClient(event, token);
    await client.mutation(api.sync.updateDeviceCursor, {
        workspace_id: parsed.data.scope.workspaceId as Id<'workspaces'>,
        device_id: parsed.data.deviceId,
        last_seen_version: parsed.data.version,
    });

    // Record successful request for rate limiting
    recordSyncRequest(session.user.id, 'sync:cursor');

    return { ok: true };
});
