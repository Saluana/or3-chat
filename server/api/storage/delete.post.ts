/**
 * Deletes one workspace-scoped storage object through the active gateway.
 *
 * Authorization is enforced here, before provider dispatch. Providers must
 * independently validate any backend storage identifier against the canonical
 * workspace/hash-derived identifier and treat an absent object as success.
 */
import { createError, defineEventHandler, readBody } from 'h3';
import { z } from 'zod';
import { requireCan } from '../../auth/can';
import { resolveSessionContext } from '../../auth/session';
import { getActiveStorageGatewayAdapter } from '../../storage/gateway/registry';
import { isSsrAuthEnabled } from '../../utils/auth/is-ssr-auth-enabled';
import { isStorageEnabled } from '../../utils/storage/is-storage-enabled';

const BodySchema = z.object({
    workspace_id: z.string().trim().min(1),
    hash: z.string().trim().min(1),
    storage_id: z.string().trim().min(1).optional(),
}).strict();

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

    const adapter = getActiveStorageGatewayAdapter();
    if (!adapter) {
        throw createError({ statusCode: 500, statusMessage: 'Storage adapter not configured' });
    }
    if (!adapter.deleteObject) {
        throw createError({ statusCode: 501, statusMessage: 'Delete not supported by adapter' });
    }

    await adapter.deleteObject(event, {
        workspaceId: body.data.workspace_id,
        hash: body.data.hash,
        storageId: body.data.storage_id,
    });

    return { ok: true };
});
