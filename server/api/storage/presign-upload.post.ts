/**
 * POST /api/storage/presign-upload
 * Gateway endpoint for storage uploads.
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
    mime_type: z.string(),
    size_bytes: z.number(),
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
    requireCan(session, 'workspace.write', {
        kind: 'workspace',
        id: body.data.workspace_id,
    });

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

    return {
        url: result.uploadUrl,
        expiresAt: Date.now() + expiryMs,
        disposition: body.data.disposition,
    };
});
