/**
 * @module server/api/admin/workspace/members/remove.post
 *
 * Purpose:
 * Removes a user from the workspace membership list.
 */
import { defineEventHandler, readBody, createError } from 'h3';
import { z } from 'zod';
import { requireAdminApi } from '../../../../admin/api';
import { getWorkspaceAccessStore } from '../../../../admin/stores/registry';

const BodySchema = z.object({
    userId: z.string().min(1),
});

/**
 * POST /api/admin/workspace/members/remove
 *
 * Purpose:
 * Revoke workspace access for a specific user.
 *
 * Behavior:
 * - Removes the membership record.
 * - Does not delete the user, only the association.
 */
export default defineEventHandler(async (event) => {
    const session = await requireAdminApi(event, { ownerOnly: true, mutation: true });

    const body = BodySchema.safeParse(await readBody(event));
    if (!body.success) {
        throw createError({ statusCode: 400, statusMessage: 'Invalid request' });
    }

    const workspaceId = session.workspace?.id;
    if (!workspaceId) {
        throw createError({ statusCode: 400, statusMessage: 'Workspace not resolved' });
    }

    const store = getWorkspaceAccessStore(event);
    await store.removeMember({
        workspaceId,
        userId: body.data.userId,
    });

    return { ok: true };
});
