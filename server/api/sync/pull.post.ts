/**
 * @module server/api/sync/pull.post
 *
 * Purpose:
 * Retrieves a batch of changes from the server for client-side synchronization.
 *
 * Responsibilities:
 * - Authorizes access (`workspace.read`).
 * - Enforces rate limits (`sync:pull`).
 * - Proxies request to backend (`api.sync.pull`).
 * - Returns changes + new global cursor (server version).
 */
import { defineEventHandler, readBody, createError, setResponseHeader } from 'h3';
import { PullRequestSchema } from '~~/shared/sync/schemas';
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

/**
 * POST /api/sync/pull
 *
 * Purpose:
 * Client requests "what changed since cursor X?"
 *
 * Behavior:
 * 1. Validates schema and permissions.
 * 2. Checks token bucket rate limiter.
 * 3. Fetches changes via Convex.
 *
 * Security:
 * - Leaking change logs leaks data; strictly gated by `workspace.read`.
 */
export default defineEventHandler(async (event) => {
    if (!isSsrAuthEnabled(event) || !isSyncEnabled(event)) {
        throw createError({ statusCode: 404, statusMessage: 'Not Found' });
    }

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
    const retryAfterDefaultMs = 1000;
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

    const token = await getClerkProviderToken(event, CONVEX_JWT_TEMPLATE);
    if (!token) {
        throw createError({ statusCode: 401, statusMessage: 'Missing provider token' });
    }

    const client = getConvexGatewayClient(event, token);
    const result = await client.query(api.sync.pull, {
        workspace_id: parsed.data.scope.workspaceId as Id<'workspaces'>,
        cursor: parsed.data.cursor,
        limit: parsed.data.limit,
        tables: parsed.data.tables,
    });

    // Record successful request for rate limiting
    recordSyncRequest(session.user.id, 'sync:pull');

    return result;
});
