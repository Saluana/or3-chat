/**
 * Deletes one workspace-scoped storage object through the active gateway.
 *
 * Authorization is enforced here, before provider dispatch. Providers must
 * independently validate any backend storage identifier against the canonical
 * workspace/hash-derived identifier and treat an absent object as success.
 */
import { requireCloudMutation } from '../../utils/security/cloud-mutation';
import { createError, defineEventHandler, readBody } from 'h3';
import { z } from 'zod';
import { requireCan } from '../../auth/can';
import { resolveSessionContext } from '../../auth/session';
import { getActiveStorageGatewayAdapter } from '../../storage/gateway/registry';
import { getActiveSyncGatewayAdapter } from '../../sync/gateway/registry';
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

    requireCloudMutation(event);

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

    // Preflight rejects known retained files. Atomic protection is provider-owned; use
    // canonical rows and retained edges, never the derived ref_count cache.
    const sync = getActiveSyncGatewayAdapter();
    if (!sync?.queryCanonicalStorage) {
        throw createError({ statusCode: 503, statusMessage: 'Canonical reference state is required for deletion' });
    }
    for (const kind of ['live_metadata', 'reference_edges'] as const) {
        let cursor: string | undefined;
        for (let pageNumber = 0; ; pageNumber++) {
            const page = await sync.queryCanonicalStorage(event, {
                scope: { workspaceId: body.data.workspace_id }, kind,
                hash: body.data.hash, cursor, limit: 100,
            });
            if (page.items.length) {
                throw createError({ statusCode: 409, statusMessage: 'Cannot delete a retained file' });
            }
            if (!page.hasMore) break;
            if (!page.nextCursor || page.nextCursor === cursor || pageNumber >= 99) {
                throw createError({ statusCode: 502, statusMessage: 'Canonical storage provider returned an invalid page' });
            }
            cursor = page.nextCursor;
        }
    }

    if (adapter.deletionCoordination?.version !== 1
        || adapter.deletionCoordination.syncProviderId !== sync.id) {
        throw createError({ statusCode: 503, statusMessage: 'Provider-owned deletion coordination is required' });
    }
    await adapter.deleteObject(event, {
        workspaceId: body.data.workspace_id,
        hash: body.data.hash,
        storageId: body.data.storage_id,
    });

    return { ok: true };
});
