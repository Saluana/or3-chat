/**
 * @module server/api/storage/commit.post
 *
 * Purpose:
 * Finalizes a file upload by linking a storage blob to a workspace.
 *
 * Responsibilities:
 * - Dispatches to registered StorageGatewayAdapter.
 * - Enforce `workspace.write` permissions.
 * - Enforce rate limits (`storage:commit`).
 * - Record analytics metrics.
 *
 * Architecture:
 * - Uses SSR Auth Gateway pattern.
 * - Backend agnostic (delegates via registry).
 */
import { defineEventHandler, readBody, createError, setResponseHeader } from 'h3';
import { z } from 'zod';
import { resolveSessionContext } from '../../auth/session';
import { requireCan } from '../../auth/can';
import { isSsrAuthEnabled } from '../../utils/auth/is-ssr-auth-enabled';
import { isStorageEnabled } from '../../utils/storage/is-storage-enabled';
import { getActiveStorageGatewayAdapter } from '../../storage/gateway/registry';
import { recordUploadComplete } from '../../utils/storage/metrics';
import {
    checkSyncRateLimit,
    recordSyncRequest,
} from '../../utils/sync/rate-limiter';

const BodySchema = z.object({
    workspace_id: z.string(),
    hash: z.string(),
    storage_id: z.string(),
    storage_provider_id: z.string(),
    mime_type: z.string(),
    size_bytes: z.number(),
    name: z.string(),
    kind: z.enum(['image', 'pdf']),
    width: z.number().optional(),
    height: z.number().optional(),
    page_count: z.number().optional(),
});

/**
 * POST /api/storage/commit
 *
 * Purpose:
 * Confirm that a file uploaded via presigned URL is valid and should be persisted.
 *
 * Behavior:
 * 1. Validates Session & Permission (`workspace.write`).
 * 2. Checks Rate Limit.
 * 3. Dispatches to adapter to store metadata.
 * 4. Records completion metric.
 *
 * Errors:
 * - 404: If Storage/Auth disabled.
 * - 429: Rate limit.
 * - 401: Unauthorized.
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
    requireCan(session, 'workspace.write', {
        kind: 'workspace',
        id: body.data.workspace_id,
    });

    const userId = session.user?.id;
    if (!userId) {
        throw createError({ statusCode: 401, statusMessage: 'Unauthorized' });
    }

    // Rate limiting
    const rateLimitResult = checkSyncRateLimit(userId, 'storage:commit');
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

    // Check if adapter supports commit
    if (adapter.commit) {
        // Dispatch to adapter
        await adapter.commit(event, body.data);
    }
    // If adapter doesn't support commit, it's a no-op (files are committed on upload)

    recordSyncRequest(userId, 'storage:commit');
    recordUploadComplete(body.data.size_bytes);

    return { ok: true };
});
