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
import { defineEventHandler, createError, setResponseHeader } from 'h3';
import {
    PullRequestSchema,
    PullResponseSchema,
    getPullResponseContractError,
} from '~~/shared/sync/schemas';
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
import { enforceRateLimit } from '../../utils/rate-limit/enforce';
import { setNoCacheHeaders } from '../../utils/headers';
import { readLimitedJsonBody } from '../../utils/security/limited-json-body';

const MAX_SYNC_PULL_REQUEST_BYTES = 8 * 1024;

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

    const body: unknown = await readLimitedJsonBody(
        event,
        MAX_SYNC_PULL_REQUEST_BYTES
    );
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

    const rateLimitResult = checkSyncRateLimit(session.user.id, 'sync:pull');
    enforceRateLimit(event, rateLimitResult);

    const stats = getSyncRateLimitStats(session.user.id, 'sync:pull');
    if (stats) {
        setResponseHeader(event, 'X-RateLimit-Limit', String(stats.limit));
        setResponseHeader(event, 'X-RateLimit-Remaining', String(stats.remaining));
    }

    recordSyncRequest(session.user.id, 'sync:pull');

    const adapter = getActiveSyncGatewayAdapter();
    if (!adapter) {
        throw createError({ statusCode: 500, statusMessage: 'Sync adapter not configured' });
    }

    const result = PullResponseSchema.safeParse(
        await adapter.pull(event, parsed.data)
    );
    if (
        !result.success ||
        getPullResponseContractError(parsed.data, result.data)
    ) {
        throw createError({
            statusCode: 502,
            statusMessage: 'Invalid pull response',
        });
    }

    return result.data;
});
