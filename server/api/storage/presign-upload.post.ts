/**
 * POST /api/storage/presign-upload
 * Gateway endpoint for storage uploads.
 */
import { defineEventHandler, readBody, createError, setResponseHeader } from 'h3';
import { z } from 'zod';
import { resolveSessionContext } from '../../auth/session';
import { requireCan } from '../../auth/can';
import { isSsrAuthEnabled } from '../../utils/auth/is-ssr-auth-enabled';
import { isStorageEnabled } from '../../utils/storage/is-storage-enabled';
import { api } from '~~/convex/_generated/api';
import type { Id } from '~~/convex/_generated/dataModel';
import { or3Config } from '~~/config.or3';
import {
    getClerkProviderToken,
    getConvexGatewayClient,
} from '../../utils/sync/convex-gateway';
import {
    checkSyncRateLimit,
    recordSyncRequest,
} from '../../utils/sync/rate-limiter';
import { recordUploadStart } from '../../utils/storage/metrics';

const BodySchema = z.object({
    workspace_id: z.string(),
    hash: z.string(),
    mime_type: z.string(),
    size_bytes: z.number(),
    expires_in_ms: z.number().optional(),
    disposition: z.string().optional(),
});

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
    requireCan(session, 'workspace.write', {
        kind: 'workspace',
        id: body.data.workspace_id,
    });

    // Rate limiting
    const userId = session.user.id;
    const rateLimitResult = checkSyncRateLimit(userId, 'storage:upload');
    if (!rateLimitResult.allowed) {
        const retryAfterSec = Math.ceil((rateLimitResult.retryAfterMs ?? 1000) / 1000);
        setResponseHeader(event, 'Retry-After', retryAfterSec);
        throw createError({
            statusCode: 429,
            statusMessage: `Rate limit exceeded. Retry after ${retryAfterSec}s`,
        });
    }

    // Size limit check (from config)
    const MAX_FILE_SIZE = or3Config.limits.maxCloudFileSizeBytes;
    if (body.data.size_bytes > MAX_FILE_SIZE) {
        throw createError({
            statusCode: 413,
            statusMessage: `File size exceeds maximum of ${MAX_FILE_SIZE} bytes`
        });
    }

    // MIME type allowlist check
    const ALLOWED_MIME_TYPES = [
        'image/jpeg',
        'image/png',
        'image/gif',
        'image/webp',
        'application/pdf',
        'text/plain',
        'text/markdown',
    ];

    if (!ALLOWED_MIME_TYPES.includes(body.data.mime_type)) {
        throw createError({
            statusCode: 415,
            statusMessage: `MIME type ${body.data.mime_type} not allowed`
        });
    }

    const token = await getClerkProviderToken(event, 'convex');
    if (!token) {
        throw createError({ statusCode: 401, statusMessage: 'Missing provider token' });
    }

    const client = getConvexGatewayClient(event, token);
    const result = await client.mutation(api.storage.generateUploadUrl, {
        workspace_id: body.data.workspace_id as Id<'workspaces'>,
        hash: body.data.hash,
        mime_type: body.data.mime_type,
        size_bytes: body.data.size_bytes,
    });

    const expiryMs = Math.min(body.data.expires_in_ms ?? 3600_000, 3600_000);

    recordSyncRequest(userId, 'storage:upload');
    recordUploadStart();

    return {
        url: result.uploadUrl,
        expiresAt: Date.now() + expiryMs,
        disposition: body.data.disposition,
    };
});
