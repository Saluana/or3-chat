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
import { defineEventHandler, readBody, createError } from 'h3';
import type { H3Event } from 'h3';
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
import { enforceRateLimit } from '../../utils/rate-limit/enforce';
import { recordDownloadStart } from '../../utils/storage/metrics';
import { setNoCacheHeaders } from '../../utils/headers';
import { resolvePresignExpiresAt } from '../../utils/storage/presign-expiry';
import { getActiveSyncGatewayAdapter } from '../../sync/gateway/registry';

const BodySchema = z.object({
    workspace_id: z.string().trim().min(1).max(256),
    hash: z.string().trim().min(1).max(256),
    storage_id: z.string().optional(),
    mime_type: z.string().min(1).optional(),
    expires_in_ms: z.number().int().min(1).max(86_400_000).optional(),
    disposition: z.enum(['inline', 'attachment']).optional(),
});

function normalizeDownloadHash(value: string): string | null {
    const normalized = value.trim().toLowerCase();
    if (/^sha256:[0-9a-f]{64}$/.test(normalized)) return normalized;
    if (/^[0-9a-f]{64}$/.test(normalized)) return `sha256:${normalized}`;
    if (/^md5:[0-9a-f]{32}$/.test(normalized)) return normalized;
    if (/^[0-9a-f]{32}$/.test(normalized)) return `md5:${normalized}`;
    return null;
}

async function resolveLiveStorageId(
    event: H3Event,
    workspaceId: string,
    hash: string,
): Promise<{ hash: string; storageId: string }> {
    const canonicalHash = normalizeDownloadHash(hash);
    if (!canonicalHash) {
        throw createError({ statusCode: 400, statusMessage: 'Invalid request' });
    }

    const syncAdapter = getActiveSyncGatewayAdapter();
    if (!syncAdapter?.queryCanonicalStorage) {
        throw createError({
            statusCode: 503,
            statusMessage: 'Storage authorization is not available',
        });
    }

    const page = await syncAdapter.queryCanonicalStorage(event, {
        scope: { workspaceId },
        kind: 'live_metadata',
        hash: canonicalHash,
        limit: 1,
    });
    if (page.hasMore && !page.nextCursor) {
        throw createError({
            statusCode: 502,
            statusMessage: 'Storage authorization provider returned an invalid page',
        });
    }

    const record = page.items.find((item) => {
        if (item.kind !== 'metadata' || typeof item.storageId !== 'string') {
            return false;
        }
        if ((item as { deleted?: unknown }).deleted === true) return false;
        const recordHash = normalizeDownloadHash(item.hash);
        return recordHash === canonicalHash && item.storageId.trim().length > 0;
    });
    if (!record || record.kind !== 'metadata' || !record.storageId) {
        // Keep missing, deleted, pending, and cross-workspace hashes
        // indistinguishable to callers.
        throw createError({ statusCode: 404, statusMessage: 'File not found' });
    }

    return { hash: canonicalHash, storageId: record.storageId.trim() };
}

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

    // Prevent caching of sensitive storage presign URLs
    setNoCacheHeaders(event);

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
    enforceRateLimit(event, rateLimitResult);

    const liveFile = await resolveLiveStorageId(
        event,
        body.data.workspace_id,
        body.data.hash,
    );

    // Get storage gateway adapter from registry
    const adapter = getActiveStorageGatewayAdapter();
    if (!adapter) {
        throw createError({ statusCode: 500, statusMessage: 'Storage adapter not configured' });
    }

    // Dispatch to adapter
    const result = await adapter.presignDownload(event, {
        workspaceId: body.data.workspace_id,
        hash: liveFile.hash,
        // The canonical metadata row, not the request body, selects the
        // provider object. This prevents stale or cross-object storage IDs
        // from becoming an authority.
        storageId: liveFile.storageId,
        mimeType: body.data.mime_type,
        expiresInMs: body.data.expires_in_ms,
        disposition: body.data.disposition,
    });

    recordSyncRequest(userId, 'storage:download');
    recordDownloadStart();

    const expiresAt = resolvePresignExpiresAt(result, body.data.expires_in_ms);

    return {
        url: result.url,
        expiresAt,
        disposition: body.data.disposition,
        ...(typeof result.method === 'string' ? { method: result.method } : {}),
        ...(result.headers ? { headers: result.headers } : {}),
        ...(typeof result.storageId === 'string' ? { storageId: result.storageId } : {}),
    };
});
