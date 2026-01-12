/**
 * POST /api/storage/gc/run
 * Trigger storage GC for orphaned blobs.
 */
import { defineEventHandler, readBody, createError } from 'h3';
import { z } from 'zod';
import { resolveSessionContext } from '../../../auth/session';
import { requireCan } from '../../../auth/can';
import { isSsrAuthEnabled } from '../../../utils/auth/is-ssr-auth-enabled';
import { api } from '~~/convex/_generated/api';
import type { Id } from '~~/convex/_generated/dataModel';
import {
    getClerkProviderToken,
    getConvexGatewayClient,
} from '../../../utils/sync/convex-gateway';

const BodySchema = z.object({
    workspace_id: z.string(),
    retention_seconds: z.number().optional(),
    limit: z.number().optional(),
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
    requireCan(session, 'admin.access', {
        kind: 'workspace',
        id: body.data.workspace_id,
    });

    const token = await getClerkProviderToken(event, 'convex');
    if (!token) {
        throw createError({ statusCode: 401, statusMessage: 'Missing provider token' });
    }

    const client = getConvexGatewayClient(event, token);
    const retentionSeconds = body.data.retention_seconds ?? 30 * 24 * 3600;
    const result = await client.mutation(api.storage.gcDeletedFiles, {
        workspace_id: body.data.workspace_id as Id<'workspaces'>,
        retention_seconds: retentionSeconds,
        limit: body.data.limit,
    });

    return { deleted_count: result.deletedCount };
});
