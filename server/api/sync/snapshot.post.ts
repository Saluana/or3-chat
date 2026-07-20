/**
 * @module server/api/sync/snapshot.post
 *
 * Returns one bounded page from a provider's consistent materialized snapshot.
 * Fresh clients atomically install the full page chain before replaying changes
 * strictly after its high-watermark.
 */
import { defineEventHandler, readBody, createError, setResponseHeader } from 'h3';
import { SnapshotRequestSchema, SnapshotResponseSchema } from '~~/shared/sync/schemas';
import { resolveSessionContext } from '../../auth/session';
import { requireCan } from '../../auth/can';
import { isSsrAuthEnabled } from '../../utils/auth/is-ssr-auth-enabled';
import { isSyncEnabled } from '../../utils/sync/is-sync-enabled';
import { getActiveSyncGatewayAdapter } from '../../sync/gateway/registry';
import {
    checkSyncRateLimit,
    getSyncRateLimitStats,
    recordSyncRequest,
} from '../../utils/sync/rate-limiter';
import { setNoCacheHeaders } from '../../utils/headers';

export default defineEventHandler(async (event) => {
    if (!isSsrAuthEnabled(event) || !isSyncEnabled(event)) {
        throw createError({ statusCode: 404, statusMessage: 'Not Found' });
    }

    setNoCacheHeaders(event);
    const request = SnapshotRequestSchema.safeParse(await readBody(event));
    if (!request.success) {
        throw createError({ statusCode: 400, statusMessage: 'Invalid snapshot request' });
    }

    const session = await resolveSessionContext(event);
    if (!session.authenticated || !session.user || !session.workspace) {
        throw createError({ statusCode: 401, statusMessage: 'Unauthorized' });
    }
    requireCan(session, 'workspace.read', {
        kind: 'workspace',
        id: request.data.scope.workspaceId,
    });

    const rateLimit = checkSyncRateLimit(session.user.id, 'sync:snapshot');
    if (!rateLimit.allowed) {
        const retryAfterSec = Math.ceil((rateLimit.retryAfterMs ?? 1000) / 1000);
        setResponseHeader(event, 'Retry-After', retryAfterSec);
        throw createError({
            statusCode: 429,
            statusMessage: `Rate limit exceeded. Retry after ${retryAfterSec}s`,
        });
    }

    const stats = getSyncRateLimitStats(session.user.id, 'sync:snapshot');
    if (stats) {
        setResponseHeader(event, 'X-RateLimit-Limit', String(stats.limit));
        setResponseHeader(event, 'X-RateLimit-Remaining', String(stats.remaining));
    }

    const adapter = getActiveSyncGatewayAdapter();
    if (!adapter?.snapshot) {
        throw createError({
            statusCode: 503,
            statusMessage: 'Snapshot bootstrap unavailable for active sync adapter',
        });
    }

    const response = SnapshotResponseSchema.safeParse(
        await adapter.snapshot(event, request.data)
    );
    if (!response.success) {
        throw createError({ statusCode: 502, statusMessage: 'Invalid snapshot response' });
    }

    recordSyncRequest(session.user.id, 'sync:snapshot');
    return response.data;
});
