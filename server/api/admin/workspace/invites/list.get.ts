import { createError, defineEventHandler, getQuery, setResponseHeader } from 'h3';
import { z } from 'zod';
import { requireAdminApiContext } from '../../../../admin/api';
import { getAuthWorkspaceStore } from '../../../../auth/store/registry';
import { isAdminEnabled } from '../../../../utils/admin/is-admin-enabled';

const QuerySchema = z.object({
    status: z.enum(['pending', 'accepted', 'revoked', 'expired']).optional(),
    limit: z.coerce.number().int().min(1).max(500).optional(),
});

export default defineEventHandler(async (event) => {
    if (!isAdminEnabled(event)) {
        throw createError({
            statusCode: 404,
            statusMessage: 'Not Found',
        });
    }

    const adminCtx = await requireAdminApiContext(event, { ownerOnly: true });
    setResponseHeader(event, 'Cache-Control', 'no-store');

    const session = adminCtx.session;
    if (!session?.workspace) {
        throw createError({
            statusCode: 403,
            statusMessage: 'Workspace admin session required',
        });
    }

    const workspaceId = session.workspace.id;

    const query = QuerySchema.safeParse(getQuery(event));
    if (!query.success) {
        throw createError({ statusCode: 400, statusMessage: 'Invalid query' });
    }

    const config = useRuntimeConfig();
    const storeId = config.public.sync.provider;
    const store = getAuthWorkspaceStore(storeId);
    if (!store || typeof store.listInvites !== 'function') {
        throw createError({
            statusCode: 503,
            statusMessage: 'Selected auth store does not support invites',
        });
    }

    const invites = await store.listInvites({
        workspaceId,
        status: query.data.status,
        limit: query.data.limit,
    });

    return { invites };
});
