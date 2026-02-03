/**
 * @module server/api/storage/presign-download.post
 *
 * Purpose:
 * Generates a short-lived URL for downloading a file directly from the storage provider.
 *
 * Responsibilities:
 * - Authorizes access to the file (`workspace.read`).
 * - Proxies the request to generate the signed URL (Convex `api.storage.getFileUrl`).
 * - Enforces rate limits (`storage:download`).
 * - Computes expiration time.
 */
import { defineEventHandler, readBody, createError, setResponseHeader } from 'h3';
import { z } from 'zod';
import { resolveSessionContext } from '../../auth/session';
import { requireCan } from '../../auth/can';
import { isSsrAuthEnabled } from '../../utils/auth/is-ssr-auth-enabled';
import { isStorageEnabled } from '../../utils/storage/is-storage-enabled';
import { api } from '~~/convex/_generated/api';
import type { Id } from '~~/convex/_generated/dataModel';
import {
    getClerkProviderToken,
    getConvexGatewayClient,
} from '../../utils/sync/convex-gateway';
import { CONVEX_JWT_TEMPLATE } from '~~/shared/cloud/provider-ids';
import {
    checkSyncRateLimit,
    recordSyncRequest,
} from '../../utils/sync/rate-limiter';
import { recordDownloadStart } from '../../utils/storage/metrics';
import { resolvePresignExpiresAt } from '../../utils/storage/presign-expiry';

const BodySchema = z.object({
    workspace_id: z.string(),
    hash: z.string(),
    storage_id: z.string().optional(),
    expires_in_ms: z.number().optional(),
    disposition: z.string().optional(),
});

/**
 * POST /api/storage/presign-download
 *
 * Purpose:
 * Secure file retrieval.
 *
 * Behavior:
 * - Checks if user can read the workspace.
 * - Rate limiting to prevent scraping.
 * - Returns a temporary URL that the client uses immediately.
 *
 * Security:
 * - URL expires (TTL configurable).
 * - Bypasses server bandwidth by directing client to R2/S3/Convex directly.
 */
export default defineEventHandler(async (event) => {
    if (!isSsrAuthEnabled(event) || !isStorageEnabled(event)) {
        throw createError({ statusCode: 404, statusMessage: 'Not Found' });
    }

    const body = BodySchema.safeParse(await readBody(event));
    if (!body.success) {
        throw createError({ statusCode: 400, statusMessage: 'Invalid request' });
    }

    const session = await resolveSessionContext(event);
    if (!session.authenticated || !session.user) {
        throw createError({ statusCode: 401, statusMessage: 'Unauthorized' });
    }
    requireCan(session, 'workspace.read', {
        kind: 'workspace',
        id: body.data.workspace_id,
    });

    // Rate limiting
    const userId = session.user.id;
    const rateLimitResult = checkSyncRateLimit(userId, 'storage:download');
    if (!rateLimitResult.allowed) {
        const retryAfterSec = Math.ceil((rateLimitResult.retryAfterMs ?? 1000) / 1000);
        setResponseHeader(event, 'Retry-After', retryAfterSec);
        throw createError({
            statusCode: 429,
            statusMessage: `Rate limit exceeded. Retry after ${retryAfterSec}s`,
        });
    }

    const token = await getClerkProviderToken(event, CONVEX_JWT_TEMPLATE);
    if (!token) {
        throw createError({ statusCode: 401, statusMessage: 'Missing provider token' });
    }

    const client = getConvexGatewayClient(event, token);
    const result = await client.query(api.storage.getFileUrl, {
        workspace_id: body.data.workspace_id as Id<'workspaces'>,
        hash: body.data.hash,
    });

    if (!result?.url) {
        throw createError({ statusCode: 404, statusMessage: 'File not found' });
    }

    const expiresAt = resolvePresignExpiresAt(result, body.data.expires_in_ms);

    recordSyncRequest(userId, 'storage:download');
    recordDownloadStart();

    return {
        url: result.url,
        expiresAt,
        disposition: body.data.disposition,
    };
});
