/**
 * POST /api/sync/push
 * Gateway endpoint for sync push.
 */
import { defineEventHandler, readBody, createError } from 'h3';
import { PushBatchSchema } from '~~/shared/sync/schemas';
import { resolveSessionContext } from '../../auth/session';
import { requireCan } from '../../auth/can';
import { isSsrAuthEnabled } from '../../utils/auth/is-ssr-auth-enabled';
import { api } from '~~/convex/_generated/api';
import type { Id } from '~~/convex/_generated/dataModel';
import { getClerkProviderToken, getConvexGatewayClient } from '../../utils/sync/convex-gateway';

export default defineEventHandler(async (event) => {
    if (!isSsrAuthEnabled(event)) {
        throw createError({ statusCode: 404, statusMessage: 'Not Found' });
    }

    const body = await readBody(event);
    const parsed = PushBatchSchema.safeParse(body);
    if (!parsed.success) {
        throw createError({ statusCode: 400, statusMessage: 'Invalid push request' });
    }

    const session = await resolveSessionContext(event);
    requireCan(session, 'workspace.write', {
        kind: 'workspace',
        id: parsed.data.scope.workspaceId,
    });

    const token = await getClerkProviderToken(event, 'convex');
    if (!token) {
        throw createError({ statusCode: 401, statusMessage: 'Missing provider token' });
    }

    const client = getConvexGatewayClient(event, token);
    const result = await client.mutation(api.sync.push, {
        workspace_id: parsed.data.scope.workspaceId as Id<'workspaces'>,
        ops: parsed.data.ops.map((op) => ({
            op_id: op.stamp.opId,
            table_name: op.tableName,
            operation: op.operation,
            pk: op.pk,
            payload: op.payload,
            clock: op.stamp.clock,
            hlc: op.stamp.hlc,
            device_id: op.stamp.deviceId,
        })),
    });

    return result;
});
