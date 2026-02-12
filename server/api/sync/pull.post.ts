/**
 * @module server/api/sync/pull.post
 *
 * Purpose:
 * Retrieves a batch of changes from the server for client-side synchronization.
 *
 * Responsibilities:
 * - Authorizes access (`workspace.read`).
 * - Enforces rate limits (`sync:pull`).
 * - Dispatches to registered SyncGatewayAdapter.
 * - Returns changes + new global cursor (server version).
 */
import { defineEventHandler, readBody, createError, setResponseHeader } from 'h3';
import { PullRequestSchema } from '~~/shared/sync/schemas';
import { resolveSessionContext } from '../../auth/session';
import { requireCan } from '../../auth/can';
import { isSsrAuthEnabled } from '../../utils/auth/is-ssr-auth-enabled';
import { isSyncEnabled } from '../../utils/sync/is-sync-enabled';
import { getActiveSyncGatewayAdapter } from '../../sync/gateway/registry';
import {
    checkSyncRateLimit,
    recordSyncRequest,
    getSyncRateLimitStats,
} from '../../utils/sync/rate-limiter';
import { setNoCacheHeaders } from '../../utils/headers';

/**
 * POST /api/sync/pull
 *
 * Purpose:
 * Client requests "what changed since cursor X?"
 *
 * Behavior:
 * 1. Validates schema and permissions.
 * 2. Checks token bucket rate limiter.
 * 3. Fetches changes via registered SyncGatewayAdapter.
 *
 * Security:
 * - Leaking change logs leaks data; strictly gated by `workspace.read`.
 */
export default defineEventHandler(async (event) => {
    if (!isSsrAuthEnabled(event) || !isSyncEnabled(event)) {
        throw createError({ statusCode: 404, statusMessage: 'Not Found' });
    }

    // Prevent caching of sensitive sync data
    setNoCacheHeaders(event);

    const body: unknown = await readBody(event);
    const parsed = PullRequestSchema.safeParse(body);
    if (!parsed.success) {
        throw createError({ statusCode: 400, statusMessage: 'Invalid pull request' });
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
    const rateLimitResult = checkSyncRateLimit(session.user.id, 'sync:pull');
    if (!rateLimitResult.allowed) {
        const retryAfterSec = Math.ceil((rateLimitResult.retryAfterMs ?? 1000) / 1000);
        setResponseHeader(event, 'Retry-After', retryAfterSec);
        throw createError({
            statusCode: 429,
            statusMessage: `Rate limit exceeded. Retry after ${retryAfterSec}s`,
        });
    }

    // Add rate limit headers
    const stats = getSyncRateLimitStats(session.user.id, 'sync:pull');
    if (stats) {
        setResponseHeader(event, 'X-RateLimit-Limit', String(stats.limit));
        setResponseHeader(event, 'X-RateLimit-Remaining', String(stats.remaining));
    }

    // Get sync gateway adapter from registry
    const adapter = getActiveSyncGatewayAdapter();
    if (!adapter) {
        throw createError({ statusCode: 500, statusMessage: 'Sync adapter not configured' });
    }

    // Dispatch to adapter
    const result = await adapter.pull(event, parsed.data);

    // Record successful request for rate limiting
    recordSyncRequest(session.user.id, 'sync:pull');

    return result;
});
