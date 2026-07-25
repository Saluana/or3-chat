/**
 * @module server/api/admin/workspace/members/remove.post
 *
 * Purpose:
 * Removes a user from the workspace membership list.
 */
import { defineEventHandler, readBody, createError } from 'h3';
import { z } from 'zod';
import { requireAdminApiContext } from '../../../../admin/api';
import { getWorkspaceAccessStore } from '../../../../admin/stores/registry';
import { invalidateSharedSessionCacheForIdentity } from '../../../../auth/session';
import { useRuntimeConfig } from '#imports';
import { resolveAdminWorkspaceTarget } from '../../../../admin/workspace-target';

const BodySchema = z.object({
    userId: z.string().min(1),
    workspaceId: z.string().min(1).optional(),
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
    const context = await requireAdminApiContext(event, {
        ownerOnly: true,
        mutation: true,
        allowWorkspaceAdmin: true,
    });

    const body = BodySchema.safeParse(await readBody(event));
    if (!body.success) {
        throw createError({ statusCode: 400, statusMessage: 'Invalid request' });
    }

    const workspaceId = resolveAdminWorkspaceTarget(
        context,
        body.data.workspaceId
    );

    const store = getWorkspaceAccessStore(event);
    try {
        await store.removeMember({
            workspaceId,
            userId: body.data.userId,
        });
    } catch (error) {
        if (
            error instanceof Error &&
            error.message.includes('last workspace owner')
        ) {
            throw createError({
                statusCode: 409,
                statusMessage: error.message,
            });
        }
        throw error;
    }

    invalidateSharedSessionCacheForIdentity({
        storeId:
            (useRuntimeConfig(event).sync as { provider?: string } | undefined)?.provider ||
            (useRuntimeConfig(event).public as { sync?: { provider?: string } }).sync?.provider ||
            'convex',
    });

    return { ok: true };
});
