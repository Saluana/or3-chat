/**
 * POST /api/storage/presign-download
 * Gateway endpoint for storage downloads.
 */
import { defineEventHandler, readBody, createError } from 'h3';
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

    return {
        url: result.url,
        expiresAt: Date.now() + expiryMs,
        disposition: body.data.disposition,
    };
});
