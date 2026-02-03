/**
 * @module server/api/storage/commit.post
 *
 * Purpose:
 * Finalizes a file upload by linking a storage blob to a workspace.
 *
 * Responsibilities:
 * - Proxy the `storage.commitUpload` mutation to the backend provider (Convex).
 * - Enforce `workspace.write` permissions.
 * - Enforce rate limits (`storage:commit`).
 * - Record analytics metrics.
 *
 * Architecture:
 * - Uses SSR Auth Gateway pattern.
 * - Backend agnostic (delegates via Gateway Client).
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
 * 3. Calls backend mutation to store metadata.
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

    const token = await getClerkProviderToken(event, CONVEX_JWT_TEMPLATE);
    if (!token) {
        throw createError({ statusCode: 401, statusMessage: 'Missing provider token' });
    }

    const client = getConvexGatewayClient(event, token);
    await client.mutation(api.storage.commitUpload, {
        workspace_id: body.data.workspace_id as Id<'workspaces'>,
        hash: body.data.hash,
        storage_id: body.data.storage_id as Id<'_storage'>,
        storage_provider_id: body.data.storage_provider_id,
        mime_type: body.data.mime_type,
        size_bytes: body.data.size_bytes,
        name: body.data.name,
        kind: body.data.kind,
        width: body.data.width,
        height: body.data.height,
        page_count: body.data.page_count,
    });

    recordSyncRequest(userId, 'storage:commit');
    recordUploadComplete(body.data.size_bytes);

    return { ok: true };
});
