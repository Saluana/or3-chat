import { createError, defineEventHandler, readBody, setResponseHeader } from 'h3';
import { z } from 'zod';
import { requireAdminApiContext } from '../../../../admin/api';
import { getAuthWorkspaceStore } from '../../../../auth/store/registry';
import { isAdminEnabled } from '../../../../utils/admin/is-admin-enabled';
import { resolveAdminWorkspaceTarget } from '../../../../admin/workspace-target';
import { getWorkspaceAccessStore } from '../../../../admin/stores/registry';

const BodySchema = z.object({
    inviteId: z.string().min(1),
    workspaceId: z.string().min(1).optional(),
});

function isMissingConvexFunctionError(error: unknown, functionName: string): boolean {
    if (!(error instanceof Error)) return false;
    return error.message.includes(`Could not find public function for '${functionName}'`);
}

export default defineEventHandler(async (event) => {
    if (!isAdminEnabled(event)) {
        throw createError({
            statusCode: 404,
            statusMessage: 'Not Found',
        });
    }

    const adminCtx = await requireAdminApiContext(event, {
        ownerOnly: true,
        mutation: true,
        allowWorkspaceAdmin: true,
    });
    setResponseHeader(event, 'Cache-Control', 'no-store');

    const body = BodySchema.safeParse(await readBody(event));
    if (!body.success) {
        throw createError({ statusCode: 400, statusMessage: 'Invalid request' });
    }
    const workspaceId = resolveAdminWorkspaceTarget(
        adminCtx,
        body.data.workspaceId
    );
    const workspace = await getWorkspaceAccessStore(event).getWorkspace({
        workspaceId,
    });
    if (!workspace) {
        throw createError({
            statusCode: 404,
            statusMessage: 'Workspace not found',
        });
    }
    const userId = adminCtx.session?.user?.id ?? workspace.ownerUserId;
    if (!userId) {
        throw createError({
            statusCode: 409,
            statusMessage: 'Workspace has no owner to attribute this action to',
        });
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

    try {
        await store.revokeInvite({
            workspaceId,
            inviteId: body.data.inviteId,
            revokedByUserId: userId,
        });
    } catch (error) {
        if (isMissingConvexFunctionError(error, 'workspaces:revokeInvite')) {
            throw createError({
                statusCode: 503,
                statusMessage:
                    'Invites are unavailable because Convex invite functions are not deployed.',
            });
        }
        throw error;
    }

    return { ok: true };
});
