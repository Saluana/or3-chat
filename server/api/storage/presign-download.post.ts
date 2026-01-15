/**
 * POST /api/storage/presign-download
 * Gateway endpoint for storage downloads.
 */
import { defineEventHandler, readBody, createError, setResponseHeader } from 'h3';
import { z } from 'zod';
import { resolveSessionContext } from '../../auth/session';
import { requireCan } from '../../auth/can';
import { isSsrAuthEnabled } from '../../utils/auth/is-ssr-auth-enabled';
import { api } from '~~/convex/_generated/api';
import type { Id } from '~~/convex/_generated/dataModel';
import {
    getClerkProviderToken,
    getConvexGatewayClient,
} from '../../utils/sync/convex-gateway';
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

export default defineEventHandler(async (event) => {
    if (!isSsrAuthEnabled(event)) {
        throw createError({ statusCode: 404, statusMessage: 'Not Found' });
    }

    const body = BodySchema.safeParse(await readBody(event));
    if (!body.success) {
        throw createError({ statusCode: 400, statusMessage: 'Invalid request' });
    }

    const session = await resolveSessionContext(event);
    requireCan(session, 'workspace.read', {
        kind: 'workspace',
        id: body.data.workspace_id,
    });

    // Rate limiting
    const rateLimitResult = checkSyncRateLimit(session.user.id, 'storage:download');
    if (!rateLimitResult.allowed) {
        const retryAfterSec = Math.ceil((rateLimitResult.retryAfterMs ?? 1000) / 1000);
        setResponseHeader(event, 'Retry-After', String(retryAfterSec));
        throw createError({
            statusCode: 429,
            statusMessage: `Rate limit exceeded. Retry after ${retryAfterSec}s`,
        });
    }

    const token = await getClerkProviderToken(event, 'convex');
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

    const expiryMs = Math.min(body.data.expires_in_ms ?? 3600_000, 3600_000);

    recordSyncRequest(session.user.id, 'storage:download');
    recordDownloadStart();

    return {
        url: result.url,
        expiresAt: Date.now() + expiryMs,
        disposition: body.data.disposition,
    };
});
