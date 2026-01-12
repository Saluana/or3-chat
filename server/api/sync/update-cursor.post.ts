/**
 * POST /api/sync/update-cursor
 * Gateway endpoint for device cursor updates.
 */
import { defineEventHandler, readBody, createError } from 'h3';
import { z } from 'zod';
import { SyncScopeSchema } from '~~/shared/sync/schemas';
import { resolveSessionContext } from '../../auth/session';
import { requireCan } from '../../auth/can';
import { isSsrAuthEnabled } from '../../utils/auth/is-ssr-auth-enabled';
import { api } from '~~/convex/_generated/api';
import type { Id } from '~~/convex/_generated/dataModel';
import { getClerkProviderToken, getConvexGatewayClient } from '../../utils/sync/convex-gateway';

const UpdateCursorSchema = z.object({
    scope: SyncScopeSchema,
    deviceId: z.string(),
    version: z.number().int().nonnegative(),
});

export default defineEventHandler(async (event) => {
    if (!isSsrAuthEnabled(event)) {
        throw createError({ statusCode: 404, statusMessage: 'Not Found' });
    }

    const body = await readBody(event);
    const parsed = UpdateCursorSchema.safeParse(body);
    if (!parsed.success) {
        throw createError({ statusCode: 400, statusMessage: 'Invalid cursor request' });
    }

    const session = await resolveSessionContext(event);
    requireCan(session, 'workspace.read', {
        kind: 'workspace',
        id: parsed.data.scope.workspaceId,
    });

    const token = await getClerkProviderToken(event, 'convex');
    if (!token) {
        throw createError({ statusCode: 401, statusMessage: 'Missing provider token' });
    }

    const client = getConvexGatewayClient(event, token);
    await client.mutation(api.sync.updateDeviceCursor, {
        workspace_id: parsed.data.scope.workspaceId as Id<'workspaces'>,
        device_id: parsed.data.deviceId,
        last_seen_version: parsed.data.version,
    });

    return { ok: true };
});
