/**
 * POST /api/storage/commit
 * Link uploaded storage ID to file metadata.
 */
import { defineEventHandler, readBody, createError } from 'h3';
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
import { recordUploadComplete } from '../../utils/storage/metrics';

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

    const token = await getClerkProviderToken(event, 'convex');
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

    recordUploadComplete(body.data.size_bytes);

    return { ok: true };
});
