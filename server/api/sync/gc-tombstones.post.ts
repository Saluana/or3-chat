/**
 * @module server/api/sync/gc-tombstones.post
 *
 * Purpose:
 * Cleans up deletion markers (tombstones) that have exceeded the retention period.
 */
import { defineEventHandler, readBody, createError } from 'h3';
import { z } from 'zod';
import { SyncScopeSchema } from '~~/shared/sync/schemas';
import { resolveSessionContext } from '../../auth/session';
import { requireCan } from '../../auth/can';
import { isSsrAuthEnabled } from '../../utils/auth/is-ssr-auth-enabled';
import { isSyncEnabled } from '../../utils/sync/is-sync-enabled';
import { api } from '~~/convex/_generated/api';
import type { Id } from '~~/convex/_generated/dataModel';
import { getClerkProviderToken, getConvexGatewayClient } from '../../utils/sync/convex-gateway';
import { CONVEX_JWT_TEMPLATE } from '~~/shared/cloud/provider-ids';

const GcRequestSchema = z.object({
    scope: SyncScopeSchema,
    retentionSeconds: z.number().int().positive(),
});

/**
 * POST /api/sync/gc-tombstones
 *
 * Purpose:
 * Forget about deleted items after X time.
 *
 * Behavior:
 * - Proxies `api.sync.gcTombstones`.
 * - Requires `workspace.write` permissions.
 *
 * Impact:
 * - Clients that have been offline longer than `retentionSeconds` must do a full re-sync, as they will miss deletions.
 */
export default defineEventHandler(async (event) => {
    if (!isSsrAuthEnabled(event) || !isSyncEnabled(event)) {
        throw createError({ statusCode: 404, statusMessage: 'Not Found' });
    }

    const body: unknown = await readBody(event);
    const parsed = GcRequestSchema.safeParse(body);
    if (!parsed.success) {
        throw createError({ statusCode: 400, statusMessage: 'Invalid GC request' });
    }

    const session = await resolveSessionContext(event);
    requireCan(session, 'workspace.write', {
        kind: 'workspace',
        id: parsed.data.scope.workspaceId,
    });

    const token = await getClerkProviderToken(event, CONVEX_JWT_TEMPLATE);
    if (!token) {
        throw createError({ statusCode: 401, statusMessage: 'Missing provider token' });
    }

    const client = getConvexGatewayClient(event, token);
    const result = await client.mutation(api.sync.gcTombstones, {
        workspace_id: parsed.data.scope.workspaceId as Id<'workspaces'>,
        retention_seconds: parsed.data.retentionSeconds,
    });

    return result;
});
