/**
 * @module server/api/admin/workspace/members/set-role.post
 *
 * Purpose:
 * Updates the permission level (role) of a workspace member.
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
    role: z.enum(['owner', 'editor', 'viewer']),
    workspaceId: z.string().min(1).optional(),
});

/**
 * POST /api/admin/workspace/members/set-role
 *
 * Purpose:
 * Change member privileges.
 *
 * Behavior:
 * - Validate role enum.
 * - Call store update.
 * - Emit `admin.user:action:role_changed` hook.
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
        await store.setMemberRole({
            workspaceId,
            userId: body.data.userId,
            role: body.data.role,
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

    await event.context.adminHooks?.doAction('admin.user:action:role_changed', {
        workspaceId,
        userId: body.data.userId,
        role: body.data.role,
    });

    return { ok: true };
});
