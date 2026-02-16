import { createError, defineEventHandler, readBody, setResponseHeader } from 'h3';
import { z } from 'zod';
import { requireAdminApiContext } from '../../../../admin/api';
import { getAuthWorkspaceStore } from '../../../../auth/store/registry';
import { isAdminEnabled } from '../../../../utils/admin/is-admin-enabled';

const BodySchema = z.object({
    inviteId: z.string().min(1),
});

export default defineEventHandler(async (event) => {
    if (!isAdminEnabled(event)) {
        throw createError({
            statusCode: 404,
            statusMessage: 'Not Found',
        });
    }

    const adminCtx = await requireAdminApiContext(event, { ownerOnly: true, mutation: true });
    setResponseHeader(event, 'Cache-Control', 'no-store');

    const session = adminCtx.session;
    if (!session?.workspace || !session.user) {
        throw createError({
            statusCode: 403,
            statusMessage: 'Workspace admin session required',
        });
    }

    const workspaceId = session.workspace.id;
    const userId = session.user.id;

    const body = BodySchema.safeParse(await readBody(event));
    if (!body.success) {
        throw createError({ statusCode: 400, statusMessage: 'Invalid request' });
    }

    const config = useRuntimeConfig();
    const storeId = config.public.sync.provider;
    const store = getAuthWorkspaceStore(storeId);
    if (!store || typeof store.revokeInvite !== 'function') {
        throw createError({
            statusCode: 503,
            statusMessage: 'Selected auth store does not support invites',
        });
    }

    await store.revokeInvite({
        workspaceId,
        inviteId: body.data.inviteId,
        revokedByUserId: userId,
    });

    return { ok: true };
});
