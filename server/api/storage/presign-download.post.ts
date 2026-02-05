/**
 * @module server/api/storage/presign-download.post
 *
 * Purpose:
 * Generates a short-lived URL for downloading a file directly from the storage provider.
 *
 * Responsibilities:
 * - Authorizes access to the file (`workspace.read`).
 * - Dispatches to registered StorageGatewayAdapter.
 * - Enforces rate limits (`storage:download`).
 * - Computes expiration time.
 */
import { defineEventHandler, readBody, createError, setResponseHeader } from 'h3';
import { z } from 'zod';
import { resolveSessionContext } from '../../auth/session';
import { requireCan } from '../../auth/can';
import { isSsrAuthEnabled } from '../../utils/auth/is-ssr-auth-enabled';
import { isStorageEnabled } from '../../utils/storage/is-storage-enabled';
import { getActiveStorageGatewayAdapter } from '../../storage/gateway/registry';
import {
    checkSyncRateLimit,
    recordSyncRequest,
} from '../../utils/sync/rate-limiter';
import { recordDownloadStart } from '../../utils/storage/metrics';

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
 * - Returns a temporary URL via registered StorageGatewayAdapter.
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

    // Get storage gateway adapter from registry
    const adapter = getActiveStorageGatewayAdapter();
    if (!adapter) {
        throw createError({ statusCode: 500, statusMessage: 'Storage adapter not configured' });
    }

    // Dispatch to adapter
    const result = await adapter.presignDownload(event, {
        workspaceId: body.data.workspace_id,
        hash: body.data.hash,
        storageId: body.data.storage_id,
    });

    recordSyncRequest(userId, 'storage:download');
    recordDownloadStart();

    // Use provider expiry if available, otherwise fallback to server default
    const { DEFAULT_PRESIGN_EXPIRY_MS } = await import('../../utils/storage/presign-expiry');
    const expiresAt = result.expiresAt ?? Date.now() + DEFAULT_PRESIGN_EXPIRY_MS;

    return {
        url: result.url,
        expiresAt,
        disposition: body.data.disposition,
    };
});
